'use strict';

/*
 * Patch keeper multi-synthés.
 * Le fichier synths.json décrit les synthétiseurs et leurs contrôles.
 */

const SYNTHS_FILE = './synths.json';
const STORAGE_KEYS = {
  draft: 'patch-keeper-draft',
  bank: 'patch-keeper-bank',
};

const elements = {};
let synths = [];
let currentSynth = null;
let controls = [];
let state = {};
let bank = [];
let cleanState = '';
let toastTimeout;

function getElement(id) {
  return document.getElementById(id);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

// Propriétés communes aux potentiomètres et faders.
// Les valeurs historiques (0–10, pas de 0.1) restent implicites.
function getNumericConfig(control) {
  return {
    min: control.min ?? 0,
    max: control.max ?? 10,
    step: control.step ?? 0.1,
    defaultValue: control.default ?? control.min ?? 0,
    unit: control.unit ?? '',
    center: control.center ?? false,
  };
}

function decimalPlaces(value) {
  const str = String(value).toLowerCase();
  if (str.includes('e-')) {
    const [mantissa, exponent] = str.split('e-');
    return Math.min(10, Number(exponent) + (mantissa.split('.')[1]?.length || 0));
  }
  return Math.min(10, str.split('.')[1]?.length || 0);
}

function normalizeNumericValue(control, rawValue) {
  const { min, max, step, defaultValue } = getNumericConfig(control);
  const invalid = rawValue === undefined || rawValue === null ||
    typeof rawValue === 'boolean' ||
    (typeof rawValue === 'string' && rawValue.trim() === '');
  const parsed = invalid ? NaN : Number(rawValue);
  const number = Number.isFinite(parsed) ? parsed : defaultValue;

  if (number <= min) return min;
  if (number >= max) return max;

  const stepsFromMin = (number - min) / step;
  // Compense les erreurs d'arrondi binaire sur les demi-pas (ex. 9.95 / 0.1).
  const tickCount = Math.round(stepsFromMin + Number.EPSILON * Math.max(1, Math.abs(stepsFromMin)) * 2);
  const snapped = min + tickCount * step;
  const precision = Math.max(decimalPlaces(min), decimalPlaces(max), decimalPlaces(step));
  return Math.max(min, Math.min(max, Number(snapped.toFixed(precision))));
}

function formatNumericValue(control, value) {
  const { min, max, step, unit } = getNumericConfig(control);
  const precision = Math.max(decimalPlaces(min), decimalPlaces(max), decimalPlaces(step));
  return `${value.toFixed(precision)}${unit ? ` ${unit}` : ''}`;
}

function relativePosition(control, value) {
  const { min, max } = getNumericConfig(control);
  return (value - min) / (max - min);
}

function supportsZeroMark(control) {
  const { min, max, center } = getNumericConfig(control);
  return center && min <= 0 && max >= 0;
}

function showToast(message, duration = 3000) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, duration);
}

function getEditableSnapshot() {
  return JSON.stringify({
    synth_id: currentSynth?.id ?? null,
    name: elements.name.value,
    notes: elements.notes.value,
    params: state,
  });
}

function markAsClean() {
  cleanState = getEditableSnapshot();
}

function isDirty() {
  return getEditableSnapshot() !== cleanState;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({
      synth_id: currentSynth?.id ?? null,
      name: elements.name.value,
      notes: elements.notes.value,
      params: state,
    }));
    localStorage.setItem(STORAGE_KEYS.bank, JSON.stringify(bank));
  } catch (error) {
    // Le stockage local peut être indisponible dans certains contextes du navigateur.
  }
}

function createDefaultState(templateControls) {
  return Object.fromEntries(templateControls.map((control) => {
    if (control.type === 'select') return [control.name, control.values[0]];
    if (control.type === 'multiselect') {
      // Chaque option est désactivée par défaut, sauf si un tableau default est fourni.
      const selected = Array.isArray(control.default) ? control.default : [];
      return [control.name, control.values.filter((value) => selected.includes(value))];
    }
    if (control.type === 'toggle') return [control.name, false];
    return [control.name, normalizeNumericValue(control, getNumericConfig(control).defaultValue)];
  }));
}

