import { AtheneDate } from '../date/AtheneDate';
import { type CheckResult, isPrivate, pairKey } from './checks';
import { type VaultEvent, type VaultPerson, parseWikilink } from './model';

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
	/** PLAC-Werte der Referenz-GEDCOM, damit bekannte Orte gleich geschrieben werden ("Wollishausen, BY") */
	referencePlaces?: string[];
}

export interface WriterResult {
	text: string;
	persons: number;
	families: number;
	/** Personen ohne Tod, für die ein geschätztes Sterbedatum (BEF) ausgegeben wurde */
	estimatedDeaths: number;
}

/** Ereignistyp im Vault → GEDCOM-Tag (Personen). Fehlende Typen werden nicht exportiert. */
const INDI_EVENTS: Record<string, { tag: string; type?: string; value?: boolean }> = {
	Geburt: { tag: 'BIRT' },
	Taufe: { tag: 'CHR' },
	Tod: { tag: 'DEAT' },
	Beisetzung: { tag: 'BURI' },
	Firmung: { tag: 'CONF' },
	Kommunion: { tag: 'FCOM' },
	Wohnort: { tag: 'RESI' },
	Nachlass: { tag: 'WILL' },
	Beruf: { tag: 'OCCU', value: true },
	Ausbildung: { tag: 'EDUC', value: true },
	Grundbesitz: { tag: 'PROP', value: true },
	Priesterweihe: { tag: 'EVEN', type: 'Priesterweihe' },
	Primiz: { tag: 'EVEN', type: 'Primiz' },
	Wehrdienst: { tag: 'EVEN', type: 'Wehrdienst' },
	Inhaftierung: { tag: 'EVEN', type: 'Inhaftierung' },
	Mitgliedschaft: { tag: 'EVEN', type: 'Mitgliedschaft' },
	Krankensalbung: { tag: 'EVEN', type: 'Krankensalbung' },
	Amt: { tag: 'EVEN', type: 'Amt' },
	// generisch: TYPE aus `Art`, sonst "Ereignis"; Text aus `Beschreibung`
	Sonstiges: { tag: 'EVEN' },
	Ereignis: { tag: 'EVEN' },
};
/** GEDCOM-Zeilen dürfen höchstens 255 Zeichen lang sein. */
/** Freitext für GEDCOM: Wikilinks auflösen ("[[C01386]]" → "C01386", "[[Ziel|Anzeige]]" → "Anzeige"), höchstens `max` Zeichen. */
const clip = (s: string | undefined, max = 200) => {
	if (!s) return s;
	const plain = s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, display?: string) => display || target).replace(/\s+/g, ' ').trim();
	return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
};
const TAG_ORDER = ['BIRT', 'CHR', 'CONF', 'FCOM', 'EDUC', 'OCCU', 'PROP', 'RESI', 'EVEN', 'WILL', 'DEAT', 'BURI'];

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
	const name = basename.replace(/\s+I\d+$/, '').trim();
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
const line = (level: number, tag: string, value?: string) => (value ? `${level} ${tag} ${value}` : `${level} ${tag}`);
/** Ereignisse, die per Datenschutz nicht veröffentlicht werden (Sensitiv, Privat) */
const isHiddenEvent = (e: VaultEvent) => !!e.privacy && (/sensitiv/i.test(e.privacy) || isPrivate(e.privacy));

