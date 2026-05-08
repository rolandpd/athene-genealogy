import edtf from 'edtf';
import { DateQualifier, sortOffsetFor } from './qualifiers';

// edtf returns Date subclasses or Interval objects — minimal types we need
interface Bitmask {
  value: number;
}

interface EdtfDate {
  type: 'Date';
  /** Canonical EDTF/ISO string: "YYYY", "YYYY-MM", or "YYYY-MM-DD" */
  edtf: string;
  precision: number;  // 1 = year, 2 = month, 3 = day
  // Bitmask objects — always truthy; check .value !== 0
  approximate: Bitmask;
  uncertain: Bitmask;
}

interface EdtfInterval {
  type: 'Interval';
  // Open ends are represented as Infinity (not null!) — use isEdtfDate() to check
  lower: EdtfDate | number;
  upper: EdtfDate | number;
  precision: number;
}

type EdtfResult = EdtfDate | EdtfInterval;

/** True if x is an edtf Date object (has an .edtf string). Safer than instanceof Date. */
function isEdtfDate(x: unknown): x is EdtfDate {
  return x !== null && typeof x === 'object' && typeof (x as EdtfDate).edtf === 'string';
}

/** Parse year, month (0-indexed), day from an edtf ISO string. */
function parseEdtfParts(edtfStr: string): { year: number; month: number; day: number } {
  const parts = edtfStr.split('-');
  return {
    year:  parseInt(parts[0] ?? '0', 10),
    month: parts.length > 1 ? parseInt(parts[1] ?? '1', 10) - 1 : 0,  // 0-indexed
    day:   parts.length > 2 ? parseInt(parts[2] ?? '1', 10) : 1,
  };
}

export type DatePrecision = 'YEAR' | 'MONTH' | 'DATE';

const GERMAN_MONTHS = [
  'Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni',
  'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.',
];

const GEDCOM_MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

export class AtheneDate {
  readonly rawString: string;
  readonly qualifiers: ReadonlySet<DateQualifier>;

  private readonly parsed: EdtfResult;

