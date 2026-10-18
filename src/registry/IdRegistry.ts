import { App } from 'obsidian';
import { formatWithMask, parseMask } from '../types';
import type { IdTypeConfig } from '../types';

/** Minimales Interface, das IdRegistry vom Plugin erwartet — vermeidet zirkuläre Imports */
interface RegistryHost {
	app: App;
}

export class IdRegistry {
	/**
	 * Höchste in dieser Sitzung selbst vergebene Nummer je Präfix.
	 * Nur als Absicherung: metadataCache hinkt der Dateierstellung hinterher,
	 * ein Frischscan direkt nach dem Anlegen sieht die neue Datei also noch nicht.
	 * Nicht persistiert — beim Neuladen des Plugins liefert der Scan die Wahrheit.
	 */
	private sessionMax: Record<string, number> = {};

	constructor(private host: RegistryHost) {}

	/**
	 * Gibt die nächste freie ID zurück, ohne sie zu belegen.
	 * Für die Vorschau im Modal.
	 */
	async peekNextId(config: IdTypeConfig): Promise<string> {
		return formatWithMask(config.mask, (await this.getCurrentMax(config)) + 1);
	}

	/**
	 * Vergibt die nächste freie ID und merkt sie für diese Sitzung vor.
	 * Nur aufrufen, wenn die Datei tatsächlich angelegt wird.
	 */
	async commitNextId(config: IdTypeConfig): Promise<string> {
		const next = (await this.getCurrentMax(config)) + 1;
		const { prefix } = parseMask(config.mask);
		this.sessionMax[prefix] = next;
		return formatWithMask(config.mask, next);
	}

	// ── Privat ──────────────────────────────────────────────────────────────

	/**
	 * Ermittelt die höchste belegte Nummer. Es wird bei jedem Aufruf frisch
	 * gescannt: Einträge werden selten angelegt, ein persistenter Cache läuft
	 * dagegen bei manuell erstellten Dateien aus dem Tritt und führt zu
	 * doppelt vergebenen IDs.
	 */
	private async getCurrentMax(config: IdTypeConfig): Promise<number> {
		const { prefix } = parseMask(config.mask);
		return Math.max(await this.scanMaxId(config), this.sessionMax[prefix] ?? 0);
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
				const cache = this.host.app.metadataCache.getFileCache(file);
				const fm = cache?.frontmatter as Record<string, unknown> | undefined;
				const val: unknown = fm?.[config.idProperty];
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
