// tests/unit/cli/config-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadRefactronConfig,
  parseRequiresPythonMin,
  detectPythonVersionFromPyproject,
  resolvePythonVersion,
} from '../../../src/cli/config-loader.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-rc-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadRefactronConfig', () => {
  it('returns defaults when no config file is present', async () => {
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.transforms).toEqual(['all']);
    expect(cfg.exclude).toEqual([]);
    expect(cfg.testCmd).toBeNull();
    expect(cfg.confidence).toBe('high');
    expect(cfg.dryRun).toBe(true);
  });

  it('reads values from .refactronrc.json', async () => {
    const payload = {
      transforms: ['var_to_const_let', 'implicit_any'],
      exclude: ['build/', 'coverage/'],
      testCmd: 'npm test',
      confidence: 'medium',
      dryRun: false,
    };
    await fs.writeFile(path.join(tmp, '.refactronrc.json'), JSON.stringify(payload, null, 2));
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.transforms).toEqual(['var_to_const_let', 'implicit_any']);
    expect(cfg.exclude).toEqual(['build/', 'coverage/']);
    expect(cfg.testCmd).toBe('npm test');
    expect(cfg.confidence).toBe('medium');
    expect(cfg.dryRun).toBe(false);
  });

  it('throws on invalid schema (wrong type / unknown key)', async () => {
    const bad = { confidence: 'extremely-high', somethingElse: 42 };
    await fs.writeFile(path.join(tmp, '.refactronrc.json'), JSON.stringify(bad));
    await expect(loadRefactronConfig(tmp)).rejects.toThrow(/Invalid \.refactronrc/);
  });

  it('rejects unknown transform ids', async () => {
    const bad = { transforms: ['not_a_real_transform'] };
    await fs.writeFile(path.join(tmp, '.refactronrc.json'), JSON.stringify(bad));
    await expect(loadRefactronConfig(tmp)).rejects.toThrow(/Invalid \.refactronrc/);
  });
});

describe('documentation sub-config', () => {
  it('defaults to backend provider with llama-3.3-70b-versatile and creds-derived endpoint', async () => {
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.documentation).toMatchObject({
      provider: 'backend',
      model: 'llama-3.3-70b-versatile',
      endpoint: null, // null = use api_base_url from credentials
      tokenBudget: 4000,
      redactPatterns: [],
      cache: true,
    });
  });

  it('accepts a customised documentation block and preserves defaults', async () => {
    await fs.writeFile(
      path.join(tmp, '.refactronrc.json'),
      JSON.stringify({
        documentation: { provider: 'openai', model: 'gpt-4o-mini', tokenBudget: 2000 },
      }),
    );
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.documentation.provider).toBe('openai');
    expect(cfg.documentation.model).toBe('gpt-4o-mini');
    expect(cfg.documentation.tokenBudget).toBe(2000);
    // defaults preserved via deep-merge
    expect(cfg.documentation.cache).toBe(true);
    expect(cfg.documentation.endpoint).toBeNull();
    expect(cfg.documentation.redactPatterns).toEqual([]);
  });

  it('rejects unknown providers', async () => {
    await fs.writeFile(
      path.join(tmp, '.refactronrc.json'),
      JSON.stringify({ documentation: { provider: 'bogus' } }),
    );
    await expect(loadRefactronConfig(tmp)).rejects.toThrow(/provider/);
  });
});

describe('pythonVersion config key', () => {
  it('defaults to null when not present', async () => {
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.pythonVersion).toBeNull();
  });

  it('accepts a supported version string', async () => {
    await fs.writeFile(
      path.join(tmp, '.refactronrc.json'),
      JSON.stringify({ pythonVersion: '3.11' }),
    );
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.pythonVersion).toBe('3.11');
  });

  it('rejects an unsupported version string', async () => {
    await fs.writeFile(
      path.join(tmp, '.refactronrc.json'),
      JSON.stringify({ pythonVersion: '3.7' }),
    );
    await expect(loadRefactronConfig(tmp)).rejects.toThrow(/Invalid \.refactronrc/);
  });
});

describe('parseRequiresPythonMin', () => {
  it('parses ">=3.10"', () => {
    expect(parseRequiresPythonMin('>=3.10')).toEqual([3, 10]);
  });
  it('parses ">= 3.10.4"', () => {
    expect(parseRequiresPythonMin('>= 3.10.4')).toEqual([3, 10]);
  });
  it('parses "^3.11"', () => {
    expect(parseRequiresPythonMin('^3.11')).toEqual([3, 11]);
  });
  it('parses ">=3.9,<4"', () => {
    expect(parseRequiresPythonMin('>=3.9,<4')).toEqual([3, 9]);
  });
  it('parses plain "3.12" (Poetry shorthand)', () => {
    expect(parseRequiresPythonMin('3.12')).toEqual([3, 12]);
  });
  it('treats ">3.10" as the next minor', () => {
    expect(parseRequiresPythonMin('>3.10')).toEqual([3, 11]);
  });
  it('returns null on garbage', () => {
    expect(parseRequiresPythonMin('definitely not a version')).toBeNull();
  });
});

describe('detectPythonVersionFromPyproject', () => {
  it('reads requires-python from a PEP 621 [project] block', async () => {
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[project]', 'name = "demo"', 'requires-python = ">=3.10"', ''].join('\n'),
    );
    expect(await detectPythonVersionFromPyproject(tmp)).toBe('3.10');
  });

  it('reads python from [tool.poetry.dependencies]', async () => {
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[tool.poetry.dependencies]', 'python = "^3.11"', ''].join('\n'),
    );
    expect(await detectPythonVersionFromPyproject(tmp)).toBe('3.11');
  });

  it('returns null when no pyproject.toml exists', async () => {
    expect(await detectPythonVersionFromPyproject(tmp)).toBeNull();
  });

  it('returns null when the version is below the oldest we support', async () => {
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[project]', 'requires-python = ">=3.7"', ''].join('\n'),
    );
    expect(await detectPythonVersionFromPyproject(tmp)).toBeNull();
  });

  it('clamps a future-version floor to the highest supported version', async () => {
    // A project that requires Python >= 3.14 also supports everything 3.13
    // supports. The resolver must NOT return null for forward versions —
    // doing so would silently disable 3.9-gated transforms on projects
    // that obviously target a modern interpreter.
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[project]', 'requires-python = ">=3.14"', ''].join('\n'),
    );
    expect(await detectPythonVersionFromPyproject(tmp)).toBe('3.13');
  });

  it('clamps a far-future floor (e.g. >=4.0) to the highest supported version', async () => {
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[project]', 'requires-python = ">=4.0"', ''].join('\n'),
    );
    expect(await detectPythonVersionFromPyproject(tmp)).toBe('3.13');
  });
});

describe('resolvePythonVersion', () => {
  it('returns the explicit config value if present (ignores pyproject)', async () => {
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[project]', 'requires-python = ">=3.8"', ''].join('\n'),
    );
    expect(await resolvePythonVersion(tmp, { pythonVersion: '3.12' })).toBe('3.12');
  });

  it('falls back to pyproject when config is null', async () => {
    await fs.writeFile(
      path.join(tmp, 'pyproject.toml'),
      ['[project]', 'requires-python = ">=3.10"', ''].join('\n'),
    );
    expect(await resolvePythonVersion(tmp, { pythonVersion: null })).toBe('3.10');
  });

  it('returns null when neither config nor pyproject sets a version', async () => {
    expect(await resolvePythonVersion(tmp, { pythonVersion: null })).toBeNull();
  });
});
