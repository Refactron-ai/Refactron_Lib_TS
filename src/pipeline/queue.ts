// src/pipeline/queue.ts
import type { CodeIssue, FixStatus, FixQueueItem } from '../core/models.js';

export class FixQueue {
  private items: FixQueueItem[] = [];

  enqueue(issue: CodeIssue, fixerName: string): void {
    this.items.push({
      issueId: issue.id,
      filePath: issue.file,
      lineNumber: issue.line,
      severity: issue.severity,
      message: issue.message,
      fixerName,
      status: 'PENDING',
    });
  }

  updateStatus(issueId: string, status: FixStatus, extra?: Partial<FixQueueItem>): void {
    const item = this.items.find((i) => i.issueId === issueId);
    if (item) {
      item.status = status;
      if (extra) Object.assign(item, extra);
    }
  }

  getPending(): FixQueueItem[] {
    return this.items.filter((i) => i.status === 'PENDING');
  }

  getApplied(): FixQueueItem[] {
    return this.items.filter((i) => i.status === 'APPLIED');
  }

  getBlocked(): FixQueueItem[] {
    return this.items.filter((i) => i.status === 'BLOCKED');
  }

  getAll(): FixQueueItem[] {
    return [...this.items];
  }
}
