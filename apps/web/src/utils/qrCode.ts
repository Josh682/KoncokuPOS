/**
 * Lightweight, self-contained QR Code Generator (Byte Mode, ECC Level M)
 * 0 external dependencies, 100% offline and browser/node compatible.
 */

// Galois Field GF(256) tables for QR Reed-Solomon
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 256) {
      x ^= 0x11d; // Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
    }
  }
  EXP_TABLE[255] = EXP_TABLE[0]!;
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a]! + LOG_TABLE[b]!) % 255]!;
}

function polyMultiply(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const result = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j]! ^= gfMultiply(p1[i]!, p2[j]!);
    }
  }
  return result;
}

function getGeneratorPoly(degree: number): Uint8Array {
  let g = new Uint8Array([1]) as Uint8Array;
  for (let i = 0; i < degree; i++) {
    g = polyMultiply(g, new Uint8Array([1, EXP_TABLE[i]!]));
  }
  return g;
}

function calculateEcc(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = getGeneratorPoly(eccCount);
  const info = new Uint8Array(data.length + eccCount);
  info.set(data, 0);

  for (let i = 0; i < data.length; i++) {
    const coef = info[i]!;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        info[i + j]! ^= gfMultiply(gen[j]!, coef);
      }
    }
  }
  return info.subarray(data.length);
}

// Versions 1 to 5 data & ecc capacities for Level M
interface VersionSpec {
  version: number;
  dataCapacityBytes: number;
  eccPerBlock: number;
  totalBlocks: number;
  alignmentPatternCenters: number[];
}

const VERSION_SPECS: VersionSpec[] = [
  { version: 1, dataCapacityBytes: 16, eccPerBlock: 10, totalBlocks: 1, alignmentPatternCenters: [] },
  { version: 2, dataCapacityBytes: 28, eccPerBlock: 16, totalBlocks: 1, alignmentPatternCenters: [6, 18] },
  { version: 3, dataCapacityBytes: 44, eccPerBlock: 26, totalBlocks: 1, alignmentPatternCenters: [6, 22] },
  { version: 4, dataCapacityBytes: 64, eccPerBlock: 18, totalBlocks: 2, alignmentPatternCenters: [6, 26] },
  { version: 5, dataCapacityBytes: 86, eccPerBlock: 24, totalBlocks: 2, alignmentPatternCenters: [6, 30] },
];

/**
 * Generate 2D boolean grid for QR code
 */
