import { useState, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert, Badge, Card, CardBody, CardHead, Icon } from './ui.js';

type GuideSection = 'start' | 'plugins' | 'cowork' | 'dev' | 'qa';

const guideSections: Array<{ id: GuideSection; label: string; hint: string }> = [
  { id: 'start', label: 'Get started', hint: 'Run the lab' },
  { id: 'plugins', label: 'Plugins', hint: 'Clone and understand' },
  { id: 'cowork', label: 'Claude & Cowork', hint: 'Install and invoke' },
  { id: 'dev', label: 'Dev track', hint: 'Build and review' },
  { id: 'qa', label: 'QA track', hint: 'Design and automate' },
];

const validSections = new Set<GuideSection>(guideSections.map((section) => section.id));

interface TrackStep {
  command: string;
  title: string;
  purpose: string;
  agents?: string;
}

const devSteps: TrackStep[] = [
  {
    command: '/yw:scaffold-app <app-slug> --stack node-ts-spa',
    title: 'Start a new application',
    purpose:
      'Create the contracts, datastore, roles, documented API, and testability surface before features.',
  },
  {
    command: '/yw:build-feature <feature-slug> --requirement <path>',
    title: 'Build a feature',
    purpose:
      'Clarify intent, implement bounded work, and verify the result. Use --no-requirement only with a recorded reason.',
    agents: 'requirement-clarifier · testability-scout · build-verifier',
  },
  {
    command: '/yw:revise-feature <feature-slug> -- <required change>',
    title: 'Change existing behavior',
    purpose:
      'Make the smallest compatible revision and produce a downstream QA-artifact invalidation list.',
    agents: 'requirement-clarifier · testability-scout · build-verifier',
  },
  {
    command: '/yw:fix-defect <feature-slug> "<symptom>"',
    title: 'Fix a defect',
    purpose:
      'Reproduce the failure, add a failing regression first, implement the smallest correct fix, and verify it.',
    agents: 'build-verifier',
  },
  {
    command: '/yw:seed-testability <feature-slug> --surface all',
    title: 'Repair legacy testability gaps',
    purpose:
      'Add stable selectors, served API documentation, and readable business values to older code.',
    agents: 'testability-scout',
  },
  {
    command: '/yw:review-code <feature-slug> --staged --depth thorough',
    title: 'Run independent review',
    purpose:
      'Review correctness, security, data integrity, observability, and testability without editing the change.',
    agents: 'code-reviewer · build-verifier',
  },
  {
    command: '/yw:ship-change <feature-slug> describe',
    title: 'Prepare the handoff',
    purpose:
      'Create reviewable ship notes or local commits. Pushes and pull requests still require explicit authorization.',
    agents: 'code-reviewer',
  },
];

