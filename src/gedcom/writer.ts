import { AtheneDate } from '../date/AtheneDate';
import { type CheckResult, isPrivate, pairKey } from './checks';
import { type EventTypeDef, type VaultEvent, type VaultPerson, parseWikilink } from './model';

/**
 * GEDCOM 5.5.1-Export für GEDBAS.
 *
 * Schlüssel: `_UID` aus `uuid` bei Personen und Familien. Die XREFs sind die Vault-IDs
 * (I0301, F0155); GEDBAS vergibt beim Import eigene und behält nur die `_UID`.
 * Ausgegeben werden nur Tags, die GEDBAS auswertet (siehe Clippings/GEDCOM-Import – GenWiki).
 */

export interface WriterOptions {
	/** Datum der Erzeugung, z. B. new Date() */
	created: Date;
	/** Plugin-Version für HEAD.SOUR.VERS */
	version: string;
	/** Name des Einsenders, leer = ohne SUBM-Namen */
	submitter?: string;
	/** `FACT` als `EVEN` schreiben, weil GEDBAS `FACT` nicht anzeigt (Standard: true) */
	factAsEven?: boolean;
}

export interface WriterResult {
	text: string;
	persons: number;
	families: number;
	/** Personen ohne Tod, für die ein geschätztes Sterbedatum (BEF) ausgegeben wurde */
	estimatedDeaths: number;
}

/**
 * Eingebaute Zuordnung, falls ein Ereignistyp keine Typ-Notiz mit `gedcom` hat.
 * Maßgeblich sind die Typ-Notizen unter System/Ereignistyp (Properties `gedcom`, `gedcomType`, `gedcomValue`).
 */
const BUILTIN_TYPES: Record<string, EventTypeDef> = {
	Geburt: { gedcom: 'BIRT' },
	Taufe: { gedcom: 'CHR' },
	Firmung: { gedcom: 'CONF' },
	Kommunion: { gedcom: 'FCOM' },
	Priesterweihe: { gedcom: 'ORDN' },
	Elternschaft: { gedcom: 'ADOP' },
	Tod: { gedcom: 'DEAT' },
	Beisetzung: { gedcom: 'BURI' },
	Nachlass: { gedcom: 'PROB' },
	Heirat: { gedcom: 'MARR' },
	Verlobung: { gedcom: 'ENGA' },
	Ehevertrag: { gedcom: 'MARC' },
	Beruf: { gedcom: 'OCCU', gedcomValue: ['Beruf', 'Amt', 'Beschreibung'] },
	Amt: { gedcom: 'OCCU', gedcomValue: ['Amt', 'Beschreibung'] },
	Ausbildung: { gedcom: 'EDUC', gedcomValue: ['Beruf', 'Beschreibung'] },
	Wohnort: { gedcom: 'RESI', gedcomValue: ['Adresse', 'Beschreibung'] },
	Grundbesitz: { gedcom: 'PROP', gedcomValue: ['Beschreibung'] },
	Mitgliedschaft: { gedcom: 'FACT', gedcomType: 'Mitgliedschaft', gedcomValue: ['Organisation', 'Beschreibung'] },
	Primiz: { gedcom: 'EVEN', gedcomType: 'Primiz' },
	Krankensalbung: { gedcom: 'EVEN', gedcomType: 'Krankensalbung' },
	Inhaftierung: { gedcom: 'EVEN', gedcomType: 'Inhaftierung' },
	Wehrdienst: { gedcom: 'EVEN', gedcomType: 'Militärdienst' },
	Sonstiges: { gedcom: 'EVEN' },
	Ereignis: { gedcom: 'EVEN' },
};
/** Ereignisse eines Paares (stehen in GEDCOM an der FAM) */
const FAMILY_TAGS = new Set(['MARR', 'ENGA', 'MARC', 'MARB', 'MARL', 'MARS', 'DIV', 'DIVF', 'ANUL']);
/** Attribute: haben immer einen Wert in der Zeile */
const ATTRIBUTE_TAGS = new Set(['OCCU', 'EDUC', 'PROP', 'RELI', 'NATI', 'TITL', 'FACT', 'DSCR', 'CAST', 'IDNO', 'NCHI', 'NMR']);
const TAG_ORDER = ['BIRT', 'CHR', 'BAPM', 'ADOP', 'CONF', 'FCOM', 'ORDN', 'EDUC', 'OCCU', 'PROP', 'RESI', 'FACT', 'EVEN', 'WILL', 'PROB', 'DEAT', 'BURI'];
const tagRank = (tag: string) => (TAG_ORDER.includes(tag) ? TAG_ORDER.indexOf(tag) : TAG_ORDER.length);
/** GEDCOM-Zeilen dürfen höchstens 255 Zeichen lang sein. */
/** Freitext für GEDCOM: Wikilinks auflösen ("[[C01386]]" → "C01386", "[[Ziel|Anzeige]]" → "Anzeige"), höchstens `max` Zeichen. */
const clip = (s: string | undefined, max = 200) => {
	if (!s) return s;
	const plain = s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, display?: string) => display || target).replace(/\s+/g, ' ').trim();
	return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
};

