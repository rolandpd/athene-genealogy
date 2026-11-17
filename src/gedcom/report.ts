import type { CheckResult, PlausibilityIssue } from './checks';

export interface ReportMeta {
	/** Zeitpunkt der Erstellung, z. B. "17.11.2026 14:05" */
	created: string;
	/** Vault-Pfad der Referenz-GEDCOM, falls verwendet */
	referencePath?: string;
	/** Basis-URL für GEDBAS-Personenseiten */
	gedbasPersonUrl: string;
}

/**
 * Erzeugt den Prüfbericht als Markdown-Notiz.
 * Personen und Ereignisse werden als Wikilinks über den Dateinamen verlinkt.
 */
export function renderReport(r: CheckResult, meta: ReportMeta): string {
	const basenames = new Map<string, string>();
	for (const p of r.model.persons.values()) basenames.set(p.path, p.basename);
	for (const e of r.model.events) basenames.set(e.path, e.basename);
	for (const f of r.model.families) basenames.set(f.path, f.basename);
	const link = (path?: string) => (path ? `[[${basenames.get(path) ?? path.replace(/\.md$/, '')}]]` : '–');
	const year = (p: string) => r.rel.birthYear.get(p) ?? '?';
	const list = (items: string[], max = Infinity) => {
		if (items.length === 0) return '_keine_\n';
		const shown = items.slice(0, max).map(i => `- ${i}`);
		if (items.length > max) shown.push(`- … und ${items.length - max} weitere`);
		return shown.join('\n') + '\n';
	};
	const sortByName = (paths: Iterable<string>) => [...paths].sort((a, b) => (basenames.get(a) ?? a).localeCompare(basenames.get(b) ?? b, 'de'));

	const out: string[] = [];
	out.push('---', 'tags:', '  - Verwaltung/Export', `created: ${meta.created}`, '---', '');
	out.push('# GEDCOM-Prüfbericht', '');
	out.push(`Erstellt am ${meta.created} vom Plugin athene-genealogy. Diese Notiz wird bei jedem Lauf überschrieben.`, '');

	// ── Kennzahlen
	const s = r.scope;
	out.push('## Kennzahlen', '');
	out.push('| Kennzahl | Wert |', '|---|---|');
	out.push(`| Personen im Vault | ${r.model.persons.size} |`);
	out.push(`| mit Kekulé-Nummer | ${[...r.model.persons.values()].filter(p => p.kekule).length} |`);
	out.push(`| Kekulé + direkt verbunden | ${s.connected.size} |`);
	if (r.reference) out.push(`| aus GEDBAS übernommen (Bestandsschutz) | ${s.protectedByReference.size} |`);
	out.push(`| **Export-Umfang** | **${s.included.size}** |`);
	if (r.reference) out.push(`| davon neu gegenüber GEDBAS | ${[...s.included].filter(p => !s.protectedByReference.has(p)).length} |`);
	out.push(`| ausgelassen: Lebend-Regel | ${s.living.length} |`);
	out.push(`| ausgelassen: \`Export: false\` / Datenschutz | ${s.excludedByFlag.length} |`);
	out.push(`| im Umfang ohne \`uuid\` | ${r.withoutUuid.length} |`);
	out.push(`| doppelte oder ungültige \`uuid\` | ${r.duplicateUids.length + r.invalidUids.length} |`);
	out.push(`| benötigte Familien | ${r.families.needed.length} (${r.families.missing.length} ohne Datensatz, ${r.families.withoutUuid.length} ohne \`uuid\`) |`);
	out.push(`| zusammenhängende Gruppen | ${r.groups.length} (${r.groups.slice(0, 6).map(g => g.length).join(', ')}${r.groups.length > 6 ? ', …' : ''}) |`);
	out.push(`| Datumslinks fehlerhaft | ${r.dateLinks.length} |`);
	out.push(`| Plausibilitätsfehler | ${r.plausibility.length} |`, '');

	// ── GEDBAS-Abgleich
	if (r.reference) {
		const ref = r.reference;
		const byUid = ref.matches.filter(m => m.via === 'uid').length;
		const byName = ref.matches.filter(m => m.via === 'name').length;
		const deleted = ref.individuals.filter(i => i.deleted).length;
		out.push('## Abgleich mit GEDBAS', '');
		out.push(`Referenz: \`${meta.referencePath ?? '?'}\` mit ${ref.individuals.length} Personen, davon ${deleted} von GEDBAS aus Datenschutzgründen geleert.`);
		out.push(`Zugeordnet: ${byUid} über die UID, ${byName} über Name und Geburtsjahr.`, '');

		const open = ref.matches.filter(m => !m.person);
		out.push(`### Nicht zugeordnet (${open.length})`, '');
		out.push(list(open.map(m => {
			const g = m.individual;
			const url = `${meta.gedbasPersonUrl}${g.xref.replace(/^I/, '')}`;
			const cands = m.candidates.length ? ` → mehrdeutig: ${m.candidates.map(link).join(', ')}` : '';
			return `[ ] [${g.name ?? g.xref}](${url}) ${g.birthDate ?? ''}${cands}`;
		})));

		out.push(`### Würden aus GEDBAS herausfallen (${ref.dropped.length})`, '');
		out.push('In GEDBAS vorhanden, aber nicht mehr im Export-Umfang (ohne Lebend-Regel).', '');
		out.push(list(sortByName(ref.dropped).map(p => `[ ] ${link(p)}`)));

		out.push(`### GEDBAS-Link fehlt in \`refs\` (${ref.missingRef.length})`, '');
		out.push('Wird beim Rückabgleich automatisch nachgetragen.', '');
		out.push(list(ref.missingRef.map(m => `${link(m.person)} → ${meta.gedbasPersonUrl}${m.individual.xref.replace(/^I/, '')}`), 15));
	}

	// ── Lebend-Regel
	out.push('## Lebend-Regel', '');
	out.push(`### Ausgelassen (${s.living.length})`, '');
	out.push(list(sortByName(s.living).map(p => `${link(p)} (${year(p)})`)));
	out.push(`### Weder Geburtsjahr noch Tod (${s.unknownLiving.length})`, '');
	out.push('Die Lebend-Regel greift hier nicht. Mindestens ein geschätztes Geburtsjahr ergänzen.', '');
	out.push(list(sortByName(s.unknownLiving).map(p => `[ ] ${link(p)}`)));
	if (s.excludedByFlag.length) {
		out.push(`### Ausgeschlossen per \`Export: false\` oder Datenschutz (${s.excludedByFlag.length})`, '');
		out.push(list(sortByName(s.excludedByFlag).map(link)));
	}

	// ── Datumslinks
	out.push(`## Datumslinks (${r.dateLinks.length})`, '');
	out.push('Linkziel und Anzeige stimmen nicht überein, oder die Anzeige ist kein gültiges Datum.', '');
	const hint = { mismatch: '', unreadable: ' (Anzeige nicht lesbar)', coarse: ' (Link ungenauer als Anzeige)' };
	out.push(list(r.dateLinks.map(d => `[ ] ${link(d.event)}: \`${d.value}\`${hint[d.reason]}`)));

	// ── Plausibilität
	out.push(`## Plausibilität (${r.plausibility.length})`, '');
	out.push(list(r.plausibility.map(i => `[ ] ${describe(i, link, year)}`)));

	// ── Familien
	out.push(`## Familien ohne Datensatz (${r.families.missing.length})`, '');
	out.push(list(r.families.missing.map(f => `${link(f.father)} + ${link(f.mother)}`), 50));

	// ── Gruppen
	const small = r.groups.filter(g => g.length <= 3);
	out.push(`## Kleine unverbundene Gruppen (${small.length})`, '');
	out.push('Höchstens drei Personen ohne Verbindung zum Rest des Umfangs.', '');
	out.push(list(small.map(g => sortByName(g).map(link).join(' + '))));

	// ── UIDs
	if (r.duplicateUids.length || r.invalidUids.length) {
		out.push(`## UID-Fehler (${r.duplicateUids.length + r.invalidUids.length})`, '');
		out.push(list([
			...r.duplicateUids.map(g => `[ ] Gleiche \`uuid\`: ${sortByName(g).map(link).join(', ')}`),
			...r.invalidUids.map(p => `[ ] Ungültige \`uuid\`: ${link(p)}`),
		]));
	}

	// ── ohne uuid
	out.push(`## Ohne \`uuid\` (${r.withoutUuid.length})`, '');
	out.push('Command „Fehlende UIDs für Personen vergeben“ ausführen.', '');
	out.push(list(sortByName(r.withoutUuid).map(link), 20));

	return out.join('\n');
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
