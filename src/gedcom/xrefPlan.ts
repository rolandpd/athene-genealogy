import { type CheckResult, referenceXref } from './checks';

export interface XrefUpdate {
	path: string;
	/** neue Liste für `xrefs` */
	xrefs: string[];
	/** bisheriger Eintrag derselben Quelle, falls die ID sich geändert hat */
	previous?: string;
}

/**
 * Rückabgleich: die externe ID der Referenz (z. B. GEDBAS-Personen-ID) als `xrefs: - S00239:<ID>`.
 * Nur Zuordnungen über die UID, damit keine unsichere Namenszuordnung festgeschrieben wird.
 * Andere Einträge derselben Quelle werden ersetzt, Einträge anderer Quellen bleiben.
 */
export function planXrefUpdates(r: CheckResult, source: string): XrefUpdate[] {
	const prefix = `${source}:`;
	const updates: XrefUpdate[] = [];
	for (const m of r.reference?.matches ?? []) {
		if (m.via !== 'uid' || !m.person) continue;
		const person = r.model.persons.get(m.person);
		if (!person) continue;
		const wanted = referenceXref(source, m.individual.xref);
		const same = person.xrefs.filter(x => x.startsWith(prefix));
		if (same.length === 1 && same[0] === wanted) continue;
		updates.push({
			path: person.path,
			xrefs: [...person.xrefs.filter(x => !x.startsWith(prefix)), wanted],
			previous: same.find(x => x !== wanted),
		});
	}
	return updates;
}
