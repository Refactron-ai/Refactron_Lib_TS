// Neutral helpers used by tests. No legacy patterns.

export function repeat(str: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += str;
  }
  return out;
}
