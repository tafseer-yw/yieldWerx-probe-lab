import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { MarkdownPreview } from './MarkdownPreview.js';
import { SKILLS_CONTENT, type SkillContent } from './skillsContent.js';
import { Badge, Card, CardBody, CardHead, Icon, type Tone } from './ui.js';

/*
 * Skills & Agents reference — every PROBE skill and specialist agent as a
 * searchable, selectable list, each shown three ways: the verbatim SKILL.md
 * (Markdown), that same source rendered (Preview), and a plain explanation of
 * what it does, why, how, and how to harden it for your own workflow.
 *
 * The content is embedded (skillsContent.generated.ts) so the page is
 * self-contained offline; regenerate it with
 * `npx tsx scripts/generate-skills-content.ts` after the plugin changes.
 */

type View = 'preview' | 'markdown' | 'explain';

const TRACK_TONE: Record<string, Tone> = {
  dev: 'accent',
  qa: 'good',
  design: 'good',
  scripting: 'good',
  ops: 'warning',
  cross: 'neutral',
};

function trackLabel(track: string): string {
  if (track === 'cross') return 'shared';
  return track;
}

export function SkillsPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('explain');

  const selectedName = params.get('name');
  const selected: SkillContent | undefined = useMemo(
    () => SKILLS_CONTENT.find((item) => item.name === selectedName) ?? SKILLS_CONTENT[0],
    [selectedName],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return SKILLS_CONTENT;
    return SKILLS_CONTENT.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.track.toLowerCase().includes(needle),
    );
  }, [query]);

  const skills = filtered.filter((item) => item.kind === 'skill');
  const agents = filtered.filter((item) => item.kind === 'agent');

  /* Merge into the existing query rather than replacing it, so selecting a
     skill inside the PROBE guide keeps ?section=skills. */
  const select = (name: string): void =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('name', name);
      return next;
    });

  return (
    <div className="skills-layout">
      <aside className="skills-sidebar">
        <label className="skills-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search skills and agents"
            aria-label="Search skills and agents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <SkillList
          heading={`Skills (${skills.length})`}
          items={skills}
          selectedName={selected?.name}
          onSelect={select}
        />
        <SkillList
          heading={`Agents (${agents.length})`}
          items={agents}
          selectedName={selected?.name}
          onSelect={select}
        />
        {filtered.length === 0 ? (
          <p className="muted skills-empty">Nothing matches “{query}”.</p>
        ) : null}
      </aside>

      <section className="skills-detail">
        {selected ? (
          <Card>
            <CardHead
              kicker={selected.kind === 'agent' ? 'Specialist agent' : 'PROBE skill'}
              title={
                <span className="skills-title">
                  <code>
                    {selected.kind === 'skill' ? '/yw:' : ''}
                    {selected.name}
                  </code>
                  <Badge tone={TRACK_TONE[selected.track] ?? 'neutral'}>
                    {trackLabel(selected.track)}
                  </Badge>
                  {selected.safety ? <Badge>{selected.safety}</Badge> : null}
                </span>
              }
              subtitle={selected.description}
              actions={
                <div className="guide-view-toggle" role="group" aria-label="How to show this skill">
                  <button
                    type="button"
                    className={view === 'explain' ? 'is-active' : ''}
                    aria-pressed={view === 'explain'}
                    onClick={() => setView('explain')}
                  >
                    Explain
                  </button>
                  <button
                    type="button"
                    className={view === 'preview' ? 'is-active' : ''}
                    aria-pressed={view === 'preview'}
                    onClick={() => setView('preview')}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className={view === 'markdown' ? 'is-active' : ''}
                    aria-pressed={view === 'markdown'}
                    onClick={() => setView('markdown')}
                  >
                    Markdown
                  </button>
                </div>
              }
            />
            <CardBody>
              {view === 'markdown' ? (
                <pre className="skills-source">{selected.markdown}</pre>
              ) : view === 'preview' ? (
                <div className="skills-render">
                  <MarkdownPreview source={selected.markdown} />
                </div>
              ) : (
                <SkillExplanation item={selected} />
              )}
            </CardBody>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function SkillList({
  heading,
  items,
  selectedName,
  onSelect,
}: {
  heading: string;
  items: SkillContent[];
  selectedName?: string;
  onSelect: (name: string) => void;
}): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <nav className="skills-group" aria-label={heading}>
      <p className="skills-group-head">{heading}</p>
      <ul>
        {items.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              className={item.name === selectedName ? 'skills-item is-active' : 'skills-item'}
              aria-current={item.name === selectedName}
              onClick={() => onSelect(item.name)}
            >
              <span className="skills-item-name">{item.name}</span>
              <span className={`skills-item-track track-${item.track}`}>
                {trackLabel(item.track)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SkillExplanation({ item }: { item: SkillContent }): ReactElement {
  return (
    <div className="skills-explain">
      <ExplainBlock title="What it does" body={item.what || item.description} />
      <ExplainBlock title="Why it exists" body={item.why} />
      <ExplainBlock title="How it works" body={item.how} />
      <div className="skills-explain-block skills-harden">
        <p className="guide-arg-label">Harden it for your workflow</p>
        <MarkdownPreview source={item.hardening} />
      </div>
      <p className="skills-explain-foot">
        The three sections above are lifted from the skill&rsquo;s own SKILL.md; switch to{' '}
        <strong>Markdown</strong> or <strong>Preview</strong> to read it in full.
      </p>
    </div>
  );
}

function ExplainBlock({ title, body }: { title: string; body: string }): ReactElement | null {
  if (!body.trim()) return null;
  return (
    <div className="skills-explain-block">
      <p className="guide-arg-label">{title}</p>
      <MarkdownPreview source={body} />
    </div>
  );
}
