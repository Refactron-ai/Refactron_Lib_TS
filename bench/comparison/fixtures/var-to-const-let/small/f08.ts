// f08.ts — hoisting / TDZ-ish edge case.
// `temp` is referenced before its declaration line via the `init` function.
// Under `var` hoisting, this is legal (returns undefined).
// Converting it to `let` keeps the *same* observable behavior because `init` is
// only *called* after `temp = 5`. Converting to `const` is OK too since `temp`
// is never reassigned. We mark expected as "const" for the strictly-correct
// rewrite. A safety-conscious tool may skip it; we accept "skip" as well.

export function hoistDemo(): number {
  function init(): number {
    return temp;
  }
  var temp = 5;
  return init();
}

// `usedBeforeDecl` is referenced lexically before its declaration AND read
// before the assignment runs. Converting to const/let here would change
// behavior (TDZ ReferenceError). A safe tool should skip.
export function tdzTrap(): number | undefined {
  var probe = (function () {
    return typeof usedBeforeDecl;
  })();
  // probe captures 'undefined' under var hoisting; under let it would throw.
  var usedBeforeDecl = 10;
  return probe.length;
}

// Reassignment that happens via `arguments.callee`-like late binding. The
// outer var `accum` is reassigned inside the IIFE — let.
export function lateReassign(n: number): number {
  var accum = 0;
  (function () {
    accum = n * 2;
  })();
  return accum;
}

// Vanilla const candidate sharing the file with the trickier cases above.
export function plain(n: number): number {
  var doubled = n * 2;
  return doubled;
}

// var declared inside a block (still function-scoped under var rules).
export function blockedVar(n: number): number {
  if (n > 0) {
    var inner = n + 1;
    return inner;
  }
  return 0;
}
