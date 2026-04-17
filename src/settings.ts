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

		// ── General ────────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName('Display language')
			.setDesc('Language code for date formatting (e.g. "de")')
			.addText(text => text
				.setPlaceholder('Language code')
				.setValue(this.plugin.settings.locale)
				.onChange(async val => {
					this.plugin.settings.locale = val.trim() || 'de';
					await this.plugin.saveSettings();
				}));

		// ── ID types ───────────────────────────────────────────────────────
		new Setting(containerEl).setName('ID types').setHeading();
		containerEl.createEl('p', {
			text: 'Each entry creates a command in the command palette. New types are available immediately.',
			cls: 'setting-item-description',
		});

		for (let i = 0; i < this.plugin.settings.idTypes.length; i++) {
			this.renderIdType(containerEl, i);
		}

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText('Add ID type')
				.onClick(async () => {
					this.plugin.settings.idTypes.push({
						id: crypto.randomUUID(),
						name: 'New',
						mask: 'I####',
						folder: '',
						templates: [],
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		// ── ID registry ────────────────────────────────────────────────────
		new Setting(containerEl).setName('ID registry').setHeading();

		new Setting(containerEl)
			.setName('Rebuild index')
			.setDesc('Scan vault for existing ids and update the cache — run this after creating files manually.')
			.addButton(btn => btn
				.setButtonText('Rebuild')
				.onClick(async () => {
					await this.plugin.registry?.rebuildAll();
					new Notice('ID index rebuilt.');
				}));
	}

	// ── Single ID type ────────────────────────────────────────────────────

	private renderIdType(containerEl: HTMLElement, index: number) {
		const type = this.plugin.settings.idTypes[index];
		if (!type) return;
		const div = containerEl.createDiv({ cls: 'athene-id-type' });

		new Setting(div)
			.setName(type.name || '(unnamed)')
			.setHeading()
			.addButton(btn => btn
				.setIcon('trash')
				.setTooltip('Remove')
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
			.setDesc('Display name, e.g. "person" or "event"')
			.addText(text => text
				.setValue(type.name)
				.onChange(async val => {
					type.name = val;
					await this.plugin.saveSettings();
				}));

		new Setting(div)
			.setName('Mask')
			.setDesc('Prefix followed by "#" digit placeholders — e.g. "p####" creates p0001, p0002 …')
			.addText(text => text
				.setValue(type.mask)
				.setPlaceholder('I####')
				.onChange(async val => {
					type.mask = val.toUpperCase();
					await this.plugin.saveSettings();
				}));

		// Target folder with typeahead
		new Setting(div)
			.setName('Target folder')
			.setDesc('Folder for new files')
			.addText(text => {
				text.setValue(type.folder).setPlaceholder('Personen');
				new FolderSuggest(this.app, text.inputEl, val => {
					type.folder = val;
					text.setValue(val);
					void this.plugin.saveSettings();
				});
				text.onChange(async val => {
					type.folder = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(div)
			.setName('ID property')
			.setDesc('Optional frontmatter property for storing the ID, e.g. "ID" — used during rebuild and file creation.')
			.addText(text => text
				.setValue(type.idProperty ?? '')
				.setPlaceholder('Property name')
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
					new FileSuggest(this.app, text.inputEl, val => {
						type.templates[i] = val;
						text.setValue(val);
						void this.plugin.saveSettings();
					});
					text.onChange(async val => {
						type.templates[i] = val;
						await this.plugin.saveSettings();
					});
				})
				.addButton(btn => btn
					.setIcon('minus-circle')
					.setTooltip('Remove')
					.onClick(async () => {
						type.templates.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		new Setting(tplDiv)
			.addButton(btn => btn
				.setButtonText('Add template')
				.onClick(async () => {
					type.templates.push('');
					await this.plugin.saveSettings();
					this.display();
				}));
	}
}
