# patch-keeper
A simple application for saving analog synthesizer patches

## Lancement

Le navigateur bloque généralement `fetch()` vers un fichier JSON local lorsque la page est ouverte directement en `file://`.

Il faut donc lancer un petit serveur HTTP local depuis ce dossier :

```bash
python -m http.server 8000
```

Puis ouvrir :

http://localhost:8000

## Modifier le catalogue des synthétiseurs

Ajoutez un objet dans `synths.json` :

```json
{
  "id": "identifiant_unique",
  "name": "Nom du synthétiseur",
  "template": [
    {
      "title": "Nom de la section",
      "controls": [
        {
          "name": "parametre_unique",
          "display_name": "Nom affiché",
          "type": "knob",
          "values": []
        }
      ]
    }
  ]
}
```

Types de contrôles pris en charge :

- `knob` : potentiomètre rotatif, plage personnalisable (0 à 10 par défaut)
- `fader` : curseur vertical, plage personnalisable (0 à 10 par défaut)
- `select` : boutons de sélection exclusifs ; `values` doit contenir au moins une valeur
- `multiselect` : boutons activables indépendamment ; `values` doit contenir au moins une valeur
- `toggle` : interrupteur Off / On

Chaque `name` de contrôle doit être unique à l'intérieur du template d'un synthétiseur.

## Compatibilité des patches

Chaque patch exporté contient `synth_id`. Les patches sans cet identifiant ou associés à un autre synthétiseur sont refusés à l'import et au rappel depuis la banque.

## Multiselect

Un contrôle multiselect reprend le format d'un `select`, mais mémorise **un tableau** de choix dans `params` :

```json
{
  "name": "active_waves",
  "display_name": "Oscillateurs actifs",
  "type": "multiselect",
  "values": ["Saw", "Square", "Triangle", "Noise"],
  "default": ["Saw", "Square"],
  "inline": true
}
```

- `values` : liste obligatoire des choix (chaînes distinctes).
- `default` : optionnel ; tableau des choix activés à la remise à zéro. Par défaut `[]`.
- `inline` : optionnel ; affiche les boutons sur plusieurs colonnes/lignes compactes.
- Cliquer sur un bouton active ou désactive ce choix sans changer les autres.
- Les patches enregistrent, par exemple, `"active_waves": ["Saw", "Square"]`.
- En important un patch, les choix invalides sont ignorés, et les valeurs du patch manquantes sont remplacées par la valeur par défaut.

Le fichier `exemple_synthe_multiselect.json` contient un synthétiseur complet à copier, au besoin, dans le tableau `synths.json`. Il n'est **pas** chargé automatiquement.

## Autres types envisageables (non implémentés)

- `number` : saisie numérique précise (fréquence, BPM, valeur MIDI, etc.).
- `stepper` : valeur discrète avec boutons moins/plus, pour octaves ou divisions.
- `xy` : deux paramètres pilotés dans une surface bidimensionnelle.
- `display` : valeur ou indication non modifiable (utile pour documentation et repérage).

Les réglages bipolaires sont déjà possibles grâce aux propriétés numériques ci-dessous : **aucun type `bipolar` n'est nécessaire**.

## Propriétés numériques (`knob` et `fader`)

Ces propriétés sont toutes facultatives et ne concernent que `knob` et `fader` :

| Propriété | Description | Valeur par défaut |
| --- | --- | --- |
| `min` | Borne inférieure | `0` |
| `max` | Borne supérieure | `10` |
| `step` | Pas utilisé par la souris et le clavier | `0.1` |
| `default` | Valeur initiale et valeur à la remise à zéro | `min` |
| `unit` | Unité affichée (par exemple `%`, `Hz`, `st`) | `""` |
| `center` | Affiche un repère de **zéro** s'il est dans la plage | `false` |

Exemple de potentiomètre bipolaire :

```json
{
  "name": "osc_tune",
  "display_name": "Tune",
  "type": "knob",
  "min": -12,
  "max": 12,
  "step": 1,
  "default": 0,
  "unit": "st",
  "center": true
}
```

Exemple de fader :

```json
{
  "name": "mix_level",
  "display_name": "Mix",
  "type": "fader",
  "min": 0,
  "max": 100,
  "step": 1,
  "default": 50,
  "unit": "%"
}
```

Les valeurs exportées dans les patches sont des **nombres**, pas des chaînes comprenant l'unité. À l'import, les valeurs sont ramenées dans la plage autorisée et arrondies au pas. Si une valeur est absente ou invalide, la valeur par défaut du contrôle est utilisée. Les flèches avancent d'un `step`, PageUp/PageDown de dix, et Home/End vont aux bornes.

Pour une configuration cohérente, privilégiez des plages dont l'étendue est un multiple du pas. Un `default` hors de la plage est considéré comme invalide ; un `default` non aligné sur le pas est arrondi au pas le plus proche.

Le fichier `exemple_controles_numeriques.json` présente ces réglages ; il est fourni séparément du catalogue actif pour ne pas changer vos modèles existants.
