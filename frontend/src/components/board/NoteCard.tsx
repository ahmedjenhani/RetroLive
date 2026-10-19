import { useState } from 'react';
import { LIMITS, type NoteDto, type Phase } from '@retrolive/shared';
import { Button, Textarea, cn } from '../ui';

interface Props {
  note: NoteDto;
  phase: Phase;
  isMine: boolean;
  isHost: boolean;
  voted: boolean;
  votesLeft: number;
  onVote: (noteId: string) => void;
  onUnvote: (noteId: string) => void;
  onEdit: (noteId: string, text: string) => Promise<boolean>;
  onDelete: (noteId: string) => void;
}

export function NoteCard({ note, phase, isMine, isHost, voted, votesLeft, onVote, onUnvote, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [saving, setSaving] = useState(false);

  const canEdit = isMine && phase === 'WRITING';
  const canDelete = phase !== 'CLOSED' && ((isMine && phase === 'WRITING') || isHost);
  const voting = phase === 'VOTING';
  const showCount = note.voteCount > 0 || voting;
  const cannotVote = !voted && votesLeft === 0;

  async function save() {
    setSaving(true);
    const ok = await onEdit(note.id, draft);
    setSaving(false);
    if (ok) {
      setEditing(false);
    }
  }

  return (
    <article
      className="note-enter rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      data-testid={`note-${note.id}`}
      aria-label={`Note by ${note.authorNickname}`}
    >
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={LIMITS.NOTE_MAX_LENGTH}
            aria-label="Edit note"
            autoFocus
          />
          <div className="flex gap-2">
            <Button small busy={saving} onClick={save} disabled={draft.trim().length === 0}>
              Save
            </Button>
            <Button
              small
              variant="ghost"
              onClick={() => {
                setDraft(note.text);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-testid="note-text">
          {note.text}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400" data-testid="note-author">
          {note.authorNickname}
        </span>

        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            Edit
          </button>
        )}
        {canDelete && !editing && (
          <button
            type="button"
            onClick={() => onDelete(note.id)}
            aria-label={isMine ? 'Delete your note' : 'Remove this note'}
            className="rounded px-1.5 py-0.5 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
          >
            {isMine ? 'Delete' : 'Remove'}
          </button>
        )}

        {voting ? (
          <button
            type="button"
            aria-pressed={voted}
            aria-label={voted ? 'Remove your vote' : 'Vote for this note'}
            disabled={cannotVote}
            onClick={() => (voted ? onUnvote(note.id) : onVote(note.id))}
            data-testid="vote-button"
            className={cn(
              'inline-flex min-w-12 items-center justify-center gap-1 rounded-full px-3 py-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              voted
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-slate-100 text-slate-700 hover:bg-indigo-100 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-indigo-900',
            )}
          >
            <span aria-hidden="true">▲</span>
            <span data-testid="vote-count">{note.voteCount}</span>
          </button>
        ) : (
          showCount && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              aria-label={`${note.voteCount} votes`}
              data-testid="vote-count"
            >
              ▲ {note.voteCount}
            </span>
          )
        )}
      </div>
    </article>
  );
}
