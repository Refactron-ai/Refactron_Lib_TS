import type { FileChange, GateResult } from '../contracts.js';

export interface ShadowTreeHandle {
  path: string;
  cleanup(): Promise<void>;
}

export interface RunnerSpec {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface CheckContext {
  shadowRoot: string;
  changes: FileChange[];
}

export type Check = (ctx: CheckContext) => Promise<GateResult>;
