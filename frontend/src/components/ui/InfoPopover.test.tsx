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
    expect(screen.getByText('panel content')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('panel content')).not.toBeInTheDocument();
  });

  it('closes when a pointer event lands outside the popover', () => {
    render(
      <div>
        <InfoPopover label="Details">panel content</InfoPopover>
        <button data-testid="outside">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByText('panel content')).not.toBeInTheDocument();
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
