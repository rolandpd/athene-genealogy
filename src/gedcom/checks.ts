import { type GedcomIndividual, type VaultEvent, type VaultModel, parseWikilink, yearOfDateLink } from './model';
import { isValidUid } from './uid';

export interface CheckOptions {
	/** Aktuelles Jahr (für die Lebend-Regel) */
	currentYear: number;
	/** Wer jünger ist und kein Sterbe-/Beisetzungsereignis hat, gilt als lebend */
	livingYears: number;
	/**
	 * Quellen-ID der Referenzdatenbank (z. B. "S00239" für GEDBAS DB 67272).
	 * Personen mit `xrefs: [S00239:<XREF ohne I>]` werden direkt zugeordnet.
	 */
	referenceSource?: string;
}

/**
 * `xrefs`-Eintrag für eine Person der Referenz: die stabile UID, wenn die Referenz eine hat
 * ("S00239:174597123e63…"), sonst die XREF ohne "I" ("S00239:1449005733").
 * GEDBAS vergibt bei jedem Upload neue Personen-IDs, nur die UID bleibt.
 */
export function referenceXref(source: string, g: { xref: string; uid?: string }): string {
	return `${source}:${g.uid ?? g.xref.replace(/^I/, '')}`;
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
	/** Elternpaare je Geburts-/Elternschaftsereignis (Rolle aus dem Ereignis, nicht aus dem Geschlecht) */
	parentPairs: { child: string; father?: string; mother?: string; type: string }[];
}

function add<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
	let set = map.get(key);
	if (!set) map.set(key, (set = new Set()));
	set.add(value);
}

