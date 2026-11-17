/**
 * Plattformunabhängiges Datenmodell für GEDCOM-Prüfung und -Export.
 * Wird in collect.ts aus dem Obsidian-metadataCache befüllt und ist
 * dadurch ohne Obsidian testbar.
 */

export interface VaultPerson {
	/** Vault-Pfad, dient als Schlüssel */
	path: string;
	/** Dateiname ohne Endung, z. B. "Mayr, Georg I0132" — für Wikilinks */
	basename: string;
	id?: string;
	kekule: boolean;
	uuid?: string;
	/** M/F/U/X */
	sex?: string;
	/** Rohwert des Datenschutz-Property, z. B. "[[Privat]]" */
	privacy?: string;
	/** Lookup-Referenzen aus `xrefs` im Format `QuelleID:ExterneID`, z. B. "S00239:1449005733" */
	xrefs: string[];
	/** Bearbeitungsstatus als Linkziel, z. B. "Klärungsbedarf" */
	status?: string;
}

export interface VaultEvent {
	path: string;
	basename: string;
	/** Normalisierter Ereignistyp ("Geburt", auch wenn im Vault "[[Geburt]]" steht) */
	type: string;
	/** Pfade der beteiligten Personen (nur aufgelöste Links) */
	persons: string[];
	father?: string;
	mother?: string;
	/** Rohwert des Datum-Property, z. B. "[[1874-09-25|25.09.1874]]" */
	date?: string;
	/** Bearbeitungsstatus als Linkziel, z. B. "Klärungsbedarf" */
	status?: string;
}

export interface VaultFamily {
	path: string;
	basename: string;
	id?: string;
	uuid?: string;
	father?: string;
	mother?: string;
}

export interface VaultModel {
	persons: Map<string, VaultPerson>;
	events: VaultEvent[];
	families: VaultFamily[];
}

/** Person aus einer GEDCOM-Datei (nur die für den Abgleich nötigen Felder). */
export interface GedcomIndividual {
	/** XREF ohne @, z. B. "I1449005466" */
	xref: string;
	uid?: string;
	/** NAME-Wert, z. B. "Anna Maria /Baumann/" */
	name?: string;
	/** Erstes Datum aus BIRT, sonst CHR/BAPM */
	birthDate?: string;
	/** Von GEDBAS aus Datenschutzgründen geleert */
	deleted: boolean;
}

/** Zerlegt einen Wikilink-Wert "[[ziel|anzeige]]" in seine Teile. */
export function parseWikilink(raw: unknown): { target: string; display?: string } | null {
	if (typeof raw !== 'string') return null;
	const m = raw.match(/^\s*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\s*$/);
	if (!m || !m[1]) return null;
	return { target: m[1].trim(), display: m[2]?.trim() };
}

/** Jahr aus dem Linkziel eines Datumslinks: "[[1874-09-25|…]]" → 1874. */
export function yearOfDateLink(raw: string | undefined): number | undefined {
	const link = parseWikilink(raw);
	const m = link?.target.match(/^(\d{4})/);
	return m?.[1] ? Number(m[1]) : undefined;
}

/** "[[Geburt]]", "[[Wehrdienst|Kriegsdienst]]" oder "Geburt" → "Geburt" */
export function normalizeEventType(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	return parseWikilink(raw)?.target ?? raw.trim();
}