const qaSteps: TrackStep[] = [
  {
    command: '/yw:ask-yieldwerx <question>',
    title: 'Get product context',
    purpose:
      'Ask the Knowledgebase about YieldWerx terms, modules, calculations, or workflows. Context cannot invent requirements.',
    agents: 'Knowledgebase routing skill',
  },
  {
    command: '/yw:probe-spec <feature-slug> <approved-spec>',
    title: 'Make the requirement testable',
    purpose:
      'Extract stable acceptance criteria, categories, ambiguities, domain needs, and the feature ledger.',
    agents: 'source-digester',
  },
  {
    command: '/yw:probe-implementation <feature-slug> local',
    title: 'Compare intent with the build',
    purpose: 'Classify each observable AC as aligned, divergent, absent, unobservable, or blocked.',
    agents: 'implementation-prober',
  },
  {
    command: '/yw:forge-cases <feature-slug> --scenario-type all',
    title: 'Design executable cases',
    purpose:
      'Create procedural manual scenarios with coverage, data, pacing, and visual dispositions.',
    agents: 'test-case-designer',
  },
  {
    command: '/yw:audit-cases <feature-slug>',
    title: 'Audit the design independently',
    purpose:
      'Challenge coverage, traceability, procedure, boundaries, and data feasibility before approval.',
    agents: 'test-case-auditor',
  },
  {
    command: '/yw:gate-design <feature-slug>',
    title: 'Assemble Design Gate evidence',
    purpose:
      'Produce a decision-ready report. A named human signs or explicitly records a scoped bypass.',
  },
  {
    command:
      '/yw:ui-recon <feature-slug> local --with-api-recon --spec http://127.0.0.1:5000/openapi.json',
    title: 'Recon the running application',
    purpose: 'Capture stable UI contracts and API behavior from one coordinated browser session.',
    agents: 'ui-recon-agent · implementation-prober',
  },
  {
    command: '/yw:execute-cases <feature-slug> local --continue-on-failure',
    title: 'Execute and preserve evidence',
    purpose: 'Run approved cases with isolated state, exact step verdicts, and failure evidence.',
  },
  {
    command: '/yw:forge-scripts <feature-slug> --scenario-type all',
    title: 'Automate approved cases',
    purpose: 'Generate runnable automation without removing the permanent manual record.',
    agents: 'e2e-scripter · plotly-specialist when applicable',
  },
  {
    command: '/yw:audit-scripts <feature-slug>',
    title: 'Audit automation',
    purpose:
      'Independently inspect assertions, selectors, synchronization, isolation, and traceability.',
    agents: 'script-auditor',
  },
  {
    command: '/yw:green-run <feature-slug>',
    title: 'Prove repeatability',
    purpose: 'Record three consecutive green runs before Merge Gate evidence is assembled.',
  },
  {
    command: '/yw:gate-merge <feature-slug>',
    title: 'Assemble Merge Gate evidence',
    purpose: 'Report readiness honestly; the human decision remains separate from the evidence.',
  },
  {
    command: '/yw:testops-promote <feature-slug>',
    title: 'Promote to CI',
    purpose: 'Run the suite in CI with durable evidence and fail-on-flake behavior.',
    agents: 'testops-engineer',
  },
  {
    command: '/yw:gate-ops <feature-slug>',
    title: 'Finish the automation lifecycle',
    purpose:
      'Assemble the five-run, flake-rate, synchronization, and manual-only evidence for human review.',
  },
];

function initialSection(value: string | null): GuideSection {
  return value && validSections.has(value as GuideSection) ? (value as GuideSection) : 'start';
}

export function ProbeGuidePage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = initialSection(searchParams.get('section'));
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (id: string): void => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Card>
        <CardHead
          kicker="Interactive handbook"
          title="PROBE Lab guide"
          subtitle="From first install to a complete Dev or QA practice run. Progress is kept for this page session only."
        />
        <CardBody>
          <nav className="guide-tabs" aria-label="PROBE guide sections">
            {guideSections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                className={active === section.id ? 'guide-tab is-active' : 'guide-tab'}
                aria-current={active === section.id ? 'page' : undefined}
                onClick={() => setSearchParams({ section: section.id })}
              >
                <span className="guide-tab-number">{index + 1}</span>
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.hint}</small>
                </span>
              </button>
            ))}
          </nav>
        </CardBody>
      </Card>

      {active === 'start' ? <GettingStarted completed={completed} toggle={toggle} /> : null}
      {active === 'plugins' ? <PluginIntroduction completed={completed} toggle={toggle} /> : null}
      {active === 'cowork' ? <CoworkGuide completed={completed} toggle={toggle} /> : null}
      {active === 'dev' ? (
        <TrackGuide kind="dev" steps={devSteps} completed={completed} toggle={toggle} />
      ) : null}
      {active === 'qa' ? (
        <TrackGuide kind="qa" steps={qaSteps} completed={completed} toggle={toggle} />
      ) : null}
    </>
  );
}

interface ChecklistProps {
  completed: Set<string>;
  toggle: (id: string) => void;
}