export function writeGedcom(r: CheckResult, opts: WriterOptions): WriterResult {
	const { model, rel, scope } = r;
	const inScope = (p?: string): p is string => !!p && scope.included.has(p);
	const persons = [...scope.included].map(p => model.persons.get(p)!).filter(Boolean)
		.sort((a, b) => (a.id ?? a.path).localeCompare(b.id ?? b.path));
	const personXref = new Map(persons.map(p => [p.path, xrefOf(p.id, p.basename)]));

	// ── Orte
	const refPlaces = new Map<string, string[]>();
	for (const plac of opts.referencePlaces ?? []) {
		const head = plac.split(',')[0]!.trim();
		refPlaces.set(head, [...new Set([...(refPlaces.get(head) ?? []), plac])]);
	}
	const placeLines = (e: { place?: string; placeDetails?: string[]; placeText?: string }, level: number, extraAddress?: string): string[] => {
		const place = e.place ? model.places?.get(e.place) : undefined;
		if (!place) {
			// Ort als Freitext (ohne Ort-Notiz), z.B. "KL Buchenwald (bei Weimar)"
			if (!e.placeText) return extraAddress ? [line(level, 'ADDR', clip(extraAddress))] : [];
			const out = [line(level, 'PLAC', clip(e.placeText))];
			if (extraAddress) out.push(line(level, 'ADDR'), line(level + 1, 'ADR1', clip(extraAddress)));
			return out;
		}
		const known = refPlaces.get(place.name);
		const plac = known?.length === 1 ? known[0]! : place.name;
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

	// ── Familien: Paare aus der Prüfung, Kinder aus Geburt/Elternschaft, Heirat aus den Ereignissen
	interface Fam { xref: string; uid?: string; husb?: string; wife?: string; children: Map<string, string>; marriages: VaultEvent[] }
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
	for (const e of model.events) {
		if (e.type !== 'Heirat' || e.persons.length !== 2 || isHiddenEvent(e)) continue;
		const [a, b] = e.persons as [string, string];
		const aIsWife = sex(a) === 'F' || (sex(a) !== 'M' && sex(b) === 'M');
		const [father, mother] = aIsWife ? [b, a] : [a, b];
		families.get(pairKey(father, mother))?.marriages.push(e);
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
		if (isHiddenEvent(e) || !INDI_EVENTS[e.type]) continue;
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
			TAG_ORDER.indexOf(INDI_EVENTS[a.type]!.tag) - TAG_ORDER.indexOf(INDI_EVENTS[b.type]!.tag)
			|| (dateLinkToEdtf(a.date) ?? '').localeCompare(dateLinkToEdtf(b.date) ?? ''));
		let hasDeath = false;
		for (const e of events) {
			const map = INDI_EVENTS[e.type]!;
			// Attribute (OCCU, EDUC, PROP) brauchen einen Wert; EVEN bekommt die Beschreibung als Text
			const value = map.value
				? (e.occupation ?? e.kind ?? e.description ?? (map.tag === 'PROP' ? 'Grundbesitz' : ''))
				: map.tag === 'EVEN' ? (e.description ?? '') : '';
			if (map.value && !value) continue;
			const start = out.length;
			out.push(line(1, map.tag, clip(value) || undefined));
			const type = map.type ?? (map.tag === 'EVEN' ? (e.kind ?? 'Ereignis') : undefined);
			if (type) out.push(line(2, 'TYPE', clip(type, 90)));
			let date = dateLinkToGedcom(e.date);
			if (map.tag === 'DEAT') {
				hasDeath = true;
				if (!date) date = deathEstimate(p.path);
			}
			if (date) out.push(line(2, 'DATE', date));
			// Wohnort: Adresse oder Beschreibung (z.B. "DP Assembly Center Kempten") als Adresse
			out.push(...placeLines(e, 2, map.tag === 'RESI' ? (e.address ?? e.description) : undefined));
			if (out.length === start + 1) {
				// Ereignis ohne Datum und Ort: Tod als "DEAT Y", alles andere weglassen
				if (map.tag === 'DEAT') out[start] = '1 DEAT Y';
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
		for (const m of f.marriages) {
			out.push('1 MARR');
			const date = dateLinkToGedcom(m.date);
			if (date) out.push(line(2, 'DATE', date));
			out.push(...placeLines(m, 2));
			if (!date && !m.place) out[out.length - 1] = '1 MARR Y';
		}
		if (f.uid) out.push(line(1, '_UID', f.uid.toLowerCase()));
	}
	out.push('0 TRLR');

	return { text: out.join('\r\n') + '\r\n', persons: persons.length, families: exported.length, estimatedDeaths };
}
