import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { COLUMN_LABEL, LIMITS, type Column, type NoteDto, type Phase } from '@retrolive/shared';
import { Button, Textarea, cn } from '../ui';
import { NoteCard } from './NoteCard';

const ACCENT: Record<Column, { bar: string; dot: string; hint: string }> = {
  WENT_WELL: { bar: 'border-t-emerald-500', dot: 'bg-emerald-500', hint: 'What should we keep doing?' },
  TO_IMPROVE: { bar: 'border-t-amber-500', dot: 'bg-amber-500', hint: 'What slowed us down or annoyed us?' },
  ACTION_IDEAS: { bar: 'border-t-sky-500', dot: 'bg-sky-500', hint: 'What could we try next?' },
};

interface Props {
  column: Column;
  notes: NoteDto[];
  phase: Phase;
  myId: string;
  isHost: boolean;
  myVotes: string[];
  votesLeft: number;
  onAdd: (column: Column, text: string) => Promise<boolean>;
  onEdit: (noteId: string, text: string) => Promise<boolean>;
  onDelete: (noteId: string) => void;
  onVote: (noteId: string) => void;
  onUnvote: (noteId: string) => void;
}

export function NoteColumn({ column, notes, phase, myId, isHost, myVotes, votesLeft, onAdd, onEdit, onDelete, onVote, onUnvote }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const accent = ACCENT[column];

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (text.trim().length === 0 || busy) {
      return;
    }
    const draft = text;
    setText(''); // clear at once so it feels instant, and put the text back if the server says no
    setBusy(true);
    const ok = await onAdd(column, draft);
    setBusy(false);
    if (!ok) {
      setText((current) => (current === '' ? draft : current));
    }
  }

  // Enter sends, Shift+Enter makes a new line
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section
      aria-label={COLUMN_LABEL[column]}
      data-testid={`column-${column}`}
      className={cn(
        'flex flex-col rounded-2xl border border-t-4 border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800 dark:bg-slate-900/60',
        accent.bar,
      )}
    >
      <header className="mb-3 flex items-center gap-2 px-1">
        <span className={cn('h-2.5 w-2.5 rounded-full', accent.dot)} />
        <h2 className="font-semibold">{COLUMN_LABEL[column]}</h2>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {notes.length}
        </span>
      </header>

      {phase === 'WRITING' && (
        <form onSubmit={submit} className="mb-3 space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={LIMITS.NOTE_MAX_LENGTH}
            placeholder={accent.hint}
            aria-label={`Add a note to ${COLUMN_LABEL[column]}`}
            data-testid={`note-input-${column}`}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {text.length}/{LIMITS.NOTE_MAX_LENGTH} · Enter to add
            </span>
            <Button type="submit" small busy={busy} disabled={text.trim().length === 0} data-testid={`note-add-${column}`}>
              Add
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-1 flex-col gap-2">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            phase={phase}
            isMine={note.authorId === myId}
            isHost={isHost}
            voted={myVotes.includes(note.id)}
            votesLeft={votesLeft}
            onVote={onVote}
            onUnvote={onUnvote}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        {notes.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {phase === 'WRITING' ? 'No notes yet. Be the first!' : 'No notes in this column.'}
          </p>
        )}
      </div>
    </section>
  );
}
