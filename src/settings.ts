import { App, PluginSettingTab, Setting } from 'obsidian';
import type AtheneGenealogyPlugin from './main';
import type { IdTypeConfig } from './types';
import { FileSuggest, FolderSuggest } from './suggest';
import { t } from './i18n';
import { ConfirmModal } from './modal/ConfirmModal';

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
			.setName(t('settings.locale.name'))
			.setDesc(t('settings.locale.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.locale.placeholder'))
				.setValue(this.plugin.settings.locale)
				.onChange(async val => {
					this.plugin.settings.locale = val.trim() || 'de';
					await this.plugin.saveSettings();
				}));

		// ── ID types ───────────────────────────────────────────────────────
		new Setting(containerEl).setName(t('settings.idTypes.heading')).setHeading();
		containerEl.createEl('p', {
			text: t('settings.idTypes.desc'),
			cls: 'setting-item-description',
		});

		for (let i = 0; i < this.plugin.settings.idTypes.length; i++) {
			this.renderIdType(containerEl, i);
		}

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText(t('settings.idTypes.btnAdd'))
				.onClick(async () => {
					this.plugin.settings.idTypes.push({
						id: crypto.randomUUID(),
						name: t('settings.idTypes.newTypeName'),
						mask: 'I####',
						folder: '',
						templates: [],
					});
					await this.plugin.saveSettings();
					this.display();
				}));
	}

	// ── Single ID type ────────────────────────────────────────────────────

	private renderIdType(containerEl: HTMLElement, index: number) {
		const type = this.plugin.settings.idTypes[index];
		if (!type) return;
		const div = containerEl.createDiv({ cls: 'athene-id-type' });

		new Setting(div)
			.setName(type.name || t('settings.idType.unnamed'))
			.setHeading()
			.addButton(btn => btn
				.setIcon('trash')
				.setTooltip(t('settings.idType.tooltipRemove'))
				.setWarning()
				.onClick(() => {
					const name = type.name || t('settings.idType.unnamed');
					new ConfirmModal(
						this.app,
						t('settings.idType.confirmRemove.title'),
						t('settings.idType.confirmRemove.message', { name }),
						t('settings.idType.confirmRemove.btnConfirm'),
						async () => {
							// Typ per Referenz suchen — der Index kann sich inzwischen verschoben haben
							const idx = this.plugin.settings.idTypes.indexOf(type);
							if (idx < 0) return;
							this.plugin.settings.idTypes.splice(idx, 1);
							await this.plugin.saveSettings();
							this.display();
						},
					).open();
				}));

		new Setting(div)
			.setName(t('settings.idType.name.label'))
			.setDesc(t('settings.idType.name.desc'))
			.addText(text => text
				.setValue(type.name)
				.onChange(async val => {
					type.name = val;
					await this.plugin.saveSettings();
				}));

		new Setting(div)
			.setName(t('settings.idType.mask.label'))
			.setDesc(t('settings.idType.mask.desc'))
			.addText(text => text
				.setValue(type.mask)
				.setPlaceholder(t('settings.idType.mask.placeholder'))
				.onChange(async val => {
					type.mask = val.toUpperCase();
					await this.plugin.saveSettings();
				}));

		// Target folder with typeahead
		new Setting(div)
			.setName(t('settings.idType.folder.label'))
			.setDesc(t('settings.idType.folder.desc'))
			.addText(text => {
				text.setValue(type.folder).setPlaceholder(t('settings.idType.folder.placeholder'));
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
			.setName(t('settings.idType.idProperty.label'))
			.setDesc(t('settings.idType.idProperty.desc'))
			.addText(text => text
				.setValue(type.idProperty ?? '')
				.setPlaceholder(t('settings.idType.idProperty.placeholder'))
				.onChange(async val => {
					type.idProperty = val.trim() || undefined;
					await this.plugin.saveSettings();
				}));

		this.renderTemplates(div, type);
	}

	private renderTemplates(containerEl: HTMLElement, type: IdTypeConfig) {
		containerEl.createEl('p', {
			text: t('settings.idType.templates.label'),
			cls: 'athene-templates-label',
		});

		const tplDiv = containerEl.createDiv({ cls: 'athene-templates-list' });

		for (let i = 0; i < type.templates.length; i++) {
			new Setting(tplDiv)
				.addText(text => {
					text.setValue(type.templates[i] ?? '').setPlaceholder(t('settings.idType.templates.placeholder'));
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
					.setTooltip(t('settings.idType.templates.tooltipRemove'))
					.onClick(async () => {
						type.templates.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		new Setting(tplDiv)
			.addButton(btn => btn
				.setButtonText(t('settings.idType.templates.btnAdd'))
				.onClick(async () => {
					type.templates.push('');
					await this.plugin.saveSettings();
					this.display();
				}));
	}
}