export function buildRelations(model: VaultModel): Relations {
	const rel: Relations = {
		birthYear: new Map(), deathYear: new Map(), hasDeath: new Set(),
		parents: new Map(), children: new Map(), spouses: new Map(), marriageYears: new Map(), parentPairs: [],
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
				const father = isPerson(e.father) ? e.father : undefined;
				const mother = isPerson(e.mother) ? e.mother : undefined;
				if (father || mother) rel.parentPairs.push({ child: p, father, mother, type: e.type });
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
	via?: 'uid' | 'xref' | 'name';
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

export function matchReference(model: VaultModel, rel: Relations, individuals: GedcomIndividual[], source?: string): ReferenceMatch[] {
	const byUid = new Map<string, string>();
	const byXref = new Map<string, string>();
	const byName = new Map<string, string[]>();
	for (const p of model.persons.values()) {
		if (p.uuid) byUid.set(p.uuid.toLowerCase(), p.path);
		for (const x of p.xrefs) byXref.set(x, p.path);
		const key = nameKey(p.basename);
		byName.set(key, [...(byName.get(key) ?? []), p.path]);
	}

	const matches: ReferenceMatch[] = individuals.filter(g => !g.deleted).map(g => {
		const uidHit = g.uid ? byUid.get(g.uid) : undefined;
		if (uidHit) return { individual: g, person: uidHit, via: 'uid' as const, candidates: [uidHit] };
		const xrefHit = source ? byXref.get(referenceXref(source, g)) : undefined;
		if (xrefHit) return { individual: g, person: xrefHit, via: 'xref' as const, candidates: [xrefHit] };

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
	/** per Datenschutz ausgeschlossen (Privat) */
	excludedByPrivacy: string[];
	living: string[];
	/** weder Geburtsjahr noch Tod → Lebend-Regel nicht anwendbar */
	unknownLiving: string[];
}

export function isPrivate(privacy: string | undefined): boolean {
	return !!privacy && /privat|privacy/i.test(privacy);
}

/** Datenschutz: [[Lebend]] */
export function isLivingMark(privacy: string | undefined): boolean {
	return !!privacy && /lebend/i.test(privacy);
}

export interface LivingCheck {
	/** nach der Regel lebend, aber ohne Datenschutz [[Lebend]] */
	missingMark: string[];
	/** als [[Lebend]] markiert, aber Tod/Beisetzung erfasst */
	markedButDead: string[];
	/** als [[Lebend]] markiert, aber vor der Grenze geboren (möglich, aber prüfen) */
	markedButOld: string[];
}

/** Vergleicht die berechnete Lebend-Regel mit dem Datenschutz-Literal — für alle Personen. */
export function checkLiving(model: VaultModel, rel: Relations, opts: CheckOptions): LivingCheck {
	const cutoff = opts.currentYear - opts.livingYears;
	const result: LivingCheck = { missingMark: [], markedButDead: [], markedButOld: [] };
	for (const p of model.persons.values()) {
		const dead = rel.hasDeath.has(p.path);
		const born = rel.birthYear.get(p.path);
		const marked = isLivingMark(p.privacy);
		if (!dead && born !== undefined && born > cutoff && !marked && !isPrivate(p.privacy)) result.missingMark.push(p.path);
		if (marked && dead) result.markedButDead.push(p.path);
		else if (marked && born !== undefined && born <= cutoff) result.markedButOld.push(p.path);
	}
	return result;
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

	const scope: Scope = { included: new Set(), connected, protectedByReference, excludedByPrivacy: [], living: [], unknownLiving: [] };
	for (const p of candidates) {
		const person = model.persons.get(p);
		if (!person) continue;
		if (isPrivate(person.privacy)) {
			scope.excludedByPrivacy.push(p);
			continue;
		}
		if (isLivingMark(person.privacy)) {
			scope.living.push(p);
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
	/** beteiligte Ereignisse — ihr Status entscheidet, ob der Fall offen, geprüft oder bekannt ist */
	events: string[];
	/** offen | geprüft (Status Konsolidiert) | bekannt (Status Klärungsbedarf) */
	state: 'open' | 'reviewed' | 'known';
}

export const STATUS_KNOWN_PROBLEM = 'Klärungsbedarf';
export const STATUS_REVIEWED = 'Konsolidiert';

export function checkPlausibility(model: VaultModel, rel: Relations): PlausibilityIssue[] {
	const byPerson = new Map<string, VaultEvent[]>();
	for (const e of model.events) {
		for (const p of new Set([...e.persons, e.father, e.mother].filter((x): x is string => !!x))) {
			byPerson.set(p, [...(byPerson.get(p) ?? []), e]);
		}
	}
	const eventsOf = (p: string, types: string[]) => (byPerson.get(p) ?? []).filter(e => types.includes(e.type) && e.persons.includes(p));
	const parentEvents = (child: string, parent: string) =>
		(byPerson.get(child) ?? []).filter(e => PARENT_TYPES.includes(e.type) && e.persons.includes(child) && (e.father === parent || e.mother === parent));
	const stateOf = (person: string, events: VaultEvent[]): PlausibilityIssue['state'] => {
		const statuses = [model.persons.get(person)?.status, ...events.map(e => e.status)];
		if (statuses.includes(STATUS_KNOWN_PROBLEM)) return 'known';
		if (statuses.includes(STATUS_REVIEWED)) return 'reviewed';
		return 'open';
	};
	const issues: PlausibilityIssue[] = [];
	const push = (person: string, kind: PlausibilityIssue['kind'], value: number, events: VaultEvent[], other?: string) =>
		issues.push({ person, other, kind, value, events: events.map(e => e.path), state: stateOf(person, events) });

	for (const p of model.persons.keys()) {
		const b = rel.birthYear.get(p);
		const d = rel.deathYear.get(p);
		const lifeEvents = () => eventsOf(p, [...BIRTH_TYPES, ...DEATH_TYPES]);
		if (b !== undefined && d !== undefined) {
			if (d < b) push(p, 'deathBeforeBirth', d, lifeEvents());
			else if (d - b > 105) push(p, 'tooOld', d - b, lifeEvents());
		}
		for (const m of rel.marriageYears.get(p) ?? []) {
			if (b !== undefined && m - b < 14) push(p, 'marriageTooYoung', m - b, [...eventsOf(p, MARRIAGE_TYPES), ...eventsOf(p, BIRTH_TYPES)]);
		}
		for (const parent of rel.parents.get(p) ?? []) {
			const pb = rel.birthYear.get(parent);
			const pd = rel.deathYear.get(parent);
			if (b !== undefined && pb !== undefined && (b - pb < 14 || b - pb > 60)) {
				push(p, 'parentAge', b - pb, [...parentEvents(p, parent), ...eventsOf(parent, BIRTH_TYPES)], parent);
			}
			// Vater darf bis zu einem Jahr vor der Geburt gestorben sein
			if (b !== undefined && pd !== undefined && b > pd + 1) {
				push(p, 'parentDead', pd, [...parentEvents(p, parent), ...eventsOf(parent, DEATH_TYPES)], parent);
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
	/** vorhandene Familie mit nur einem Elternteil, die um den Partner ergänzt werden kann */
	incomplete: { family: string; father: string; mother: string }[];
	withoutUuid: string[];
}

export const pairKey = (f?: string, m?: string) => `${f ?? '-'}|${m ?? '-'}`;

export function checkFamilies(model: VaultModel, rel: Relations, scope: Set<string>): FamilyCheck {
	const existing = new Map(model.families.map(f => [pairKey(f.father, f.mother), f]));
	const sex = (p: string) => model.persons.get(p)?.sex;
	const needed = new Map<string, { father?: string; mother?: string }>();

	// Elternpaare: Rolle aus dem Ereignis (Vater/Mutter). Eine Adoption ergibt eine zweite Familie.
	for (const pair of rel.parentPairs) {
		if (!scope.has(pair.child)) continue;
		needed.set(pairKey(pair.father, pair.mother), { father: pair.father, mother: pair.mother });
	}
	// Ehepaare: Rolle aus dem Geschlecht; ohne Angabe gilt die Person als Ehemann, wenn der Partner weiblich ist
	for (const p of scope) {
		for (const s of rel.spouses.get(p) ?? []) {
			const pIsWife = sex(p) === 'F' || (sex(p) !== 'M' && sex(s) === 'M');
			const [father, mother] = pIsWife ? [s, p] : [p, s];
			needed.set(pairKey(father, mother), { father, mother });
		}
	}

	const result: FamilyCheck = { needed: [], missing: [], incomplete: [], withoutUuid: [] };
	const used = new Set<string>();
	for (const [key, pair] of needed) {
		let fam = existing.get(key);
		// Vorhandene Familie mit nur einem Elternteil ergänzen statt eine zweite anzulegen —
		// aber nur, wenn das Teilpaar selbst nicht mehr benötigt wird.
		if (!fam && pair.father && pair.mother) {
			for (const partial of [pairKey(pair.father, undefined), pairKey(undefined, pair.mother)]) {
				const candidate = existing.get(partial);
				if (candidate && !needed.has(partial) && !used.has(candidate.path)) {
					fam = candidate;
					used.add(candidate.path);
					result.incomplete.push({ family: candidate.path, father: pair.father, mother: pair.mother });
					break;
				}
			}
		}
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
		/** in der Referenz, aber nicht mehr im Umfang (außer Lebend-Regel und Datenschutz) */
		dropped: string[];
		/** in der Referenz, aber per Datenschutz ausgeschlossen: soll aus GEDBAS verschwinden */
		removedByPrivacy: string[];
		/** zugeordnet, aber ohne passenden GEDBAS-Link in refs */
		missingRef: ReferenceMatch[];
		/** Personen mit einem Eintrag dieser Quelle in `xrefs`, die nicht (mehr) in der Referenz stehen */
		staleRef: string[];
	};
	withoutUuid: string[];
	/** gleiche UID bei mehreren Personen (alle Personen, nicht nur der Umfang) */
	duplicateUids: string[][];
	/** UID vorhanden, aber kein gültiges Format */
	invalidUids: string[];
	living: LivingCheck;
	dateLinks: DateLinkIssue[];
	plausibility: PlausibilityIssue[];
	families: FamilyCheck;
	groups: string[][];
}

export function runChecks(model: VaultModel, opts: CheckOptions, reference?: GedcomIndividual[]): CheckResult {
	const rel = buildRelations(model);
	const matches = reference ? matchReference(model, rel, reference, opts.referenceSource) : [];
	const referenced = matches.flatMap(m => (m.person ? [m.person] : []));
	const scope = computeScope(model, rel, referenced, opts);

	const result: CheckResult = {
		model, rel, scope,
		withoutUuid: [...scope.included].filter(p => !model.persons.get(p)?.uuid),
		...checkUids(model),
		living: checkLiving(model, rel, opts),
		dateLinks: checkDateLinks(model),
		plausibility: checkPlausibility(model, rel),
		families: checkFamilies(model, rel, scope.included),
		groups: findGroups(rel, scope.included),
	};
	if (reference) {
		// Datenschutz geht vor Bestandsschutz: Lebend-Regel und nachträglich verschärfter Datenschutz sind gewollt
		const living = new Set(scope.living);
		const privacy = new Set(scope.excludedByPrivacy);
		result.reference = {
			individuals: reference,
			matches,
			dropped: referenced.filter(p => !scope.included.has(p) && !living.has(p) && !privacy.has(p)),
			removedByPrivacy: referenced.filter(p => privacy.has(p)),
			missingRef: opts.referenceSource
				? matches.filter(m => m.person && !model.persons.get(m.person)?.xrefs.includes(referenceXref(opts.referenceSource!, m.individual)))
				: [],
			staleRef: opts.referenceSource
				? [...model.persons.values()]
					.filter(p => !referenced.includes(p.path) && p.xrefs.some(x => x.startsWith(`${opts.referenceSource}:`)))
					.map(p => p.path)
				: [],
		};
	}
	return result;
}
