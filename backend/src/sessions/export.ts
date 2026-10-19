import { COLUMNS, COLUMN_LABEL, type NoteDto, type RetroSummary } from '@retrolive/shared';

export interface ExportInput {
  title: string;
  createdAt: Date;
  notes: NoteDto[];
  summary: RetroSummary | null;
}

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' ');

/** The finished retrospective as Markdown: summary first, then every column, most voted notes on top. */
export function buildMarkdown({ title, createdAt, notes, summary }: ExportInput): string {
  const lines: string[] = [`# ${title}`, '', `_Retrospective, ${createdAt.toISOString().slice(0, 10)}_`, ''];

  if (summary) {
    lines.push('## Summary', '');
    for (const theme of summary.themes) {
      lines.push(`- **${theme.title}**: ${theme.summary}`);
    }
    if (summary.actionItems.length > 0) {
      lines.push('', '### Action items', '');
      for (const item of summary.actionItems) {
        lines.push(`- [ ] ${item}`);
      }
    }
    lines.push('');
  }

  for (const column of COLUMNS) {
    const inColumn = notes
      .filter((n) => n.column === column)
      .sort((a, b) => b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt));
    lines.push(`## ${COLUMN_LABEL[column]}`, '');
    if (inColumn.length === 0) {
      lines.push('_No notes_');
    }
    for (const n of inColumn) {
      const votes = n.voteCount > 0 ? ` (${n.voteCount} ${n.voteCount === 1 ? 'vote' : 'votes'})` : '';
      lines.push(`- ${oneLine(n.text)}${votes}, _${n.authorNickname}_`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
