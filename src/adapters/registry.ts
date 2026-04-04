// src/adapters/registry.ts
import path from 'path';
import type { ILanguageAdapter } from './interface.js';
import { PythonAdapter } from './python/index.js';
import { TypeScriptAdapter } from './typescript/index.js';

export class AdapterRegistry {
  private adapters: ILanguageAdapter[] = [
    new PythonAdapter(),
    new TypeScriptAdapter(),
  ];

  async detectAdapters(projectRoot: string): Promise<ILanguageAdapter[]> {
    const detected: ILanguageAdapter[] = [];
    for (const adapter of this.adapters) {
      if (await adapter.detect(projectRoot)) {
        detected.push(adapter);
      }
    }
    return detected;
  }

  adapterForFile(filePath: string): ILanguageAdapter | null {
    const ext = path.extname(filePath);
    return this.adapters.find((a) => a.extensions.includes(ext)) ?? null;
  }

  getAll(): ILanguageAdapter[] {
    return [...this.adapters];
  }
}
