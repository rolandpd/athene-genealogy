import { describe, expect, it } from 'vitest';
import { AtheneDate } from './AtheneDate';

// ── parse() ───────────────────────────────────────────────────────────────────

describe('AtheneDate.parse', () => {
	it('returns null for empty string', () => {
		expect(AtheneDate.parse('')).toBeNull();
	});

	it('returns null for invalid input', () => {
		expect(AtheneDate.parse('not-a-date')).toBeNull();
		expect(AtheneDate.parse('99999-99-99')).toBeNull();
	});

	it('parses a full date (YYYY-MM-DD)', () => {
		const d = AtheneDate.parse('1897-06-23');
		expect(d).not.toBeNull();
		expect(d!.isoDate).toBe('1897-06-23');
		expect(d!.precision).toBe('DATE');
	});

	it('parses a year-month (YYYY-MM)', () => {
		const d = AtheneDate.parse('1897-06');
		expect(d!.isoDate).toBe('1897-06');
		expect(d!.precision).toBe('MONTH');
	});

	it('parses a year-only (YYYY)', () => {
		const d = AtheneDate.parse('1897');
		expect(d!.isoDate).toBe('1897');
		expect(d!.precision).toBe('YEAR');
	});

	it('sets APPROXIMATE qualifier from EDTF ~', () => {
		const d = AtheneDate.parse('1897~');
		expect(d!.hasQualifier('APPROXIMATE')).toBe(true);
		expect(d!.hasQualifier('UNCERTAIN')).toBe(false);
	});

	it('sets UNCERTAIN qualifier from EDTF ?', () => {
		const d = AtheneDate.parse('1897?');
		expect(d!.hasQualifier('UNCERTAIN')).toBe(true);
		expect(d!.hasQualifier('APPROXIMATE')).toBe(false);
	});

	it('sets both APPROXIMATE and UNCERTAIN from EDTF %', () => {
		const d = AtheneDate.parse('1897%');
		expect(d!.hasQualifier('APPROXIMATE')).toBe(true);
		expect(d!.hasQualifier('UNCERTAIN')).toBe(true);
	});

	it('sets BEFORE from open interval ../X', () => {
		const d = AtheneDate.parse('../1897');
		expect(d!.hasQualifier('BEFORE')).toBe(true);
		expect(d!.hasQualifier('AFTER')).toBe(false);
	});

	it('sets AFTER from open interval X/..', () => {
		const d = AtheneDate.parse('1897/..');
		expect(d!.hasQualifier('AFTER')).toBe(true);
		expect(d!.hasQualifier('BEFORE')).toBe(false);
	});

	it('parses a closed interval X/Y', () => {
		const d = AtheneDate.parse('1890/1897');
		expect(d!.isInterval).toBe(true);
		expect(d!.hasQualifier('BEFORE')).toBe(false);
		expect(d!.hasQualifier('AFTER')).toBe(false);
	});

	it('accepts extra qualifiers CALCULATED and ESTIMATED', () => {
		const d = AtheneDate.parse('1897', ['CALCULATED']);
		expect(d!.hasQualifier('CALCULATED')).toBe(true);

		const e = AtheneDate.parse('1897', ['ESTIMATED']);
		expect(e!.hasQualifier('ESTIMATED')).toBe(true);
	});
});

// ── withQualifier() ───────────────────────────────────────────────────────────

describe('AtheneDate.withQualifier', () => {
	it('returns a new instance (immutable)', () => {
		const a = AtheneDate.parse('1897')!;
		const b = a.withQualifier('CALCULATED');
		expect(a.hasQualifier('CALCULATED')).toBe(false);
		expect(b.hasQualifier('CALCULATED')).toBe(true);
	});

	it('preserves existing qualifiers', () => {
		const a = AtheneDate.parse('1897~')!;
		const b = a.withQualifier('ESTIMATED');
		expect(b.hasQualifier('APPROXIMATE')).toBe(true);
		expect(b.hasQualifier('ESTIMATED')).toBe(true);
	});
});

