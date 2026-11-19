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
	/** Aliase, z. B. Heiratsnamen "Maria Anna Kastner" */
	aliases?: string[];
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
	/** Pfad der Ort-Notiz (erster Eintrag von `Ort`, meist die Gemeinde) */
	place?: string;
	/** weitere, genauere Orte aus `Ort` (Hof, Kirche) */
	placeDetails?: string[];
	/** `Ort` als Freitext ohne Ort-Notiz, z.B. "KL Buchenwald (bei Weimar)" */
	placeText?: string;
	/** `Beschreibung` als Text */
	description?: string;
	/** `Adresse` (beim Wohnort) */
	address?: string;
	/** alle Properties als Text (Wikilink → Anzeige), für die Werte aus `gedcomValue` */
	fields?: Record<string, string>;
	/** Pfade aus `Beleg` (Fundstellen, manchmal direkt Quellen) */
	evidence?: string[];
	/** Konfidenz als Linkziel, z. B. "Beurkundet" */
	confidence?: string;
	/** `Anmerkung`, z. B. Begründung einer Schätzung ("Geboren 1869") */
	note?: string;
	/** Beruf als Text: Anzeige des Beruf-Links, sonst Beschreibung */
	occupation?: string;
	/** Art, z. B. "Adoption" bei Elternschaft */
	kind?: string;
	/** Konfession bei der Taufe, z. B. "römisch-katholisch" */
	religion?: string;
	/** Rohwert des Datenschutz-Property */
	privacy?: string;
}

export interface VaultPlace {
	path: string;
	/** Name ohne ID, z. B. "Wollishausen" */
	name: string;
	/** z. B. "DE-86459 Wollishausen" */
	address?: string;
	/** GOV-Kennung aus `xrefs` (http://gov.genealogy.net/<ID>) */
	gov?: string;
	/** aus `location: [48.3876, 10.437]` */
	lat?: number;
	long?: number;
}

/** Fundstelle (C…): konkrete Stelle in einer Quelle */
export interface VaultCitation {
	path: string;
	id?: string;
	/** Bezeichnung (erster Alias), z. B. "Johannes Ev. Mayr ≈17.08.1869 (Taufeintrag)" */
	title: string;
	/** Pfad der Quelle */
	source?: string;
	/** `Beschreibung`, z. B. Seite "S.58" */
	description?: string;
	url?: string;
	/** Datum der Fundstelle (Datumslink) */
	date?: string;
}

/** Quelle (S…) */
export interface VaultSource {
	path: string;
	id?: string;
	title: string;
	url?: string;
	/** Pfad des (ersten) Aufbewahrungsorts */
	repository?: string;
}

/** Aufbewahrungsort (R…) */
export interface VaultRepository {
	path: string;
	id?: string;
	name: string;
	url?: string;
}

/** Technische Zuordnung eines Ereignistyps aus `System/Ereignistyp/<Typ>` zu GEDCOM. */
export interface EventTypeDef {
	/** GEDCOM-Tag, z. B. "OCCU", "EVEN", "MARR" */
	gedcom: string;
	/** angezeigter Name bei EVEN/FACT, z. B. "Inhaftierung" */
	gedcomType?: string;
	/** Properties, aus denen der Wert eines Attributs kommt (erstes mit Wert gilt) */
	gedcomValue?: string[];
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
	places?: Map<string, VaultPlace>;
	/** Ereignistypen nach Name und Aliasen */
	eventTypes?: Map<string, EventTypeDef>;
	citations?: Map<string, VaultCitation>;
	sources?: Map<string, VaultSource>;
	repositories?: Map<string, VaultRepository>;
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

/** "[[Landwirt (Beruf)|Bauer]]" → "Bauer", "Bauer" → "Bauer" */
export function linkText(raw: unknown): string | undefined {
	if (typeof raw !== 'string' || !raw.trim()) return undefined;
	const link = parseWikilink(raw);
	if (!link) return raw.trim();
	return link.display || link.target;
}

/** "[[Geburt]]", "[[Wehrdienst|Kriegsdienst]]" oder "Geburt" → "Geburt" */
export function normalizeEventType(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	return parseWikilink(raw)?.target ?? raw.trim();
}
