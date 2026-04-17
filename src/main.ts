import { Plugin } from 'obsidian';
import { AtheneDate, type DateQualifier } from './date';
import { AtheneGenealogySettingTab, DEFAULT_SETTINGS } from './settings';
import type { AthenePluginSettings } from './types';
import { IdRegistry } from './registry/IdRegistry';
import { NewEntityModal } from './modal/NewEntityModal';
import { TypePickerModal } from './modal/TypePickerModal';

/** Public API exposed on window.athene — usable from DataView JS blocks. */
export interface AtheneApi {
	/** Parse an EDTF string into an AtheneDate. Returns null for invalid input. */
	parseDate(str: string, qualifiers?: DateQualifier[]): AtheneDate | null;
	AtheneDate: typeof AtheneDate;
}

declare global {
	interface Window {
		athene?: AtheneApi;
	}
}

export default class AtheneGenealogyPlugin extends Plugin {
	settings!: AthenePluginSettings;
	registry!: IdRegistry;

	async onload() {
		await this.loadSettings();

		this.registry = new IdRegistry(this);

		// Expose AtheneDate API globally so DataView JS blocks can use it without importing
		window.athene = {
			parseDate: (str, qualifiers) => AtheneDate.parse(str, qualifiers),
			AtheneDate,
		};

		// Immer verfügbarer Einstiegspunkt: öffnet Typ-Auswahl oder direkt das Modal
		this.addCommand({
			id: 'new-entity',
			name: 'New: create file...',
			callback: () => {
				const types = this.settings.idTypes;
				if (types.length === 0) return;
				if (types.length === 1) {
					new NewEntityModal(this.app, this.registry, types[0]!).open();
				} else {
					new TypePickerModal(this.app, this.registry, types).open();
				}
			},
		});

		this.registerIdCommands();

		this.addSettingTab(new AtheneGenealogySettingTab(this.app, this));
	}

	onunload() {
		delete window.athene;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AthenePluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Neu konfigurierte Typen sofort in der Palette verfügbar machen
		this.registerIdCommands();
	}

	/**
	 * Registers one command per configured ID type.
	 * addCommand() is idempotent for a given ID — no plugin reload needed.
	 */
	registerIdCommands() {
		for (const idType of this.settings.idTypes) {
			this.addCommand({
				id: `new-${idType.id}`,
				name: `Neu: ${idType.name}`,
				callback: () => {
					const current = this.settings.idTypes.find(t => t.id === idType.id);
					if (current) new NewEntityModal(this.app, this.registry, current).open();
				},
			});
		}
	}
}
