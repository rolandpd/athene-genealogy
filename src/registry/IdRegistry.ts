import { App } from 'obsidian';
import { formatWithMask, parseMask } from '../types';
import type { AthenePluginSettings, IdTypeConfig } from '../types';

/** Minimales Interface, das IdRegistry vom Plugin erwartet — vermeidet zirkuläre Imports */
interface RegistryHost {
	app: App;
	settings: AthenePluginSettings;
	saveSettings(): Promise<void>;
}

export class IdRegistry {
	constructor(private host: RegistryHost) {}

	/**
	 * Gibt die nächste ID zurück, ohne den Cache zu verändern.
	 * Für die Vorschau im Modal.
	 */
	async peekNextId(config: IdTypeConfig): Promise<string> {
		const current = await this.getCurrentMax(config);
		return formatWithMask(config.mask, current + 1);
	}

	/**
	 * Vergibt die nächste ID: inkrementiert den Cache und persistiert ihn.
	 * Nur aufrufen, wenn die Datei tatsächlich angelegt wird.
	 */
	async commitNextId(config: IdTypeConfig): Promise<string> {
		const next = (await this.getCurrentMax(config)) + 1;
		const { prefix } = parseMask(config.mask);
		this.host.settings.idCache[prefix] = next;
		await this.host.saveSettings();
		return formatWithMask(config.mask, next);
	}

	/**
	 * Scannt den Vault und baut den Cache für alle konfigurierten Typen neu auf.
	 * Bevorzugt Frontmatter-Property (wenn idProperty gesetzt), Dateiname als Fallback.
	 */
	async rebuildAll(): Promise<void> {
		for (const idType of this.host.settings.idTypes) {
			const { prefix } = parseMask(idType.mask);
			this.host.settings.idCache[prefix] = await this.scanMaxId(idType);
		}
		await this.host.saveSettings();
	}

	// ── Privat ──────────────────────────────────────────────────────────────

	private async getCurrentMax(config: IdTypeConfig): Promise<number> {
		const { prefix } = parseMask(config.mask);
		const cached = this.host.settings.idCache[prefix];
		if (cached !== undefined) return cached;
		const max = await this.scanMaxId(config);
		this.host.settings.idCache[prefix] = max;
		await this.host.saveSettings();
		return max;
	}

	private async scanMaxId(config: IdTypeConfig): Promise<number> {
		const { prefix, digits } = parseMask(config.mask);
		const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// Mindestens <digits> Ziffern, damit Overflow-IDs (I10000 bei I####) erkannt werden
		const filenamePattern = new RegExp(`(?:^|[^A-Za-z])${escaped}(\\d{${digits},})(?:\\b|$)`);
		const propPattern = new RegExp(`^${escaped}(\\d+)$`);

		let max = 0;

		for (const file of this.host.app.vault.getMarkdownFiles()) {
			let num = 0;

			// Frontmatter-Property bevorzugt, wenn idProperty konfiguriert ist
			if (config.idProperty) {
				const fm = this.host.app.metadataCache.getFileCache(file)?.frontmatter;
				const val = fm?.[config.idProperty];
				if (typeof val === 'string') {
					const m = val.match(propPattern);
					if (m?.[1]) num = parseInt(m[1], 10);
				}
			}

			// Dateiname als Fallback (oder primär wenn kein idProperty)
			if (num === 0) {
				const m = file.basename.match(filenamePattern);
				if (m?.[1]) num = parseInt(m[1], 10);
			}

			if (num > max) max = num;
		}

		return max;
	}
}
