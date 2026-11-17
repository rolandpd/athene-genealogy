import { describe, expect, it } from 'vitest';
import { runChecks } from './checks';
import { readGedcomIndividuals } from './gedcomReader';
import type { VaultEvent, VaultModel, VaultPerson } from './model';
import { dateLinkToGedcom, marriedSurnames, nameParts, writeGedcom } from './writer';

describe('dateLinkToGedcom', () => {
	it.each([
		['[[1774-10-10|10.10.1774]]', '10 OCT 1774'],
		['[[1774-10|10.1774]]', 'OCT 1774'],
		['[[1774-11|Nov. 1774]]', 'NOV 1774'],
		['[[1774|1774]]', '1774'],
		['[[1774|1774~]]', 'ABT 1774'],
		['[[1774|1774?]]', 'EST 1774'],
		['[[1774-10-10|10.10.1774~]]', 'ABT 10 OCT 1774'],
		['[[1774|../1774]]', 'BEF 1774'],
		['[[1774|../1774?]]', 'BEF 1774'],
		['[[1774|vor 1774]]', 'BEF 1774'],
		['[[1774|1774/..]]', 'AFT 1774'],
		['[[1774|1774/1779]]', 'BET 1774 AND 1779'],
		['[[1774-10-10|../10.10.1774]]', 'BEF 10 OCT 1774'],
	])('%s → %s', (raw, expected) => {
		expect(dateLinkToGedcom(raw)).toBe(expected);
	});

	it('ignoriert leere und unbekannte Werte', () => {
		expect(dateLinkToGedcom(undefined)).toBeUndefined();
		expect(dateLinkToGedcom('XXXX-10-10')).toBeUndefined();
	});
});

describe('Namen', () => {
	it('zerlegt den Dateinamen', () => {
		expect(nameParts('Wiedenbauer, Maria Anna I0301')).toEqual({ given: 'Maria Anna', surname: 'Wiedenbauer' });
	});

	it('liest Heiratsnamen aus den Aliasen', () => {
		const p: VaultPerson = { path: 'p', basename: 'Wiedenbauer, Maria Anna I0301', kekule: true, xrefs: [], aliases: ['Maria Anna Wiedenbauer', 'Maria Anna Kastner', 'I0301'] };
		expect(marriedSurnames(p)).toEqual(['Kastner']);
	});
});

describe('writeGedcom', () => {
	const v = 'Mayr, Georg I0001.md', m = 'Huber, Anna I0002.md', k = 'Mayr, Josef I0003.md', priv = 'Moser, Monika I0004.md';
	const person = (path: string, extra: Partial<VaultPerson>): VaultPerson => ({ path, basename: path.replace(/\.md$/, ''), kekule: true, xrefs: [], ...extra });
	const ev = (path: string, type: string, persons: string[], date: string | undefined, extra: Partial<VaultEvent> = {}): VaultEvent => ({ path, basename: path, type, persons, date, ...extra });
	const model: VaultModel = {
		persons: new Map([
			[v, person(v, { id: 'I0001', sex: 'M', uuid: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })],
			[m, person(m, { id: 'I0002', sex: 'F', uuid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })],
			[k, person(k, { id: 'I0003', sex: 'M', uuid: 'cccccccccccccccccccccccccccccccccccc' })],
			[priv, person(priv, { id: 'I0004', sex: 'F', privacy: '[[Privat]]', kekule: false })],
		]),
		events: [
			ev('E1', 'Geburt', [k], '[[1850-03-01|01.03.1850]]', { father: v, mother: m, place: 'Orte/Wollishausen P0047.md' }),
			ev('E2', 'Heirat', [v, m], '[[1849|1849~]]'),
			ev('E3', 'Geburt', [v], '[[1820|1820?]]'),
			ev('E4', 'Tod', [m], '[[1890-01-02|02.01.1890]]'),
			ev('E5', 'Beruf', [v], '[[1850|1850]]', { occupation: 'Bauer' }),
			ev('E6', 'Taufe', [k], '[[1850-03-02|02.03.1850]]', { religion: 'römisch-katholisch' }),
			ev('E7', 'Heirat', [k, priv], '[[1880|1880]]'),
			ev('E8', 'Wehrdienst', [k], '[[1870|1870]]', { privacy: '[[Sensitiv]]' }),
		],
		families: [{ path: 'F1.md', basename: 'F0001', id: 'F0001', uuid: 'dddddddddddddddddddddddddddddddddddd', father: v, mother: m }],
		places: new Map([['Orte/Wollishausen P0047.md', { path: 'Orte/Wollishausen P0047.md', name: 'Wollishausen', address: 'DE-86459 Wollishausen' }]]),
	};
	const r = runChecks(model, { currentYear: 2026, livingYears: 100 });
	const { text, persons, families } = writeGedcom(r, { created: new Date(2026, 10, 17), version: '0.13.0', submitter: 'Test', referencePlaces: ['Wollishausen, BY'] });
	const lines = text.split('\r\n');

	it('schreibt Personen mit UID und lässt Privat aus', () => {
		expect(persons).toBe(3);
		expect(text).not.toContain('Moser');
		expect(readGedcomIndividuals(text).map(i => i.uid)).toEqual([
			'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccccc',
		]);
	});

	it('schreibt Familien mit Kind, Heirat und UID', () => {
		expect(families).toBe(1);
		const fam = text.slice(text.indexOf('0 @F0001@ FAM'));
		expect(fam).toContain('1 HUSB @I0001@\r\n1 WIFE @I0002@\r\n1 CHIL @I0003@\r\n1 MARR\r\n2 DATE ABT 1849');
		expect(fam).toContain('1 _UID dddddddddddddddddddddddddddddddddddd');
		expect(text).toContain('1 FAMC @F0001@\r\n2 PEDI birth');
	});

	it('übernimmt Ortsnamen aus der Referenz und schreibt Beruf, Konfession', () => {
		expect(text).toContain('2 PLAC Wollishausen, BY\r\n2 ADDR\r\n3 ADR2 Wollishausen, BY\r\n3 POST DE-86459');
		expect(lines).toContain('1 OCCU Bauer');
		expect(lines).toContain('1 RELI römisch-katholisch');
	});

	it('lässt sensible Ereignisse aus und schätzt fehlende Sterbedaten', () => {
		expect(text).not.toContain('Wehrdienst');
		const georg = text.slice(text.indexOf('0 @I0001@'), text.indexOf('0 @I0002@'));
		expect(georg).toContain('1 DEAT\r\n2 DATE BEF 1920');
	});
});
