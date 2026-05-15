// f04.ts — vars in nested function scopes; same name reused at outer & inner levels.
// The two `tmp` variables are independent: outer `tmp` is reassigned (let),
// inner `tmp` is not (const).

export function nestedScope(n: number): number {
  var tmp = 0;
  for (var i = 0; i < n; i++) {
    tmp = tmp + i;
  }
  function inner(x: number): number {
    var tmp = x * 3;
    return tmp;
  }
  return tmp + inner(n);
}

export function outerThenInner(): string {
  var tag = 'outer';
  function build() {
    var tag = 'inner';
    return tag;
  }
  return tag + '+' + build();
}

export function counterPair(n: number): [number, number] {
  var a = 0;
  var b = 0;
  for (var i = 0; i < n; i++) {
    a = a + 1;
    b = b + 2;
  }
  return [a, b];
}

export function shadowConst(): number {
  var v = 10;
  function leaf() {
    var v = 99;
    return v;
  }
  return v + leaf();
}

export function paramShadow(x: number): number {
  var x2 = x * x;
  function helper(x: number): number {
    var doubled = x + x;
    return doubled;
  }
  return x2 + helper(x);
}
