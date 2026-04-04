// src/cli/components/FullscreenLayout.tsx
// Alternate-screen wrapper — enters alternate screen on mount, restores on unmount.
// Matches Claude Code's FullscreenLayout: fixed terminal height, flex-column,
// ScrollBox fills remaining height via flexGrow=1.
import React, { useEffect } from 'react';
import { Box, useStdout } from 'ink';

interface FullscreenLayoutProps {
  children: React.ReactNode;
}

export function FullscreenLayout({ children }: FullscreenLayoutProps): React.ReactElement {
  const { stdout } = useStdout();

  useEffect(() => {
    // Enter alternate screen — hides scrollback, gives fixed viewport
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1049h'); // enter alt screen
      process.stdout.write('\x1b[?25l'); // hide cursor
    }

    return () => {
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?25h'); // show cursor
        process.stdout.write('\x1b[?1049l'); // leave alt screen
      }
    };
  }, []);

  const height = stdout.rows ?? 24;

  return (
    <Box flexDirection="column" height={height} width="100%">
      {children}
    </Box>
  );
}