function validateSynths(data) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Le fichier synths.json doit contenir un tableau non vide.');
  }

  const ids = new Set();

  data.forEach((synth) => {
    if (!synth || typeof synth.id !== 'string' || !synth.id.trim()) {
      throw new Error('Chaque synthétiseur doit avoir un id non vide.');
    }
    if (ids.has(synth.id)) {
      throw new Error(`Identifiant de synthétiseur en double : ${synth.id}`);
    }
    ids.add(synth.id);

    if (typeof synth.name !== 'string' || !synth.name.trim()) {
      throw new Error(`Le synthétiseur ${synth.id} doit avoir un nom.`);
    }
    if (!Array.isArray(synth.template)) {
      throw new Error(`Le template de ${synth.name} doit être un tableau.`);
    }

    const controlNames = new Set();
    synth.template.forEach((section) => {
      if (!section || typeof section.title !== 'string' || !Array.isArray(section.controls)) {
        throw new Error(`Section invalide dans le template de ${synth.name}.`);
      }

      section.controls.forEach((control) => {
        if (!control || typeof control.name !== 'string' || !control.name.trim()) {
          throw new Error(`Un contrôle de ${synth.name} ne possède pas de name.`);
        }
        if (controlNames.has(control.name)) {
          throw new Error(`Contrôle "${control.name}" défini plusieurs fois dans ${synth.name}.`);
        }
        controlNames.add(control.name);

        if (!['knob', 'fader', 'select', 'multiselect', 'toggle'].includes(control.type)) {
          throw new Error(`Type "${control.type}" non reconnu pour ${control.name}.`);
        }
        if (['select', 'multiselect'].includes(control.type)) {
          if (!Array.isArray(control.values) || control.values.length === 0 ||
              control.values.some((value) => typeof value !== 'string') ||
              new Set(control.values).size !== control.values.length) {
            throw new Error(`Le contrôle ${control.type} "${control.name}" doit proposer des chaînes uniques dans values.`);
          }
        }
        if (control.type === 'multiselect' && control.default !== undefined &&
            (!Array.isArray(control.default) ||
             control.default.some((value) => !control.values.includes(value)))) {
          throw new Error(`Le défaut du multiselect "${control.name}" doit être un tableau de valeurs autorisées.`);
        }
        if (['knob', 'fader'].includes(control.type)) {
          for (const key of ['min', 'max', 'step', 'default']) {
            if (control[key] !== undefined &&
                (typeof control[key] !== 'number' || !Number.isFinite(control[key]))) {
              throw new Error(`Le champ "${key}" de "${control.name}" doit être un nombre fini.`);
            }
          }
          const { min, max, step, defaultValue } = getNumericConfig(control);
          if (min >= max || step <= 0 || defaultValue < min || defaultValue > max) {
            throw new Error(`Plage, pas ou défaut invalide pour "${control.name}" (min < max, step > 0, default dans la plage).`);
          }
          if (control.unit !== undefined && typeof control.unit !== 'string') {
            throw new Error(`Le champ "unit" de "${control.name}" doit être une chaîne.`);
          }
          if (control.center !== undefined && typeof control.center !== 'boolean') {
            throw new Error(`Le champ "center" de "${control.name}" doit être un booléen.`);
          }
        }
      });
    });
  });

  return data;
}

function flattenTemplate(synth) {
  return synth.template.flatMap((section) => section.controls);
}

function populateSynthPicker() {
  elements.synthSelect.replaceChildren();

  synths.forEach((synth) => {
    const option = createElement('option', '', synth.name);
    option.value = synth.id;
    elements.synthSelect.append(option);
  });

  elements.synthSelect.disabled = false;
}

