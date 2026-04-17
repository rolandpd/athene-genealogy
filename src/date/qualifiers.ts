/**
 * Semantic qualifiers for AtheneDate.
 *
 * APPROXIMATE, UNCERTAIN, BEFORE, AFTER are derived from the EDTF string itself.
 * CALCULATED and ESTIMATED are vault-specific annotations (not representable in EDTF)
 * and must be stored separately (e.g. as a frontmatter field).
 */
export type DateQualifier =
  | 'APPROXIMATE'  // EDTF: ~   — ca./ungefähr
  | 'UNCERTAIN'    // EDTF: ?   — unsicher/fraglich
  | 'CALCULATED'   // GEDCOM: CAL — aus anderen Daten berechnet (z.B. Einschulung aus Geburtsjahr)
  | 'ESTIMATED'    // GEDCOM: EST — geschätzt aus Kontext (z.B. Alter aus Zensus)
  | 'BEFORE'       // EDTF: ../X  — vor dem Datum
  | 'AFTER';       // EDTF: X/..  — nach dem Datum

/**
 * How qualifiers affect sort position within an uncertain time range.
 * Returns a fraction [0..1] of the period to use as sort offset.
 */
export function sortOffsetFor(qualifiers: ReadonlySet<DateQualifier>): number {
  if (qualifiers.has('AFTER'))  return 1.0;  // conservative: end of period
  if (qualifiers.has('BEFORE')) return 0.0;  // conservative: start of period
  if (qualifiers.has('CALCULATED') || qualifiers.has('ESTIMATED')) return 0.5;
  if (qualifiers.has('APPROXIMATE')) return 0.5;
  return 0.0;  // exact or uncertain — start of period (legacy behaviour)
}
