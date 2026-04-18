/**
 * Validates that all locale files contain the same keys as en.json (the reference).
 * Run with: npm run check-i18n
 * Exits with code 1 if any translations are missing (for use in CI).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n/locales');

function flattenKeys(obj, prefix = '') {
	const keys = [];
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
			keys.push(...flattenKeys(v, key));
		} else {
			keys.push(key);
		}
	}
	return keys;
}

const reference = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
const refKeys = new Set(flattenKeys(reference));
const langs = ['de', 'fr', 'es', 'it', 'pl', 'ia'];

let hasErrors = false;

for (const lang of langs) {
	const data = JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8'));
	const langKeys = new Set(flattenKeys(data));

	const missing = [...refKeys].filter(k => !langKeys.has(k));
	const extra = [...langKeys].filter(k => !refKeys.has(k));

	if (missing.length === 0 && extra.length === 0) {
		console.log(`${lang}: ✓ complete (${refKeys.size} keys)`);
		continue;
	}
	if (missing.length) {
		console.log(`${lang}: ✗ missing ${missing.length} key(s):`);
		missing.forEach(k => console.log(`    - ${k}`));
		hasErrors = true;
	}
	if (extra.length) {
		console.log(`${lang}: ⚠ ${extra.length} extra key(s) not in en.json:`);
		extra.forEach(k => console.log(`    + ${k}`));
	}
}

if (hasErrors) {
	console.log('\nRun `npm run check-i18n` before releasing. Missing keys fall back to English.');
	process.exit(1);
}
