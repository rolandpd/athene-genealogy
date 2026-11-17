import { type GedcomIndividual, type VaultModel, parseWikilink, yearOfDateLink } from './model';
import { isValidUid } from './uid';

export interface CheckOptions {
	/** Aktuelles Jahr (für die Lebend-Regel) */
	currentYear: number;
	/** Wer jünger ist und kein Sterbe-/Beisetzungsereignis hat, gilt als lebend */
	livingYears: number;
}

export const BIRTH_TYPES = ['Geburt', 'Taufe'];
export const DEATH_TYPES = ['Tod', 'Beisetzung'];
export const PARENT_TYPES = ['Geburt', 'Elternschaft'];
export const MARRIAGE_TYPES = ['Heirat'];

// ── Beziehungen ───────────────────────────────────────────────────────────────

export interface Relations {
	birthYear: Map<string, number>;
	deathYear: Map<string, number>;
	/** hat ein Tod-/Beisetzungsereignis (auch ohne Datum) */
	hasDeath: Set<string>;
	parents: Map<string, Set<string>>;
	children: Map<string, Set<string>>;
	spouses: Map<string, Set<string>>;
	marriageYears: Map<string, number[]>;
}

function add<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
	let set = map.get(key);
	if (!set) map.set(key, (set = new Set()));
	set.add(value);
}

export function buildRelations(model: VaultModel): Relations {
	const rel: Relations = {
		birthYear: new Map(), deathYear: new Map(), hasDeath: new Set(),
		parents: new Map(), children: new Map(), spouses: new Map(), marriageYears: new Map(),
	};
	const isPerson = (p: string | undefined): p is string => !!p && model.persons.has(p);

	for (const e of model.events) {
		const persons = e.persons.filter(isPerson);
		const year = yearOfDateLink(e.date);
		for (const p of persons) {
			if (BIRTH_TYPES.includes(e.type) && year !== undefined) {
				rel.birthYear.set(p, Math.min(rel.birthYear.get(p) ?? Infinity, year));
			}
			if (DEATH_TYPES.includes(e.type)) {
				rel.hasDeath.add(p);
				if (year !== undefined) rel.deathYear.set(p, Math.min(rel.deathYear.get(p) ?? Infinity, year));
			}
			if (PARENT_TYPES.includes(e.type)) {
				for (const parent of [e.father, e.mother].filter(isPerson)) {
					add(rel.parents, p, parent);
					add(rel.children, parent, p);
				}
			}
			if (MARRIAGE_TYPES.includes(e.type) && year !== undefined) {
				rel.marriageYears.set(p, [...(rel.marriageYears.get(p) ?? []), year]);
			}
		}
		if (MARRIAGE_TYPES.includes(e.type) && persons.length === 2) {
			const [a, b] = persons as [string, string];
			add(rel.spouses, a, b);
			add(rel.spouses, b, a);
		}
	}
	return rel;
}

// ── Abgleich mit einer GEDCOM-Referenz (z. B. GEDBAS-Reexport) ───────────────

export interface ReferenceMatch {
	individual: GedcomIndividual;
	person?: string;
	via?: 'uid' | 'name';
	candidates: string[];
}

