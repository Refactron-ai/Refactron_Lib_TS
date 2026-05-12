import * as fs from 'node:fs/promises';
import { RefactronAnalyzer } from '../analyze/engine.js';
import { renderTerminal } from '../analyze/format/terminal.js';
import { toJson } from '../analyze/format/json.js';
import type { Confidence } from '../analyze/detectors/types.js';

interface ParsedFlags {
  target: string;
  json: boolean;
  confidence: Confidence;
  graphPath: string | null;
}

const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

export function parseFlags(argv: string[]): ParsedFlags {
  let target = '.';
  let json = false;
  let confidence: Confidence = 'high';
  let graphPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') {
      json = true;
    } else if (a === '--confidence') {
      const v = argv[++i];
      if (v && (CONFIDENCES as string[]).includes(v)) confidence = v as Confidence;
    } else if (a.startsWith('--confidence=')) {
      const v = a.slice('--confidence='.length);
      if ((CONFIDENCES as string[]).includes(v)) confidence = v as Confidence;
    } else if (a.startsWith('--graph=')) {
      graphPath = a.slice('--graph='.length);
    } else if (!a.startsWith('-')) {
      target = a;
    }
  }
  return { target, json, confidence, graphPath };
}

export async function runAnalyzeCommand(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const analyzer = new RefactronAnalyzer({ confidence: flags.confidence });
  const report = await analyzer.analyzeExtended(flags.target);
  if (flags.graphPath) {
    await fs.writeFile(flags.graphPath, toJson(report), 'utf8');
  }
  process.stdout.write(flags.json ? toJson(report) + '\n' : renderTerminal(report));
  return 0;
}
