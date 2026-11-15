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

function clamp(value) {
  return Math.min(10, Math.max(0, Math.round(value * 10) / 10));
}

function formatValue(value) {
  return Number(value).toFixed(1);
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
    if (control.type === 'toggle') return [control.name, false];
    return [control.name, 0];
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

        if (!['knob', 'fader', 'select', 'toggle'].includes(control.type)) {
          throw new Error(`Type "${control.type}" non reconnu pour ${control.name}.`);
        }
        if (control.type === 'select' &&
            (!Array.isArray(control.values) || control.values.length === 0)) {
          throw new Error(`Le contrôle select "${control.name}" doit avoir au moins une valeur.`);
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

function configureSlider(element, label, onIncrement) {
  element.tabIndex = 0;
  element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', label);
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', '10');

  element.addEventListener('keydown', (event) => {
    const increments = {
      ArrowUp: 0.1,
      ArrowRight: 0.1,
      ArrowDown: -0.1,
      ArrowLeft: -0.1,
      PageUp: 1,
      PageDown: -1,
    };
    const increment = increments[event.key];
    if (increment === undefined) return;

    event.preventDefault();
    onIncrement(increment);
  });
}

function buildFader(control, wrapper, valueElement) {
  const track = createElement('div', 'fader-track');
  const cap = createElement('div', 'fader-cap');
  track.append(cap);

  configureSlider(track, control.display_name, (increment) => {
    setControlValue(control.name, clamp(state[control.name] + increment));
  });

  const valueFromPointer = (clientY) => {
    const bounds = track.getBoundingClientRect();
    return clamp((1 - (clientY - bounds.top - 15) / (bounds.height - 30)) * 10);
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
    cap.style.bottom = `calc((100% - 30px) * ${value / 10})`;
    valueElement.textContent = formatValue(value);
    track.setAttribute('aria-valuenow', String(value));
  };

  wrapper.append(track, valueElement);
}

function buildKnob(control, wrapper, valueElement) {
  const knob = createElement('div', 'knob');
  const indicator = createElement('i', 'knob-indicator');
  knob.append(indicator);

  configureSlider(knob, control.display_name, (increment) => {
    setControlValue(control.name, clamp(state[control.name] + increment));
  });

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
        clamp(startValue + (startY - event.clientY) / 20),
      );
    }
  });

  control.update = (value) => {
    indicator.style.transform = `rotate(${-135 + value * 27}deg)`;
    valueElement.textContent = formatValue(value);
    knob.setAttribute('aria-valuenow', String(value));
  };

  wrapper.append(knob, valueElement);
}

function buildOptions(control, wrapper) {
  const values = control.type === 'toggle'
    ? [['Off', false], ['On', true]]
    : control.values.map((value) => [value, value]);

  const optionsElement = createElement('div', 'options');
  const buttons = [];

  values.forEach(([label, value]) => {
    const button = createElement('button', '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setControlValue(control.name, value));
    buttons.push({ button, value });
    optionsElement.append(button);
  });

  control.update = (value) => {
    buttons.forEach(({ button, value: optionValue }) => {
      button.setAttribute('aria-pressed', String(optionValue === value));
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
    if (control.type === 'select' && control.values.length > 2) {
      // Le groupe de boutons reste volontairement cohérent avec l'interface existante.
      wrapper.classList.add('control--many-options');
    }
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
  state[name] = value;
  const control = controls.find((item) => item.name === name);
  control?.update?.(value);
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
    } else if (control.type === 'toggle') {
      value = value === true;
    } else {
      value = Number(value);
      value = Number.isFinite(value) ? clamp(value) : 0;
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
    .replace(/[\\u0300-\\u036f]/g, '')
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

  // Conserver le Donner Essential L1 comme modèle initial si présent,
  // sinon sélectionner le premier synthétiseur du fichier JSON.
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
