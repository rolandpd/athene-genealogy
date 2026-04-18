# Athene Genealogy

An [Obsidian](https://obsidian.md) plugin for structured genealogical research. It provides an ID registry for assigning stable identifiers to persons, events, and sources; a file creation modal with [Templater](https://github.com/SilentVoid13/Templater) integration; and EDTF-based date handling for precise historical dates including approximations and ranges.

The plugin is designed around the idea that **events are the primary information currency** — persons, places, and sources are linked through structured event records. It supports research workflows where every piece of information should be traceable to a primary source.

> **Status:** Early release (v0.9.x). Core features are working and in daily use. The API and settings format may still change before v1.0.

## Features

### ID Registry

Automatically assigns unique IDs based on configurable masks (e.g. `I####` → `I0042`). The highest issued ID per mask is cached so new IDs are instant — no vault scan required on every creation.

- Mask-based format: prefix letters followed by `#` placeholders (e.g. `I####`, `E#####`, `T#####`)
- Overflow-safe: `I####` with number 10000 produces `I10000`
- Optional frontmatter property: ID can be stored in a property (e.g. `id`) instead of or in addition to the filename
- **Rebuild** command rescans all filenames and frontmatter to resync the cache

### File Creation Modal

Invoke **"New: Person"** (or any configured type) from the command palette:

- Filename pre-filled with the next ID — type the name in front of it
- If the ID is removed from the filename and no frontmatter property is configured, an inline warning appears with a reset link
- Template selector (dropdown if multiple templates are configured per type)
- Templater integration: applies the template via Templater's `write_template_to_file` API if Templater is installed; falls back to plain content copy

### EDTF Date Handling

`AtheneDate` parses [EDTF](https://www.loc.gov/standards/datetime/) date strings and converts them to:

- German display format (`23. Juni 1897`, `ca. 1897`, `vor 1897`)
- GEDCOM 5.5.1 (`ABT 23 JUN 1897`, `BEF 1897`)
- GEDCOM 7 (near 1:1 EDTF)
- Sort keys for correct chronological ordering

The API is exposed on `window.athene` for use in Dataview JS blocks — no imports needed.

```js
// In a Dataview JS block:
const d = window.athene.parseDate("1897~");
dv.paragraph(d.toDisplay()); // "ca. 1897"
```

## Settings

Each ID type can be configured with:

| Field | Description |
|---|---|
| Name | Display name used in the command palette, e.g. "Person" |
| Mask | ID format, e.g. `I####` |
| Target folder | Vault folder where new files are created |
| ID property | Optional frontmatter property to store the ID (e.g. `id`) |
| Templates | One or more Templater template files |

The **ID Registry** section provides a **Rebuild** button to rescan the vault and resync the ID cache.

## Installation

### Via BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add `rolandpd/athene-genealogy` as a beta plugin.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/rolandpd/athene-genealogy/releases/latest) and copy them to `<vault>/.obsidian/plugins/athene-genealogy/`.

## Recommended: Templater

While the plugin works without Templater, it is strongly recommended. Templates are applied using Templater's API when available, which means all `tp.*` variables work as usual.

**Template design guidelines** when used with this plugin:

- **Do not use `tp.file.rename()` or `tp.file.move()` in templates.** The plugin creates the file with the correct name before applying the template. Renaming or moving inside the template will decouple the file from the ID the plugin assigned.
- **Do not set the `id` property in the template.** If an ID property is configured for the type, the plugin sets it after the template is applied — any value in the template will be overridden.
- **Disable "Trigger Templater on new file creation"** in Templater's settings if it is enabled. This setting causes Templater to create an additional file automatically whenever any file is created, which conflicts with the plugin's own file creation.
- `tp.file.title` and other `tp.file.*` variables work as expected — the file already has its final name when the template runs.

## Roadmap

Planned for future releases:

- **i18n** — UI translations (DE, EN, FR, IT, ES, PL)
- **FileFactory** — programmatic file creation for persons, events, and sources
- **GEDCOM export** — export vault data to GEDCOM 5.5.1 and GEDCOM 7
- **Obsidian plugin directory** — submission once the API stabilises

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
