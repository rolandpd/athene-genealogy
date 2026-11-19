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
		expect(nameParts('Bunk, Anselm i0762')).toEqual({ given: 'Anselm', surname: 'Bunk' });
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
			ev('E1', 'Geburt', [k], '[[1850-03-01|01.03.1850]]', { father: v, mother: m, place: 'Orte/Wollishausen P0047.md', placeDetails: ['Orte/Hof P0999.md'], address: '[[Wollishausen 3 P1000|Hauptstraße 3]]' }),
			ev('E2', 'Heirat', [v, m], '[[1849|1849~]]'),
			ev('E3', 'Geburt', [v], '[[1820|1820?]]'),
			ev('E4', 'Tod', [m], '[[1890-01-02|02.01.1890]]'),
			ev('E5', 'Beruf', [v], '[[1850|1850]]', { occupation: 'Bauer' }),
			ev('E6', 'Taufe', [k], '[[1850-03-02|02.03.1850]]', { religion: 'römisch-katholisch' }),
			ev('E7', 'Heirat', [k, priv], '[[1880|1880]]'),
			ev('E8', 'Wehrdienst', [k], '[[1870|1870]]', { privacy: '[[Sensitiv]]' }),
		],
		families: [{ path: 'F1.md', basename: 'F0001', id: 'F0001', uuid: 'dddddddddddddddddddddddddddddddddddd', father: v, mother: m }],
		places: new Map([
			['Orte/Wollishausen P0047.md', { path: 'Orte/Wollishausen P0047.md', name: 'Wollishausen', address: 'DE-86459 Wollishausen', gov: 'WOLSENJN58JI', lat: 48.32, long: 10.7 }],
			['Orte/Hof P0999.md', { path: 'Orte/Hof P0999.md', name: 'Wollishausen, Schusterhof' }],
		]),
	};
	const r = runChecks(model, { currentYear: 2026, livingYears: 100 });
	const { text, persons, families } = writeGedcom(r, { created: new Date(2026, 10, 17), version: '0.13.0', submitter: 'Test' });
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

	it('schreibt den Namen der Ort-Notiz mit GOV, Koordinaten und Adresse, dazu Beruf und Konfession', () => {
		expect(text).toContain('2 PLAC Wollishausen\r\n3 _GOV WOLSENJN58JI\r\n3 MAP\r\n4 LATI N48.32\r\n4 LONG E10.7\r\n2 ADDR\r\n3 ADR1 Wollishausen, Schusterhof, Hauptstraße 3\r\n3 ADR2 Wollishausen\r\n3 POST DE-86459');
		expect(lines).toContain('1 OCCU Bauer');
		expect(lines).toContain('1 RELI römisch-katholisch');
	});

	it('lässt sensible Ereignisse aus und schätzt fehlende Sterbedaten', () => {
		expect(text).not.toContain('Wehrdienst');
		const georg = text.slice(text.indexOf('0 @I0001@'), text.indexOf('0 @I0002@'));
		expect(georg).toContain('1 DEAT\r\n2 DATE BEF 1920');
	});
});

