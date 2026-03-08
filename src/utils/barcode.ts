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

// ─── EAN-13 Encoding for SVG rendering ───

// L-code (odd parity) patterns for digits 0-9
const L_PATTERNS = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
// G-code (even parity) patterns for digits 0-9
const G_PATTERNS = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
// R-code patterns for digits 0-9
const R_PATTERNS = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
// First digit determines L/G pattern for left group
const FIRST_DIGIT_PATTERNS = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/**
 * Encode EAN-13 string into binary bar pattern (1=black, 0=white).
 * Returns array of { x, width } for each black bar, ready for SVG rendering.
 */
export function encodeEAN13Bars(code: string, barWidth = 1.5): { bars: { x: number; w: number }[]; totalWidth: number } {
  if (!/^\d{13}$/.test(code)) return { bars: [], totalWidth: 0 };

  const digits = code.split('').map(Number);
  const firstDigit = digits[0];
  const pattern = FIRST_DIGIT_PATTERNS[firstDigit];

  // Build binary string
  let binary = '101'; // start guard

  // Left group (digits 1-6)
  for (let i = 0; i < 6; i++) {
    const d = digits[i + 1];
    binary += pattern[i] === 'L' ? L_PATTERNS[d] : G_PATTERNS[d];
  }

  binary += '01010'; // center guard

  // Right group (digits 7-12)
  for (let i = 0; i < 6; i++) {
    binary += R_PATTERNS[digits[i + 7]];
  }

  binary += '101'; // end guard

  // Convert binary string to bar positions
  const bars: { x: number; w: number }[] = [];
  let i = 0;
  while (i < binary.length) {
    if (binary[i] === '1') {
      const start = i;
      while (i < binary.length && binary[i] === '1') i++;
      bars.push({ x: start * barWidth, w: (i - start) * barWidth });
    } else {
      i++;
    }
  }

  return { bars, totalWidth: binary.length * barWidth };
}