function configureSlider(element, control, onChange) {
  const { min, max, step } = getNumericConfig(control);
  element.tabIndex = 0;
  element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', control.display_name || control.name);
  element.setAttribute('aria-valuemin', String(min));
  element.setAttribute('aria-valuemax', String(max));

  element.addEventListener('keydown', (event) => {
    const increments = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: step * 10,
      PageDown: -step * 10,
    };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? min : max);
      return;
    }
    const increment = increments[event.key];
    if (increment === undefined) return;
    event.preventDefault();
    onChange(state[control.name] + increment);
  });
}

function buildFader(control, wrapper, valueElement) {
  const { min, max } = getNumericConfig(control);
  const track = createElement('div', 'fader-track');
  const cap = createElement('div', 'fader-cap');
  track.append(cap);

  if (supportsZeroMark(control)) {
    const zeroMark = createElement('span', 'fader-zero-mark');
    zeroMark.style.bottom = `calc((100% - 30px) * ${relativePosition(control, 0)} + 15px)`;
    zeroMark.setAttribute('aria-hidden', 'true');
    track.append(zeroMark);
  }

  configureSlider(track, control, (value) => setControlValue(control.name, value));

  const valueFromPointer = (clientY) => {
    const bounds = track.getBoundingClientRect();
    const position = Math.max(0, Math.min(1,
      1 - (clientY - bounds.top - 15) / (bounds.height - 30)));
    return min + position * (max - min);
  };

  track.addEventListener('pointerdown', (event) => {
    track.setPointerCapture(event.pointerId);
    setControlValue(control.name, valueFromPointer(event.clientY));
  });

  track.addEventListener('pointermove', (event) => {
    if (track.hasPointerCapture(event.pointerId)) {
      setControlValue(control.name, valueFromPointer(event.clientY));
    }
  });

  control.update = (value) => {
    cap.style.bottom = `calc((100% - 30px) * ${relativePosition(control, value)})`;
    valueElement.textContent = formatNumericValue(control, value);
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', formatNumericValue(control, value));
  };

  wrapper.append(track, valueElement);
}

function buildKnob(control, wrapper, valueElement) {
  const { min, max } = getNumericConfig(control);
  const knob = createElement('div', 'knob');
  const indicator = createElement('i', 'knob-indicator');
  knob.append(indicator);

  if (supportsZeroMark(control)) {
    const zeroMark = createElement('span', 'knob-zero-mark');
    zeroMark.style.transform = `rotate(${-135 + relativePosition(control, 0) * 270}deg)`;
    zeroMark.setAttribute('aria-hidden', 'true');
    knob.append(zeroMark);
  }

  configureSlider(knob, control, (value) => setControlValue(control.name, value));

  let startY = 0;
  let startValue = 0;

  knob.addEventListener('pointerdown', (event) => {
    knob.setPointerCapture(event.pointerId);
    startY = event.clientY;
    startValue = state[control.name];
  });

  knob.addEventListener('pointermove', (event) => {
    if (knob.hasPointerCapture(event.pointerId)) {
      setControlValue(
        control.name,
        startValue + (startY - event.clientY) * (max - min) / 200,
      );
    }
  });

  control.update = (value) => {
    indicator.style.transform = `rotate(${-135 + relativePosition(control, value) * 270}deg)`;
    valueElement.textContent = formatNumericValue(control, value);
    knob.setAttribute('aria-valuenow', String(value));
    knob.setAttribute('aria-valuetext', formatNumericValue(control, value));
  };

  wrapper.append(knob, valueElement);
}

