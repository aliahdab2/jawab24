/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InfoPopover } from './InfoPopover';

describe('InfoPopover', () => {
  it('is closed by default — panel is not in the DOM', () => {
    render(<InfoPopover label="Details">panel content</InfoPopover>);
    expect(screen.queryByText('panel content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on click and exposes aria-expanded=true', () => {
    render(<InfoPopover label="Details">panel content</InfoPopover>);
    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(trigger);
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles closed on a second click', () => {
    render(<InfoPopover label="Details">panel content</InfoPopover>);
    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText('panel content')).not.toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    render(<InfoPopover label="Details">panel content</InfoPopover>);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const panel = screen.getByText('panel content');
    expect(panel).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByText('panel content')).not.toBeInTheDocument();
  });

  // Outside-pointer-down dismissal is provided by Radix DismissableLayer and
  // exercised by Radix's own test suite. jsdom's PointerEvent emulation is
  // unreliable, so we don't duplicate that coverage here.

  it('renders the panel in a portal (escapes overflow-hidden ancestors)', () => {
    render(
      <div style={{ overflow: 'hidden' }} data-testid="clip">
        <InfoPopover label="Details">panel content</InfoPopover>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const panel = screen.getByText('panel content');
    const clipper = screen.getByTestId('clip');
    expect(clipper.contains(panel)).toBe(false);
  });

  it('does not bubble click to parent handlers', () => {
    let parentClicks = 0;
    render(
      <div onClick={() => { parentClicks += 1; }}>
        <InfoPopover label="Details">panel content</InfoPopover>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(parentClicks).toBe(0);
  });

  it('links the trigger and panel via aria-controls / id', () => {
    render(<InfoPopover label="Details">panel content</InfoPopover>);
    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(trigger);
    const controlsId = trigger.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId!)).not.toBeNull();
  });
});
