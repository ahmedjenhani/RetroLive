import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Phase } from '@retrolive/shared';
import { PhaseBar } from './PhaseBar';

function setup(phase: Phase, isHost: boolean) {
  const onSetPhase = vi.fn().mockResolvedValue(undefined);
  render(<PhaseBar phase={phase} isHost={isHost} onSetPhase={onSetPhase} />);
  return onSetPhase;
}

describe('PhaseBar', () => {
  it('shows guests where the session is, with no controls', () => {
    setup('VOTING', false);
    expect(screen.getByText(/Spend your votes/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the current step for screen readers', () => {
    setup('DISCUSSING', true);
    expect(document.querySelector('[aria-current="step"]')).not.toBeNull();
    expect(screen.getByTestId('current-phase')).toHaveTextContent('Discussing');
  });

  it('gives the host a single "start voting" step while writing', async () => {
    const onSetPhase = setup('WRITING', true);
    expect(screen.queryByTestId('phase-back')).toBeNull();
    await userEvent.click(screen.getByTestId('phase-next'));
    expect(onSetPhase).toHaveBeenCalledWith('VOTING');
  });

  it('lets the host go forward or back from the voting phase', async () => {
    const onSetPhase = setup('VOTING', true);
    await userEvent.click(screen.getByTestId('phase-back'));
    expect(onSetPhase).toHaveBeenLastCalledWith('WRITING');
    await userEvent.click(screen.getByTestId('phase-next'));
    expect(onSetPhase).toHaveBeenLastCalledWith('DISCUSSING');
  });

  it('asks for confirmation before closing the session', async () => {
    const onSetPhase = setup('DISCUSSING', true);
    await userEvent.click(screen.getByTestId('phase-next'));
    expect(onSetPhase).not.toHaveBeenCalled();
    expect(screen.getByText(/Nobody can add or vote after this/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSetPhase).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('phase-next'));
    await userEvent.click(screen.getByTestId('phase-confirm-close'));
    expect(onSetPhase).toHaveBeenCalledWith('CLOSED');
  });

  it('offers no way forward or back once closed', () => {
    setup('CLOSED', true);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
