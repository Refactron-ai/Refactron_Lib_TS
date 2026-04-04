// src/infrastructure/git.ts
import { spawnSync } from 'child_process';
import path from 'path';

export interface GitCommit {
  hash: string;
  date: Date;
}

export function isGitRepo(dir: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return result.status === 0;
}

export function gitLogForFile(filePath: string, days: number): GitCommit[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = spawnSync(
    'git',
    ['log', `--since=${since}`, '--format=%H %aI', '--', path.resolve(filePath)],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return [];
  return parseGitLog(result.stdout);
}

function parseGitLog(output: string): GitCommit[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(' ');
      const hash = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line;
      const dateStr = spaceIdx >= 0 ? line.slice(spaceIdx + 1) : '';
      return { hash, date: new Date(dateStr) };
    });
}

export async function findCoChangePairs(filePath: string, commits: GitCommit[]): Promise<string[]> {
  const coChanges = new Map<string, number>();
  const absPath = path.resolve(filePath);

  for (const commit of commits) {
    const result = spawnSync(
      'git',
      ['diff-tree', '--no-commit-id', '-r', '--name-only', commit.hash],
      { encoding: 'utf8' },
    );
    const changedFiles = result.stdout.trim().split('\n').filter(Boolean);
    const fileInCommit = changedFiles.some((f) => path.resolve(f) === absPath);
    if (fileInCommit) {
      for (const f of changedFiles) {
        const resolved = path.resolve(f);
        if (resolved !== absPath) {
          coChanges.set(resolved, (coChanges.get(resolved) ?? 0) + 1);
        }
      }
    }
  }

  const threshold = Math.max(1, commits.length * 0.5);
  return [...coChanges.entries()].filter(([, count]) => count >= threshold).map(([file]) => file);
}