function buildOptions(control, wrapper) {
  const isMultiple = control.type === 'multiselect';
  const values = control.type === 'toggle'
    ? [['Off', false], ['On', true]]
    : control.values.map((value) => [value, value]);

  const optionsElement = createElement('div',
    `options${control.inline ? ' options--inline' : ''}`);
  optionsElement.setAttribute('role', 'group');
  optionsElement.setAttribute('aria-label', control.display_name || control.name);
  const buttons = [];

  values.forEach(([label, value]) => {
    const button = createElement('button', '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (!isMultiple) {
        setControlValue(control.name, value);
        return;
      }

      const selected = state[control.name];
      const nextValues = selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value];
      // Conserver un ordre stable pour le JSON, quel que soit l'ordre des clics.
      setControlValue(control.name,
        control.values.filter((item) => nextValues.includes(item)));
    });
    buttons.push({ button, value });
    optionsElement.append(button);
  });

  control.update = (value) => {
    buttons.forEach(({ button, value: optionValue }) => {
      const pressed = isMultiple ? value.includes(optionValue) : optionValue === value;
      button.setAttribute('aria-pressed', String(pressed));
    });
  };

  wrapper.append(optionsElement);
}

function buildControl(control) {
  const wrapper = createElement('div', 'control');
  const label = createElement('label', '', control.display_name || control.name);
  const value = createElement('div', 'control-value');

  if (control.type === 'fader') {
    buildFader(control, wrapper, value);
  } else if (control.type === 'knob') {
    buildKnob(control, wrapper, value);
  } else {
    buildOptions(control, wrapper);
  }

  wrapper.append(label);
  return wrapper;
}

function buildInterface() {
  elements.synth.replaceChildren();
  controls = flattenTemplate(currentSynth);

  currentSynth.template.forEach((section) => {
    const sectionElement = createElement('section', 'synth-section');
    const heading = createElement('h2', '', section.title);
    const row = createElement('div', 'control-row');

    section.controls.forEach((controlDefinition) => {
      const control = { ...controlDefinition };
      row.append(buildControl(control));
      const original = controls.find((item) => item.name === control.name);
      original.update = control.update;
    });

    sectionElement.append(heading, row);
    elements.synth.append(sectionElement);
  });
}

function setControlValue(name, value) {
  const control = controls.find((item) => item.name === name);
  if (!control) return;

  const nextValue = ['knob', 'fader'].includes(control.type)
    ? normalizeNumericValue(control, value)
    : value;
  state[name] = nextValue;
  control.update?.(nextValue);
  persist();
}

function updateAllControls() {
  controls.forEach((control) => control.update?.(state[control.name]));
}

function applyPatch(patch) {
  if (!patch || patch.synth_id !== currentSynth.id) {
    const receivedId = patch?.synth_id || 'absent';
    showToast(
      `Patch incompatible : synth_id "${receivedId}", synthétiseur actif "${currentSynth.id}".`,
      5000,
    );
    return false;
  }

  const defaults = createDefaultState(controls);
  controls.forEach((control) => {
    let value = patch.params?.[control.name];

    if (control.type === 'select') {
      if (!control.values.includes(value)) value = defaults[control.name];
    } else if (control.type === 'multiselect') {
      // Les anciens patches peuvent ne pas contenir ce paramètre.
      // Ignorer les valeurs inconnues et éviter les doublons.
      value = Array.isArray(value)
        ? control.values.filter((option) => value.includes(option))
        : defaults[control.name];
    } else if (control.type === 'toggle') {
      value = value === true;
    } else {
      // Réutilise le défaut du template pour les paramètres absents ou invalides.
      value = normalizeNumericValue(control, value);
    }

    state[control.name] = value;
  });

  elements.name.value = patch.name || '';
  elements.notes.value = patch.notes || '';
  updateAllControls();
  markAsClean();
  persist();
  return true;
}

