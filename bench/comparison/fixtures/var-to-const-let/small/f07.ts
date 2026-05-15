// f07.ts — vars used inside conditionals. Some are reassigned only in one branch
// (still let), some are conditionally initialized but never reassigned (const).

export function classify(n: number): string {
  var label: string;
  if (n > 0) {
    label = 'positive';
  } else if (n < 0) {
    label = 'negative';
  } else {
    label = 'zero';
  }
  return label;
}

export function maybeBoost(x: number, boost: boolean): number {
  var result = x;
  if (boost) {
    result = result * 2;
  }
  return result;
}

export function piecewise(x: number): number {
  var out = 0;
  if (x < 0) {
    out = -x;
  } else if (x > 100) {
    out = 100;
  } else {
    out = x;
  }
  return out;
}

export function tag(name: string, important: boolean): string {
  var prefix = important ? '[!]' : '[ ]';
  var suffix = '.';
  return prefix + name + suffix;
}

export function clamp(x: number, lo: number, hi: number): number {
  var v = x;
  if (v < lo) {
    v = lo;
  }
  if (v > hi) {
    v = hi;
  }
  return v;
}

export function inferKind(n: number): string {
  var kind = 'unknown';
  switch (n % 3) {
    case 0:
      kind = 'three';
      break;
    case 1:
      kind = 'one';
      break;
    default:
      kind = 'two';
  }
  return kind;
}
