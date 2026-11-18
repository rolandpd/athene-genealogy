import { type CheckResult, referenceXref } from './checks';

export interface XrefUpdate {
	path: string;
	/** neue Liste für `xrefs` */
	xrefs: string[];
	/** bisheriger Eintrag derselben Quelle, falls er ersetzt oder entfernt wird */
	previous?: string;
}

/**
 * Rückabgleich: Personen, die in der Referenz stehen, bekommen `xrefs: - S00239:<uid>`.
 * Nur Zuordnungen über die UID, damit keine unsichere Namenszuordnung festgeschrieben wird.
 * Andere Einträge derselben Quelle werden ersetzt; Personen, die nicht mehr in der Referenz
 * stehen (z. B. nach einer Datenschutz-Verschärfung), verlieren den Eintrag.
 * Einträge anderer Quellen bleiben unverändert.
 */
export function planXrefUpdates(r: CheckResult, source: string): XrefUpdate[] {
	const prefix = `${source}:`;
	const updates: XrefUpdate[] = [];
	for (const m of r.reference?.matches ?? []) {
		if (m.via !== 'uid' || !m.person) continue;
		const person = r.model.persons.get(m.person);
		if (!person) continue;
		const wanted = referenceXref(source, m.individual);
		const same = person.xrefs.filter(x => x.startsWith(prefix));
		if (same.length === 1 && same[0] === wanted) continue;
		updates.push({
			path: person.path,
			xrefs: [...person.xrefs.filter(x => !x.startsWith(prefix)), wanted],
			previous: same.find(x => x !== wanted),
		});
	}
	for (const path of r.reference?.staleRef ?? []) {
		const person = r.model.persons.get(path);
		if (!person) continue;
		updates.push({
			path,
			xrefs: person.xrefs.filter(x => !x.startsWith(prefix)),
			previous: person.xrefs.find(x => x.startsWith(prefix)),
		});
	}
	return updates;
}