describe('writeGedcom: Freitext-Orte, sonstige Ereignisse, Wohnort', () => {
	const p = 'Domagalski, Karol I0015.md';
	const model: VaultModel = {
		persons: new Map([[p, { path: p, basename: 'Domagalski, Karol I0015', id: 'I0015', kekule: true, xrefs: [], sex: 'M', uuid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }]]),
		events: [
			{ path: 'E1', basename: 'E1', type: 'Geburt', persons: [p], date: '[[1922-09-17|17.09.1922]]' },
			{ path: 'E2', basename: 'E2', type: 'Inhaftierung', persons: [p], date: '[[1943-10-23|23.10.1943]]', placeText: 'KL Buchenwald (bei Weimar)', description: 'Häftlings-Nr. 30219' },
			{ path: 'E3', basename: 'E3', type: 'Sonstiges', persons: [p], date: '[[1945-04-02|02.04.1945]]', placeText: 'KL Mittelbau (Dora)', description: 'Befreiung aus KL Mittelbau' },
			{ path: 'E4', basename: 'E4', type: 'Wohnort', persons: [p], date: '[[1945-07-09|09.07.1945]]', placeText: 'Kempten (Allgäu)', description: 'DP Assembly Center Kempten (vgl. [[C01386]])' },
			{ path: 'E5', basename: 'E5', type: 'Grundbesitz', persons: [p], date: '[[1950|1950]]' },
			{ path: 'E6', basename: 'E6', type: 'Tod', persons: [p], date: '[[1996-04-22|22.04.1996]]' },
		],
		families: [],
		places: new Map(),
	};
	const { text } = writeGedcom(runChecks(model, { currentYear: 2026, livingYears: 100 }), { created: new Date(2026, 10, 19), version: 'test' });

	it('schreibt Freitext-Orte und die Beschreibung bei EVEN', () => {
		expect(text).toContain('1 EVEN Häftlings-Nr. 30219\r\n2 TYPE Inhaftierung\r\n2 DATE 23 OCT 1943\r\n2 PLAC KL Buchenwald (bei Weimar)');
		expect(text).toContain('1 EVEN Befreiung aus KL Mittelbau\r\n2 TYPE Ereignis\r\n2 DATE 2 APR 1945\r\n2 PLAC KL Mittelbau (Dora)');
	});

	it('schreibt beim Wohnort die Beschreibung als Adresse und Grundbesitz auch ohne Wert', () => {
		expect(text).toContain('1 RESI\r\n2 DATE 9 JUL 1945\r\n2 PLAC Kempten (Allgäu)\r\n2 ADDR\r\n3 ADR1 DP Assembly Center Kempten (vgl. C01386)');
		expect(text).toContain('1 PROP Grundbesitz\r\n2 DATE 1950');
	});
});

describe('writeGedcom: Zuordnung über die Typ-Notizen', () => {
	const v = 'Mayr, Georg I0001.md', m = 'Huber, Anna I0002.md', k = 'Mayr, Josef I0003.md';
	const pers = (path: string, sex: string, id: string) => ({ path, basename: path.replace(/\.md$/, ''), id, kekule: true, xrefs: [], sex });
	const model: VaultModel = {
		persons: new Map([[v, pers(v, 'M', 'I0001')], [m, pers(m, 'F', 'I0002')], [k, pers(k, 'M', 'I0003')]]),
		events: [
			{ path: 'E1', basename: 'E1', type: 'Taufe', persons: [k], date: '[[1850-03-02|02.03.1850]]', father: v, mother: m, religion: 'römisch-katholisch' },
			{ path: 'E2', basename: 'E2', type: 'Priesterweihe', persons: [k], date: '[[1875|1875]]' },
			{ path: 'E3', basename: 'E3', type: 'Mitgliedschaft', persons: [k], date: '[[1880|1880]]', fields: { Organisation: 'Kolpingverein' } },
			{ path: 'E4', basename: 'E4', type: 'Verlobung', persons: [v, m], date: '[[1848|1848]]' },
			{ path: 'E5', basename: 'E5', type: 'Stand', persons: [m], date: '[[1849|1849]]', fields: { Stand: 'Bauerstochter' } },
			{ path: 'E6', basename: 'E6', type: 'Geburt', persons: [k], date: '[[1850-03-01|01.03.1850]]', father: v, mother: m },
			{ path: 'E7', basename: 'E7', type: 'Tod', persons: [v, m, k], date: '[[1900|1900]]' },
		],
		families: [{ path: 'F1.md', basename: 'F0001', id: 'F0001', uuid: 'dddddddddddddddddddddddddddddddddddd', father: v, mother: m }],
		places: new Map(),
		eventTypes: new Map([['Stand', { gedcom: 'OCCU', gedcomValue: ['Stand'] }]]),
	};
	const { text } = writeGedcom(runChecks(model, { currentYear: 2026, livingYears: 100 }), { created: new Date(2026, 10, 19), version: 'test' });

	it('nutzt eigene Tags (ORDN), Konfession an der Taufe und FACT als EVEN', () => {
		expect(text).toContain('1 CHR\r\n2 DATE 2 MAR 1850\r\n2 RELI römisch-katholisch');
		expect(text).toContain('1 ORDN\r\n2 DATE 1875');
		expect(text).toContain('1 EVEN Kolpingverein\r\n2 TYPE Mitgliedschaft\r\n2 DATE 1880');
	});

	it('liest neue Typen aus den Typ-Notizen und schreibt Paar-Ereignisse an die Familie', () => {
		expect(text).toContain('1 OCCU Bauerstochter\r\n2 DATE 1849');
		expect(text.slice(text.indexOf('0 @F0001@ FAM'))).toContain('1 ENGA\r\n2 DATE 1848');
	});
});

