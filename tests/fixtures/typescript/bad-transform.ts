// tests/fixtures/typescript/bad-transform.ts
// KNOWN-BAD: renaming this export changes public API — behavior change for callers

export function processPayment(amount: number): { success: boolean; transactionId: string } {
  // if this return structure changes, downstream callers break
  return {
    success: amount > 0,
    transactionId: `txn-${Date.now()}`,
  };
}
