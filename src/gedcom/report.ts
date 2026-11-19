import { STATUS_KNOWN_PROBLEM, type CheckResult, type PlausibilityIssue, referenceXref } from './checks';

export interface ReportMeta {
	/** Zeitpunkt der Erstellung, z. B. "17.11.2026 14:05" */
	created: string;
	/** Vault-Pfad der Referenz-GEDCOM, falls verwendet */
	referencePath?: string;
	/** Quellen-ID der Referenzdatenbank für `xrefs`, z. B. "S00239" */
	referenceSource?: string;
	/** Basis-URL für GEDBAS-Personenseiten */
	gedbasPersonUrl: string;
}

/**
 * Einzelne Prüfungen. Der Prüfbericht enthält nur die, die den Export behindern
 * ({@link REPORT_SECTIONS}); jede lässt sich per Codeblock `athene-check`
 * einzeln in eine Notiz einbetten, z. B. unter System/Konsistenz.
 */
export const CHECK_SECTIONS = ['reference', 'living', 'date-links', 'families', 'uids', 'plausibility', 'known-issues', 'groups'] as const;
export type CheckSection = typeof CHECK_SECTIONS[number];
export const REPORT_SECTIONS: CheckSection[] = ['reference', 'living', 'date-links', 'families', 'uids'];

export const isCheckSection = (s: string): s is CheckSection => (CHECK_SECTIONS as readonly string[]).includes(s);

interface Ctx {
	r: CheckResult;
	meta: ReportMeta;
	link: (path?: string) => string;
	year: (path: string) => number | string;
	list: (items: string[], max?: number) => string;
	sortByName: (paths: Iterable<string>) => string[];
	/** "[ ] " im Bericht (abhakbar), leer in eingebetteten Prüfungen */
	todo: string;
	/** Bericht: nur, was den Export behindert */
	exportOnly: boolean;
}

function makeCtx(r: CheckResult, meta: ReportMeta, exportOnly: boolean): Ctx {
	const basenames = new Map<string, string>();
	for (const p of r.model.persons.values()) basenames.set(p.path, p.basename);
	for (const e of r.model.events) basenames.set(e.path, e.basename);
	for (const f of r.model.families) basenames.set(f.path, f.basename);
	return {
		r,
		meta,
		exportOnly,
		todo: exportOnly ? '[ ] ' : '',
		link: (path?: string) => (path ? `[[${basenames.get(path) ?? path.replace(/\.md$/, '')}]]` : '–'),
		year: (p: string) => r.rel.birthYear.get(p) ?? '?',
		list: (items: string[], max = Infinity) => {
			if (items.length === 0) return '_keine_\n';
			const shown = items.slice(0, max).map(i => `- ${i}`);
			if (items.length > max) shown.push(`- … und ${items.length - max} weitere`);
			return shown.join('\n') + '\n';
		},
		sortByName: (paths: Iterable<string>) => [...paths].sort((a, b) => (basenames.get(a) ?? a).localeCompare(basenames.get(b) ?? b, 'de')),
	};
}

/** Datumslinks, die den Export verfälschen (nicht nur ungenau sind). */
const blockingDateLinks = (r: CheckResult) => r.dateLinks.filter(d => d.reason !== 'coarse');
const openPlausibility = (r: CheckResult) => r.plausibility.filter(i => i.state === 'open');

/** Alles, was den Export behindert, mit Anzahl. Der Export läuft nur, wenn alle 0 sind. */
export function exportBlockers(r: CheckResult): [string, number][] {
	return [
		['GEDBAS-Personen nicht zugeordnet', r.reference ? r.reference.matches.filter(m => !m.person).length : 0],
		['GEDBAS-Personen würden herausfallen', r.reference?.dropped.length ?? 0],
		['Lebend-Regel ≠ Datenschutz', r.living.missingMark.length + r.living.markedButDead.length + r.living.markedButOld.length],
		['weder Geburtsjahr noch Tod', r.scope.unknownLiving.length],
		['Datumslinks fehlerhaft', blockingDateLinks(r).length],
		['Familien fehlen oder unvollständig', r.families.missing.length + r.families.incomplete.length + r.families.withoutUuid.length],
		['UID fehlt, doppelt oder ungültig', r.withoutUuid.length + r.duplicateUids.length + r.invalidUids.length],
	];
}

/**
 * Erzeugt den Prüfbericht als Markdown-Notiz: Kennzahlen und alles, was den Export behindert.
 * Personen und Ereignisse werden als Wikilinks über den Dateinamen verlinkt.
 */