describe('writeGedcom: Quellen', () => {
	const p = 'Bayrle, Joseph I0453.md';
	const model: VaultModel = {
		persons: new Map([[p, { path: p, basename: 'Bayrle, Joseph I0453', id: 'I0453', kekule: true, xrefs: [], sex: 'M' }]]),
		events: [
			{ path: 'E1', basename: 'E1', type: 'Geburt', persons: [p], date: '[[1837-03-08|08.03.1837]]', evidence: ['C1'], confidence: 'Gesichert' },
			{ path: 'E2', basename: 'E2', type: 'Tod', persons: [p], evidence: ['C2'], confidence: 'Abgeleitet', note: 'Geboren 1837' },
		],
		families: [],
		places: new Map(),
		citations: new Map([
			['C1', { path: 'C1', id: 'C00058', title: 'Joseph Bayrle u. Barbara Gumpp 27.11.1866 (Heiratseintrag)', source: 'S1', description: 'S.28', url: 'https://data.matricula-online.eu/x/?pg=28', date: '[[1866-11-27|27.11.1866]]' }],
			['C2', { path: 'C2', id: 'C00010', title: 'Person älter 100 Jahre (Regel)', source: 'S0' }],
		]),
		sources: new Map([
			['S1', { path: 'S1', id: 'S00237', title: 'Wolferstadt, Trauungen 12-01, 1851-1920', url: 'https://data.matricula-online.eu/x/', repository: 'R1' }],
			['S0', { path: 'S0', id: 'S00001', title: 'Basisregelwerk' }],
		]),
		repositories: new Map([['R1', { path: 'R1', id: 'R0059', name: 'Kirchenbücher Wolferstadt', url: 'https://data.matricula-online.eu/w/' }]]),
	};
	const { text } = writeGedcom(runChecks(model, { currentYear: 2026, livingYears: 100 }), { created: new Date(2026, 10, 19), version: 'test' });

	it('schreibt Quellenangaben mit Seite, Link und Verlässlichkeit', () => {
		expect(text).toContain('1 BIRT\r\n2 DATE 8 MAR 1837\r\n2 SOUR @S00237@\r\n3 PAGE Joseph Bayrle u. Barbara Gumpp 27.11.1866 (Heiratseintrag); S.28\r\n3 DATA\r\n4 DATE 27 NOV 1866\r\n3 _LINK https://data.matricula-online.eu/x/?pg=28\r\n3 QUAY 2');
	});

	it('schreibt Regeln mit Begründung und die Quellen- und Archiv-Datensätze', () => {
		expect(text).toContain('2 SOUR @S00001@\r\n3 PAGE Person älter 100 Jahre (Regel); Geboren 1837\r\n3 QUAY 1');
		expect(text).toContain('0 @S00237@ SOUR\r\n1 TITL Wolferstadt, Trauungen 12-01, 1851-1920\r\n1 _LINK https://data.matricula-online.eu/x/\r\n1 REPO @R0059@');
		expect(text).toContain('0 @R0059@ REPO\r\n1 NAME Kirchenbücher Wolferstadt\r\n1 WWW https://data.matricula-online.eu/w/');
	});
});
