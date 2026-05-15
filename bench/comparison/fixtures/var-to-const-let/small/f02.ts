// f02.ts — clearly-let candidates: every var is reassigned in a loop or branch.

export function sumTo(n: number): number {
  // total reassigned in loop, i reassigned by for-step.
  var total = 0;
  for (var i = 1; i <= n; i++) {
    total = total + i;
  }
  return total;
}

export function countdown(n: number): number[] {
  // out is the array reference (never reassigned -> const).
  // current is reassigned each iteration -> let.
  var out: number[] = [];
  var current = n;
  while (current > 0) {
    out.push(current);
    current = current - 1;
  }
  return out;
}

export function maxOf(values: number[]): number {
  var best = -Infinity;
  var idx = 0;
  while (idx < values.length) {
    if (values[idx] > best) {
      best = values[idx];
    }
    idx = idx + 1;
  }
  return best;
}

export function joinWith(parts: string[], sep: string): string {
  var acc = '';
  var k = 0;
  while (k < parts.length) {
    if (k > 0) {
      acc = acc + sep;
    }
    acc = acc + parts[k];
    k = k + 1;
  }
  return acc;
}

export function flipFlop(n: number): boolean {
  var on = false;
  var step = 0;
  while (step < n) {
    on = !on;
    step = step + 1;
  }
  return on;
}

export function lastNonZero(values: number[]): number {
  var hit = 0;
  var p = 0;
  while (p < values.length) {
    if (values[p] !== 0) {
      hit = values[p];
    }
    p = p + 1;
  }
  return hit;
}
