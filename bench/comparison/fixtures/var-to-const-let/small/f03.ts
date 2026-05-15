// f03.ts — mixed file: roughly half const candidates, half let.

export function compute(n: number): number {
  var base = 10;
  var multiplier = 2;
  var acc = 0;
  for (var i = 0; i < n; i++) {
    acc = acc + base * multiplier;
  }
  return acc;
}

export function formatLine(name: string, age: number): string {
  var sep = ' / ';
  var label = 'person';
  var line = label + sep + name + sep + String(age);
  return line;
}

export function bumpUntil(start: number, max: number): number {
  var v = start;
  var step = 1;
  while (v < max) {
    v = v + step;
  }
  return v;
}

export function listOdd(limit: number): number[] {
  var collected: number[] = [];
  var start = 1;
  for (var x = start; x < limit; x += 2) {
    collected.push(x);
  }
  return collected;
}

export function nameWith(prefix: string, who: string): string {
  var glue = '-';
  var built = prefix + glue + who;
  return built;
}

export function shrink(n: number): number {
  var size = n;
  while (size > 1) {
    size = Math.floor(size / 2);
  }
  return size;
}