function createSnapshot() {
  return {
    synth_id: currentSynth.id,
    synth: currentSynth.name,
    version: 1,
    name: elements.name.value.trim() || 'Sans titre',
    notes: elements.notes.value,
    saved: new Date().toISOString(),
    params: { ...state },
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createSlug(value) {
  return value.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'patch';
}

function saveCurrentPatch() {
  const patch = createSnapshot();
  downloadJson(patch, `${createSlug(patch.name)}.json`);
  markAsClean();
  persist();
  showToast('Patch téléchargé');
}

function addCurrentPatch() {
  const patch = createSnapshot();
  const existingIndex = bank.findIndex((item) =>
    item.name === patch.name && item.synth_id === patch.synth_id
  );

  if (existingIndex >= 0) {
    bank[existingIndex] = patch;
    showToast(`Patch « ${patch.name} » mis à jour`);
  } else {
    bank.push(patch);
    showToast('Patch ajouté à la banque');
  }

  markAsClean();
  renderBank();
  persist();
}

function renderBank() {
  elements.bank.replaceChildren();

  if (!bank.length) {
    elements.bank.append(createElement(
      'li',
      'empty-message',
      'Aucun patch. Ajoutez le patch courant ou ouvrez un fichier.',
    ));
    return;
  }

  bank.forEach((patch, index) => {
    const item = createElement('li');
    const recallButton = createElement('button', '', patch.name || 'Sans titre');
    const removeButton = createElement('button', '', '×');
    const compatible = patch.synth_id === currentSynth.id;

    recallButton.type = 'button';
    recallButton.title = compatible
      ? 'Rappeler ce patch'
      : `Patch d'un autre synthétiseur (${patch.synth_id || 'identifiant absent'})`;
    if (!compatible) recallButton.classList.add('is-incompatible');

    recallButton.addEventListener('click', () => {
      if (!compatible) {
        showToast(
          `Ce patch appartient à "${patch.synth_id || 'un ancien format'}", pas à "${currentSynth.id}".`,
          5000,
        );
        return;
      }
      applyPatch(patch);
      showToast(`Patch « ${patch.name} » rappelé`);
    });

    removeButton.type = 'button';
    removeButton.title = 'Retirer de la banque';
    removeButton.setAttribute('aria-label', `Retirer ${patch.name || 'ce patch'}`);
    removeButton.addEventListener('click', () => {
      bank.splice(index, 1);
      renderBank();
      persist();
    });

    item.append(recallButton, removeButton);
    elements.bank.append(item);
  });
}

function switchSynth(synthId) {
  const nextSynth = synths.find((synth) => synth.id === synthId);
  if (!nextSynth || nextSynth.id === currentSynth?.id) return;

  if (isDirty()) {
    const confirmed = window.confirm(
      `Le patch actuellement ouvert a été modifié.\n\n` +
      `Si tu changes de synthétiseur, les modifications non sauvegardées seront perdues.\n\n` +
      `Clique sur « Annuler » pour rester sur ce synthétiseur et sauvegarder ton patch, ` +
      `ou sur « OK » pour continuer et réinitialiser le panneau.`,
    );

    if (!confirmed) {
      elements.synthSelect.value = currentSynth.id;
      return;
    }
  }

  currentSynth = nextSynth;
  elements.synthSelect.value = currentSynth.id;
  state = createDefaultState(flattenTemplate(currentSynth));
  elements.name.value = '';
  elements.notes.value = '';
  buildInterface();
  updateAllControls();
  markAsClean();
  persist();
  renderBank();
  showToast(`${currentSynth.name} sélectionné`);
}

function importPatchObject(patch, sourceName) {
  if (!patch || typeof patch !== 'object' || !patch.params) {
    return { imported: false, reason: `${sourceName} : structure de patch invalide.` };
  }

  if (!patch.synth_id) {
    return {
      imported: false,
      reason: `${sourceName} : synth_id absent. Ce patch doit être réexporté avec la nouvelle version.`,
    };
  }

  if (patch.synth_id !== currentSynth.id) {
    return {
      imported: false,
      reason: `${sourceName} : patch prévu pour "${patch.synth_id}", synthétiseur actif "${currentSynth.id}".`,
    };
  }

  const normalizedPatch = {
    ...patch,
    name: patch.name || sourceName,
  };

  const duplicateIndex = bank.findIndex((item) =>
    item.name === normalizedPatch.name && item.synth_id === normalizedPatch.synth_id
  );

  if (duplicateIndex >= 0) bank[duplicateIndex] = normalizedPatch;
  else bank.push(normalizedPatch);

  return { imported: true, patch: normalizedPatch };
}

async function importFiles(event) {
  let imported = [];
  const errors = [];

  for (const file of event.target.files) {
    try {
      const data = JSON.parse(await file.text());
      const patches = Array.isArray(data.patches) ? data.patches : [data];

      patches.forEach((patch, index) => {
        const sourceName = patches.length > 1
          ? `${file.name} (patch ${index + 1})`
          : file.name;
        const result = importPatchObject(patch, sourceName);

        if (result.imported) imported.push(result.patch);
        else errors.push(result.reason);
      });
    } catch (error) {
      errors.push(`${file.name} : fichier JSON illisible.`);
    }
  }

  event.target.value = '';

  if (imported.length) {
    renderBank();
    const lastPatch = imported[imported.length - 1];
    applyPatch(lastPatch);
    persist();
  }

  if (errors.length) {
    showToast(errors[0] + (errors.length > 1 ? ` (+ ${errors.length - 1} erreur(s))` : ''), 6000);
  } else if (imported.length) {
    showToast(`${imported.length} patch(s) importé(s)`);
  } else {
    showToast('Aucun patch compatible trouvé.');
  }
}

function exportBank() {
  if (!bank.length) {
    showToast('La banque est vide');
    return;
  }

  downloadJson({
    version: 1,
    patches: bank,
  }, 'banque-patches.json');
  showToast('Banque téléchargée');
}

function resetCurrentPatch() {
  state = createDefaultState(controls);
  elements.name.value = '';
  elements.notes.value = '';
  updateAllControls();
  markAsClean();
  persist();
  showToast('Panneau remis à zéro');
}

function restoreLocalData() {
  try {
    const storedBank = JSON.parse(localStorage.getItem(STORAGE_KEYS.bank) || '[]');
    bank = Array.isArray(storedBank) ? storedBank : [];
  } catch (error) {
    bank = [];
  }

  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEYS.draft) || 'null');
    if (draft && draft.synth_id === currentSynth.id) {
      applyPatch({ ...draft, synth_id: draft.synth_id });
    } else {
      state = createDefaultState(controls);
      elements.name.value = '';
      elements.notes.value = '';
      updateAllControls();
      markAsClean();
    }
  } catch (error) {
    state = createDefaultState(controls);
    elements.name.value = '';
    elements.notes.value = '';
    updateAllControls();
    markAsClean();
  }

  renderBank();
}

