function ean13CheckDigit(first12: string): string {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index]) * (index % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

export function generateEAN13(sequenceNum: number): string {
  const prefix = '2000000';
  const seq = String(sequenceNum).padStart(5, '0');
  const first12 = `${prefix}${seq}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

export function isValidEAN13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return code[12] === ean13CheckDigit(code.slice(0, 12));
}

const lPatterns = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const gPatterns = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const rPatterns = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const firstDigitPatterns = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function encodeEAN13Bars(code: string, barWidth = 1.4): { bars: Array<{ x: number; w: number }>; totalWidth: number } {
  if (!isValidEAN13(code)) return { bars: [], totalWidth: 0 };

  const digits = code.split('').map(Number);
  const firstDigit = digits[0];
  const pattern = firstDigitPatterns[firstDigit];

  let binary = '101';
  for (let index = 0; index < 6; index += 1) {
    const digit = digits[index + 1];
    binary += pattern[index] === 'L' ? lPatterns[digit] : gPatterns[digit];
  }

  binary += '01010';

  for (let index = 0; index < 6; index += 1) {
    binary += rPatterns[digits[index + 7]];
  }

  binary += '101';

  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 0;
  while (cursor < binary.length) {
    if (binary[cursor] === '1') {
      const start = cursor;
      while (cursor < binary.length && binary[cursor] === '1') {
        cursor += 1;
      }
      bars.push({ x: start * barWidth, w: (cursor - start) * barWidth });
    } else {
      cursor += 1;
    }
  }

  return { bars, totalWidth: binary.length * barWidth };
}
