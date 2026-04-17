import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AtheneGenealogyPlugin from './main';
import { parseMask } from './types';
import type { IdTypeConfig } from './types';
import { FileSuggest, FolderSuggest } from './suggest';

export type { AthenePluginSettings } from './types';
export { DEFAULT_SETTINGS } from './types';

export class AtheneGenealogySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: AtheneGenealogyPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Allgemein ──────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName('Anzeigesprache')
			.setDesc('Sprachcode für Datumsformatierung (z.B. "de")')
			.addText(text => text
				.setPlaceholder('de')
				.setValue(this.plugin.settings.locale)
				.onChange(async val => {
					this.plugin.settings.locale = val.trim() || 'de';
					await this.plugin.saveSettings();
				}));

		// ── ID-Typen ───────────────────────────────────────────────────────
		containerEl.createEl('h2', { text: 'ID-Typen' });
		containerEl.createEl('p', {
			text: 'Jeder Eintrag erzeugt einen Command „Neu: <Name>" in der Command-Palette. '
				+ 'Neue Typen sind sofort verfügbar (kein Plugin-Reload nötig).',
			cls: 'setting-item-description',
		});

		for (let i = 0; i < this.plugin.settings.idTypes.length; i++) {
			this.renderIdType(containerEl, i);
		}

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText('+ ID-Typ hinzufügen')
				.onClick(async () => {
					this.plugin.settings.idTypes.push({
						id: crypto.randomUUID(),
						name: 'Neu',
						mask: 'I####',
						folder: '',
						templates: [],
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		// ── ID-Registry ────────────────────────────────────────────────────
		containerEl.createEl('h2', { text: 'ID-Registry' });

		new Setting(containerEl)
			.setName('Index neu aufbauen')
			.setDesc('Vault nach vorhandenen IDs durchsuchen und Cache aktualisieren. '
				+ 'Nötig nach manuell angelegten Dateien.')
			.addButton(btn => btn
				.setButtonText('Rebuild')
				.onClick(async () => {
					await this.plugin.registry?.rebuildAll();
					new Notice('ID-Index neu aufgebaut.');
				}));
	}

	// ── Einzelner ID-Typ ──────────────────────────────────────────────────

	private renderIdType(containerEl: HTMLElement, index: number) {
		const type = this.plugin.settings.idTypes[index];
		if (!type) return;
		const div = containerEl.createDiv({ cls: 'athene-id-type' });

		new Setting(div)
			.setName(type.name || '(unbenannt)')
			.setHeading()
			.addButton(btn => btn
				.setIcon('trash')
				.setTooltip('Entfernen')
				.setWarning()
				.onClick(async () => {
					const { prefix } = parseMask(type.mask);
					this.plugin.settings.idTypes.splice(index, 1);
					delete this.plugin.settings.idCache[prefix];
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(div)
			.setName('Name')
			.setDesc('Anzeigename, z.B. „Person" oder „Ereignis"')
			.addText(text => text
				.setValue(type.name)
				.onChange(async val => {
					type.name = val;
					await this.plugin.saveSettings();
				}));

		new Setting(div)
			.setName('Maske')
			.setDesc('Präfix + "#" als Platzhalter für Ziffern. Beispiel: "I####" → I0042, Overflow: I10000')
			.addText(text => text
				.setValue(type.mask)
				.setPlaceholder('I####')
				.onChange(async val => {
					type.mask = val.toUpperCase();
					await this.plugin.saveSettings();
				}));

		// Zielordner mit Typeahead
		new Setting(div)
			.setName('Zielordner')
			.setDesc('Ordner für neue Dateien')
			.addText(text => {
				text.setValue(type.folder).setPlaceholder('Personen');
				new FolderSuggest(this.app, text.inputEl, async val => {
					type.folder = val;
					text.setValue(val);
					await this.plugin.saveSettings();
				});
				text.onChange(async val => {
					type.folder = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(div)
			.setName('ID-Property')
			.setDesc('Optional: Frontmatter-Property für die ID, z.B. "id". Rebuild und Anlegen nutzen dieses Property.')
			.addText(text => text
				.setValue(type.idProperty ?? '')
				.setPlaceholder('id')
				.onChange(async val => {
					type.idProperty = val.trim() || undefined;
					await this.plugin.saveSettings();
				}));

		this.renderTemplates(div, type);
	}

	private renderTemplates(containerEl: HTMLElement, type: IdTypeConfig) {
		containerEl.createEl('p', {
			text: 'Templates',
			cls: 'athene-templates-label',
		});

		const tplDiv = containerEl.createDiv({ cls: 'athene-templates-list' });

		for (let i = 0; i < type.templates.length; i++) {
			new Setting(tplDiv)
				.addText(text => {
					text.setValue(type.templates[i] ?? '').setPlaceholder('Templates/Person.md');
					// Typeahead für Markdown-Dateien
					new FileSuggest(this.app, text.inputEl, async val => {
						type.templates[i] = val;
						text.setValue(val);
						await this.plugin.saveSettings();
					});
					text.onChange(async val => {
						type.templates[i] = val;
						await this.plugin.saveSettings();
					});
				})
				.addButton(btn => btn
					.setIcon('minus-circle')
					.setTooltip('Entfernen')
					.onClick(async () => {
						type.templates.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		new Setting(tplDiv)
			.addButton(btn => btn
				.setButtonText('+ Template hinzufügen')
				.onClick(async () => {
					type.templates.push('');
					await this.plugin.saveSettings();
					this.display();
				}));
	}
}
