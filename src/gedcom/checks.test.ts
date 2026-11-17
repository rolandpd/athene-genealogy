import { describe, expect, it } from 'vitest';
import { checkDateLink, computeScope, buildRelations, matchReference, nameKey, runChecks, checkFamilies } from './checks';
import { readGedcomIndividuals } from './gedcomReader';
import { normalizeEventType, type VaultEvent, type VaultModel, type VaultPerson } from './model';

function person(path: string, extra: Partial<VaultPerson> = {}): VaultPerson {
	return { path, basename: path.replace(/\.md$/, ''), kekule: false, xrefs: [], ...extra };
}
function event(path: string, type: string, persons: string[], date?: string, extra: Partial<VaultEvent> = {}): VaultEvent {
	return { path, basename: path, type, persons, date, ...extra };
}
function model(persons: VaultPerson[], events: VaultEvent[]): VaultModel {
	return { persons: new Map(persons.map(p => [p.path, p])), events, families: [] };
}
const OPTS = { currentYear: 2026, livingYears: 100 };

describe('normalizeEventType', () => {
	it('liest Text und Wikilinks', () => {
		expect(normalizeEventType('Geburt')).toBe('Geburt');
		expect(normalizeEventType('[[Geburt]]')).toBe('Geburt');
		expect(normalizeEventType('[[Wehrdienst|Kriegsdienst]]')).toBe('Wehrdienst');
	});
});

describe('checkDateLink', () => {
	it('akzeptiert übereinstimmende Links', () => {
		expect(checkDateLink('[[1874-09-25|25.09.1874]]')).toBeNull();
		expect(checkDateLink('[[1944-06|06.1944~]]')).toBeNull();
		expect(checkDateLink('[[1734|1734?]]')).toBeNull();
		expect(checkDateLink('[[1728|../1728?]]')).toBeNull();
		expect(checkDateLink('[[1757|1757/..]]')).toBeNull();
		expect(checkDateLink('[[2011-07|2011-07~]]')).toBeNull();
	});
	it('überspringt Zeiträume, Monatsnamen und Freitext', () => {
		expect(checkDateLink('[[1774-09-02|1774/1779]]')).toBeNull();
		expect(checkDateLink('[[2010-11|Nov. 2010]]')).toBeNull();
		expect(checkDateLink('[[1681-07|Sommer 1681~]]')).toBeNull();
	});
	it('findet Abweichungen zwischen Ziel und Anzeige', () => {
		expect(checkDateLink('[[1978|../1728?]]')).toBe('mismatch');
		expect(checkDateLink('[[1729-10-21|21.10.1719]]')).toBe('mismatch');
		expect(checkDateLink('[[1960-01-03|01.03.1960]]')).toBe('mismatch');
	});
	it('meldet Links, die ungenauer als die Anzeige sind', () => {
		expect(checkDateLink('[[1886-05|11.05.1886]]')).toBe('coarse');
	});
	it('meldet unlesbare Anzeigen', () => {
		expect(checkDateLink('[[1829-02-09|09.021829]]')).toBe('unreadable');
		expect(checkDateLink('[[1965-06-17|17.16.1965]]')).toBe('unreadable');
	});
});

