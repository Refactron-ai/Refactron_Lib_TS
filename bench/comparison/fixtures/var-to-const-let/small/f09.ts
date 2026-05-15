// f09.ts — vars in try/catch and async-ish settings (no actual await; pure sync).

export function trySafe(input: string): string {
  var parsed = '';
  try {
    var raw = JSON.parse(input);
    parsed = String(raw);
  } catch {
    parsed = 'invalid';
  }
  return parsed;
}

export function counted(values: number[]): number {
  var seen = 0;
  for (var v of values) {
    seen = seen + 1;
  }
  return seen;
}

export function gather(values: number[]): number[] {
  var collected: number[] = [];
  for (var v of values) {
    collected.push(v);
  }
  return collected;
}

export function partition(values: number[]): { lows: number[]; highs: number[] } {
  var lows: number[] = [];
  var highs: number[] = [];
  for (var v of values) {
    if (v < 50) {
      lows.push(v);
    } else {
      highs.push(v);
    }
  }
  return { lows: lows, highs: highs };
}

export function maxThrice(values: number[]): number {
  var best = -Infinity;
  for (var pass = 0; pass < 3; pass++) {
    for (var n of values) {
      if (n > best) {
        best = n;
      }
    }
  }
  return best;
}

export function safeDivide(a: number, b: number): number {
  var result = 0;
  try {
    if (b === 0) {
      throw new Error('div0');
    }
    result = a / b;
  } catch {
    result = 0;
  }
  return result;
}
