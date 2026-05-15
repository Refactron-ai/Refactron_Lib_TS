// f05.ts — for-loop bindings; var in for-init is reassigned by the loop step.
// Expected: every for-init `var` becomes `let`.

export function sumRange(start: number, end: number): number {
  var total = 0;
  for (var i = start; i < end; i++) {
    total = total + i;
  }
  return total;
}

export function product(values: number[]): number {
  var p = 1;
  for (var idx = 0; idx < values.length; idx++) {
    p = p * values[idx];
  }
  return p;
}

export function copyArray(src: number[]): number[] {
  var out: number[] = [];
  for (var k = 0; k < src.length; k++) {
    out.push(src[k]);
  }
  return out;
}

export function diagonal(rows: number, cols: number): number {
  var hits = 0;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      if (r === c) {
        hits = hits + 1;
      }
    }
  }
  return hits;
}

export function firstMatch(values: number[], target: number): number {
  var found = -1;
  for (var n = 0; n < values.length; n++) {
    if (values[n] === target) {
      found = n;
      break;
    }
  }
  return found;
}

export function reverseInto(values: number[]): number[] {
  var out: number[] = [];
  for (var p = values.length - 1; p >= 0; p--) {
    out.push(values[p]);
  }
  return out;
}