describe('Export-Umfang', () => {
	const m = model(
		[
			person('kind.md', { kekule: true, sex: 'M' }),
			person('vater.md', { sex: 'M' }),
			person('mutter.md', { sex: 'F' }),
			person('lebend.md', { sex: 'F' }),
			person('fremd.md', { sex: 'F' }),
			person('gesperrt.md', { sex: 'M', privacy: '[[Privat]]' }),
		],
		[
			event('E1', 'Geburt', ['kind.md'], '[[1900-01-01|01.01.1900]]', { father: 'vater.md', mother: 'mutter.md' }),
			event('E2', 'Tod', ['kind.md'], '[[1980|1980]]'),
			event('E3', 'Geburt', ['lebend.md'], '[[1950|1950]]', { father: 'kind.md' }),
			event('E4', 'Heirat', ['kind.md', 'gesperrt.md'], '[[1925|1925]]'),
		],
	);
	const rel = buildRelations(m);

	it('nimmt Kekulé-Personen und direkte Verwandte auf', () => {
		const scope = computeScope(m, rel, [], OPTS);
		expect([...scope.included].sort()).toEqual(['kind.md', 'mutter.md', 'vater.md']);
		expect(scope.living).toEqual(['lebend.md']);
		expect(scope.excludedByPrivacy).toEqual(['gesperrt.md']);
		expect(scope.unknownLiving.sort()).toEqual(['mutter.md', 'vater.md']);
	});

	it('übernimmt Personen aus der Referenz (Bestandsschutz)', () => {
		const scope = computeScope(m, rel, ['fremd.md'], OPTS);
		expect(scope.included.has('fremd.md')).toBe(true);
	});

	it('leitet benötigte Familien ab', () => {
		const scope = computeScope(m, rel, [], OPTS);
		const fam = checkFamilies(m, rel, scope.included);
		expect(fam.missing).toContainEqual({ father: 'vater.md', mother: 'mutter.md' });
	});
});

describe('GEDCOM-Abgleich', () => {
	const ged = [
		'0 HEAD',
		'0 @I1449005466@ INDI',
		'1 NAME Anna Maria /Baumann/',
		'1 BIRT',
		'2 DATE 20 JUL 1765',
		'1 _UID CF502118DB07F43B795D3F4923BDE5DE08C0',
		'0 @I1449005470@ INDI',
		'1 NAME Anna /Mayr/',
		'1 CHR',
		'2 DATE 14 JUL 1889',
		'0 @I1449005490@ INDI',
		'1 NOTE aus Datenschutzgründen gelöscht',
		'0 TRLR',
	].join('\r\n');

	it('liest Personen, UID und Löschvermerk', () => {
		const indis = readGedcomIndividuals(ged);
		expect(indis).toHaveLength(3);
		expect(indis[0]).toMatchObject({ xref: 'I1449005466', uid: 'cf502118db07f43b795d3f4923bde5de08c0', birthDate: '20 JUL 1765' });
		expect(indis[1]?.birthDate).toBe('14 JUL 1889');
		expect(indis[2]?.deleted).toBe(true);
	});

	it('ordnet per UID und per Name + Geburtsjahr zu', () => {
		const m = model(
			[
				person('Baumann, Anna Maria I0002.md', { uuid: 'cf502118db07f43b795d3f4923bde5de08c0' }),
				person('Mayr, Anna I0102.md'),
			],
			[event('E1', 'Taufe', ['Mayr, Anna I0102.md'], '[[1889-07-14|14.07.1889]]')],
		);
		const matches = matchReference(m, buildRelations(m), readGedcomIndividuals(ged));
		expect(matches.map(x => [x.person, x.via])).toEqual([
			['Baumann, Anna Maria I0002.md', 'uid'],
			['Mayr, Anna I0102.md', 'name'],
		]);
	});

	it('ordnet eine Person nicht zweimal per Name zu', () => {
		const twice = readGedcomIndividuals(['0 @I1@ INDI', '1 NAME Maria /Mayr/', '0 @I2@ INDI', '1 NAME Maria /Mayr/'].join('\n'));
		const m = model([person('Mayr, Maria I0167.md')], []);
		const matches = matchReference(m, buildRelations(m), twice);
		expect(matches.every(x => x.person === undefined && x.candidates.length === 1)).toBe(true);
	});

	it('meldet fehlende GEDBAS-IDs in xrefs', () => {
		const m = model([person('Baumann, Anna Maria I0002.md', { kekule: true, uuid: 'cf502118db07f43b795d3f4923bde5de08c0' })], []);
		const r = runChecks(m, { ...OPTS, referenceSource: 'S00239' }, readGedcomIndividuals(ged));
		expect(r.reference?.missingRef).toHaveLength(1);
	});

	it('Datenschutz geht vor Bestandsschutz', () => {
		const m = model([person('Baumann, Anna Maria I0002.md', { uuid: 'cf502118db07f43b795d3f4923bde5de08c0', privacy: '[[Privat]]' })], []);
		const r = runChecks(m, OPTS, readGedcomIndividuals(ged));
		expect(r.scope.included.has('Baumann, Anna Maria I0002.md')).toBe(false);
		expect(r.reference?.dropped).toEqual([]);
		expect(r.reference?.removedByPrivacy).toEqual(['Baumann, Anna Maria I0002.md']);
	});

	it('normalisiert Namen unabhängig von der Schreibweise', () => {
		expect(nameKey('Anna Maria /Baumann/')).toBe(nameKey('Baumann, Anna Maria I0002'));
	});
});

