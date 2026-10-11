import { roundHalfAway } from "./money";

export type ChurchTax = "NONE" | "EIGHT" | "NINE";

/** Vereinfachte Lohnabrechnung nach deutschem Recht (SV-Sätze 2026, ESt-Tarif 2025 als Näherung). */
export interface PayrollInput {
  grossCents: number;
  taxClass: number;
  childAllowances: number;
  churchTax: ChurchTax;
  kvAdditionalBp: number;
}

export interface PayrollResult {
  grossCents: number;
  taxGrossCents: number;
  svGrossCents: number;
  rvCents: number;
  avCents: number;
  kvCents: number;
  pvCents: number;
  rvAgCents: number;
  avAgCents: number;
  kvAgCents: number;
  pvAgCents: number;
  wageTaxCents: number;
  soliCents: number;
  churchTaxCents: number;
  taxDeductionCents: number;
  svDeductionCents: number;
  netCents: number;
  payoutCents: number;
  employerSvCents: number;
  employerCostCents: number;
}

/** Brutto in Cent = Arbeitsstunden × Stundenlohn (Cent/Std.). */
export function monthlyGrossFromHours(hours: number, hourlyRateCents: number): number {
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isInteger(hourlyRateCents) || hourlyRateCents <= 0) return 0;
  return Math.round(hours * hourlyRateCents);
}

const RV_BP = 930;
const AV_BP = 130;
const KV_BASE_BP = 730;
const PV_BP = 180;
const BBG_RV_MONTH = 8_050_00;
const BBG_KV_MONTH = 5_512_50;

function bpOf(cents: number, bp: number) {
  return roundHalfAway((cents * bp) / 10_000);
}

/** ESt-Grundtabelle 2025 (Jahresbetrag in Euro), näherungsweise. */
function annualIncomeTaxEuro(zvEuro: number): number {
  const x = Math.max(0, zvEuro);
  if (x <= 12096) return 0;
  if (x <= 17443) {
    const y = (x - 12096) / 10000;
    return Math.floor((922.98 * y + 1400) * y);
  }
  if (x <= 68480) {
    const y = (x - 17443) / 10000;
    return Math.floor((181.19 * y + 2397) * y + 1025.38);
  }
  if (x <= 277825) return Math.floor(0.42 * x - 10911.92);
  return Math.floor(0.45 * x - 19246.67);
}

export function calculatePayslip(input: PayrollInput): PayrollResult {
  const gross = Math.max(0, Math.round(input.grossCents));
  const rvBase = Math.min(gross, BBG_RV_MONTH);
  const kvBase = Math.min(gross, BBG_KV_MONTH);
  const extra = Math.max(0, input.kvAdditionalBp);
  const extraAn = Math.round(extra / 2);
  const extraAg = extra - extraAn;
  const rvCents = bpOf(rvBase, RV_BP);
  const avCents = bpOf(rvBase, AV_BP);
  const kvCents = bpOf(kvBase, KV_BASE_BP + extraAn);
  const pvCents = bpOf(kvBase, PV_BP);
  const rvAgCents = rvCents;
  const avAgCents = avCents;
  const kvAgCents = bpOf(kvBase, KV_BASE_BP + extraAg);
  const pvAgCents = pvCents;
  const svEmployee = rvCents + avCents + kvCents + pvCents;

  const annualGross = (gross * 12) / 100;
  const childRelief = Math.max(0, input.childAllowances) * 2604;
  const classFactor = input.taxClass === 1 || input.taxClass === 4 ? 1 : input.taxClass === 3 ? 0.55 : input.taxClass === 5 ? 1.35 : 1;
  const zv = Math.max(0, annualGross - childRelief) * classFactor;
  const annualTax = annualIncomeTaxEuro(zv);
  const wageTaxCents = Math.max(0, roundHalfAway((annualTax / 12) * 100));
  const soliCents = wageTaxCents * 12 > 1813800 ? roundHalfAway(wageTaxCents * 0.055) : 0;
  // Nur bei ausdrücklicher Konfession; alles andere (NONE, leer, unbekannt) = 0 % Kirchensteuer
  const churchRate = input.churchTax === "NINE" ? 900 : input.churchTax === "EIGHT" ? 800 : 0;
  const churchTaxCents = churchRate ? bpOf(wageTaxCents, churchRate) : 0;
  const taxDeductionCents = wageTaxCents + soliCents + churchTaxCents;
  const netCents = Math.max(0, gross - svEmployee - taxDeductionCents);
  const employerSvCents = rvAgCents + avAgCents + kvAgCents + pvAgCents;
  return {
    grossCents: gross,
    taxGrossCents: gross,
    svGrossCents: kvBase,
    rvCents, avCents, kvCents, pvCents,
    rvAgCents, avAgCents, kvAgCents, pvAgCents,
    wageTaxCents, soliCents, churchTaxCents,
    taxDeductionCents, svDeductionCents: svEmployee,
    netCents, payoutCents: netCents,
    employerSvCents, employerCostCents: gross + employerSvCents,
  };
}