const MONTHS: Record<string, string> = {
	jan: '01', feb: '02', mär: '03', mar: '03', apr: '04', mai: '05', may: '05', jun: '06',
	jul: '07', aug: '08', sep: '09', okt: '10', oct: '10', nov: '11', dez: '12', dec: '12',
};
const GEDCOM_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Ein Datum aus der Anzeige in ISO-Form: "10.10.1774" → "1774-10-10", "Nov. 1774" → "1774-11". */
function displayPartToIso(part: string): string | undefined {
	const s = part.trim();
	let m: RegExpMatchArray | null;
	if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
	if ((m = s.match(/^(\d{1,2})\.(\d{4})$/))) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
	if ((m = s.match(/^([A-Za-zÄÖÜäöü]{3})[a-zäöü]*\.?\s*(\d{4})$/))) {
		const mo = MONTHS[m[1]!.toLowerCase()];
		return mo ? `${m[2]}-${mo}` : undefined;
	}
	if (/^\d{4}(-\d{2}){0,2}$/.test(s)) return s;
	return undefined;
}

/**
 * Datumslink → EDTF. Das Linkziel liefert das Datum, die Anzeige die Qualifikation:
 * "[[1774|1774~]]" → "1774~", "[[1774|../1774]]" → "../1774", "[[1774|1774/1779]]" → "1774/1779".
 */
export function dateLinkToEdtf(raw: string | undefined): string | undefined {
	const link = parseWikilink(raw);
	if (!link || !/^\d{4}(-\d{2}){0,2}$/.test(link.target)) return undefined;
	const target = link.target;
	const display = (link.display ?? target).trim();
	const q = display.includes('~') && display.includes('?') ? '%' : display.includes('~') ? '~' : display.includes('?') ? '?' : '';
	const clean = display.replace(/[~?%]/g, '').trim();
	if (clean.startsWith('../') || /^vor\s/i.test(clean)) return `../${displayPartToIso(clean.replace(/^(\.\.\/|vor\s+)/i, '')) ?? target}${q}`;
	if (clean.endsWith('/..') || /^nach\s/i.test(clean)) return `${displayPartToIso(clean.replace(/(\/\.\.$|^nach\s+)/i, '')) ?? target}${q}/..`;
	const parts = clean.split('/');
	if (parts.length === 2) {
		const [a, b] = parts.map(displayPartToIso);
		if (a && b) return `${a}${q}/${b}${q}`;
	}
	return `${target}${q}`;
}

/** Datumslink → GEDCOM 5.5.1, z. B. "ABT 1774", "BEF 10 OCT 1774". */
export function dateLinkToGedcom(raw: string | undefined): string | undefined {
	const edtf = dateLinkToEdtf(raw);
	if (!edtf) return undefined;
	return AtheneDate.parse(edtf)?.toGedcom55() ?? AtheneDate.parse(edtf.replace(/[~?%]/g, ''))?.toGedcom55();
}