describe('Plausibilität', () => {
	it('findet Heirat vor der Geburt und tote Eltern', () => {
		const m = model(
			[person('a.md'), person('b.md'), person('kind.md')],
			[
				event('E1', 'Geburt', ['a.md'], '[[1737|1737]]'),
				event('E2', 'Heirat', ['a.md', 'b.md'], '[[1735|1735]]'),
				event('E3', 'Tod', ['b.md'], '[[1760|1760]]'),
				event('E4', 'Geburt', ['kind.md'], '[[1762|1762]]', { mother: 'b.md' }),
			],
		);
		const kinds = runChecks(m, OPTS).plausibility.map(i => i.kind);
		expect(kinds).toContain('marriageTooYoung');
		expect(kinds).toContain('parentDead');
	});
});

describe('Lebend-Regel und Datenschutz', () => {
	it('meldet fehlende und widersprüchliche Lebend-Markierungen', () => {
		const m = model(
			[
				person('jung.md'),
				person('markiert.md', { privacy: '[[Lebend]]' }),
				person('tot.md', { privacy: '[[Lebend]]' }),
				person('alt.md', { privacy: '[[Lebend]]' }),
			],
			[
				event('E1', 'Geburt', ['jung.md'], '[[1960|1960]]'),
				event('E2', 'Geburt', ['markiert.md'], '[[1970|1970]]'),
				event('E3', 'Tod', ['tot.md']),
				event('E4', 'Geburt', ['alt.md'], '[[1900|1900]]'),
			],
		);
		const r = runChecks(m, OPTS);
		expect(r.living).toEqual({ missingMark: ['jung.md'], markedButDead: ['tot.md'], markedButOld: ['alt.md'] });
	});

	it('lässt explizit als Lebend markierte Personen aus', () => {
		const m = model([person('x.md', { kekule: true, privacy: '[[Lebend]]' })], []);
		const scope = computeScope(m, buildRelations(m), [], OPTS);
		expect(scope.living).toEqual(['x.md']);
		expect(scope.included.size).toBe(0);
	});
});

describe('Plausibilität und Bearbeitungsstatus', () => {
	it('ordnet Fälle nach dem Status der beteiligten Ereignisse ein', () => {
		const m = model(
			[person('vater.md'), person('kind.md'), person('mutter.md'), person('kind2.md')],
			[
				event('E1', 'Geburt', ['vater.md'], '[[1771|1771]]'),
				event('E2', 'Geburt', ['kind.md'], '[[1832|1832]]', { father: 'vater.md', status: 'Konsolidiert' }),
				event('E3', 'Tod', ['mutter.md'], '[[1760|1760]]', { status: 'Klärungsbedarf' }),
				event('E4', 'Geburt', ['kind2.md'], '[[1762|1762]]', { mother: 'mutter.md' }),
			],
		);
		const issues = runChecks(m, OPTS).plausibility;
		expect(issues.find(i => i.kind === 'parentAge')).toMatchObject({ state: 'reviewed', events: ['E2', 'E1'] });
		expect(issues.find(i => i.kind === 'parentDead')).toMatchObject({ state: 'known', events: ['E4', 'E3'] });
	});
});