async function loadSynths() {
  const response = await fetch(SYNTHS_FILE, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Impossible de charger ${SYNTHS_FILE} (HTTP ${response.status}).`);
  }

  synths = validateSynths(await response.json());
  populateSynthPicker();

  // Sélectionner le premier synthétiseur déclaré dans le catalogue.
  currentSynth = synths[0];
  elements.synthSelect.value = currentSynth.id;

  state = createDefaultState(flattenTemplate(currentSynth));
  buildInterface();
  updateAllControls();
  markAsClean();
  restoreLocalData();
}

function initialize() {
  [
    'synth', 'bank', 'toast', 'name', 'notes', 'save', 'reset',
    'add', 'exportBank', 'file', 'synthSelect',
  ].forEach((id) => {
    elements[id] = getElement(id);
  });

  elements.synthSelect.addEventListener('change', (event) => {
    switchSynth(event.target.value);
  });
  elements.save.addEventListener('click', saveCurrentPatch);
  elements.add.addEventListener('click', addCurrentPatch);
  elements.exportBank.addEventListener('click', exportBank);
  elements.reset.addEventListener('click', resetCurrentPatch);
  elements.name.addEventListener('input', persist);
  elements.notes.addEventListener('input', persist);
  elements.file.addEventListener('change', importFiles);

  loadSynths().catch((error) => {
    elements.synthSelect.disabled = true;
    elements.synthSelect.replaceChildren(
      createElement('option', '', 'Erreur de chargement'),
    );
    showToast(error.message, 7000);
    console.error(error);
  });
}

initialize();
