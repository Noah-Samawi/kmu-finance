import { ALLOWED_VAT_RATES, COMMON_VAT_RATES } from "@/domain/invoice";
import { inputCls } from "./ui";

export function VatSelect({
  name, value, defaultValue, onChange, disabled, allowEmpty, className,
}: {
  name?: string;
  value?: number | "";
  defaultValue?: number | "";
  onChange?: (bp: number) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  className?: string;
}) {
  const extra = value !== undefined
    ? { value: value === "" ? "" : String(value) }
    : { defaultValue: defaultValue === undefined ? (allowEmpty ? "" : "700") : defaultValue === "" ? "" : String(defaultValue) };
  return (
    <select
      name={name}
      disabled={disabled}
      className={className ?? `${inputCls} min-w-[9rem]`}
      {...extra}
      onChange={onChange ? (e) => onChange(Number(e.target.value)) : undefined}
    >
      {allowEmpty && <option value="">–</option>}
      <optgroup label="Häufig">
        {COMMON_VAT_RATES.map((bp) => (
          <option key={`c-${bp}`} value={String(bp)}>{bp / 100} %</option>
        ))}
      </optgroup>
      <optgroup label="0 % bis 20 %">
        {ALLOWED_VAT_RATES.map((bp) => (
          <option key={bp} value={String(bp)}>{bp / 100} %</option>
        ))}
      </optgroup>
    </select>
  );
}
