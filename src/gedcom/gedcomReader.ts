import type { GedcomIndividual } from './model';

const LINE = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

/**
 * Liest die Personen (INDI) aus einer GEDCOM-5.5.1-Datei.
 * Bewusst minimal: nur XREF, NAME, _UID, Geburts-/Taufdatum und die
 * GEDBAS-Markierung "aus Datenschutzgründen gelöscht".
 */
export function readGedcomIndividuals(text: string): GedcomIndividual[] {
	const result: GedcomIndividual[] = [];
	let cur: GedcomIndividual | null = null;
	let ctx = '';
	let baptismDate: string | undefined;

	const finish = () => {
		if (cur && !cur.birthDate && baptismDate) cur.birthDate = baptismDate;
	};

	for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
		const m = raw.match(LINE);
		if (!m) continue;
		const level = Number(m[1]);
		const xref = m[2];
		const tag = m[3] ?? '';
		const value = m[4]?.trim() ?? '';

		if (level === 0) {
			finish();
			baptismDate = undefined;
			cur = tag === 'INDI' && xref ? { xref: xref.slice(1, -1), deleted: false } : null;
			if (cur) result.push(cur);
			continue;
		}
		if (!cur) continue;
		if (level === 1) {
			ctx = tag;
			if (tag === 'NAME' && !cur.name) cur.name = value;
			else if (tag === '_UID') cur.uid = value.toLowerCase();
			else if (tag === 'NOTE' && /Datenschutzgr/i.test(value)) cur.deleted = true;
		} else if (level === 2 && tag === 'DATE') {
			if (ctx === 'BIRT' && !cur.birthDate) cur.birthDate = value;
			else if ((ctx === 'CHR' || ctx === 'BAPM') && !baptismDate) baptismDate = value;
		}
	}
	finish();
	return result;
}
