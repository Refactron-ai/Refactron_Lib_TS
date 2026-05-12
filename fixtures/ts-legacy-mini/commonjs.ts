// Legacy CommonJS interop: `require` + `module.exports`.
// Target transform: ES module import/export.

const path = require('path');

module.exports = {
  join: (a, b) => path.join(a, b),
};
