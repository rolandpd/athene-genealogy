import { describe, expect, it } from 'vitest';
import { createUid, isValidUid, uidChecksum } from './uid';
import { checkUids } from './checks';
import type { VaultModel, VaultPerson } from './model';

describe('UID', () => {
	it('erzeugt 36 Hex-Zeichen mit Prüfsumme', () => {
		const uid = createUid();
		expect(uid).toMatch(/^[0-9a-f]{36}$/);
		expect(uid.slice(32)).toBe(uidChecksum(uid.slice(0, 32)));
		expect(uid[12]).toBe('4');
	});

	it('erzeugt verschiedene UIDs', () => {
		expect(new Set(Array.from({ length: 100 }, () => createUid())).size).toBe(100);
	});

	it('berechnet die Prüfsumme deterministisch', () => {
		const zero = new Uint8Array(16);
		expect(createUid(() => zero).slice(32)).toBe(uidChecksum('00000000000040008000000000000000'));
		expect(uidChecksum('ff'.repeat(16))).toBe('f078');
	});

	it('akzeptiert vorhandene UIDs ohne PAF-Prüfsumme', () => {
		expect(isValidUid('5b64fdb391c32f387546aae3f709e7b927ea')).toBe(true);
		expect(isValidUid('CF502118DB07F43B795D3F4923BDE5DE')).toBe(true);
		expect(isValidUid('5b64-fdb3')).toBe(false);
		expect(isValidUid(undefined)).toBe(false);
		expect(isValidUid(42)).toBe(false);
	});

	it('findet doppelte und ungültige UIDs', () => {
		const p = (path: string, uuid?: string): [string, VaultPerson] => [path, { path, basename: path, kekule: false, gedbasRefs: [], uuid }];
		const model: VaultModel = {
			persons: new Map([p('a', 'df1621d5fa7d9408553ade253ce269184089'), p('b', 'DF1621D5FA7D9408553ADE253CE269184089'), p('c', 'xyz'), p('d')]),
			events: [],
			families: [],
		};
		expect(checkUids(model)).toEqual({ duplicateUids: [['a', 'b']], invalidUids: ['c'] });
	});
});