export function renderReport(r: CheckResult, meta: ReportMeta): string {
	const c = makeCtx(r, meta, true);
	const s = r.scope;
	const out: string[] = [];
	out.push('---', 'tags:', '  - Verwaltung/Export', `created: ${meta.created}`, '---', '');
	out.push('# GEDCOM-Prüfbericht', '');
	out.push(`Erstellt am ${meta.created} vom Plugin athene-genealogy. Diese Notiz wird bei jedem Lauf überschrieben.`);
	out.push('Der Bericht enthält nur, was den Export behindert. Allgemeine Datenpflege liegt in den einzelnen Prüfungen unter System/Konsistenz.', '');

	out.push('## Kennzahlen', '');
	out.push('| Kennzahl | Wert |', '|---|---|');
	out.push(`| Personen im Vault | ${r.model.persons.size} |`);
	out.push(`| mit Kekulé-Nummer | ${[...r.model.persons.values()].filter(p => p.kekule).length} |`);
	out.push(`| mit Kekulé-Personen verbunden | ${s.connected.size} |`);
	if (r.reference) out.push(`| aus GEDBAS übernommen (Bestandsschutz) | ${s.protectedByReference.size} |`);
	out.push(`| **Export-Umfang** | **${s.included.size}** |`);
	if (r.reference) out.push(`| davon neu gegenüber GEDBAS | ${[...s.included].filter(p => !s.protectedByReference.has(p)).length} |`);
	out.push(`| ausgelassen: Lebend-Regel | ${s.living.length} |`);
	out.push(`| ausgelassen: Datenschutz [[Privat]] | ${s.excludedByPrivacy.length} |`);
	out.push(`| benötigte Familien | ${r.families.needed.length} |`);
	out.push(`| _kein Hindernis: offene Plausibilitätsfälle_ | ${openPlausibility(r).length} |`, '');

	const open = exportBlockers(r).filter(([, n]) => n > 0);
	out.push('## Export-Hindernisse', '');
	out.push(open.length ? c.list(open.map(([k, n]) => `${k}: **${n}**`)) : '✅ Keine. Der Export kann laufen.\n');

	for (const section of REPORT_SECTIONS) out.push(...renderSectionLines(section, c));
	return out.join('\n');
}

/** Eine einzelne Prüfung als Markdown, z. B. für den Codeblock `athene-check`. */
export function renderSection(section: CheckSection, r: CheckResult, meta: ReportMeta): string {
	return renderSectionLines(section, makeCtx(r, meta, false)).join('\n');
}

function renderSectionLines(section: CheckSection, c: Ctx): string[] {
	switch (section) {
		case 'reference': return gedbas(c);
		case 'living': return living(c);
		case 'date-links': return dateLinks(c);
		case 'families': return families(c);
		case 'uids': return uids(c);
		case 'plausibility': return plausibility(c);
		case 'known-issues': return knownProblems(c);
		case 'groups': return groups(c);
	}
}

