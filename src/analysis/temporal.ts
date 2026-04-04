// src/analysis/temporal.ts
import type { TemporalProfile } from '../core/models.js';
import { isGitRepo, gitLogForFile, findCoChangePairs } from '../infrastructure/git.js';

export class TemporalAnalyzer {
  async profile(filePath: string): Promise<TemporalProfile | null> {
    if (!isGitRepo(process.cwd())) return null;

    const log = gitLogForFile(filePath, 180); // 6-month window
    if (log.length === 0) return null;

    const firstEntry = log[0];
    const lastModified = firstEntry?.date ?? new Date();
    const changeVelocity = log.length / 6; // changes per month
    const daysSinceLastTouch = this.daysBetween(lastModified, new Date());
    const coChangePairs = await findCoChangePairs(filePath, log);

    return {
      lastModified,
      changeVelocity,
      coChangePairs,
      daysSinceLastTouch,
    };
  }

  computeRiskScore(
    blastScore: number,
    temporal: TemporalProfile | undefined,
  ): 'DANGER' | 'HIGH' | 'MEDIUM' | 'LOW' {
    const days = temporal?.daysSinceLastTouch ?? 0;
    const velocity = temporal?.changeVelocity ?? 1;

    if (blastScore > 75 && days > 365 && velocity < 0.5) return 'DANGER';
    if (blastScore > 50 && days > 180) return 'HIGH';
    if (blastScore > 25) return 'MEDIUM';
    return 'LOW';
  }

  private daysBetween(a: Date, b: Date): number {
    return Math.floor(Math.abs(b.getTime() - a.getTime()) / 86_400_000);
  }
}
