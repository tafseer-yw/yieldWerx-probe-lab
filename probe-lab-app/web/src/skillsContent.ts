/**
 * The shape of one Skills & Agents reference entry. The data itself is
 * generated into skillsContent.generated.ts by
 * scripts/generate-skills-content.ts from the plugin's SKILL.md / agent files.
 */
export interface SkillContent {
  name: string;
  kind: 'skill' | 'agent';
  track: string;
  safety: string;
  userInvocable: boolean;
  description: string;
  argumentHint: string;
  produces: string;
  consumes: string;
  /** The verbatim SKILL.md / agent Markdown — the Markdown and Preview toggles. */
  markdown: string;
  /** Sections lifted from the source, for the Explanation toggle. */
  why: string;
  what: string;
  how: string;
  /** Config-grounded hardening guidance, derived by the generator. */
  hardening: string;
}

export { SKILLS_CONTENT } from './skillsContent.generated.js';