export function generateQrMatrix(text: string): boolean[][] {
  const utf8Data = new TextEncoder().encode(text);

  // Find smallest version that fits
  let spec = VERSION_SPECS.find((s) => s.dataCapacityBytes >= utf8Data.length + 3);
  if (!spec) {
    spec = VERSION_SPECS[VERSION_SPECS.length - 1]!;
  }

  const { version, dataCapacityBytes, eccPerBlock, totalBlocks, alignmentPatternCenters } = spec;
  const size = 17 + 4 * version;

  // 1. Bit Buffer: Mode (8-bit Byte: 0100) + Char Count (8 bits) + Data + Terminator + Padding
  const bitArray: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitArray.push((val >>> i) & 1);
    }
  }

  pushBits(0b0100, 4); // Byte mode
  pushBits(utf8Data.length, 8); // 8-bit character count indicator for v1-9
  for (const byte of utf8Data) {
    pushBits(byte, 8);
  }

  // Terminator
  const maxBits = dataCapacityBytes * 8;
  const termLen = Math.min(4, maxBits - bitArray.length);
  pushBits(0, termLen);

  // Byte align
  while (bitArray.length % 8 !== 0) {
    bitArray.push(0);
  }

  // Pad bytes: 0xEC, 0x11
  let padToggle = false;
  while (bitArray.length < maxBits) {
    pushBits(padToggle ? 0x11 : 0xec, 8);
    padToggle = !padToggle;
  }

  // Convert bits to data bytes
  const dataBytes = new Uint8Array(dataCapacityBytes);
  for (let i = 0; i < dataCapacityBytes; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bitArray[i * 8 + j]!;
    }
    dataBytes[i] = b;
  }

  // Split into blocks and generate ECC
  const blockSize = Math.floor(dataCapacityBytes / totalBlocks);
  const allBlocksData: Uint8Array[] = [];
  const allBlocksEcc: Uint8Array[] = [];

  for (let b = 0; b < totalBlocks; b++) {
    const start = b * blockSize;
    const end = b === totalBlocks - 1 ? dataCapacityBytes : (b + 1) * blockSize;
    const blockData = dataBytes.subarray(start, end);
    allBlocksData.push(blockData);
    allBlocksEcc.push(calculateEcc(blockData, eccPerBlock));
  }

  // Interleave data and ECC codewords
  const interleaved: number[] = [];
  const maxBlockLen = Math.max(...allBlocksData.map((d) => d.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (i < allBlocksData[b]!.length) {
        interleaved.push(allBlocksData[b]![i]!);
      }
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      interleaved.push(allBlocksEcc[b]![i]!);
    }
  }

  // Convert interleaved bytes into bits
  const finalBits: number[] = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((byte >>> i) & 1);
    }
  }

  // 2. Initialize Matrix (null = unassigned)
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );

  // 3. Finder Patterns (7x7) + Separators
  function placeFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r;
        const mc = col + c;
        if (mr >= 0 && mr < size && mc >= 0 && mc < size) {
          const isBlack =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          matrix[mr]![mc] = isBlack;
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 4. Alignment Patterns (for version >= 2)
  if (alignmentPatternCenters.length >= 2) {
    for (const ar of alignmentPatternCenters) {
      for (const ac of alignmentPatternCenters) {
        // Skip finders
        if (
          (ar === 6 && ac === 6) ||
          (ar === 6 && ac === alignmentPatternCenters[alignmentPatternCenters.length - 1]) ||
          (ar === alignmentPatternCenters[alignmentPatternCenters.length - 1] && ac === 6)
        ) {
          continue;
        }
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isBlack = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            matrix[ar + r]![ac + c] = isBlack;
          }
        }
      }
    }
  }

  // 5. Timing Patterns (Row 6 & Col 6)
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6]![i] === null) {
      matrix[6]![i] = i % 2 === 0;
    }
    if (matrix[i]![6] === null) {
      matrix[i]![6] = i % 2 === 0;
    }
  }

  // Dark module
  matrix[4 * version + 9]![8] = true;

  // Reserve format areas
  for (let i = 0; i < 9; i++) {
    if (matrix[8]![i] === null) matrix[8]![i] = false;
    if (matrix[i]![8] === null) matrix[i]![8] = false;
  }
  for (let i = size - 8; i < size; i++) {
    if (matrix[8]![i] === null) matrix[8]![i] = false;
  }
  for (let i = size - 7; i < size; i++) {
    if (matrix[i]![8] === null) matrix[i]![8] = false;
  }

  // 6. Data Placement in zigzag columns
  let bitIdx = 0;
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const left = right - 1;

    for (let step = 0; step < size; step++) {
      const r = upwards ? size - 1 - step : step;
      for (const c of [right, left]) {
        if (matrix[r]![c] === null) {
          let bit = false;
          if (bitIdx < finalBits.length) {
            bit = finalBits[bitIdx] === 1;
            bitIdx++;
          }
          // Mask Pattern 0: (row + col) % 2 === 0
          if ((r + c) % 2 === 0) {
            bit = !bit;
          }
          matrix[r]![c] = bit;
        }
      }
    }
    upwards = !upwards;
  }

  // 7. Write Format Information (ECC M, Mask 0: bits 101010000010010)
  // standard format info for M / Mask 0:
  // Place on row 8 & col 8:
  const actualFormat = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  for (let i = 0; i < 6; i++) matrix[8]![i] = actualFormat[i] === 1;
  matrix[8]![7] = actualFormat[6] === 1;
  matrix[8]![8] = actualFormat[7] === 1;
  matrix[7]![8] = actualFormat[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i]![8] = actualFormat[i] === 1;

  for (let i = 0; i < 8; i++) matrix[8]![size - 1 - i] = actualFormat[i] === 1;
  for (let i = 8; i < 15; i++) matrix[size - 15 + i]![8] = actualFormat[i] === 1;

  return matrix as boolean[][];
}
