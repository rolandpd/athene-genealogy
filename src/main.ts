import { Plugin, TFile } from 'obsidian';
import { AtheneDate, type DateQualifier } from './date';
import { AtheneGenealogySettingTab, DEFAULT_SETTINGS } from './settings';
import type { AthenePluginSettings } from './types';
import { IdRegistry } from './registry/IdRegistry';
import { FileFactory } from './factory/FileFactory';
import { NewEntityModal } from './modal/NewEntityModal';
import { TypePickerModal } from './modal/TypePickerModal';
import { initI18n, t } from './i18n';
import { setupDateLinks } from './date/DateLinkHandler';
import { AtheneZeitleisteView, ZEITLEISTE_VIEW_TYPE } from './bases/ZeitleisteView';

/** Public API exposed on window.athene — usable from DataView JS blocks. */
export interface AtheneApi {
	/** Parse an EDTF string into an AtheneDate. Returns null for invalid input. */
	parseDate(str: string, qualifiers?: DateQualifier[]): AtheneDate | null;
	AtheneDate: typeof AtheneDate;
	/**
	 * Calculate age between two ISO/EDTF date strings (YYYY, YYYY-MM, YYYY-MM-DD).
	 * Returns "40" (years), "13m" (months < 24), "40d" (days < 62), or null.
	 * Pass qualifier '~' or '?' to mark the result as approximate/uncertain.
	 *
	 * Usage in DataView:
	 *   const birthIso = dv.page(ctx.Geburt)?.Datum?.fileName?.();
	 *   const eventIso = dv.array(ev.Datum)[0]?.fileName?.();
	 *   const qualifier = dv.array(ev.Datum)[0]?.display?.includes('~') ? '~'
	 *                   : dv.array(ev.Datum)[0]?.display?.includes('?') ? '?' : undefined;
	 *   const age = window.athene?.calculateAge(birthIso, eventIso, qualifier);
	 */
	calculateAge(birthDateStr: string, eventDateStr: string, qualifier?: string): string | null;
	/** Returns the next ID for the given type ID without committing it. Returns null if type not found. */
	nextId(typeId: string): Promise<string | null>;
	/** Creates a file for the given type ID. Returns file/id/filename on success, null if type not found or on error. */
	createFile(typeId: string, filename?: string): Promise<{ file: TFile; id: string; filename: string } | null>;
}

declare global {
	interface Window {
		athene?: AtheneApi;
	}
}

export default class AtheneGenealogyPlugin extends Plugin {
	settings!: AthenePluginSettings;
	registry!: IdRegistry;
	factory!: FileFactory;

	async onload() {
		await this.loadSettings();
		await initI18n();

		this.registry = new IdRegistry(this);
		this.factory = new FileFactory(this.app, this.registry);

		setupDateLinks(this);

		this.registerBasesView(ZEITLEISTE_VIEW_TYPE, {
			name: 'Zeitleiste',
			icon: 'list-ordered',
			factory: (controller, containerEl) => new AtheneZeitleisteView(controller, containerEl, this.app),
		});

		// Expose public API globally so DataView JS blocks can use it without importing
		window.athene = {
			parseDate: (str, qualifiers) => AtheneDate.parse(str, qualifiers),
			AtheneDate,
			calculateAge: (birthDateStr, eventDateStr, qualifier) =>
				AtheneDate.calculateAge(birthDateStr, eventDateStr, qualifier),
			nextId: (typeId) => {
				const config = this.settings.idTypes.find(type => type.id === typeId);
				if (!config) return Promise.resolve(null);
				return this.registry.peekNextId(config);
			},
			createFile: async (typeId, filename) => {
				const config = this.settings.idTypes.find(type => type.id === typeId);
				if (!config) return null;
				try {
					return await this.factory.createFile({ config, filename });
				} catch {
					return null;
				}
			},
		};

		// Immer verfügbarer Einstiegspunkt: öffnet Typ-Auswahl oder direkt das Modal
		this.addCommand({
			id: 'new-entity',
			name: t('cmd.newFile'),
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
				name: t('cmd.newType', { name: idType.name }),
				callback: () => {
					const current = this.settings.idTypes.find(type => type.id === idType.id);
					if (current) new NewEntityModal(this.app, this.registry, current).open();
				},
			});
		}
	}
}
