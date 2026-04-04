// src/core/config.ts
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

export interface AnalyzerConfig {
  enabled: boolean;
  threshold?: number;
  max_method_lines?: number;
}

export interface RefactronConfig {
  version: number;
  analyzers: {
    complexity: AnalyzerConfig & { threshold: number };
    security: AnalyzerConfig;
    code_smell: AnalyzerConfig & { max_method_lines: number };
    dead_code: AnalyzerConfig;
    type_hints: AnalyzerConfig;
    dependencies: AnalyzerConfig;
    performance: AnalyzerConfig;
  };
  verification: {
    timeout_seconds: number;
    critical_timeout_seconds: number;
  };
  autofix: {
    dry_run: boolean;
    require_verification: boolean;
  };
  output: {
    format: 'terminal' | 'json' | 'sarif';
    fail_on: 'critical' | 'high' | 'medium' | 'low' | null;
  };
}

export const defaultConfig: RefactronConfig = {
  version: 1,
  analyzers: {
    complexity: { enabled: true, threshold: 10 },
    security: { enabled: true },
    code_smell: { enabled: true, max_method_lines: 50 },
    dead_code: { enabled: true },
    type_hints: { enabled: true },
    dependencies: { enabled: true },
    performance: { enabled: true },
  },
  verification: {
    timeout_seconds: 45,
    critical_timeout_seconds: 120,
  },
  autofix: {
    dry_run: false,
    require_verification: true,
  },
  output: {
    format: 'terminal',
    fail_on: null,
  },
};

export async function loadConfig(projectRoot: string): Promise<RefactronConfig> {
  const configPath = path.join(projectRoot, 'refactron.yaml');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Partial<RefactronConfig>;
    return deepMerge(defaultConfig, parsed);
  } catch {
    return defaultConfig;
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined) {
      if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
        result[key] = deepMerge(base[key] as object, val as object) as T[typeof key];
      } else {
        result[key] = val as T[typeof key];
      }
    }
  }
  return result;
}