function GettingStarted({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="Get the lab running"
        subtitle="Run these commands from the repository root."
      />
      <CardBody>
        <div className="guide-callout-grid">
          <GuideCallout title="Prerequisites" icon="info">
            Node.js 22.18 or newer, npm, Git, and a Chromium-capable workstation. Git LFS is also
            needed when cloning the Knowledgebase source documents.
          </GuideCallout>
          <GuideCallout title="Local addresses" icon="target">
            Web app: <code>http://127.0.0.1:3000</code>
            <br />
            API: <code>http://127.0.0.1:5000</code>
            <br />
            OpenAPI: <code>/docs</code>
          </GuideCallout>
        </div>
        <CommandBlock
          label="Install everything"
          command={'npm install\nnpx playwright install chromium'}
        />
        <CommandBlock label="Seed and start the app" command="npm run app:dev" />
        <Alert tone="info">
          Sign in with <code>engineer / engineer</code> for uploads, or <code>admin / admin</code>{' '}
          to manage sample wafers. These are local practice credentials only.
        </Alert>
        <Checklist
          prefix="start"
          items={[
            'Install root and app dependencies',
            'Install the Playwright Chromium browser',
            'Start the API and web app',
            'Open the dashboard and sign in',
            'Run npm test from a second terminal',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}

function PluginIntroduction({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="PROBE and Knowledgebase"
        subtitle="Two plugins, two responsibilities, installed in the same Claude environment."
      />
      <CardBody>
        <div className="guide-callout-grid">
          <GuideCallout title="yieldWerx PROBE" icon="check">
            Owns the Dev and QA workflows, evidence lifecycle, specialist agents, reviews, and
            gates.{' '}
            <ExternalLink href="https://github.com/tafseer-yw/yieldwerx-probe">
              Open GitHub repository
            </ExternalLink>
          </GuideCallout>
          <GuideCallout title="yieldWerx Knowledgebase" icon="file">
            Supplies source-traceable product and domain context. It explains terms but never
            replaces the approved requirement.{' '}
            <ExternalLink href="https://github.com/tafseer-yw/yieldwerx-knowledgebase">
              Open GitHub repository
            </ExternalLink>
          </GuideCallout>
        </div>
        <CommandBlock
          label="Clone PROBE"
          command="git clone https://github.com/tafseer-yw/yieldwerx-probe.git"
        />
        <CommandBlock
          label="Clone the Knowledgebase"
          command={
            'git lfs install\ngit clone https://github.com/tafseer-yw/yieldwerx-knowledgebase.git'
          }
        />
        <Alert tone="info">
          Cloning gives you local source for inspection and contribution. It does not install the
          plugins into Claude; complete the Claude & Cowork section next.
        </Alert>
        <Checklist
          prefix="plugins"
          items={[
            'Read the PROBE repository overview',
            'Install Git LFS',
            'Clone both repositories as sibling folders',
            'Keep requirements separate from Knowledgebase context',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}

function CoworkGuide({ completed, toggle }: ChecklistProps): ReactElement {
  return (
    <Card>
      <CardHead
        title="Install in Claude Desktop and use in Cowork"
        subtitle="Plugins work in Claude chat and Cowork; specialist sub-agents run in Cowork."
      />
      <CardBody>
        <Alert tone="info">
          Claude plugins require a paid plan. On Team or Enterprise, your organization must also
          allow Cowork and Skills, and an admin may manage which plugins are available.
        </Alert>
        <ol className="guide-steps">
          <li>
            Open the latest Claude Desktop, switch to <strong>Cowork</strong>, then open{' '}
            <strong>Customize → Plugins</strong>.
          </li>
          <li>
            Under Personal plugins, select{' '}
            <strong>+ → Add marketplace → Add from a repository</strong>.
          </li>
          <li>
            Add both GitHub repository URLs shown below and install <strong>yieldWerx PROBE</strong>{' '}
            plus <strong>yieldWerx Knowledgebase</strong>.
          </li>
          <li>
            Start a Cowork task, grant access only to the local repository folder you intend to
            practice in, and review the proposed plan.
          </li>
          <li>
            Type <strong>/</strong> or use the <strong>+</strong> menu, choose a <code>/yw:*</code>{' '}
            skill, then provide its arguments.
          </li>
        </ol>
        <CommandBlock
          label="Marketplace repositories"
          command={
            'https://github.com/tafseer-yw/yieldwerx-probe.git\nhttps://github.com/tafseer-yw/yieldwerx-knowledgebase.git'
          }
        />
        <CommandBlock
          label="Claude Code alternative"
          command={
            '/plugin marketplace add https://github.com/tafseer-yw/yieldwerx-probe.git\n/plugin marketplace add https://github.com/tafseer-yw/yieldwerx-knowledgebase.git\n/plugin install yieldwerx-knowledgebase@yieldwerx-company\n/plugin install yw@yieldwerx\n/reload-plugins'
          }
        />
        <GuideCallout title="How skills and agents differ" icon="info">
          You invoke public skills such as <code>/yw:build-feature</code> or{' '}
          <code>/yw:forge-cases</code>. Those skills delegate bounded work to their specialist
          agents. Do not treat internal agent names as slash commands.
        </GuideCallout>
        <p className="guide-links">
          <ExternalLink href="https://support.claude.com/en/articles/13837440-use-plugins-in-claude">
            Anthropic plugin instructions
          </ExternalLink>
          <ExternalLink href="https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork">
            Anthropic Cowork guide
          </ExternalLink>
        </p>
        <Checklist
          prefix="cowork"
          items={[
            'Open Cowork in Claude Desktop',
            'Add both marketplaces',
            'Install both plugins',
            'Connect the PROBE Lab folder',
            'Open the slash menu and verify /yw skills appear',
          ]}
          completed={completed}
          toggle={toggle}
        />
      </CardBody>
    </Card>
  );
}

function TrackGuide({
  kind,
  steps,
  completed,
  toggle,
}: ChecklistProps & { kind: 'dev' | 'qa'; steps: TrackStep[] }): ReactElement {
  const isDev = kind === 'dev';
  return (
    <Card>
      <CardHead
        kicker="Focused practice page"
        title={isDev ? 'Dev track' : 'QA track'}
        subtitle={
          isDev
            ? 'Build and correct the application without waiting on QA gates.'
            : 'Turn approved requirements into reviewed cases, automation, and durable evidence.'
        }
        actions={<Badge tone={isDev ? 'accent' : 'good'}>{steps.length} stages</Badge>}
      />
      <CardBody>
        <Alert tone="info">
          {isDev
            ? 'QA artifacts are optional enrichment for Dev skills, never a precondition. Dev skills do not edit QA-owned artifacts.'
            : 'QA observes the build but does not edit application code. Human reviewers own gate approvals and scoped bypass decisions.'}
        </Alert>
        <Alert>
          <strong>Practice target — Wafer triage:</strong>{' '}
          {isDev
            ? 'Trace the shared DTO, documented endpoint, weighted matcher, and standalone triage UI; preserve the insufficient-data and no-close-match safeguards.'
            : 'Exercise exact reference matches, the unfamiliar 25-die no-close case, and fewer than three failures; verify the score is never presented as confidence or diagnosis.'}
        </Alert>
        <div className="guide-track-list">
          {steps.map((step, index) => {
            const id = `${kind}-${index}`;
            return (
              <article
                className={completed.has(id) ? 'guide-track-step is-complete' : 'guide-track-step'}
                key={step.command}
              >
                <label className="guide-step-check">
                  <input type="checkbox" checked={completed.has(id)} onChange={() => toggle(id)} />
                  <span>{index + 1}</span>
                </label>
                <div className="guide-track-copy">
                  <h3>{step.title}</h3>
                  <p>{step.purpose}</p>
                  <CommandBlock command={step.command} compact />
                  {step.agents ? (
                    <p className="guide-agent">
                      <strong>Delegates to:</strong> {step.agents}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function Checklist({
  prefix,
  items,
  completed,
  toggle,
}: ChecklistProps & { prefix: string; items: string[] }): ReactElement {
  const count = items.filter((_, index) => completed.has(`${prefix}-${index}`)).length;
  return (
    <section className="guide-checklist" aria-labelledby={`${prefix}-checklist`}>
      <div className="guide-checklist-head">
        <h3 id={`${prefix}-checklist`}>Your checklist</h3>
        <Badge tone={count === items.length ? 'good' : 'neutral'}>
          {count} / {items.length}
        </Badge>
      </div>
      <div
        className="guide-progress"
        role="progressbar"
        aria-label={`${count} of ${items.length} complete`}
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={count}
      >
        <span style={{ width: `${items.length === 0 ? 0 : (count / items.length) * 100}%` }} />
      </div>
      {items.map((item, index) => {
        const id = `${prefix}-${index}`;
        return (
          <label className="guide-check" key={id}>
            <input type="checkbox" checked={completed.has(id)} onChange={() => toggle(id)} />
            <span>{item}</span>
          </label>
        );
      })}
    </section>
  );
}

function CommandBlock({
  label,
  command,
  compact = false,
}: {
  label?: string;
  command: string;
  compact?: boolean;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={compact ? 'guide-command is-compact' : 'guide-command'}>
      {label ? <span className="guide-command-label">{label}</span> : null}
      <pre>
        <code>{command}</code>
      </pre>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => void copy()}
        aria-label={`Copy ${label ?? 'command'}`}
      >
        <Icon name={copied ? 'check' : 'clipboard'} size={14} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function GuideCallout({
  title,
  icon,
  children,
}: {
  title: string;
  icon: 'check' | 'file' | 'info' | 'target';
  children: ReactNode;
}): ReactElement {
  return (
    <section className="guide-callout">
      <span className="guide-callout-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </section>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a className="guide-external" href={href} target="_blank" rel="noreferrer">
      {children}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
