import { describe, expect, it } from 'vitest';
import { buildRelations, checkFamilies, matchReference } from './checks';
import { groupOf, renderFamilyNote } from './family';
import type { VaultEvent, VaultModel, VaultPerson } from './model';

const person = (path: string, extra: Partial<VaultPerson> = {}): VaultPerson =>
	({ path, basename: path.split('/').pop()!.replace(/\.md$/, ''), kekule: false, xrefs: [], ...extra });
const ev = (path: string, type: string, persons: string[], extra: Partial<VaultEvent> = {}): VaultEvent =>
	({ path, basename: path, type, persons, ...extra });

describe('Familien', () => {
	const kind = 'Personen/Zw-MayKlh/Mayr, Maria Theresia I0085.md';
	const vater = 'Personen/Zw-MayKlh/Klimm, Johann I0083.md';
	const mutter = 'Personen/Zw-MayKlh/Thekla I0086.md';
	const adoptiv = 'Personen/Zw-MayKlh/Mayr, Andreas I0107.md';
	const model: VaultModel = {
		persons: new Map([
			[kind, person(kind, { sex: 'F' })],
			[vater, person(vater)], // ohne Geschlecht
			[mutter, person(mutter, { sex: 'F' })],
			[adoptiv, person(adoptiv, { sex: 'M' })],
		]),
		events: [
			ev('E1', 'Geburt', [kind], { father: vater, mother: mutter }),
			ev('E2', 'Elternschaft', [kind], { father: adoptiv, mother: mutter }),
			ev('E3', 'Heirat', [adoptiv, mutter]),
		],
		families: [{ path: 'Familien/Zw-MayKlh/F0001.md', basename: 'F0001', father: vater, mother: mutter }],
	};

	it('nimmt die Rollen aus dem Ereignis und legt die Adoptivfamilie zusätzlich an', () => {
		const result = checkFamilies(model, buildRelations(model), new Set([kind]));
		expect(result.missing).toEqual([{ father: adoptiv, mother: mutter }]);
		expect(result.withoutUuid).toEqual(['Familien/Zw-MayKlh/F0001.md']);
	});

	it('ergänzt eine vorhandene Familie mit nur einem Elternteil statt eine zweite anzulegen', () => {
		const v = 'Personen/Weber, Johann I0424.md';
		const m = 'Personen/Ramsauer, Ursula I0860.md';
		const k = 'Personen/Weber, Anna I0426.md';
		const partial: VaultModel = {
			persons: new Map([[v, person(v, { sex: 'M' })], [m, person(m, { sex: 'F' })], [k, person(k)]]),
			events: [ev('E1', 'Geburt', [k], { father: v, mother: m })],
			families: [{ path: 'Familien/F0155.md', basename: 'F0155', father: v, uuid: 'x' }],
		};
		const result = checkFamilies(partial, buildRelations(partial), new Set([k]));
		expect(result.missing).toEqual([]);
		expect(result.incomplete).toEqual([{ family: 'Familien/F0155.md', father: v, mother: m }]);
	});

	it('bestimmt Ordner und Tag aus der Gruppe des Vaters', () => {
		expect(groupOf(vater)).toBe('Zw-MayKlh');
		expect(groupOf('Personen/Mayr, X I0001.md')).toBeUndefined();
		const note = renderFamilyNote('F1202', 'a'.repeat(36), '2026-11-17 14:00', model.persons.get(adoptiv), model.persons.get(mutter), 'Familien');
		expect(note.path).toBe('Familien/Zw-MayKlh/F1202.md');
		expect(note.content).toContain('  - Familien/Zw-MayKlh');
		expect(note.content).toContain('Vater: "[[Mayr, Andreas I0107]]"');
		expect(note.content).toContain('Mutter: "[[Thekla I0086]]"');
		expect(note.content).toContain(`uuid: ${'a'.repeat(36)}`);
	});

	it('lässt ein fehlendes Elternteil leer', () => {
		const note = renderFamilyNote('F1203', 'b'.repeat(36), '2026-11-17 14:00', undefined, model.persons.get(mutter), 'Familien');
		expect(note.content).toMatch(/\nVater:\n/);
	});
});

describe('Zuordnung über xrefs', () => {
	it('ordnet eine Person über S-ID:GEDBAS-ID zu', () => {
		const p = person('Personen/Mayr, Maria Theresia I0085.md', { xrefs: ['S00239:1449005733'] });
		const model: VaultModel = { persons: new Map([[p.path, p]]), events: [], families: [] };
		const [m] = matchReference(model, buildRelations(model), [{ xref: 'I1449005733', name: 'Maria Theresia /Klimm/', deleted: false }], 'S00239');
		expect(m).toMatchObject({ person: p.path, via: 'xref' });
	});
});
