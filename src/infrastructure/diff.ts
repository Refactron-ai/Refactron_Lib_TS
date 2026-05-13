// src/infrastructure/diff.ts
import { createTwoFilesPatch } from 'diff';

export function generateUnifiedDiff(
  originalPath: string,
  original: string,
  transformed: string,
  context = 3,
): string {
  return createTwoFilesPatch(
    `a/${originalPath}`,
    `b/${originalPath}`,
    original,
    transformed,
    '',
    '',
    { context },
  );
}

export function countChangedLines(diff: string): { added: number; removed: number } {
  const lines = diff.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}
