// f06.ts — multi-decl single statement: `var a = 1, b = 2;`.
// Per-binding semantics: split status is acceptable; for grading we
// treat the statement as reflecting the *strictest* binding's needs.
// All bindings here are single-assigned -> const.

export function pair(): [number, number] {
  var a = 1, b = 2;
  return [a, b];
}

export function trio(): [string, string, string] {
  var x = 'a', y = 'b', z = 'c';
  return [x, y, z];
}

export function lengths(items: string[]): number {
  var total = 0, longest = 0;
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].length;
    if (items[i].length > longest) {
      longest = items[i].length;
    }
  }
  return total + longest;
}

export function firstTwo(values: number[]): [number, number] {
  var first = values[0], second = values[1];
  return [first, second];
}

export function describe(name: string, role: string): string {
  var label = 'person', sep = ': ';
  return label + sep + name + sep + role;
}

export function counters(): number {
  var a = 0, b = 0, c = 0;
  for (var i = 0; i < 5; i++) {
    a = a + 1;
    b = b + 2;
    c = c + 3;
  }
  return a + b + c;
}
