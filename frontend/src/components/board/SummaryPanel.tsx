import { useState } from 'react';
import type { NoteDto, Phase, RetroSummary } from '@retrolive/shared';
import { Alert, Button, Card } from '../ui';

interface Props {
  summary: RetroSummary | null;
  notes: NoteDto[];
  phase: Phase;
  isHost: boolean;
  noteCountEnough: boolean;
  onGenerate: () => Promise<string | null>;
  onExport: () => Promise<string | null>;
}

/** The AI summary (themes and action items) plus the Markdown export. Visible to everyone once it exists. */
export function SummaryPanel({ summary, notes, phase, isHost, noteCountEnough, onGenerate, onExport }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const available = phase === 'DISCUSSING' || phase === 'CLOSED';

  if (!available || (!summary && !isHost)) {
    return null;
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setError(await onGenerate());
    setBusy(false);
  }

  async function exportMarkdown() {
    setExported(null);
    const problem = await onExport();
    if (problem) {
      setError(problem);
    } else {
      setExported('Copied to your clipboard (or downloaded) as Markdown.');
    }
  }

  return (
    <Card className="space-y-4" >
      <div data-testid="summary-panel" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">
            <span aria-hidden="true">✨ </span>AI summary
          </h2>
          {isHost && (
            <>
              <Button
                variant={summary ? 'secondary' : 'primary'}
                small
                busy={busy}
                disabled={!noteCountEnough}
                onClick={generate}
                data-testid="summary-generate"
              >
                {summary ? 'Regenerate' : 'Generate summary'}
              </Button>
              <Button variant="secondary" small onClick={exportMarkdown} data-testid="export-markdown">
                Export Markdown
              </Button>
            </>
          )}
        </div>

        {isHost && !noteCountEnough && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Add at least 3 notes to generate a summary.</p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {exported && <Alert tone="success">{exported}</Alert>}

        {summary && (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-3 md:col-span-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Themes</h3>
              {summary.themes.map((theme) => (
                <div key={theme.title} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60" data-testid="summary-theme">
                  <h4 className="font-semibold">{theme.title}</h4>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{theme.summary}</p>
                  {theme.noteIds.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                      {theme.noteIds.slice(0, 4).map((id) => {
                        const note = byId.get(id);
                        return note ? <li key={id}>“{note.text.length > 90 ? `${note.text.slice(0, 90)}…` : note.text}”</li> : null;
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Action items</h3>
              <ul className="space-y-2" data-testid="summary-actions">
                {summary.actionItems.map((item) => (
                  <li key={item} className="flex gap-2 text-sm">
                    <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 rounded border border-slate-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
