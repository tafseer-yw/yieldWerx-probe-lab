/**
 * Generate the Skills & Agents reference data the probe-lab guide renders.
 *
 * Reads every SKILL.md and agent .md from the vendored plugin and emits one
 * committed data module (web/src/skillsContent.generated.ts) holding, per item:
 *   - the verbatim Markdown source (the "Markdown" toggle and the "Preview"),
 *   - front-matter facts (track, safety, argument-hint, produces, consumes),
 *   - the Why / What / How sections lifted from the source,
 *   - a hardening note derived from the item's own config surface.
 *
 * WHY GENERATED-AND-COMMITTED: the app ships offline and cannot read
 * vendor/probe at runtime (it is gitignored and not bundled). Embedding the
 * content keeps the page self-contained; rerun this after the plugin changes.
 *
 *   npx tsx scripts/generate-skills-content.ts            # from ../vendor/probe
 *   npx tsx scripts/generate-skills-content.ts <plugin-root>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

/** The plugin lives at the repo's vendor/probe by default. */
const pluginRoot =
  process.argv[2] ?? path.join(REPO_ROOT, 'vendor', 'probe', 'plugins', 'yieldwerx-probe');

interface Item {
  name: string;
  kind: 'skill' | 'agent';
  track: string;
  safety: string;
  userInvocable: boolean;
  description: string;
  argumentHint: string;
  produces: string;
  consumes: string;
  markdown: string;
  why: string;
  what: string;
  how: string;
  hardening: string;
}

/** Split a Markdown doc into its `---` front matter and body. */
function splitFrontMatter(source: string): { front: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match) return { front: {}, body: source };
  const front: Record<string, string> = {};
  /* Flat, one-line-value front matter only — nested blocks (an agent's graph:)
     are left in the raw source, which is what the page shows anyway. */
  for (const line of (match[1] ?? '').split('\n')) {
    const kv = /^([a-zA-Z-]+):\s*(.*)$/.exec(line);
    if (kv && kv[1] && !line.startsWith(' ')) front[kv[1]] = (kv[2] ?? '').trim();
  }
  return { front, body: match[2] ?? '' };
}

/** The body text of one `## <heading>` section, up to the next `##`. */
function section(body: string, heading: string): string {
  const re = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const m = re.exec(body);
  return (m?.[1] ?? '').trim();
}

/**
 * A hardening note grounded in the item's OWN config surface, not generic
 * advice: what it reads/writes, whether it writes externally, whether it takes
 * a --stack, and which gate it touches. This is where a team makes a portable
 * skill fit their workflow.
 */
function hardening(front: Record<string, string>, body: string, kind: Item['kind']): string {
  const tips: string[] = [];
  const hint = front['argument-hint'] ?? '';
  const safety = front.safety ?? '';

  tips.push(
    'Point the commands and paths this uses at your repo in `probe.config.yaml` — the skill resolves everything through it and never guesses, so a missing entry is reported rather than assumed.',
  );
  if (/--stack/.test(hint)) {
    tips.push(
      'Pin the `--stack` you actually build on (or set a default profile), so the layer map, conventions, and commands come from your stack rather than a generic one.',
    );
  }
  if (
    /writes-shared|writes-external/.test(safety) ||
    /--live|--push|--open-pr|sync|--authorize/.test(hint)
  ) {
    tips.push(
      'This can write outside your working tree. Keep the preview/dry-run default, and gate the live write behind a recorded human approval — never wire it to run unattended.',
    );
  }
  if (/@manual|@automated|case|feature file/i.test(body)) {
    tips.push(
      'Encode your own tag and severity conventions once (in the config or a rule file); the skill then carries them into every artifact instead of you re-stating them.',
    );
  }
  if (kind === 'agent') {
    tips.push(
      'An agent is only as good as its inputs — make sure the artifacts it `consumes` are real and current, and read its output as a claim to verify, not a verdict to trust.',
    );
  }
  tips.push(
    'Run it once on a small, known feature (the bin pareto CSV export is a good one) and read every line of what it produced — that is how you learn where it needs tightening for your team.',
  );
  return tips.map((t) => `- ${t}`).join('\n');
}

function collect(dir: string, kind: Item['kind'], filenameOf: (name: string) => string): Item[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir, { withFileTypes: true });
  const items: Item[] = [];
  for (const entry of names) {
    const file = filenameOf(entry.name);
    const full =
      kind === 'skill' ? path.join(dir, entry.name, 'SKILL.md') : path.join(dir, entry.name);
    if (kind === 'skill' && !entry.isDirectory()) continue;
    if (kind === 'agent' && !entry.name.endsWith('.md')) continue;
    if (!existsSync(full)) continue;
    const source = readFileSync(full, 'utf8');
    const { front, body } = splitFrontMatter(source);
    items.push({
      name: front.name ?? file.replace(/\.md$/, ''),
      kind,
      track: front.track ?? 'cross',
      safety: front.safety ?? '',
      userInvocable: front['user-invocable'] === 'true',
      description: front.description ?? '',
      argumentHint: front['argument-hint'] ?? '',
      produces: front.produces ?? '',
      consumes: front.consumes ?? '',
      markdown: source,
      why: section(body, 'Why'),
      what: section(body, 'What'),
      how: section(body, 'How') || section(body, 'Procedure'),
      hardening: hardening(front, body, kind),
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

const skills = collect(path.join(pluginRoot, 'skills'), 'skill', (n) => n);
const agents = collect(path.join(pluginRoot, 'agents'), 'agent', (n) => n);

if (skills.length === 0) {
  process.stderr.write(
    `No skills found under ${pluginRoot}. Clone the plugin to vendor/probe first, ` +
      `or pass its path.\n`,
  );
  process.exit(1);
}

const out = path.join(APP_ROOT, 'web', 'src', 'skillsContent.generated.ts');
const banner =
  '/* GENERATED by scripts/generate-skills-content.ts from the yieldwerx-probe plugin.\n' +
  ' * Do not edit by hand — rerun the generator after the plugin changes. */\n';
writeFileSync(
  out,
  `${banner}import type { SkillContent } from './skillsContent.js';\n\n` +
    `export const SKILLS_CONTENT: SkillContent[] = ${JSON.stringify([...skills, ...agents], null, 2)};\n`,
);
process.stdout.write(
  `Wrote ${path.relative(REPO_ROOT, out)} — ${skills.length} skills + ${agents.length} agents.\n`,
);
