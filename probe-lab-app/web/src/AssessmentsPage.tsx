import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import type {
  AssessmentEffort,
  AssessmentOutcome,
  AssessmentStatusEntry,
  AssessmentsResponse,
  AssessmentTrack,
} from '../../shared/assessments.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { Alert, Badge, Card, CardBody, CardHead, Icon, Skeleton, type Tone } from './ui.js';

/*
 * The self-paced assessment ladder: 15 per track, first skills first, each
 * worth points by effort. Results are self-recorded — the page says so plainly
 * instead of pretending to verify anything — and the submission method is a
 * pull request whose link is recorded with the result.
 */

const EFFORT_LABEL: Record<AssessmentEffort, string> = {
  starter: 'Starter',
  core: 'Core',
  advanced: 'Advanced',
  expert: 'Expert',
};

/* Effort is progression, not danger — so the ladder runs neutral → accent,
   not toward the error color. */
const EFFORT_TONE: Record<AssessmentEffort, Tone> = {
  starter: 'good',
  core: 'accent',
  advanced: 'warning',
  expert: 'critical',
};

function trackFromParams(value: string | null): AssessmentTrack {
  return value === 'qa' ? 'qa' : 'dev';
}

export function AssessmentsPage(): ReactElement {
  const { api, session } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const track = trackFromParams(params.get('track'));
  const [error, setError] = useState<string>();

  const query = useQuery({ queryKey: ['assessments'], queryFn: () => api.getAssessments() });
  const data: AssessmentsResponse | undefined = query.data;

  const record = useMutation({
    mutationFn: (input: { id: string; outcome: AssessmentOutcome; evidenceUrl?: string }) =>
      api.recordAssessment(input.id, input.outcome, input.evidenceUrl),
    onSuccess: (next) => {
      setError(undefined);
      queryClient.setQueryData(['assessments'], next);
    },
    onError: (err: unknown) => setError(errorMessage(err)),
  });
  const clear = useMutation({
    mutationFn: (id: string) => api.clearAssessment(id),
    onSuccess: (next) => {
      setError(undefined);
      queryClient.setQueryData(['assessments'], next);
    },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  const busy = record.isPending || clear.isPending;
  const visible = (data?.assessments ?? []).filter((entry) => entry.track === track);
  const summary = data?.summary;
  const progressToNext =
    summary && summary.nextLevel
      ? Math.min(
          100,
          Math.round(
            ((summary.score - summary.level.minPoints) /
              (summary.nextLevel.minPoints - summary.level.minPoints)) *
              100,
          ),
        )
      : 100;

  return (
    <div className="stack">
      {summary ? (
        <Card>
          <CardHead
            kicker="Your standing"
            title={summary.level.name}
            subtitle={
              summary.nextLevel
                ? `${summary.score} points — ${summary.nextLevel.minPoints - summary.score} more to ${summary.nextLevel.name}`
                : `${summary.score} points — the top of the ladder`
            }
            actions={
              <Badge tone="accent">
                <span data-testid="assessment-score">{summary.score}</span>
                &nbsp;/ {summary.maxScore} pts
              </Badge>
            }
          />
          <CardBody>
            <div
              className="assessment-progress"
              role="progressbar"
              aria-label="Progress to the next level"
              aria-valuenow={progressToNext}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="assessment-progress-fill" style={{ width: `${progressToNext}%` }} />
            </div>
            <p className="muted assessment-honesty">
              Signed in as <strong>{session?.user.username}</strong> — results are recorded per
              account, on your word. Passing adds the assessment&rsquo;s points; a standing fail
              subtracts half of them until you clear or pass it. Submit the work itself as a{' '}
              <strong>pull request</strong> and record its link with your result, so every pass
              points at something a reviewer can open.
            </p>
            {data && data.standings.length > 0 ? (
              <div className="assessment-standings">
                <p className="guide-arg-label">Team standings</p>
                <table className="data" data-testid="assessment-standings">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Level</th>
                      <th className="num">Points</th>
                      <th className="num">Passed</th>
                      <th className="num">Failing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.standings.map((row) => (
                      <tr key={row.username}>
                        <td>
                          {row.username}
                          {row.username === session?.user.username ? ' (you)' : ''}
                        </td>
                        <td>{row.levelName}</td>
                        <td className="num">{row.score}</td>
                        <td className="num">{row.passed}</td>
                        <td className="num">{row.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {query.isLoading ? (
        <Card>
          <Skeleton rows={6} />
        </Card>
      ) : null}
      {query.error ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {data ? (
        <Card>
          <CardHead
            title={track === 'dev' ? 'Dev track' : 'QA track'}
            subtitle="Fifteen assessments, first skills first. Pick the next one you have not passed."
            actions={
              <div className="guide-view-toggle" role="group" aria-label="Assessment track">
                <button
                  type="button"
                  className={track === 'dev' ? 'is-active' : ''}
                  aria-pressed={track === 'dev'}
                  onClick={() => setParams({ track: 'dev' })}
                >
                  Dev track
                </button>
                <button
                  type="button"
                  className={track === 'qa' ? 'is-active' : ''}
                  aria-pressed={track === 'qa'}
                  onClick={() => setParams({ track: 'qa' })}
                >
                  QA track
                </button>
              </div>
            }
          />
          <CardBody>
            <div className="assessment-list" data-testid="assessment-list">
              {visible.map((entry) => (
                <AssessmentCard
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  onRecord={(outcome, evidenceUrl) =>
                    record.mutate({ id: entry.id, outcome, evidenceUrl })
                  }
                  onClear={() => clear.mutate(entry.id)}
                />
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function AssessmentCard({
  entry,
  busy,
  onRecord,
  onClear,
}: {
  entry: AssessmentStatusEntry;
  busy: boolean;
  onRecord: (outcome: AssessmentOutcome, evidenceUrl?: string) => void;
  onClear: () => void;
}): ReactElement {
  const [evidence, setEvidence] = useState('');

  return (
    <article className="assessment" data-testid={`assessment-${entry.id}`}>
      <header className="assessment-head">
        <span className="assessment-order num">{String(entry.order).padStart(2, '0')}</span>
        <h3>{entry.title}</h3>
        <div className="assessment-tags">
          <Badge tone={EFFORT_TONE[entry.effort]}>{EFFORT_LABEL[entry.effort]}</Badge>
          <Badge>
            {entry.points} pts · {entry.timeHint}
          </Badge>
          {entry.status === 'passed' ? (
            <Badge tone="good" icon="check">
              Passed
            </Badge>
          ) : null}
          {entry.status === 'failed' ? (
            <Badge tone="critical" icon="warning">
              Failing (−{entry.penalty})
            </Badge>
          ) : null}
        </div>
      </header>

      <p className="assessment-mission">{entry.mission}</p>

      <div className="assessment-skills">
        {entry.skills.map((skill) => (
          <code key={skill}>{skill}</code>
        ))}
      </div>

      <p className="guide-arg-label">Pass when</p>
      <ul className="assessment-pass-when">
        {entry.passWhen.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <footer className="assessment-foot">
        <input
          type="url"
          className="assessment-evidence"
          placeholder="Pull request link (how you submit the work)"
          aria-label={`Pull request link for ${entry.title}`}
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          disabled={busy}
        />
        <div className="assessment-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => onRecord('passed', evidence)}
          >
            <Icon name="check" size={14} />
            Record pass
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy}
            onClick={() => onRecord('failed', evidence)}
          >
            <Icon name="close" size={14} />
            Record fail
          </button>
          {entry.status !== null ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={onClear}
            >
              Clear
            </button>
          ) : null}
        </div>
      </footer>

      {entry.evidenceUrl ? (
        <p className="assessment-evidence-link">
          Submitted:{' '}
          <a href={entry.evidenceUrl} target="_blank" rel="noreferrer">
            {entry.evidenceUrl}
          </a>
          {entry.attempts > 1 ? ` · attempt ${entry.attempts}` : ''}
        </p>
      ) : entry.attempts > 1 ? (
        <p className="assessment-evidence-link">Attempt {entry.attempts}</p>
      ) : null}
    </article>
  );
}
