/**
 * Pure validation helpers for DBS Control supplier master data and dates.
 * CPF/CNPJ are stored as digits only; formatted input is accepted.
 */
function allDigitsEqual(value: string): boolean {
  return /^([0-9])\1+$/.test(value);
}

function calculateCpfDigit(base: string): number {
  const sum = [...base].reduce((total, digit, index) => total + Number(digit) * (base.length + 1 - index), 0);
  const digit = (sum * 10) % 11;
  return digit === 10 ? 0 : digit;
}

function calculateCnpjDigit(base: string, weights: number[]): number {
  const sum = [...base].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function normalizeBrazilianTaxId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^[0-9./\-\s]+$/.test(raw)) {
    throw new Error("Informe apenas números e os separadores usuais no CPF/CNPJ.");
  }
  const digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error("Informe um CPF/CNPJ válido.");

  if (allDigitsEqual(digits)) {
    throw new Error("Informe um CPF/CNPJ válido.");
  }

  if (digits.length === 11) {
    const first = calculateCpfDigit(digits.slice(0, 9));
    const second = calculateCpfDigit(digits.slice(0, 9) + String(first));
    if (digits[9] !== String(first) || digits[10] !== String(second)) {
      throw new Error("Informe um CPF válido, com dígitos verificadores corretos.");
    }
    return digits;
  }

  if (digits.length === 14) {
    const first = calculateCnpjDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = calculateCnpjDigit(digits.slice(0, 12) + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (digits[12] !== String(first) || digits[13] !== String(second)) {
      throw new Error("Informe um CNPJ válido, com dígitos verificadores corretos.");
    }
    return digits;
  }

  throw new Error("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.");
}

export function isValidIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}
