// Legacy var-style declarations. The first reassigns inside a loop (-> let),
// the second is never reassigned (-> const).

export function sumTo(n) {
  var counter = 0;
  for (var i = 1; i <= n; i++) {
    counter = counter + i;
  }
  return counter;
}

export function makeGreeting(name) {
  var greeting = 'hi';
  return greeting + ', ' + name;
}
