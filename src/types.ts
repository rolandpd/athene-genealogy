export interface IdTypeConfig {
	/** Stabiler interner Schlüssel (UUID), wird als Command-ID verwendet */
	id: string;
	/** Anzeigename, z.B. "Person" oder "Ereignis" */
	name: string;
	/**
	 * ID-Maske: Präfix gefolgt von '#'-Zeichen als Platzhalter für Ziffern.
	 * Beispiele: "I####" → I0042, "E#####" → E00123, "F####" → F0001
	 * Overflow: bei mehr Stellen als '#' wird ohne führende Nullen angehängt (I10000).
	 */
	mask: string;
	/** Zielordner im Vault, z.B. "Personen" */
	folder: string;
	/** Pfade zu Templater-Templates (relativ zum Vault-Root) */
	templates: string[];
	/**
	 * Optional: Frontmatter-Property in dem die ID gespeichert wird, z.B. "id".
	 * Wenn gesetzt: Rebuild liest dieses Property statt Dateinamen (Dateiname als Fallback).
	 * Nach dem Template wird das Property per processFrontMatter gesetzt/überschrieben.
	 */
	idProperty?: string;
}

export interface AthenePluginSettings {
	locale: string;
	idTypes: IdTypeConfig[];
	/** Cache: Masken-Präfix → aktuell höchste vergebene Nummer */
	idCache: Record<string, number>;
}

export const DEFAULT_SETTINGS: AthenePluginSettings = {
	locale: 'de',
	idTypes: [],
	idCache: {},
};

// ── Masken-Hilfsfunktionen ────────────────────────────────────────────────────

/**
 * Zerlegt eine Maske in Präfix und Stellenanzahl.
 * "I####" → { prefix: "I", digits: 4 }
 * Bei ungültiger Maske wird digits=4 als Fallback verwendet.
 */
export function parseMask(mask: string): { prefix: string; digits: number } {
	const m = mask.match(/^([^#]*)(#+)/);
	if (!m || !m[1] || !m[2]) return { prefix: mask, digits: 4 };
	return { prefix: m[1], digits: m[2].length };
}

/**
 * Formatiert eine Zahl mit der gegebenen Maske.
 * Overflow: Zahl ist länger als die Masken-Stellen → keine führenden Nullen, aber Präfix bleibt.
 */
export function formatWithMask(mask: string, num: number): string {
	const { prefix, digits } = parseMask(mask);
	const s = String(num);
	return prefix + (s.length < digits ? s.padStart(digits, '0') : s);
}
