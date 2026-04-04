// src/ui/IssueList.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CodeIssue } from '../core/models.js';
import { theme } from './theme.js';

interface IssueListProps {
  issues: CodeIssue[];
  onSelect?: (issue: CodeIssue) => void;
  onFix?: (issue: CodeIssue) => void;
}

export function IssueList({ issues, onFix }: IssueListProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useInput(
    (input, key) => {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(issues.length - 1, c + 1));
      if (input === ' ') {
        const issue = issues[cursor];
        if (issue) {
          setExpanded((e) => {
            const next = new Set(e);
            if (next.has(issue.id)) next.delete(issue.id);
            else next.add(issue.id);
            return next;
          });
        }
      }
      if (input === 'f') {
        const issue = issues[cursor];
        if (issue?.fixable && onFix) onFix(issue);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  if (issues.length === 0) {
    return <Text color={theme.colors.success}>No issues found.</Text>;
  }

  const visibleStart = Math.max(0, cursor - 5);
  const visible = issues.slice(visibleStart, visibleStart + 12);

  return (
    <Box flexDirection="column">
      {visible.map((issue, i) => {
        const idx = visibleStart + i;
        const isSelected = idx === cursor;
        const isExpanded = expanded.has(issue.id);
        const severityColor = theme.severityColors[issue.severity];
        const blastColor = theme.blastColors[issue.blastRadius.level];

        return (
          <Box key={issue.id} flexDirection="column">
            <Box>
              <Text color={isSelected ? theme.colors.accent : theme.colors.text}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text color={severityColor} bold>
                {issue.severity.toUpperCase().padEnd(8)}
              </Text>
              <Text color={theme.colors.text}>{issue.message.slice(0, 50).padEnd(52)}</Text>
              <Text color={theme.colors.textDim}>
                {issue.file}:{issue.line}
              </Text>
              {issue.fixable && <Text color={theme.colors.accent}>{'  [fixable]'}</Text>}
            </Box>
            {isExpanded && (
              <Box flexDirection="column" paddingLeft={4}>
                {issue.suggestion && (
                  <Text color={theme.colors.textDim}>
                    {theme.symbols.arrow} {issue.suggestion}
                  </Text>
                )}
                <Text color={blastColor}>
                  Blast radius: {issue.blastRadius.level.toUpperCase()} (score:{' '}
                  {issue.blastRadius.score}) — {issue.blastRadius.affectedFiles.length} files
                  affected
                </Text>
                <Text color={theme.colors.textDim}>
                  [space=collapse · f=fix · q=quit]
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
