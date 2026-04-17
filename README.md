# Athene Genealogy

An [Obsidian](https://obsidian.md) plugin for managing genealogical data. It provides an ID registry, a file creation modal with [Templater](https://github.com/SilentVoid13/Templater) integration, and EDTF-based date handling.

## Features

### ID Registry

Automatically assigns unique IDs based on configurable masks (e.g. `I####` → `I0042`). The highest issued ID per mask is cached so new IDs are instant — no vault scan required on every creation.

- Mask-based format: prefix letters followed by `#` placeholders (e.g. `I####`, `E#####`, `T#####`)
- Overflow-safe: `I####` with number 10000 produces `I10000`
- Optional frontmatter property: ID can be stored in a property (e.g. `id`) instead of or in addition to the filename
- **Rebuild** command rescans all filenames and frontmatter to resync the cache

### File Creation Modal

Invoke **"Neu: Person"** (or any configured type) from the command palette:

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

### Manual (current)

Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/athene-genealogy/`.

### Via BRAT (beta)

Once available on BRAT, add `rolandpd/athene-genealogy` as a beta plugin.

## Recommended: Templater

While the plugin works without Templater, it is strongly recommended. Templates are applied using Templater's API when available, which means all `tp.*` variables work as usual.

## License

MIT — see [LICENSE](LICENSE).