/** "Wiedenbauer, Maria Anna I0301" → { given: "Maria Anna", surname: "Wiedenbauer" } */
export function nameParts(basename: string): { given: string; surname: string } {
	const name = basename.replace(/\s+I\d+$/i, '').trim();
	const comma = name.indexOf(',');
	if (comma < 0) return { given: name, surname: '' };
	return { surname: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() };
}

/** Heiratsnamen aus den Aliasen: "Maria Anna Kastner" bei Geburtsname Wiedenbauer → "Kastner" */
export function marriedSurnames(p: VaultPerson): string[] {
	const { given, surname } = nameParts(p.basename);
	if (!given) return [];
	const out = new Set<string>();
	for (const alias of p.aliases ?? []) {
		if (!alias.startsWith(given + ' ')) continue;
		const rest = alias.slice(given.length + 1).trim();
		if (rest && rest !== surname && !/\d/.test(rest)) out.add(rest);
	}
	return [...out];
}

const gedcomToday = (d: Date) => `${d.getDate()} ${GEDCOM_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const xrefOf = (id: string | undefined, fallback: string) => `@${(id ?? fallback).replace(/[^A-Za-z0-9]/g, '')}@`;
/**
 * Eine GEDCOM-Zeile. Lange Werte werden mit CONC-Folgezeilen aufgeteilt, damit keine Zeile
 * 255 Bytes überschreitet (UTF-8: Umlaute zählen doppelt). Geteilt wird nie an einem Leerzeichen,
 * weil CONC-Teile ohne Trennzeichen aneinandergehängt werden.
 */
export const line = (level: number, tag: string, value?: string): string => {
	if (!value) return `${level} ${tag}`;
	const bytes = (s: string) => new TextEncoder().encode(s).length;
	const MAX = 240;
	const head = `${level} ${tag} `;
	if (bytes(head + value) <= MAX) return head + value;
	const parts: string[] = [];
	let rest = value;
	let prefix = head;
	while (bytes(prefix + rest) > MAX) {
		let cut = rest.length;
		while (cut > 1 && bytes(prefix + rest.slice(0, cut)) > MAX) cut--;
		while (cut > 1 && (rest[cut - 1] === ' ' || rest[cut] === ' ')) cut--;
		parts.push(prefix + rest.slice(0, cut));
		rest = rest.slice(cut);
		prefix = `${level + 1} CONC `;
	}
	parts.push(prefix + rest);
	return parts.join('\r\n');
};
/** Ereignisse, die per Datenschutz nicht veröffentlicht werden (Sensitiv, Privat) */
const isHiddenEvent = (e: VaultEvent) => !!e.privacy && (/sensitiv/i.test(e.privacy) || isPrivate(e.privacy));

export function writeGedcom(r: CheckResult, opts: WriterOptions): WriterResult {
	const { model, rel, scope } = r;
	const inScope = (p?: string): p is string => !!p && scope.included.has(p);
	const factAsEven = opts.factAsEven ?? true;
	/** Zuordnung zu GEDCOM: Typ-Notiz, sonst eingebaute Tabelle; ohne Zuordnung (z.B. "Kind") kein Export */
	const typeDef = (e: VaultEvent): EventTypeDef | undefined => model.eventTypes?.get(e.type) ?? BUILTIN_TYPES[e.type];
	/** Wert eines Attributs: erstes Property aus `gedcomValue` mit Inhalt */
	const valueOf = (e: VaultEvent, def: EventTypeDef): string | undefined => {
		for (const prop of def.gedcomValue ?? []) {
			const v = e.fields?.[prop] ?? (prop === 'Beschreibung' ? e.description : prop === 'Adresse' ? e.address : undefined);
			if (v) return v;
		}
		return e.occupation ?? e.description;
	};
	const persons = [...scope.included].map(p => model.persons.get(p)!).filter(Boolean)
		.sort((a, b) => (a.id ?? a.path).localeCompare(b.id ?? b.path));
	const personXref = new Map(persons.map(p => [p.path, xrefOf(p.id, p.basename)]));

	// ── Orte: PLAC = Name der Ort-Notiz (ohne ID); Kreis/Land kommen später über GOV bzw. die Orts-Hierarchie
	const placeLines = (e: { place?: string; placeDetails?: string[]; placeText?: string }, level: number, extraAddress?: string): string[] => {
		const place = e.place ? model.places?.get(e.place) : undefined;
		if (!place) {
			// Ort als Freitext (ohne Ort-Notiz), z.B. "KL Buchenwald (bei Weimar)"
			if (!e.placeText) return extraAddress ? [line(level, 'ADDR', clip(extraAddress))] : [];
			const out = [line(level, 'PLAC', clip(e.placeText))];
			if (extraAddress) out.push(line(level, 'ADDR'), line(level + 1, 'ADR1', clip(extraAddress)));
			return out;
		}
		const plac = place.name;
		const out = [line(level, 'PLAC', plac)];
		// GEDCOM-L-Erweiterungen unter PLAC: GOV-Kennung und Koordinaten
		if (place.gov) out.push(line(level + 1, '_GOV', place.gov));
		if (place.lat !== undefined && place.long !== undefined) {
			out.push(line(level + 1, 'MAP'),
				line(level + 2, 'LATI', `${place.lat >= 0 ? 'N' : 'S'}${Math.abs(place.lat)}`),
				line(level + 2, 'LONG', `${place.long >= 0 ? 'E' : 'W'}${Math.abs(place.long)}`));
		}
		// genauere Orte aus `Ort` (Hof, Kirche) als ADR1, PLZ als POST
		const details = (e.placeDetails ?? []).map(p => model.places?.get(p)?.name).filter((n): n is string => !!n);
		if (extraAddress) details.push(extraAddress);
		const post = place.address?.match(/\b([A-Z]{2}-\d{4,5})\b/)?.[1];
		if (details.length || post) {
			out.push(line(level, 'ADDR'));
			if (details.length) out.push(line(level + 1, 'ADR1', clip(details.join(', '))));
			out.push(line(level + 1, 'ADR2', plac));
			if (post) out.push(line(level + 1, 'POST', post));
		}
		return out;
	};

	// ── Quellen: Fundstelle → Quellenangabe am Ereignis, Quelle → SOUR, Aufbewahrungsort → REPO
	const QUAY: Record<string, string> = { Beurkundet: '3', Gesichert: '2', Nachgewiesen: '2', Abgeleitet: '1', Geschätzt: '0' };
	const usedSources = new Set<string>();
	const sourceXref = (path: string) => xrefOf(model.sources?.get(path)?.id, `S${path.length}`);
	const citationLines = (e: VaultEvent, level: number): string[] => {
		const out: string[] = [];
		const quay = e.confidence ? QUAY[e.confidence] : undefined;
		for (const ev of e.evidence ?? []) {
			const cit = model.citations?.get(ev);
			const sourcePath = cit ? cit.source : model.sources?.has(ev) ? ev : undefined;
			if (!sourcePath || !model.sources?.has(sourcePath)) continue;
			usedSources.add(sourcePath);
			out.push(line(level, 'SOUR', sourceXref(sourcePath)));
			if (cit) {
				// Seitenangabe: Bezeichnung der Fundstelle, dazu Beschreibung (Seite) bzw. bei Regeln die Anmerkung des Ereignisses
				const isRule = /regel/i.test(cit.title) || model.sources.get(sourcePath)?.title === 'Basisregelwerk';
				// Regel: "Regel: Hofübernahme – <Beschreibung der Regel>; <Anmerkung des Ereignisses>"
				const page = isRule
					? [`Regel: ${cit.title.replace(/\s*\(Regel\)\s*$/i, '')}${cit.description ? ` – ${cit.description}` : ''}`, e.note]
					: [cit.title, cit.description];
				out.push(line(level + 1, 'PAGE', clip(page.filter(Boolean).join('; '), 1000)));
				const date = dateLinkToGedcom(cit.date);
				if (date && !isRule) out.push(line(level + 1, 'DATA'), line(level + 2, 'DATE', date));
				if (cit.url) out.push(line(level + 1, '_LINK', cit.url));
			}
			if (quay) out.push(line(level + 1, 'QUAY', quay));
		}
		return out;
	};

	// ── Familien: Paare aus der Prüfung, Kinder aus Geburt/Elternschaft, Heirat aus den Ereignissen
	interface Fam { xref: string; uid?: string; husb?: string; wife?: string; children: Map<string, string>; marriages: { tag: string; e: VaultEvent }[] }
	const families = new Map<string, Fam>();
	const familyByPath = new Map(model.families.map(f => [f.path, f]));
	for (const n of r.families.needed) {
		const rec = n.family ? familyByPath.get(n.family) : undefined;
		const key = pairKey(n.father, n.mother);
		families.set(key, {
			xref: xrefOf(rec?.id, `F${families.size + 1}`),
			uid: rec?.uuid,
			husb: inScope(n.father) ? n.father : undefined,
			wife: inScope(n.mother) ? n.mother : undefined,
			children: new Map(),
			marriages: [],
		});
	}
	for (const pair of rel.parentPairs) {
		if (!inScope(pair.child)) continue;
		const fam = families.get(pairKey(pair.father, pair.mother));
		if (!fam) continue;
		const pedi = pair.type === 'Elternschaft' ? 'adopted' : 'birth';
		if (!fam.children.has(pair.child) || pedi === 'birth') fam.children.set(pair.child, pedi);
	}
	const sex = (p: string) => model.persons.get(p)?.sex;
	// Paar-Ereignisse (Heirat, Verlobung, Ehevertrag …): Im Vault zwischen zwei Personen, in GEDCOM an der FAM des Paares
	for (const e of model.events) {
		const tag = typeDef(e)?.gedcom;
		if (!tag || !FAMILY_TAGS.has(tag) || e.persons.length !== 2 || isHiddenEvent(e)) continue;
		const [a, b] = e.persons as [string, string];
		const aIsWife = sex(a) === 'F' || (sex(a) !== 'M' && sex(b) === 'M');
		const [father, mother] = aIsWife ? [b, a] : [a, b];
		families.get(pairKey(father, mother))?.marriages.push({ tag, e });
	}
	const exported = [...families.values()].filter(f => f.husb || f.wife || f.children.size > 0)
		.filter(f => (f.husb ? 1 : 0) + (f.wife ? 1 : 0) + f.children.size >= 2);
	exported.sort((a, b) => a.xref.localeCompare(b.xref));
	const famc = new Map<string, { xref: string; pedi: string }[]>();
	const fams = new Map<string, string[]>();
	for (const f of exported) {
		for (const p of [f.husb, f.wife]) if (p) fams.set(p, [...(fams.get(p) ?? []), f.xref]);
		for (const [c, pedi] of f.children) famc.set(c, [...(famc.get(c) ?? []), { xref: f.xref, pedi }]);
	}

	// ── Ereignisse je Person
	const eventsOf = new Map<string, VaultEvent[]>();
	for (const e of model.events) {
		const tag = typeDef(e)?.gedcom;
		if (isHiddenEvent(e) || !tag || tag === '-' || FAMILY_TAGS.has(tag)) continue;
		for (const p of e.persons) if (inScope(p)) eventsOf.set(p, [...(eventsOf.get(p) ?? []), e]);
	}
	const religionOf = new Map<string, string>();
	for (const e of model.events) {
		if (e.type === 'Taufe' && e.religion) for (const p of e.persons) if (inScope(p) && !religionOf.has(p)) religionOf.set(p, e.religion);
	}

	/**
	 * Grobe Schätzung des Geburtsjahrs für ein Sterbedatum "BEF Geburt+100":
	 * Geburt, sonst Heirat − 25, erstes Kind − 30, Ehepartner, Eltern + 30.
	 */
	const years = (ps: Iterable<string> | undefined) => [...(ps ?? [])].map(x => rel.birthYear.get(x)).filter((y): y is number => y !== undefined);
	const estimatedBirth = (p: string, depth = 0): number | undefined => {
		const b = rel.birthYear.get(p);
		if (b !== undefined) return b;
		const m = rel.marriageYears.get(p);
		if (m?.length) return Math.min(...m) - 25;
		const kids = years(rel.children.get(p));
		if (kids.length) return Math.min(...kids) - 30;
		// Vorfahren ohne Daten: über die geschätzte Geburt der Kinder (höchstens 5 Generationen)
		if (depth < 5) {
			const est = [...(rel.children.get(p) ?? [])].map(c => estimatedBirth(c, depth + 1)).filter((y): y is number => y !== undefined);
			if (est.length) return Math.min(...est) - 30;
		}
		const spouses = years(rel.spouses.get(p));
		if (spouses.length) return Math.max(...spouses);
		const parents = years(rel.parents.get(p));
		if (parents.length) return Math.max(...parents) + 30;
		return undefined;
	};
	let estimatedDeaths = 0;
	const deathEstimate = (p: string): string | undefined => {
		const b = estimatedBirth(p);
		if (b === undefined) return undefined;
		estimatedDeaths++;
		return `BEF ${b + 100}`;
	};

	const out: string[] = [];
	out.push('0 HEAD', '1 SOUR athene-genealogy', `2 VERS ${opts.version}`, '2 NAME athene-genealogy (Obsidian)');
	out.push(`1 DATE ${gedcomToday(opts.created)}`, '1 SUBM @SUBM@', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '1 LANG German');
	out.push('0 @SUBM@ SUBM', line(1, 'NAME', opts.submitter || 'athene-genealogy'));

	for (const p of persons) {
		const { given, surname } = nameParts(p.basename);
		out.push(`0 ${personXref.get(p.path)} INDI`);
		out.push(line(1, 'NAME', `${given} /${surname}/`.trim()), line(2, 'TYPE', 'birth'));
		if (given) out.push(line(2, 'GIVN', given));
		if (surname) out.push(line(2, 'SURN', surname));
		for (const married of marriedSurnames(p)) {
			out.push(line(1, 'NAME', `${given} /${married}/`), line(2, 'TYPE', 'married'), line(2, 'GIVN', given), line(2, 'SURN', married));
		}
		if (p.sex === 'M' || p.sex === 'F') out.push(line(1, 'SEX', p.sex));
		else out.push(line(1, 'SEX', 'U'));

		const events = (eventsOf.get(p.path) ?? []).slice().sort((a, b) =>
			tagRank(typeDef(a)!.gedcom) - tagRank(typeDef(b)!.gedcom)
			|| (dateLinkToEdtf(a.date) ?? '').localeCompare(dateLinkToEdtf(b.date) ?? ''));
		let hasDeath = false;
		for (const e of events) {
			const def = typeDef(e)!;
			let tag = def.gedcom;
			let type = def.gedcomType;
			let value: string | undefined;
			if (tag === 'RESI') {
				value = undefined; // in 5.5.1 ohne Wert; Adresse/Beschreibung kommt als ADDR
			} else if (ATTRIBUTE_TAGS.has(tag)) {
				// Attribut: Wert aus `gedcomValue`, sonst der Name des Typs (z.B. "Grundbesitz")
				value = valueOf(e, def) ?? type ?? e.type;
			} else if (tag === 'EVEN') {
				value = e.description;
				type = type ?? e.kind ?? 'Ereignis';
			}
			if (tag === 'FACT' && factAsEven) tag = 'EVEN';
			const start = out.length;
			out.push(line(1, tag, clip(value) || undefined));
			if (type && (tag === 'EVEN' || tag === 'FACT')) out.push(line(2, 'TYPE', clip(type, 90)));
			let date = dateLinkToGedcom(e.date);
			if (tag === 'DEAT') {
				hasDeath = true;
				if (!date) date = deathEstimate(p.path);
			}
			if (date) out.push(line(2, 'DATE', date));
			// Wohnort: Wert (Adresse, Beschreibung) als Adresse, z.B. "DP Assembly Center Kempten"
			// Adresse (z.B. Hof, Hausnummer) bei allen Ereignissen als ADDR; beim Wohnort notfalls die Beschreibung
			out.push(...placeLines(e, 2, tag === 'RESI' ? valueOf(e, def) : e.address));
			// Taufe: Konfession des Ereignisses
			if ((tag === 'CHR' || tag === 'BAPM') && e.religion) out.push(line(2, 'RELI', e.religion));
			const beforeSources = out.length;
			out.push(...citationLines(e, 2));
			if (beforeSources === start + 1 && !value) {
				// Ereignis ohne Datum, Ort und Wert: Tod als "DEAT Y", alles andere weglassen
				if (tag === 'DEAT') out[start] = '1 DEAT Y';
				else out.length = start;
			}
		}
		if (!hasDeath && !rel.hasDeath.has(p.path)) {
			const date = deathEstimate(p.path);
			out.push(date ? '1 DEAT' : '1 DEAT Y');
			if (date) out.push(line(2, 'DATE', date));
		}
		const reli = religionOf.get(p.path);
		if (reli) out.push(line(1, 'RELI', reli));
		if (p.uuid) out.push(line(1, '_UID', p.uuid.toLowerCase()));
		for (const c of famc.get(p.path) ?? []) out.push(line(1, 'FAMC', c.xref), line(2, 'PEDI', c.pedi));
		for (const f of fams.get(p.path) ?? []) out.push(line(1, 'FAMS', f));
	}

	for (const f of exported) {
		out.push(`0 ${f.xref} FAM`);
		if (f.husb) out.push(line(1, 'HUSB', personXref.get(f.husb)));
		if (f.wife) out.push(line(1, 'WIFE', personXref.get(f.wife)));
		for (const c of f.children.keys()) out.push(line(1, 'CHIL', personXref.get(c)));
		for (const { tag, e: m } of f.marriages) {
			const start = out.length;
			out.push(line(1, tag));
			const date = dateLinkToGedcom(m.date);
			if (date) out.push(line(2, 'DATE', date));
			out.push(...placeLines(m, 2));
			if (out.length === start + 1) out[start] = line(1, tag, 'Y');
			out.push(...citationLines(m, 2));
		}
		if (f.uid) out.push(line(1, '_UID', f.uid.toLowerCase()));
	}
	// Quellen- und Archiv-Datensätze (nur die, auf die eine Quellenangabe verweist)
	const usedRepos = new Set<string>();
	for (const path of [...usedSources].sort((a, b) => sourceXref(a).localeCompare(sourceXref(b)))) {
		const s = model.sources!.get(path)!;
		out.push(`0 ${sourceXref(path)} SOUR`, line(1, 'TITL', clip(s.title, 240)));
		if (s.url) out.push(line(1, '_LINK', s.url));
		const repo = s.repository ? model.repositories?.get(s.repository) : undefined;
		if (repo) {
			usedRepos.add(repo.path);
			out.push(line(1, 'REPO', xrefOf(repo.id, `R${repo.path.length}`)));
		}
	}
	for (const path of [...usedRepos].sort()) {
		const repo = model.repositories!.get(path)!;
		out.push(`0 ${xrefOf(repo.id, `R${path.length}`)} REPO`, line(1, 'NAME', clip(repo.name, 90)));
		if (repo.url) out.push(line(1, 'WWW', repo.url));
	}
	out.push('0 TRLR');

	return { text: out.join('\r\n') + '\r\n', persons: persons.length, families: exported.length, estimatedDeaths };
}
