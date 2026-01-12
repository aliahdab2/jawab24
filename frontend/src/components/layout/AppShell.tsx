/**
 * AppShell - Industry Standard Safe Area Handler
 * 
 * Following React Native's SafeAreaProvider pattern:
 * - Wraps entire app at root level
 * - Handles all safe area padding (top, bottom, sides)
 * - Children use flex-1 or h-full, NOT 100vh
 * 
 * This is the SINGLE source of truth for safe areas.
 */

import { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

export function AppShell({ children, className = '' }: AppShellProps) {
  return (
    <div className={`app-shell ${className}`}>
      {children}
    </div>
  );
}

export default AppShell;
