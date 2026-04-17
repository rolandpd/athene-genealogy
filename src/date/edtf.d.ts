declare module 'edtf' {
  interface Bitmask {
    readonly value: number;
  }

  interface EdtfDate extends Date {
    readonly type: 'Date';
    /** 1 = year, 2 = month, 3 = day */
    readonly precision: number;
    /** Bitmask — always truthy; check .value !== 0 for approximate (~) */
    readonly approximate: Bitmask;
    /** Bitmask — always truthy; check .value !== 0 for uncertain (?) */
    readonly uncertain: Bitmask;
    readonly edtf: string;
  }

  interface EdtfInterval {
    readonly type: 'Interval';
    /** null = open start (../X) */
    readonly lower: EdtfDate | null;
    /** null = open end (X/..) */
    readonly upper: EdtfDate | null;
    readonly precision: number;
  }

  type EdtfResult = EdtfDate | EdtfInterval;

  function edtf(str: string): EdtfResult;
  export = edtf;
}
