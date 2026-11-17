/**
 * GEDCOM-`_UID` im PAF/Gramps-Format: 32 Hex-Zeichen (zufällige UUID ohne
 * Bindestriche) plus 4 Hex-Zeichen Prüfsumme. Kleinbuchstaben, damit es zu den
 * vorhandenen UIDs im Vault passt; GEDBAS vergleicht ohne Rücksicht auf Groß-/Kleinschreibung.
 */

/** Prüfsumme über die 16 Bytes: laufende Summe a und Summe der Summen b, jeweils mod 256. */
export function uidChecksum(hex32: string): string {
	let a = 0;
	let b = 0;
	for (let i = 0; i < 32; i += 2) {
		a += parseInt(hex32.slice(i, i + 2), 16);
		b += a;
	}
	const hex = (n: number) => (n & 0xff).toString(16).padStart(2, '0');
	return hex(a) + hex(b);
}

export function createUid(random: (bytes: Uint8Array) => Uint8Array = b => crypto.getRandomValues(b)): string {
	const bytes = random(new Uint8Array(16));
	// UUID Version 4 / Variante RFC 4122
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex32 = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
	return hex32 + uidChecksum(hex32);
}

/**
 * Gültig sind 32 oder 36 Hex-Zeichen. Die Prüfsumme wird nicht verlangt:
 * Die UIDs aus dem früheren GEDBAS-Upload haben keine PAF-Prüfsumme.
 */
export function isValidUid(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{32}([0-9a-f]{4})?$/i.test(value.trim());
}
