import type { ReactElement, ReactNode } from 'react';

/**
 * A small Markdown renderer for the PROBE artifact excerpts in the guide.
 *
 * WHY NOT A LIBRARY: the app is offline and deliberately dependency-light, and
 * the excerpts use one narrow slice of Markdown — headings, bold, inline code,
 * fenced code, tables and lists. A full parser would be several hundred
 * kilobytes to render what fits in this file, and every dependency here also
 * has to be installed on a machine that may have nothing.
 *
 * WHY NOT dangerouslySetInnerHTML: the text comes from repository artifacts
 * today, but a renderer that injects HTML is one careless caller away from
 * being an injection point. This builds React elements, so the content can
 * never become markup.
 *
 * It is knowingly partial. Anything it does not recognise is shown as
 * paragraph text rather than silently dropped, so an unsupported construct
 * looks plain instead of disappearing — the failure a reader can spot.
 */

/** Splits `**bold**` and `` `code` `` out of one line, leaving the rest as text. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  /* One pass over both markers, so neither can swallow the other. */
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    index += 1;
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${index}`}>{token.slice(1, -1)}</code>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** One row of a pipe table, with the outer pipes and padding removed. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** True for the `| --- | --- |` line that separates a table's head from its body. */
function isTableDivider(line: string): boolean {
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(line) && line.includes('-');
}

export function MarkdownPreview({ source }: { source: string }): ReactElement {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    key += 1;
    /* Join wrapped lines with a space: the artifacts hard-wrap their prose, and
       preserving those breaks would render as a ragged column. */
    blocks.push(<p key={`p${key}`}>{inline(paragraph.join(' '), `p${key}`)}</p>);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    // Fenced code — taken verbatim, including its language label.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      key += 1;
      blocks.push(
        <pre className="md-code" key={`f${key}`}>
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      key += 1;
      const depth = (heading[1] ?? '#').length;
      const text = heading[2] ?? '';
      /* Rendered as a styled div rather than h1–h6: this sits inside a guide
         card that already owns the page's heading outline, and injecting more
         headings would break that outline for a screen reader. */
      blocks.push(
        <div className={`md-h md-h${Math.min(depth, 4)}`} key={`h${key}`}>
          {inline(text, `h${key}`)}
        </div>,
      );
      continue;
    }

    if (line.startsWith('|')) {
      flushParagraph();
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        rows.push(lines[i] ?? '');
        i += 1;
      }
      i -= 1;
      const head = rows[0];
      const body = rows.slice(1).filter((row) => !isTableDivider(row));
      key += 1;
      blocks.push(
        <div className="md-table-wrap" key={`t${key}`}>
          <table className="md-table">
            {head ? (
              <thead>
                <tr>
                  {tableCells(head).map((cell, c) => (
                    <th key={`t${key}h${c}`}>{inline(cell, `t${key}h${c}`)}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((row, r) => (
                <tr key={`t${key}r${r}`}>
                  {tableCells(row).map((cell, c) => (
                    <td key={`t${key}r${r}c${c}`}>{inline(cell, `t${key}r${r}c${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        let item = (lines[i] ?? '').replace(/^[-*]\s+/, '');
        /* Continuation lines are indented under their bullet. */
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1] ?? '')) {
          i += 1;
          item += ` ${(lines[i] ?? '').trim()}`;
        }
        items.push(item);
        i += 1;
      }
      i -= 1;
      key += 1;
      blocks.push(
        <ul className="md-list" key={`l${key}`}>
          {items.map((item, n) => (
            <li key={`l${key}i${n}`}>{inline(item, `l${key}i${n}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();

  return <div className="md-preview">{blocks}</div>;
}
