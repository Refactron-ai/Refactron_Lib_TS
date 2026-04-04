// src/infrastructure/git.ts
import { spawnSync } from 'child_process';
import path from 'path';

export interface GitCommit {
  hash: string;
  date: Date;
}

const gitRepoCache = new Map<string, boolean>();

export function isGitRepo(dir: string): boolean {
  if (gitRepoCache.has(dir)) return gitRepoCache.get(dir)!;
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const isRepo = result.status === 0;
  gitRepoCache.set(dir, isRepo);
  return isRepo;
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
  if (commits.length === 0) return [];

  const coChanges = new Map<string, number>();
  const absPath = path.resolve(filePath);

  // Batch: one git call for all commits instead of one per commit
  const hashes = commits.map((c) => c.hash);
  const result = spawnSync('git', ['diff-tree', '--no-commit-id', '-r', '--name-only', '--stdin'], {
    encoding: 'utf8',
    input: hashes.join('\n') + '\n',
  });

  if (result.status === 0 && result.stdout) {
    // diff-tree --stdin separates commits with the hash line followed by changed files
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    // Parse: each group starts with a 40-char hash line, followed by file paths
    let inCommitFiles: string[] = [];
    for (const line of lines) {
      if (/^[0-9a-f]{40}$/.test(line)) {
        inCommitFiles = [];
      } else {
        inCommitFiles.push(line);
        const resolved = path.resolve(line);
        if (inCommitFiles.some((f) => path.resolve(f) === absPath)) {
          if (resolved !== absPath) {
            coChanges.set(resolved, (coChanges.get(resolved) ?? 0) + 1);
          }
        }
      }
    }
  } else {
    // Fallback: individual calls (older git versions)
    for (const commit of commits.slice(0, 20)) {
      // cap at 20 to avoid timeout
      const r = spawnSync(
        'git',
        ['diff-tree', '--no-commit-id', '-r', '--name-only', commit.hash],
        { encoding: 'utf8' },
      );
      const changedFiles = r.stdout.trim().split('\n').filter(Boolean);
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
  }

  const threshold = Math.max(1, commits.length * 0.5);
  return [...coChanges.entries()].filter(([, count]) => count >= threshold).map(([file]) => file);
}
