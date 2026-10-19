import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NoteDto, Phase } from '@retrolive/shared';
import { NoteCard } from './NoteCard';

const base: NoteDto = {
  id: 'n1',
  column: 'WENT_WELL',
  text: 'Pairing worked well',
  authorId: 'me',
  authorNickname: 'Gina',
  voteCount: 2,
  createdAt: '2026-10-19T10:00:00.000Z',
};

function setup(props: Partial<React.ComponentProps<typeof NoteCard>> = {}) {
  const handlers = {
    onVote: vi.fn(),
    onUnvote: vi.fn(),
    onEdit: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn(),
  };
  render(
    <NoteCard
      note={base}
      phase={'WRITING' as Phase}
      isMine={false}
      isHost={false}
      voted={false}
      votesLeft={3}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('NoteCard', () => {
  it('shows the text and the author\'s nickname', () => {
    setup();
    expect(screen.getByText('Pairing worked well')).toBeInTheDocument();
    expect(screen.getByTestId('note-author')).toHaveTextContent('Gina');
  });

  it('lets authors edit and delete their own note while writing', async () => {
    const h = setup({ isMine: true });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByLabelText('Edit note');
    await userEvent.clear(box);
    await userEvent.type(box, 'A better wording');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.onEdit).toHaveBeenCalledWith('n1', 'A better wording');

    await userEvent.click(screen.getByRole('button', { name: 'Delete your note' }));
    expect(h.onDelete).toHaveBeenCalledWith('n1');
  });

  it('does not offer edit or delete on somebody else\'s note', () => {
    setup({ isMine: false });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
  });

  it('lets the host remove any note, but only until the session is closed', () => {
    const { unmount } = render(<div />);
    unmount();
    setup({ isHost: true, phase: 'VOTING' });
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeInTheDocument();
  });

  it('hides moderation once the session is closed', () => {
    setup({ isHost: true, phase: 'CLOSED' });
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
  });

  it('stops authors editing after the writing phase', () => {
    setup({ isMine: true, phase: 'VOTING' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete your note' })).toBeNull();
  });

  it('shows a vote button only while voting, and toggles the vote', async () => {
    const h = setup({ phase: 'VOTING' });
    const button = screen.getByRole('button', { name: 'Vote for this note' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(h.onVote).toHaveBeenCalledWith('n1');
  });

  it('lets you take a vote back', async () => {
    const h = setup({ phase: 'VOTING', voted: true });
    const button = screen.getByRole('button', { name: 'Remove your vote' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(h.onUnvote).toHaveBeenCalledWith('n1');
  });

  it('disables voting for new notes once your votes are used up, but still allows taking one back', () => {
    const { unmount } = render(<div />);
    unmount();
    setup({ phase: 'VOTING', votesLeft: 0, voted: false });
    expect(screen.getByRole('button', { name: 'Vote for this note' })).toBeDisabled();
  });

  it('shows plain totals outside the voting phase', () => {
    setup({ phase: 'DISCUSSING' });
    expect(screen.queryByTestId('vote-button')).toBeNull();
    expect(screen.getByLabelText('2 votes')).toBeInTheDocument();
  });
});
