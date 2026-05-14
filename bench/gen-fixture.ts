// bench/gen-fixture.ts
// Synthetic fixture generator for the Week 7 perf bench. Produces a directory
// tree of mixed Python + TypeScript files at a target line count, sprinkled
// with one of each Refactron transform pattern so `analyze` finds work to do.
//
// Usage:
//   tsx bench/gen-fixture.ts <target-loc> <out-dir>
//   node --loader ts-node/esm bench/gen-fixture.ts 10000 bench/10k-loc
//
// We DON'T commit the generated trees — they're large and easy to regenerate.
// Run this script locally before invoking the bench script.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const PY_TEMPLATE = (i: number): string => `# Generated module ${i}
import requests

def fetch_${i}(user_id, callback):
    """Generated callback-style fetch fixture #${i}."""
    result = requests.get("/users/%s" % user_id)
    payload = "Loaded user %s" % user_id
    callback(payload)
    return result


class User${i}:
    def __init__(self, id, name, email):
        self.id = id
        self.name = name
        self.email = email


def check_${i}(value):
    if isinstance(value, str):
        return value.upper()
    if isinstance(value, int):
        return str(value)
    return None
`;

const TS_TEMPLATE = (i: number): string => `// Generated module ${i}
const path = require('path');

export function makeGreeting${i}(name) {
  var greeting = 'hi-${i}';
  return greeting + ', ' + name;
}

export function chain${i}(input: any) {
  return Promise.resolve(input)
    .then((v) => v + 1)
    .then((v) => v * 2);
}

export function build${i}() {
  return new Promise((resolve, reject) => {
    setTimeout(() => resolve(${i}), 10);
  });
}

module.exports = { makeGreeting${i}, chain${i}, build${i} };
`;

// Approximate LOC per template (counted from the strings above).
const PY_LOC_PER_FILE = 24;
const TS_LOC_PER_FILE = 21;

async function generate(outDir: string, targetLoc: number): Promise<void> {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  // 50/50 split between python and typescript.
  const halfLoc = targetLoc / 2;
  const pyCount = Math.ceil(halfLoc / PY_LOC_PER_FILE);
  const tsCount = Math.ceil(halfLoc / TS_LOC_PER_FILE);

  // Spread into ~100 files per directory to avoid pathological dir sizes.
  const pyDir = path.join(outDir, 'src_py');
  const tsDir = path.join(outDir, 'src_ts');
  await fs.mkdir(pyDir, { recursive: true });
  await fs.mkdir(tsDir, { recursive: true });

  for (let i = 0; i < pyCount; i++) {
    const sub = path.join(pyDir, `pkg_${Math.floor(i / 100)}`);
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, `mod_${i}.py`), PY_TEMPLATE(i));
  }
  for (let i = 0; i < tsCount; i++) {
    const sub = path.join(tsDir, `pkg_${Math.floor(i / 100)}`);
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, `mod_${i}.ts`), TS_TEMPLATE(i));
  }

  const totalFiles = pyCount + tsCount;
  const totalLoc = pyCount * PY_LOC_PER_FILE + tsCount * TS_LOC_PER_FILE;
  process.stdout.write(
    `generated ${totalFiles} files (~${totalLoc} LOC) in ${outDir}\n` +
      `  python: ${pyCount} files\n` +
      `  typescript: ${tsCount} files\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetLoc = Number(args[0]);
  const outDir = args[1];
  if (!Number.isFinite(targetLoc) || targetLoc <= 0 || !outDir) {
    process.stderr.write('usage: gen-fixture.ts <target-loc> <out-dir>\n');
    process.exit(1);
  }
  await generate(path.resolve(outDir), targetLoc);
}

main().catch((err) => {
  process.stderr.write(`gen-fixture failed: ${err}\n`);
  process.exit(1);
});
