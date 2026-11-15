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
