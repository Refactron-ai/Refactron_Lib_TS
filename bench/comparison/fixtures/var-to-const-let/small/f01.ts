// f01.ts — straightforward const candidates: each var is assigned once and read.
// Expected: every var becomes const.

export function add(a: number, b: number): number {
  var sum = a + b;
  return sum;
}

export function greet(name: string): string {
  var prefix = 'Hello, ';
  var suffix = '!';
  return prefix + name + suffix;
}

export function pickFirst<T>(items: T[]): T | undefined {
  var head = items[0];
  return head;
}

export function buildPair(a: number, b: number): [number, number] {
  var first = a;
  var second = b;
  return [first, second];
}

export function describe(x: number): string {
  var label = 'value';
  var sep = '=';
  var rendered = label + sep + String(x);
  return rendered;
}

export function double(x: number): number {
  var doubled = x * 2;
  return doubled;
}

export function triangle(n: number): number {
  var tri = (n * (n + 1)) / 2;
  return tri;
}

export function mid(a: number, b: number): number {
  var avg = (a + b) / 2;
  return avg;
}

export function repeat(s: string, n: number): string {
  var out = s.repeat(n);
  return out;
}

export function tagged(): string {
  var tag = '[fixture]';
  return tag;
}