/** "Anna Maria /Baumann/" und "Baumann, Anna Maria I0002" → "anna baumann maria" */
export function nameKey(name: string): string {
	return name
		.replace(/\s+I\d+$/, '')
		.toLowerCase()
		.replace(/[/,]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.sort()
		.join(' ');
}

export function matchReference(model: VaultModel, rel: Relations, individuals: GedcomIndividual[]): ReferenceMatch[] {
	const byUid = new Map<string, string>();
	const byName = new Map<string, string[]>();
	for (const p of model.persons.values()) {
		if (p.uuid) byUid.set(p.uuid.toLowerCase(), p.path);
		const key = nameKey(p.basename);
		byName.set(key, [...(byName.get(key) ?? []), p.path]);
	}

	const matches: ReferenceMatch[] = individuals.filter(g => !g.deleted).map(g => {
		const uidHit = g.uid ? byUid.get(g.uid) : undefined;
		if (uidHit) return { individual: g, person: uidHit, via: 'uid' as const, candidates: [uidHit] };

		const year = Number(g.birthDate?.match(/\d{4}/)?.[0]) || undefined;
		const sameName = byName.get(nameKey(g.name ?? '')) ?? [];
		const fitting = sameName.filter(p => {
			const b = rel.birthYear.get(p);
			return year === undefined || b === undefined || Math.abs(b - year) <= 1;
		});
		const exact = fitting.filter(p => rel.birthYear.get(p) === year);
		const hit = fitting.length === 1 ? fitting[0] : exact.length === 1 ? exact[0] : undefined;
		return { individual: g, person: hit, via: hit ? 'name' as const : undefined, candidates: fitting };
	});

	// Eine Vault-Person darf nur einmal per Name zugeordnet werden — sonst mehrdeutig
	const count = new Map<string, number>();
	for (const m of matches) if (m.person) count.set(m.person, (count.get(m.person) ?? 0) + 1);
	for (const m of matches) {
		if (m.via === 'name' && m.person && (count.get(m.person) ?? 0) > 1) {
			m.candidates = [m.person];
			m.person = undefined;
			m.via = undefined;
		}
	}
	return matches;
}

// ── Export-Umfang ─────────────────────────────────────────────────────────────

export interface Scope {
	included: Set<string>;
	/** Kekulé-Personen und ihre direkten Verwandten */
	connected: Set<string>;
	/** aus der Referenz übernommen (Bestandsschutz) */
	protectedByReference: Set<string>;
	excludedByFlag: string[];
	living: string[];
	/** weder Geburtsjahr noch Tod → Lebend-Regel nicht anwendbar */
	unknownLiving: string[];
}

export function isPrivate(privacy: string | undefined): boolean {
	return !!privacy && /privat|privacy/i.test(privacy);
}

export function computeScope(model: VaultModel, rel: Relations, referenced: Iterable<string>, opts: CheckOptions): Scope {
	const kekule = [...model.persons.values()].filter(p => p.kekule).map(p => p.path);
	const connected = new Set(kekule);
	for (const k of kekule) {
		for (const map of [rel.parents, rel.children, rel.spouses]) {
			for (const x of map.get(k) ?? []) connected.add(x);
		}
	}
	const protectedByReference = new Set(referenced);
	const candidates = new Set([...connected, ...protectedByReference]);
	const cutoff = opts.currentYear - opts.livingYears;

	const scope: Scope = { included: new Set(), connected, protectedByReference, excludedByFlag: [], living: [], unknownLiving: [] };
	for (const p of candidates) {
		const person = model.persons.get(p);
		if (!person) continue;
		if (person.exportFlag === false || isPrivate(person.privacy)) {
			scope.excludedByFlag.push(p);
			continue;
		}
		if (!rel.hasDeath.has(p)) {
			const b = rel.birthYear.get(p);
			if (b !== undefined && b > cutoff) {
				scope.living.push(p);
				continue;
			}
			if (b === undefined) scope.unknownLiving.push(p);
		}
		scope.included.add(p);
	}
	return scope;
}

// ── Datumslinks: Linkziel und Anzeige müssen übereinstimmen ──────────────────

export interface DateLinkIssue {
	event: string;
	value: string;
	/** coarse: Link zeigt nur auf Monat/Jahr, die Anzeige nennt einen Tag (sortiert ungenau) */
	reason: 'mismatch' | 'unreadable' | 'coarse';
}

/**
 * Vergleicht Linkziel und Anzeigetext eines Datumslinks.
 * Geprüft werden nur rein numerische Anzeigen (TT.MM.JJJJ, MM.JJJJ, JJJJ, ISO);
 * Zeiträume (1774/1779), Monatsnamen und Freitext werden übersprungen.
 */
export function checkDateLink(raw: string): DateLinkIssue['reason'] | null {
	const link = parseWikilink(raw);
	if (!link?.display) return null;
	const target = link.target;
	let display = link.display.replace(/[~?]/g, '').trim();
	display = display.replace(/^\.\.\//, '').replace(/\/\.\.$/, '');
	if (display.includes('/') || /[A-Za-zÄÖÜäöü]/.test(display)) return null;

	let expected: string | undefined;
	let m: RegExpMatchArray | null;
	if ((m = display.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) {
		const [, d, mo, y] = m as unknown as [string, string, string, string];
		if (Number(mo) > 12 || Number(d) > 31) return 'unreadable';
		expected = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
	} else if ((m = display.match(/^(\d{1,2})\.(\d{4})$/))) {
		const [, mo, y] = m as unknown as [string, string, string];
		expected = `${y}-${mo.padStart(2, '0')}`;
	} else if (/^\d{4}(-\d{2}){0,2}$/.test(display)) {
		expected = display;
	} else if (/\d/.test(display)) {
		return 'unreadable';
	} else {
		return null;
	}
	if (target === expected) return null;
	return expected.startsWith(target + '-') ? 'coarse' : 'mismatch';
}

export function checkDateLinks(model: VaultModel): DateLinkIssue[] {
	const issues: DateLinkIssue[] = [];
	for (const e of model.events) {
		if (!e.date) continue;
		const reason = checkDateLink(e.date);
		if (reason) issues.push({ event: e.path, value: e.date, reason });
	}
	return issues;
}

// ── Plausibilität ─────────────────────────────────────────────────────────────

export interface PlausibilityIssue {
	person: string;
	other?: string;
	kind: 'deathBeforeBirth' | 'tooOld' | 'marriageTooYoung' | 'parentAge' | 'parentDead';
	/** Zahl zur Erläuterung (Alter, Abstand, Jahr) */
	value: number;
}

export function checkPlausibility(model: VaultModel, rel: Relations): PlausibilityIssue[] {
	const issues: PlausibilityIssue[] = [];
	for (const p of model.persons.keys()) {
		const b = rel.birthYear.get(p);
		const d = rel.deathYear.get(p);
		if (b !== undefined && d !== undefined) {
			if (d < b) issues.push({ person: p, kind: 'deathBeforeBirth', value: d });
			else if (d - b > 105) issues.push({ person: p, kind: 'tooOld', value: d - b });
		}
		for (const m of rel.marriageYears.get(p) ?? []) {
			if (b !== undefined && m - b < 14) issues.push({ person: p, kind: 'marriageTooYoung', value: m - b });
		}
		for (const parent of rel.parents.get(p) ?? []) {
			const pb = rel.birthYear.get(parent);
			const pd = rel.deathYear.get(parent);
			if (b !== undefined && pb !== undefined && (b - pb < 14 || b - pb > 60)) {
				issues.push({ person: p, other: parent, kind: 'parentAge', value: b - pb });
			}
			// Vater darf bis zu einem Jahr vor der Geburt gestorben sein
			if (b !== undefined && pd !== undefined && b > pd + 1) {
				issues.push({ person: p, other: parent, kind: 'parentDead', value: pd });
			}
		}
	}
	return issues;
}

// ── Familien ──────────────────────────────────────────────────────────────────

export interface FamilyCheck {
	/** benötigte Paare: Vater/Mutter (eins davon kann fehlen) */
	needed: { father?: string; mother?: string; family?: string }[];
	missing: { father?: string; mother?: string }[];
	withoutUuid: string[];
}

const pairKey = (f?: string, m?: string) => `${f ?? '-'}|${m ?? '-'}`;

export function checkFamilies(model: VaultModel, rel: Relations, scope: Set<string>): FamilyCheck {
	const existing = new Map(model.families.map(f => [pairKey(f.father, f.mother), f]));
	const sex = (p: string) => model.persons.get(p)?.sex;
	const needed = new Map<string, { father?: string; mother?: string }>();

	for (const child of scope) {
		const ps = [...(rel.parents.get(child) ?? [])];
		const father = ps.find(x => sex(x) === 'M');
		const mother = ps.find(x => sex(x) === 'F');
		if (father || mother) needed.set(pairKey(father, mother), { father, mother });
	}
	for (const p of scope) {
		for (const s of rel.spouses.get(p) ?? []) {
			const [father, mother] = sex(p) === 'M' ? [p, s] : [s, p];
			needed.set(pairKey(father, mother), { father, mother });
		}
	}

	const result: FamilyCheck = { needed: [], missing: [], withoutUuid: [] };
	for (const [key, pair] of needed) {
		const fam = existing.get(key);
		result.needed.push({ ...pair, family: fam?.path });
		if (!fam) result.missing.push(pair);
		else if (!fam.uuid) result.withoutUuid.push(fam.path);
	}
	return result;
}

// ── Zusammenhang ──────────────────────────────────────────────────────────────

/** Zerlegt den Export-Umfang in zusammenhängende Gruppen (größte zuerst). */
export function findGroups(rel: Relations, scope: Set<string>): string[][] {
	const adj = new Map<string, string[]>();
	const link = (a: string, b: string) => {
		if (!scope.has(a) || !scope.has(b)) return;
		adj.set(a, [...(adj.get(a) ?? []), b]);
		adj.set(b, [...(adj.get(b) ?? []), a]);
	};
	for (const p of scope) {
		for (const parent of rel.parents.get(p) ?? []) link(p, parent);
		for (const s of rel.spouses.get(p) ?? []) if (p < s) link(p, s);
	}
	const seen = new Set<string>();
	const groups: string[][] = [];
	for (const start of scope) {
		if (seen.has(start)) continue;
		const group: string[] = [];
		const stack = [start];
		seen.add(start);
		while (stack.length) {
			const x = stack.pop()!;
			group.push(x);
			for (const y of adj.get(x) ?? []) {
				if (!seen.has(y)) {
					seen.add(y);
					stack.push(y);
				}
			}
		}
		groups.push(group);
	}
	return groups.sort((a, b) => b.length - a.length);
}

// ── UIDs ──────────────────────────────────────────────────────────────────────

export function checkUids(model: VaultModel): { duplicateUids: string[][]; invalidUids: string[] } {
	const byUid = new Map<string, string[]>();
	const invalidUids: string[] = [];
	for (const p of model.persons.values()) {
		if (!p.uuid) continue;
		if (!isValidUid(p.uuid)) invalidUids.push(p.path);
		const key = p.uuid.toLowerCase();
		byUid.set(key, [...(byUid.get(key) ?? []), p.path]);
	}
	return { duplicateUids: [...byUid.values()].filter(v => v.length > 1), invalidUids };
}

// ── Gesamtlauf ────────────────────────────────────────────────────────────────

export interface CheckResult {
	model: VaultModel;
	rel: Relations;
	scope: Scope;
	reference?: {
		individuals: GedcomIndividual[];
		matches: ReferenceMatch[];
		/** in der Referenz, aber nicht mehr im Umfang (außer Lebend-Regel) */
		dropped: string[];
		/** zugeordnet, aber ohne passenden GEDBAS-Link in refs */
		missingRef: ReferenceMatch[];
	};
	withoutUuid: string[];
	/** gleiche UID bei mehreren Personen (alle Personen, nicht nur der Umfang) */
	duplicateUids: string[][];
	/** UID vorhanden, aber kein gültiges Format */
	invalidUids: string[];
	dateLinks: DateLinkIssue[];
	plausibility: PlausibilityIssue[];
	families: FamilyCheck;
	groups: string[][];
}

export function runChecks(model: VaultModel, opts: CheckOptions, reference?: GedcomIndividual[]): CheckResult {
	const rel = buildRelations(model);
	const matches = reference ? matchReference(model, rel, reference) : [];
	const referenced = matches.flatMap(m => (m.person ? [m.person] : []));
	const scope = computeScope(model, rel, referenced, opts);

	const result: CheckResult = {
		model, rel, scope,
		withoutUuid: [...scope.included].filter(p => !model.persons.get(p)?.uuid),
		...checkUids(model),
		dateLinks: checkDateLinks(model),
		plausibility: checkPlausibility(model, rel),
		families: checkFamilies(model, rel, scope.included),
		groups: findGroups(rel, scope.included),
	};
	if (reference) {
		const living = new Set(scope.living);
		result.reference = {
			individuals: reference,
			matches,
			dropped: referenced.filter(p => !scope.included.has(p) && !living.has(p)),
			missingRef: matches.filter(m => {
				if (!m.person) return false;
				const id = m.individual.xref.replace(/^I/, '');
				return !model.persons.get(m.person)?.gedbasRefs.some(r => r.includes(id));
			}),
		};
	}
	return result;
}
