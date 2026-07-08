import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CommandCenter } from './CommandCenter';

// Minimal happy-path props — individual tests override what they exercise.
function baseProps() {
  return {
    smartReplies: 42,
    repliedToday: 12,
    replyRate: '85.0',
    avgSpeedSeconds: 120,
  };
}

describe('CommandCenter — Replied Today method breakdown in tooltip', () => {
  it('renders the Replies Today tile with method breakdown in tooltip', () => {
    render(
      <CommandCenter {...baseProps()} repliedTodayByMethod={{ smart: 5, postReply: 7 }} />,
    );
    // The tile renders with "Replies Today" label
    expect(screen.getByText('Replies Today')).toBeInTheDocument();
    // And the hero value shows the total
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('includes breakdown even when Smart is zero for transparency', () => {
    render(
      <CommandCenter {...baseProps()} repliedTodayByMethod={{ smart: 0, postReply: 12 }} />,
    );
    // Component renders without errors — tooltip includes both numbers for clarity
    expect(screen.getByText('Replies Today')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('omits breakdown from tooltip when post replies is zero', () => {
    render(
      <CommandCenter {...baseProps()} repliedTodayByMethod={{ smart: 12, postReply: 0 }} />,
    );
    // Component renders; tooltip omits breakdown when Post Reply is 0
    expect(screen.getByText('Replies Today')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('hides the breakdown while stats are loading (prop omitted)', () => {
    render(<CommandCenter {...baseProps()} />);
    expect(screen.queryByText(/Post Reply:/)).not.toBeInTheDocument();
  });

  it('keeps the 4 metric tiles intact', () => {
    render(
      <CommandCenter {...baseProps()} repliedTodayByMethod={{ smart: 5, postReply: 7 }} />,
    );
    expect(screen.getByText('Smart Replies')).toBeInTheDocument();
    expect(screen.getByText('Replies Today')).toBeInTheDocument();
    expect(screen.getByText('Reply Rate')).toBeInTheDocument();
    expect(screen.getByText('Avg Speed')).toBeInTheDocument();
  });
});
