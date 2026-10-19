import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NoteDto, RetroSummary } from '@retrolive/shared';
import { SummaryPanel } from './SummaryPanel';

const notes: NoteDto[] = [
  { id: 'n1', column: 'TO_IMPROVE', text: 'Deploys are slow', authorId: 'a', authorNickname: 'Gina', voteCount: 3, createdAt: '' },
];
const summary: RetroSummary = {
  themes: [{ title: 'Slow releases', summary: 'Deploys take too long.', noteIds: ['n1', 'unknown'] }],
  actionItems: ['Automate the deploy'],
  generatedAt: '2026-10-19T10:00:00.000Z',
};

function setup(props: Partial<React.ComponentProps<typeof SummaryPanel>> = {}) {
  const onGenerate = vi.fn().mockResolvedValue(null);
  const onExport = vi.fn().mockResolvedValue(null);
  const result = render(
    <SummaryPanel
      summary={null}
      notes={notes}
      phase="DISCUSSING"
      isHost
      noteCountEnough
      onGenerate={onGenerate}
      onExport={onExport}
      {...props}
    />,
  );
  return { onGenerate, onExport, ...result };
}

describe('SummaryPanel', () => {
  it('is hidden before the discussion starts', () => {
    const { container } = setup({ phase: 'VOTING' });
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden from guests until a summary exists', () => {
    const { container } = setup({ isHost: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('lets the host generate a summary, and explains when there are too few notes', async () => {
    const { onGenerate, rerender } = setup();
    await userEvent.click(screen.getByTestId('summary-generate'));
    expect(onGenerate).toHaveBeenCalledOnce();

    rerender(
      <SummaryPanel summary={null} notes={notes} phase="DISCUSSING" isHost noteCountEnough={false} onGenerate={onGenerate} onExport={vi.fn()} />,
    );
    expect(screen.getByTestId('summary-generate')).toBeDisabled();
    expect(screen.getByText(/at least 3 notes/)).toBeInTheDocument();
  });

  it('shows the error when generating fails', async () => {
    const onGenerate = vi.fn().mockResolvedValue('The free AI quota is used up for now.');
    setup({ onGenerate });
    await userEvent.click(screen.getByTestId('summary-generate'));
    expect(await screen.findByRole('alert')).toHaveTextContent('quota is used up');
  });

  it('shows themes, the notes behind them, and action items to everyone', () => {
    setup({ isHost: false, summary });
    expect(screen.getByText('Slow releases')).toBeInTheDocument();
    expect(screen.getByText(/Deploys are slow/)).toBeInTheDocument(); // the quoted note
    expect(screen.getByText('Automate the deploy')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-generate')).toBeNull(); // guests cannot generate
  });

  it('only offers the Markdown export to the host', async () => {
    const { onExport } = setup({ summary });
    await userEvent.click(screen.getByTestId('export-markdown'));
    expect(onExport).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Copied to your clipboard/)).toBeInTheDocument();
  });
});
