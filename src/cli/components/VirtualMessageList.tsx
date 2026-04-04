// src/cli/components/VirtualMessageList.tsx
// Viewport culling — only renders visible rows + a small buffer above/below.
// Off-screen messages are replaced by spacer nodes (empty Box with height=N).
// Matches Claude Code's VirtualMessageList for zero-lag scrolling on large output.
import React from 'react';
import { Box, Text } from 'ink';

export interface MessageLine {
  id: number;
  text: string;
  color: string | undefined;
}

interface VirtualMessageListProps {
  lines: MessageLine[];
  viewportHeight: number; // rows available for message area
  scrollOffset: number; // 0 = bottom (sticky), positive = scrolled up N rows
}

const BUFFER = 5; // extra rows to render above/below viewport for smooth scroll

export function VirtualMessageList({
  lines,
  viewportHeight,
  scrollOffset,
}: VirtualMessageListProps): React.ReactElement {
  const totalLines = lines.length;

  // When scrollOffset = 0 (sticky scroll), show last viewportHeight lines
  const visibleEnd = Math.max(0, totalLines - scrollOffset);
  const visibleStart = Math.max(0, visibleEnd - viewportHeight);

  // Expand window by buffer
  const renderStart = Math.max(0, visibleStart - BUFFER);
  const renderEnd = Math.min(totalLines, visibleEnd + BUFFER);

  const topSpacerHeight = renderStart;
  const bottomSpacerHeight = Math.max(0, totalLines - renderEnd);

  const visibleLines = lines.slice(renderStart, renderEnd);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {/* Top spacer for off-screen messages above */}
      {topSpacerHeight > 0 && <Box height={topSpacerHeight} />}

      {/* Visible message rows */}
      {visibleLines.map((line) =>
        line.color !== undefined ? (
          <Text key={line.id} color={line.color} wrap="truncate-end">
            {line.text}
          </Text>
        ) : (
          <Text key={line.id} wrap="truncate-end">
            {line.text}
          </Text>
        ),
      )}

      {/* Bottom spacer */}
      {bottomSpacerHeight > 0 && <Box height={bottomSpacerHeight} />}
    </Box>
  );
}
