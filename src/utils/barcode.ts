// Generate EAN-13 check digit
function ean13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(first12[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check.toString();
}

// Generate unique EAN-13 barcode
// Format: 200 (internal prefix) + 0000 (company) + 5-digit sequence + check digit
export function generateEAN13(sequenceNum: number): string {
  const prefix = '2000000'; // 200 + 0000
  const seq = sequenceNum.toString().padStart(5, '0');
  const first12 = prefix + seq;
  return first12 + ean13CheckDigit(first12);
}

// Validate EAN-13 format
export function isValidEAN13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const first12 = code.substring(0, 12);
  return code[12] === ean13CheckDigit(first12);
}
