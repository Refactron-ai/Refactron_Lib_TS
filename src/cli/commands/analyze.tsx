// src/cli/commands/analyze.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { AnalysisResult } from '../../core/models.js';
import { IssueList } from '../../ui/IssueList.js';
import { StatusBar } from '../../ui/StatusBar.js';
import { theme } from '../../ui/theme.js';

interface AnalyzeCommandProps {
  target: string;
  onAnalysisComplete: (result: AnalysisResult) => void;
  analyze: (target: string) => Promise<AnalysisResult>;
}

export function AnalyzeCommand({
  target,
  onAnalysisComplete,
  analyze,
}: AnalyzeCommandProps): React.ReactElement {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    analyze(target)
      .then((r) => {
        setResult(r);
        onAnalysisComplete(r);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Box>
        <Text color={theme.colors.accent}>Scanning  </Text>
        <Text color={theme.colors.textDim}>{target}</Text>
      </Box>
    );
  }

  if (error) {
    return <Text color={theme.colors.error}>Error: {error}</Text>;
  }

  if (!result) return <Text>No result</Text>;

  const critical = result.issues.filter((i) => i.severity === 'critical').length;
  const high = result.issues.filter((i) => i.severity === 'high').length;
  const medium = result.issues.filter((i) => i.severity === 'medium').length;
  const low = result.issues.filter((i) => i.severity === 'low').length;
  const fixable = result.issues.filter((i) => i.fixable).length;

  return (
    <Box flexDirection="column">
      <Text color={theme.colors.textDim}>
        Analyzed  {result.filesAnalyzed} files in {result.durationMs}ms
      </Text>
      <IssueList issues={result.issues} />
      <StatusBar
        critical={critical}
        high={high}
        medium={medium}
        low={low}
        fixable={fixable}
      />
      <Text color={theme.colors.textDim}>Run: refactron autofix {target} --verify</Text>
    </Box>
  );
}
