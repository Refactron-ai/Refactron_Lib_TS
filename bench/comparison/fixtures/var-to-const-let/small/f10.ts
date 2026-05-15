// f10.ts — broad mix: const-with-mutation (object/array reference unchanged but
// content mutated), increment/decrement (++ counts as reassignment -> let),
// destructuring-style assignments via individual statements.

export function buildList(n: number): number[] {
  var list: number[] = [];
  for (var i = 0; i < n; i++) {
    list.push(i * 2);
  }
  return list;
}

export function buildMap(keys: string[]): Record<string, number> {
  var map: Record<string, number> = {};
  for (var idx = 0; idx < keys.length; idx++) {
    map[keys[idx]] = idx;
  }
  return map;
}

export function tickUp(n: number): number {
  var c = 0;
  for (var i = 0; i < n; i++) {
    c++;
  }
  return c;
}

export function tickDown(n: number): number {
  var c = n;
  while (c > 0) {
    c--;
  }
  return c;
}

export function compoundAssign(n: number): number {
  var total = 0;
  for (var i = 0; i < n; i++) {
    total += i;
  }
  return total;
}

export function chained(): number {
  var x = 1;
  var y = 2;
  var z = x + y;
  return z;
}

export function bigArr(n: number): number[] {
  var arr: number[] = new Array(n);
  for (var i = 0; i < n; i++) {
    arr[i] = i;
  }
  return arr;
}

export function untouchedConfig(): { name: string; size: number } {
  var cfg = { name: 'fixture', size: 10 };
  return cfg;
}

export function mutateInPlace(): number[] {
  var pile: number[] = [];
  pile.push(1);
  pile.push(2);
  pile.push(3);
  return pile;
}

export function loopUpdate(values: number[]): number {
  var s = 0;
  for (var i = 0; i < values.length; i++) {
    s = s + values[i];
  }
  return s;
}
