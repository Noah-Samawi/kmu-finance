import { ALLOWED_VAT_RATES } from "@/domain/invoice";
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
  const extra = value !== undefined ? { value } : { defaultValue: defaultValue ?? (allowEmpty ? "" : 700) };
  return (
    <select
      name={name}
      disabled={disabled}
      className={className ?? `${inputCls} min-w-[8rem]`}
      {...extra}
      onChange={onChange ? (e) => onChange(Number(e.target.value)) : undefined}
    >
      {allowEmpty && <option value="">–</option>}
      {ALLOWED_VAT_RATES.map((bp) => (
        <option key={bp} value={bp}>{bp / 100} %</option>
      ))}
    </select>
  );
}