function gedbas({ r, meta, link, list, sortByName, todo }: Ctx): string[] {
	if (!r.reference) return ['## Abgleich mit GEDBAS', '', '_Keine Referenz-GEDCOM eingestellt._', ''];
	const ref = r.reference;
	const byUid = ref.matches.filter(m => m.via === 'uid').length;
	const byXref = ref.matches.filter(m => m.via === 'xref').length;
	const byName = ref.matches.filter(m => m.via === 'name').length;
	const deleted = ref.individuals.filter(i => i.deleted).length;
	const out: string[] = ['## Abgleich mit GEDBAS', ''];
	out.push(`Referenz: \`${meta.referencePath ?? '?'}\`${meta.referenceSource ? ` (Quelle [[${meta.referenceSource}]])` : ''} mit ${ref.individuals.length} Personen, davon ${deleted} von GEDBAS aus Datenschutzgründen geleert.`);
	out.push(`Zugeordnet: ${byUid} über die UID, ${byXref} über \`xrefs\`, ${byName} über Name und Geburtsjahr.`, '');

	const open = ref.matches.filter(m => !m.person);
	out.push(`### Nicht zugeordnet (${open.length})`, '');
	out.push(list(open.map(m => {
		const g = m.individual;
		const url = `${meta.gedbasPersonUrl}${g.xref.replace(/^I/, '')}`;
		const cands = m.candidates.length ? ` → mehrdeutig: ${m.candidates.map(link).join(', ')}` : '';
		return `${todo}[${g.name ?? g.xref}](${url}) ${g.birthDate ?? ''}${cands}`;
	})));
	if (open.length && meta.referenceSource) {
		out.push(`Von Hand zuordnen: bei der Person \`xrefs: - ${meta.referenceSource}:<GEDBAS-ID>\` eintragen.`, '');
	}

	out.push(`### Würden aus GEDBAS herausfallen (${ref.dropped.length})`, '');
	out.push('In GEDBAS vorhanden, aber nicht mehr im Export-Umfang (ohne Lebend-Regel und Datenschutz).', '');
	out.push(list(sortByName(ref.dropped).map(p => `${todo}${link(p)}`)));

	const added = sortByName([...r.scope.included].filter(p => !r.scope.protectedByReference.has(p)));
	out.push(`### Neu gegenüber GEDBAS (${added.length})`, '');
	out.push('Kommen beim nächsten Upload dazu. Stichprobe: Wer nicht veröffentlicht werden soll, bekommt `Datenschutz: "[[Privat]]"`.', '');
	out.push(list(added.map(p => `${link(p)} (${r.rel.birthYear.get(p) ?? '?'})`)));

	if (ref.removedByPrivacy.length) {
		out.push(`### Per Datenschutz aus GEDBAS entfernen (${ref.removedByPrivacy.length})`, '');
		out.push('Kein Hindernis: Datenschutz geht vor Bestandsschutz. Nach dem Import im Reexport prüfen, ob die Personen wirklich verschwunden sind.', '');
		out.push(list(sortByName(ref.removedByPrivacy).map(p => `${link(p)} (${String(r.model.persons.get(p)?.privacy ?? '')})`)));
	}

	if (meta.referenceSource) {
		const changed = ref.missingRef.filter(m => r.model.persons.get(m.person!)?.xrefs.some(x => x.startsWith(`${meta.referenceSource}:`))).length;
		out.push(`### \`xrefs\` nicht aktuell (${ref.missingRef.length + ref.staleRef.length})`, '');
		out.push(`Kein Hindernis. ${ref.missingRef.length - changed} ohne Eintrag, ${changed} mit veraltetem Eintrag, ${ref.staleRef.length} mit Eintrag, aber nicht mehr in der Referenz. Das Command „Externe IDs aus der Referenz-GEDCOM übernehmen“ gleicht alle ab.`, '');
		out.push(list([
			...ref.missingRef.map(m => `${link(m.person)} → \`${referenceXref(meta.referenceSource!, m.individual)}\``),
			...sortByName(ref.staleRef).map(p => `${link(p)} → entfernen`),
		], 15));
	}
	return out;
}

function living({ r, link, year, list, sortByName, todo }: Ctx): string[] {
	const s = r.scope;
	const lv = r.living;
	const out: string[] = ['## Lebend-Regel', ''];
	out.push(`### Ausgelassen (${s.living.length})`, '');
	out.push(list(sortByName(s.living).map(p => `${link(p)} (${year(p)})`)));
	out.push(`### Weder Geburtsjahr noch Tod (${s.unknownLiving.length})`, '');
	out.push('Die Lebend-Regel greift hier nicht. Mindestens ein geschätztes Geburtsjahr ergänzen.', '');
	out.push(list(sortByName(s.unknownLiving).map(p => `${todo}${link(p)}`)));
	out.push(`### Datenschutz [[Lebend]] fehlt (${lv.missingMark.length})`, '');
	out.push('Nach der Lebend-Regel möglicherweise lebend, aber ohne `Datenschutz: "[[Lebend]]"`. Ist die Person verstorben: Tod-Ereignis anlegen, notfalls ohne Datum.', '');
	out.push(list(sortByName(lv.missingMark).map(p => `${todo}${link(p)} (${year(p)})`)));
	if (lv.markedButDead.length || lv.markedButOld.length) {
		out.push(`### [[Lebend]] widerspricht den Daten (${lv.markedButDead.length + lv.markedButOld.length})`, '');
		out.push(list([
			...sortByName(lv.markedButDead).map(p => `${todo}${link(p)}: als Lebend markiert, aber Tod erfasst`),
			...sortByName(lv.markedButOld).map(p => `${todo}${link(p)}: als Lebend markiert, aber geboren ${year(p)}`),
		]));
	}
	if (s.excludedByPrivacy.length) {
		out.push(`### Ausgeschlossen per Datenschutz [[Privat]] (${s.excludedByPrivacy.length})`, '');
		out.push(list(sortByName(s.excludedByPrivacy).map(link)));
	}
	return out;
}

function dateLinks({ r, link, list, todo, exportOnly }: Ctx): string[] {
	const issues = exportOnly ? blockingDateLinks(r) : r.dateLinks;
	const hint = { mismatch: '', unreadable: ' (Anzeige nicht lesbar)', coarse: ' (Link ungenauer als Anzeige)' };
	return [
		`## Datumslinks (${issues.length})`, '',
		exportOnly
			? 'Linkziel und Anzeige stimmen nicht überein, oder die Anzeige ist kein gültiges Datum.'
			: 'Linkziel und Anzeige stimmen nicht überein, die Anzeige ist kein gültiges Datum, oder der Link ist ungenauer als die Anzeige (Letzteres behindert den Export nicht).',
		'',
		list(issues.map(d => `${todo}${link(d.event)}: \`${d.value}\`${hint[d.reason]}`)),
	];
}