// ── toDisplay() ───────────────────────────────────────────────────────────────

describe('AtheneDate.toDisplay', () => {
	it('formats a full date in German', () => {
		expect(AtheneDate.parse('1897-06-23')!.toDisplay()).toBe('23. Juni 1897');
	});

	it('formats month+year', () => {
		expect(AtheneDate.parse('1897-06')!.toDisplay()).toBe('Juni 1897');
	});

	it('formats year only', () => {
		expect(AtheneDate.parse('1897')!.toDisplay()).toBe('1897');
	});

	it('prefixes "ca. " for APPROXIMATE', () => {
		expect(AtheneDate.parse('1897~')!.toDisplay()).toBe('ca. 1897');
	});

	it('prefixes "ber. " for CALCULATED', () => {
		expect(AtheneDate.parse('1897', ['CALCULATED'])!.toDisplay()).toBe('ber. 1897');
	});

	it('prefixes "gesch. " for ESTIMATED', () => {
		expect(AtheneDate.parse('1897', ['ESTIMATED'])!.toDisplay()).toBe('gesch. 1897');
	});

	it('appends "?" for plain UNCERTAIN', () => {
		expect(AtheneDate.parse('1897?')!.toDisplay()).toBe('1897?');
	});

	it('does not append "?" when APPROXIMATE covers UNCERTAIN', () => {
		expect(AtheneDate.parse('1897%')!.toDisplay()).toBe('ca. 1897');
	});

	it('formats BEFORE interval as "vor X"', () => {
		expect(AtheneDate.parse('../1897')!.toDisplay()).toBe('vor 1897');
	});

	it('formats AFTER interval as "nach X"', () => {
		expect(AtheneDate.parse('1897/..')!.toDisplay()).toBe('nach 1897');
	});

	it('formats closed interval with en-dash', () => {
		expect(AtheneDate.parse('1890/1897')!.toDisplay()).toBe('1890–1897');
	});

	it('formats closed interval with full dates', () => {
		expect(AtheneDate.parse('1890-03-01/1897-06-23')!.toDisplay())
			.toBe('1. März 1890–23. Juni 1897');
	});
});

// ── toGedcom55() ──────────────────────────────────────────────────────────────

describe('AtheneDate.toGedcom55', () => {
	it('converts a full date', () => {
		expect(AtheneDate.parse('1897-06-23')!.toGedcom55()).toBe('23 JUN 1897');
	});

	it('converts a year-month', () => {
		expect(AtheneDate.parse('1897-06')!.toGedcom55()).toBe('JUN 1897');
	});

	it('converts year only', () => {
		expect(AtheneDate.parse('1897')!.toGedcom55()).toBe('1897');
	});

	it('uses ABT for APPROXIMATE', () => {
		expect(AtheneDate.parse('1897~')!.toGedcom55()).toBe('ABT 1897');
	});

	it('uses CAL for CALCULATED', () => {
		expect(AtheneDate.parse('1897', ['CALCULATED'])!.toGedcom55()).toBe('CAL 1897');
	});

	it('uses EST for ESTIMATED', () => {
		expect(AtheneDate.parse('1897', ['ESTIMATED'])!.toGedcom55()).toBe('EST 1897');
	});

	it('uses EST for plain UNCERTAIN', () => {
		expect(AtheneDate.parse('1897?')!.toGedcom55()).toBe('EST 1897');
	});

	it('uses BEF for BEFORE', () => {
		expect(AtheneDate.parse('../1897')!.toGedcom55()).toBe('BEF 1897');
	});

	it('uses AFT for AFTER', () => {
		expect(AtheneDate.parse('1897/..')!.toGedcom55()).toBe('AFT 1897');
	});

	it('uses BET...AND for closed interval', () => {
		expect(AtheneDate.parse('1890/1897')!.toGedcom55()).toBe('BET 1890 AND 1897');
	});
});

