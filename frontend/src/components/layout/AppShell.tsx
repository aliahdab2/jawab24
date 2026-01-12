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
    <div 
      className={`app-shell ${className}`}
      style={{
        // Fill viewport
        minHeight: '100dvh', // Dynamic viewport height (modern) with fallback
        minHeight: '100vh',  // Fallback for older browsers
        
        // Flexbox column layout
        display: 'flex',
        flexDirection: 'column',
        
        // Safe area padding - handled by CSS for native apps
        // See globals.css .app-shell rules
      }}
    >
      {children}
    </div>
  );
}

export default AppShell;