function families({ r, link, list, todo }: Ctx): string[] {
	const f = r.families;
	const out = [`## Familien (${f.missing.length + f.incomplete.length + f.withoutUuid.length})`, ''];
	out.push('Das Command „Fehlende Familien anlegen“ behebt alle drei Fälle.', '');
	out.push(`### Ohne Datensatz (${f.missing.length})`, '');
	out.push(list(f.missing.map(x => `${todo}${link(x.father)} + ${link(x.mother)}`), 50));
	out.push(`### Unvollständig (${f.incomplete.length})`, '');
	out.push(list(f.incomplete.map(x => `${todo}${link(x.family)}: ${link(x.father)} + ${link(x.mother)}`), 50));
	out.push(`### Ohne \`uuid\` (${f.withoutUuid.length})`, '');
	out.push(list(f.withoutUuid.map(p => `${todo}${link(p)}`), 50));
	return out;
}

function uids({ r, link, list, sortByName, todo }: Ctx): string[] {
	const out = [`## UIDs (${r.withoutUuid.length + r.duplicateUids.length + r.invalidUids.length})`, ''];
	out.push(`### Doppelt oder ungültig (${r.duplicateUids.length + r.invalidUids.length})`, '');
	out.push(list([
		...r.duplicateUids.map(g => `${todo}Gleiche \`uuid\`: ${sortByName(g).map(link).join(', ')}`),
		...r.invalidUids.map(p => `${todo}Ungültige \`uuid\`: ${link(p)}`),
	]));
	out.push(`### Im Umfang ohne \`uuid\` (${r.withoutUuid.length})`, '');
	out.push('Command „Fehlende UIDs für Personen vergeben“ ausführen.', '');
	out.push(list(sortByName(r.withoutUuid).map(p => `${todo}${link(p)}`), 20));
	return out;
}

function plausibility({ r, link, year, list }: Ctx): string[] {
	const byState = (s: PlausibilityIssue['state']) => r.plausibility.filter(i => i.state === s);
	const withEvents = (i: PlausibilityIssue) => `${describe(i, link, year)}${i.events.length ? ` — ${i.events.map(link).join(', ')}` : ''}`;
	return [
		`## Plausibilität (${byState('open').length} offen)`, '',
		'Auffällige Lebensdaten im Export-Umfang. Ein Fall gilt als erledigt, wenn das betroffene Ereignis oder die Person den Status **Klärungsbedarf 🔴** (bekanntes Problem) oder **Konsolidiert 🔵** hat.', '',
		list(byState('open').map(withEvents)),
		`### Klärungsbedarf 🔴 (${byState('known').length})`, '',
		list(byState('known').map(withEvents)),
		`### Konsolidiert 🔵 (${byState('reviewed').length})`, '',
		list(byState('reviewed').map(withEvents)),
	];
}

function knownProblems({ r, link, list }: Ctx): string[] {
	const known = [
		...[...r.model.persons.values()].filter(p => p.status === STATUS_KNOWN_PROBLEM).map(p => p.path),
		...r.model.events.filter(e => e.status === STATUS_KNOWN_PROBLEM).map(e => e.path),
	];
	return [`## Personen und Ereignisse mit Klärungsbedarf 🔴 (${known.length})`, '', list(known.map(link))];
}

function groups({ r, link, list, sortByName }: Ctx): string[] {
	const small = r.groups.filter(g => g.length <= 3);
	return [
		`## Kleine unverbundene Gruppen (${small.length})`, '',
		`Höchstens drei Personen ohne Verbindung zum Rest des Export-Umfangs. Größen aller Gruppen: ${r.groups.map(g => g.length).join(', ')}.`, '',
		list(small.map(g => sortByName(g).map(link).join(' + '))),
	];
}

function describe(i: PlausibilityIssue, link: (p?: string) => string, year: (p: string) => number | string): string {
	const p = `${link(i.person)} (${year(i.person)})`;
	switch (i.kind) {
		case 'deathBeforeBirth': return `${p}: Tod ${i.value} vor der Geburt`;
		case 'tooOld': return `${p}: Alter ${i.value} Jahre`;
		case 'marriageTooYoung': return `${p}: Heirat mit ${i.value} Jahren`;
		case 'parentAge': return `${p}: Elternteil ${link(i.other)} geb. ${year(i.other!)}, Abstand ${i.value} Jahre`;
		case 'parentDead': return `${p}: Elternteil ${link(i.other)} gest. ${i.value}`;
	}
}