// ── toGedcom7() ───────────────────────────────────────────────────────────────

describe('AtheneDate.toGedcom7', () => {
	it('passes through plain EDTF strings unchanged', () => {
		expect(AtheneDate.parse('1897-06-23')!.toGedcom7()).toBe('1897-06-23');
		expect(AtheneDate.parse('1897~')!.toGedcom7()).toBe('1897~');
		expect(AtheneDate.parse('../1897')!.toGedcom7()).toBe('../1897');
	});

	it('prefixes CAL for CALCULATED', () => {
		expect(AtheneDate.parse('1897', ['CALCULATED'])!.toGedcom7()).toBe('CAL 1897');
	});

	it('prefixes EST for ESTIMATED', () => {
		expect(AtheneDate.parse('1897', ['ESTIMATED'])!.toGedcom7()).toBe('EST 1897');
	});
});

// ── toSortKey() ───────────────────────────────────────────────────────────────

describe('AtheneDate.toSortKey', () => {
	it('returns ISO date for an exact full date', () => {
		expect(AtheneDate.parse('1897-06-23')!.toSortKey()).toBe('1897-06-23');
	});

	it('returns Jan 1 for a year', () => {
		expect(AtheneDate.parse('1897')!.toSortKey()).toBe('1897-01-01');
	});

	it('returns first of month for year-month', () => {
		expect(AtheneDate.parse('1897-06')!.toSortKey()).toBe('1897-06-01');
	});

	it('returns mid-year for APPROXIMATE year', () => {
		const key = AtheneDate.parse('1897~')!.toSortKey()!;
		expect(key > '1897-01-01').toBe(true);
		expect(key < '1897-12-31').toBe(true);
	});

	it('returns start of year for BEFORE (conservative early)', () => {
		expect(AtheneDate.parse('../1897')!.toSortKey()).toBe('1897-01-01');
	});

	it('returns end of year for AFTER (conservative late)', () => {
		expect(AtheneDate.parse('1897/..')!.toSortKey()).toBe('1897-12-31');
	});

	it('returns mid-year for ESTIMATED', () => {
		const key = AtheneDate.parse('1897', ['ESTIMATED'])!.toSortKey()!;
		expect(key > '1897-01-01').toBe(true);
		expect(key < '1897-12-31').toBe(true);
	});

	it('produces ascending sort order', () => {
		const dates = ['1920', '1897', '1850-03', '1920-01-01']
			.map(s => AtheneDate.parse(s)!.toSortKey()!);
		const sorted = [...dates].sort();
		expect(sorted).toEqual(['1850-03-01', '1897-01-01', '1920-01-01', '1920-01-01']);
	});
});

// ── isoDate & rawString ───────────────────────────────────────────────────────

describe('AtheneDate accessors', () => {
	it('rawString preserves the original input', () => {
		expect(AtheneDate.parse('1897~')!.rawString).toBe('1897~');
		expect(AtheneDate.parse('1890/1897')!.rawString).toBe('1890/1897');
	});

	it('isoDate for BEFORE returns the upper bound', () => {
		expect(AtheneDate.parse('../1897')!.isoDate).toBe('1897');
	});

	it('isoDate for AFTER returns the lower bound', () => {
		expect(AtheneDate.parse('1897/..')!.isoDate).toBe('1897');
	});

	it('isInterval is true for intervals, false for dates', () => {
		expect(AtheneDate.parse('1897')!.isInterval).toBe(false);
		expect(AtheneDate.parse('1890/1897')!.isInterval).toBe(true);
		expect(AtheneDate.parse('../1897')!.isInterval).toBe(true);
	});

	it('toString delegates to toDisplay', () => {
		const d = AtheneDate.parse('1897-06-23')!;
		expect(String(d)).toBe(d.toDisplay());
	});
});
