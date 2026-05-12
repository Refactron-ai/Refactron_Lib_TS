// Legacy `new Promise` wrapper around setTimeout. Single resolve path.
// Target transform: util.promisify / async helper.

export function delayedValue(value, ms) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