  private constructor(rawString: string, parsed: EdtfResult, qualifiers: Set<DateQualifier>) {
    this.rawString = rawString;
    this.parsed = parsed;
    this.qualifiers = qualifiers;
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  /**
   * Parse an EDTF string. Returns null if the string is not a valid date.
   * @param str  EDTF string (e.g. "1897~", "../1897", "1890/1897")
   * @param extraQualifiers  Vault-only qualifiers not encodable in EDTF
   *                         (CALCULATED, ESTIMATED) — read from frontmatter by caller
   */
  static parse(str: string, extraQualifiers: DateQualifier[] = []): AtheneDate | null {
    if (!str) return null;
    try {
      const parsed = edtf(str) as EdtfResult;
      const qualifiers = new Set<DateQualifier>(extraQualifiers);

      if (parsed.type === 'Date') {
        const d = parsed;
        if (d.approximate.value !== 0) qualifiers.add('APPROXIMATE');
        if (d.uncertain.value !== 0)   qualifiers.add('UNCERTAIN');
      } else {
        const iv = parsed;
        if (!isEdtfDate(iv.lower)) qualifiers.add('BEFORE');  // ../X → lower is Infinity
        if (!isEdtfDate(iv.upper)) qualifiers.add('AFTER');   // X/.. → upper is Infinity
      }

      return new AtheneDate(str, parsed, qualifiers);
    } catch {
      return null;
    }
  }

  // ── Qualifier helpers ────────────────────────────────────────────────────

  hasQualifier(q: DateQualifier): boolean {
    return this.qualifiers.has(q);
  }

  /** Returns a new AtheneDate with the additional qualifier applied (immutable). */
  withQualifier(q: DateQualifier): AtheneDate {
    const next = new Set(this.qualifiers);
    next.add(q);
    return new AtheneDate(this.rawString, this.parsed, next);
  }

  // ── Type guards ──────────────────────────────────────────────────────────

  get isInterval(): boolean {
    return this.parsed.type === 'Interval';
  }

  get precision(): DatePrecision | undefined {
    const p = this.parsed.precision;
    if (p === 1) return 'YEAR';
    if (p === 2) return 'MONTH';
    if (p === 3) return 'DATE';
    return undefined;
  }

  // ── Core date access ─────────────────────────────────────────────────────

  /**
   * The "anchor" date as ISO string truncated to precision (YYYY, YYYY-MM, YYYY-MM-DD).
   * For open intervals, returns the bounded end.
   */
  get isoDate(): string | undefined {
    const anchor = this.anchorDate();
    if (!anchor) return undefined;
    return anchor.edtf.slice(0, this.isoPrecisionLength());
  }

  private anchorDate(): EdtfDate | null {
    if (this.parsed.type === 'Interval') {
      const iv = this.parsed;
      // BEFORE (../X): upper is bounded; AFTER (X/..): lower is bounded; range: prefer lower
      const lower = isEdtfDate(iv.lower) ? iv.lower : null;
      const upper = isEdtfDate(iv.upper) ? iv.upper : null;
      return upper ?? lower;
    }
    return this.parsed;
  }

  private isoPrecisionLength(): number {
    switch (this.precision) {
      case 'DATE':  return 10;
      case 'MONTH': return 7;
      default:      return 4;
    }
  }

  // ── Sort key ─────────────────────────────────────────────────────────────

  /**
   * ISO-8601 sort key (always YYYY-MM-DD), adjusted by qualifiers.
   * CALCULATED/ESTIMATED/APPROXIMATE → middle of period.
   * AFTER → end of period. BEFORE → start.
   */
  toSortKey(): string | undefined {
    const anchor = this.anchorDate();
    if (!anchor) return undefined;

    const { year, month, day } = parseEdtfParts(anchor.edtf);
    // Guard against NaN (can happen if anchor.edtf contains unexpected content)
    if (!Number.isFinite(year)) return undefined;

    const offset = sortOffsetFor(this.qualifiers);
    if (offset === 0) {
      const ts = Date.UTC(year, month, day);
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : undefined;
    }

    let start: Date;
    let end: Date;

    if (this.precision === 'YEAR') {
      start = new Date(Date.UTC(year, 0, 1));
      end   = new Date(Date.UTC(year, 11, 31));
    } else if (this.precision === 'MONTH') {
      start = new Date(Date.UTC(year, month, 1));
      end   = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    } else {
      // Exact day — no range to offset within
      return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
    }

    const ms = start.getTime() + offset * (end.getTime() - start.getTime());
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
  }

  // ── Display ───────────────────────────────────────────────────────────────

  /** German display string: "23. Juni 1897", "ca. 1897", "vor 1897", "nach 1897" */
  toDisplay(): string {
    if (this.parsed.type === 'Interval') {
      const iv = this.parsed;
      const lower = isEdtfDate(iv.lower) ? iv.lower : null;
      const upper = isEdtfDate(iv.upper) ? iv.upper : null;
      if (!lower && upper)  return `vor ${this.formatDate(upper)}`;
      if (lower && !upper)  return `nach ${this.formatDate(lower)}`;
      if (lower && upper)   return `${this.formatDate(lower)}–${this.formatDate(upper)}`;
      return this.rawString;
    }

    const d = this.parsed;
    const prefix = this.hasQualifier('APPROXIMATE') ? 'ca. ' :
                   this.hasQualifier('CALCULATED')  ? 'ber. ' :
                   this.hasQualifier('ESTIMATED')   ? 'gesch. ' : '';
    // Show '?' only for plain uncertain — suppress when a stronger qualifier covers it
    const covered = this.hasQualifier('APPROXIMATE') ||
                    this.hasQualifier('CALCULATED') ||
                    this.hasQualifier('ESTIMATED');
    const suffix = this.hasQualifier('UNCERTAIN') && !covered ? '?' : '';
    return `${prefix}${this.formatDate(d)}${suffix}`;
  }

  private formatDate(d: EdtfDate): string {
    const { year, month, day } = parseEdtfParts(d.edtf);
    if (d.precision >= 3) return `${day}. ${GERMAN_MONTHS[month]} ${year}`;
    if (d.precision >= 2) return `${GERMAN_MONTHS[month]} ${year}`;
    return String(year);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /** Canonical EDTF string (as stored in vault). */
  toEdtfString(): string {
    return this.rawString;
  }

  /** GEDCOM 5.5.1 date phrase. */
  toGedcom55(): string {
    if (this.parsed.type === 'Interval') {
      const iv = this.parsed;
      const lower = isEdtfDate(iv.lower) ? iv.lower : null;
      const upper = isEdtfDate(iv.upper) ? iv.upper : null;
      if (!lower && upper) return `BEF ${this.gedcomDate55(upper)}`;
      if (lower && !upper) return `AFT ${this.gedcomDate55(lower)}`;
      if (lower && upper)  return `BET ${this.gedcomDate55(lower)} AND ${this.gedcomDate55(upper)}`;
    }

    const d = this.parsed as EdtfDate;
    const prefix = this.hasQualifier('CALCULATED')  ? 'CAL ' :
                   this.hasQualifier('ESTIMATED')   ? 'EST ' :
                   this.hasQualifier('APPROXIMATE') ? 'ABT ' :
                   this.hasQualifier('UNCERTAIN')   ? 'EST ' : '';
    return `${prefix}${this.gedcomDate55(d)}`;
  }

  private gedcomDate55(d: EdtfDate): string {
    const { year, month, day } = parseEdtfParts(d.edtf);
    if (d.precision >= 3) return `${day} ${GEDCOM_MONTHS[month]} ${year}`;
    if (d.precision >= 2) return `${GEDCOM_MONTHS[month]} ${year}`;
    return String(year);
  }

  /** GEDCOM 7 date phrase (nearly 1:1 EDTF for most vault values). */
  toGedcom7(): string {
    if (this.hasQualifier('CALCULATED')) return `CAL ${this.rawString.replace('?', '')}`;
    if (this.hasQualifier('ESTIMATED'))  return `EST ${this.rawString.replace('?', '')}`;
    return this.rawString;
  }

  // ── Age calculation ───────────────────────────────────────────────────────

  /**
   * Calculates the age between two dates as a human-readable string.
   * Both strings must be valid EDTF / ISO date strings (YYYY, YYYY-MM, or YYYY-MM-DD).
   * Uses the anchor date (isoDate) of each — qualifiers like ~ or ? do not shift the value here.
   *
   * @param birthDateStr ISO/EDTF string for birth date
   * @param eventDateStr ISO/EDTF string for the event date
   * @param qualifier Optional display qualifier: '~' prepends, '?' appends to the result
   * @returns "40" (years), "13m" (months < 24), "40d" (days < 62), or null if not computable
   */
  static calculateAge(birthDateStr: string, eventDateStr: string, qualifier?: string): string | null {
    const birth = AtheneDate.parse(birthDateStr);
    const event = AtheneDate.parse(eventDateStr);
    if (!birth || !event) return null;

    const birthIso = birth.isoDate;
    const eventIso = event.isoDate;
    if (!birthIso || !eventIso) return null;

    const toUTCDate = (iso: string): Date => {
      const padded = iso.length === 4 ? `${iso}-01-01` : iso.length === 7 ? `${iso}-01` : iso;
      return new Date(`${padded}T00:00:00Z`);
    };

    const birthDate = toUTCDate(birthIso);
    const eventDate = toUTCDate(eventIso);

    if (!Number.isFinite(birthDate.getTime()) || !Number.isFinite(eventDate.getTime())) return null;
    if (eventDate <= birthDate) return null;

    const diffMs = eventDate.getTime() - birthDate.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);

    let age: string;
    if (diffDays < 62) {
      age = `${diffDays}d`;
    } else {
      let months = (eventDate.getUTCFullYear() - birthDate.getUTCFullYear()) * 12
        + eventDate.getUTCMonth() - birthDate.getUTCMonth();
      if (eventDate.getUTCDate() < birthDate.getUTCDate()) months--;

      if (months < 24) {
        age = `${months}m`;
      } else {
        let years = eventDate.getUTCFullYear() - birthDate.getUTCFullYear();
        if (eventDate.getUTCMonth() < birthDate.getUTCMonth() ||
          (eventDate.getUTCMonth() === birthDate.getUTCMonth() &&
            eventDate.getUTCDate() < birthDate.getUTCDate())) {
          years--;
        }
        age = String(years);
      }
    }

    if (qualifier === '~') return `~${age}`;
    if (qualifier === '?') return `${age}?`;
    return age;
  }

  /** Legacy wikilink format "[[ISO-date|display]]" for backward compatibility. */
  toWikilink(): string {
    const iso = this.isoDate ?? this.rawString;
    return `[[${iso}|${this.toDisplay()}]]`;
  }

  toString(): string {
    return this.toDisplay();
  }
}
