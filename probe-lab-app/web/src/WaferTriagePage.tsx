import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

import type {
  BinParetoResponse,
  ClusterDetectionResult,
  SignatureMatchResponse,
  WaferDetail,
} from '../../shared/contracts.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import { Alert, Badge, Card, CardBody, CardHead, EmptyState, Icon, Skeleton, Stat } from './ui.js';
import { WaferMap } from './WaferMap.js';
import { WaferPicker } from './WaferPicker.js';

interface TriageData {
  wafer: WaferDetail;
  match: SignatureMatchResponse;
  clusters: ClusterDetectionResult;
  pareto: BinParetoResponse;
}

function initialSequence(state: unknown): number | null {
  if (typeof state === 'object' && state !== null && 'waferSequence' in state) {
    const value = (state as { waferSequence: unknown }).waferSequence;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function TriageProfileBar({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="triage-profile-row">
      <div>
        <span>{label}</span>
        <strong>{percentage(value)}</strong>
      </div>
      <span className="triage-profile-track" aria-hidden="true">
        <span style={{ width: `${value * 100}%` }} />
      </span>
    </div>
  );
}

function SignatureAssessment({ match }: { match: SignatureMatchResponse }): ReactElement {
  const status =
    match.status === 'matched'
      ? { label: 'Reference match', tone: 'good' as const, icon: 'check' as const }
      : match.status === 'no-close-match'
        ? { label: 'No close match', tone: 'warning' as const, icon: 'info' as const }
        : { label: 'Insufficient data', tone: 'neutral' as const, icon: 'info' as const };

  return (
    <div className="signature-result" data-testid="triage-signature-result" aria-live="polite">
      <div className="signature-result-head">
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
        <span className="muted">
          Match needed {percentage(match.threshold)} · {match.matcher.referenceCount} examples
        </span>
      </div>

      {match.bestMatch ? (
        <div className="signature-primary">
          <div className="signature-primary-copy">
            <span className="kicker">
              {match.status === 'matched'
                ? 'Closest example'
                : 'Closest example, below the match needed'}
            </span>
            <h3>{match.bestMatch.label}</h3>
            <p className="muted">{match.bestMatch.summary}</p>
          </div>
          <div className="signature-score">
            <strong>{percentage(match.bestMatch.matchScore)}</strong>
            <span>match score</span>
          </div>
          <div
            className="signature-meter"
            role="progressbar"
            aria-label="Wafer signature match score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(match.bestMatch.matchScore * 100)}
          >
            <span style={{ width: `${match.bestMatch.matchScore * 100}%` }} />
          </div>
        </div>
      ) : null}

      <div className="signature-detail-grid">
        <div>
          <h4>What the app found</h4>
          <ul className="signature-evidence">
            {match.evidence.map((item) => (
              <li key={item}>
                <Icon name="tick" size={14} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        {match.alternatives.length > 0 ? (
          <div>
            <h4>Other examples</h4>
            <div className="signature-alternatives">
              {match.alternatives.map((candidate) => (
                <div className="signature-alternative" key={candidate.referenceKey}>
                  <span>{candidate.label}</span>
                  <strong>{percentage(candidate.matchScore)}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <Alert tone="info">{match.disclaimer}</Alert>
    </div>
  );
}

export function WaferTriagePage(): ReactElement {
  const { api } = useAuth();
  const location = useLocation();
  const initial = initialSequence(location.state);
  const [selectedSequence, setSelectedSequence] = useState<number | null>(initial);
  const [request, setRequest] = useState<number | null>(initial);

  const query = useQuery({
    queryKey: ['wafer-triage', request],
    enabled: request !== null,
    queryFn: async (): Promise<TriageData> => {
      const sequence = request as number;
      const [wafer, match, clusters, pareto] = await Promise.all([
        api.getWafer(sequence),
        api.getSignatureMatch(sequence),
        api.detectClusters(sequence, { adjacency: '4-way', minimumConnectedDies: 2 }),
        api.getBinPareto(sequence, {
          binType: 'Hard Bin',
          specifyBins: 'Failed Bins Only',
          sortBy: 'Bin Occurrence',
        }),
      ]);
      return { wafer, match, clusters, pareto };
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (selectedSequence === null) return;
    setRequest(selectedSequence);
  };

  const data = query.data;
  const highlighted = useMemo(() => {
    if (!data || data.clusters.clusters.length === 0) return undefined;
    return new Set(
      data.clusters.clusters.flatMap((cluster) =>
        cluster.coordinates.map((coordinate) => `${coordinate.x}:${coordinate.y}`),
      ),
    );
  }, [data]);

  const dominantBin = data?.pareto.bins[0];
  const largestCluster = data?.clusters.clusters[0]?.dieCount ?? 0;
  const clusteredDies =
    data?.clusters.clusters.reduce((sum, cluster) => sum + cluster.dieCount, 0) ?? 0;
  const nextChecks = data
    ? [
        data.match.status === 'matched' && data.match.bestMatch
          ? `Compare what the app found with the ${data.match.bestMatch.label} example. The label does not tell you the cause.`
          : data.match.status === 'no-close-match'
            ? 'Review the wafer map directly because none of the practice examples was close enough.'
            : 'Collect more failed dies before comparing the pattern.',
        largestCluster > 0
          ? `Check the largest side-touching group first: ${largestCluster.toLocaleString()} dies.`
          : 'No side-touching group had at least two failed dies. Check the separate failures one by one.',
        dominantBin
          ? `Start bin-level review with Hard bin ${dominantBin.binNumber}: ${dominantBin.dieCount.toLocaleString()} dies (${dominantBin.binPercentage.toFixed(2)}% of the wafer).`
          : 'No failed hard bins are available for Pareto prioritization.',
      ]
    : [];

  return (
    <>
      <Card>
        <CardHead
          title="Run wafer triage"
          subtitle="One read-only view of the pattern match, failure locations, touching groups, and top bins."
        />
        <CardBody>
          <form onSubmit={onSubmit} className="triage-form">
            <WaferPicker
              initialSequence={initial}
              disabled={query.isFetching}
              onSelect={(sequence) => {
                setSelectedSequence(sequence);
                if (sequence !== request) setRequest(null);
              }}
            />
            <div className="triage-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={query.isFetching || selectedSequence === null}
              >
                <Icon name={query.isFetching ? 'refresh' : 'target'} size={15} />
                {query.isFetching ? 'Running…' : 'Run triage'}
              </button>
              <span className="muted">Nothing is saved, diagnosed, or re-binned.</span>
            </div>
          </form>
        </CardBody>
      </Card>

      {query.error ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}

      {query.isLoading ? (
        <Card>
          <Skeleton rows={5} />
        </Card>
      ) : null}

      {request === null ? (
        <Card>
          <EmptyState
            icon="target"
            title="No wafer triaged yet"
            hint="Search for and select a wafer to assemble its lightweight, explainable analytics."
          />
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="stats" aria-label="Wafer triage summary">
            <Stat
              label="Yield"
              value={`${data.wafer.yield.toFixed(2)}%`}
              foot={`${data.wafer.lot} · wafer ${data.wafer.waferNumber}`}
              accent
            />
            <Stat
              label="Failing dies"
              value={data.match.failureDies.toLocaleString()}
              foot={`of ${data.match.totalDies.toLocaleString()} measured`}
            />
            <Stat
              label="Touching groups"
              value={data.clusters.clustersFound.toLocaleString()}
              foot={`${clusteredDies.toLocaleString()} failed dies in groups`}
            />
            <Stat
              label="Top failure bin"
              value={dominantBin ? `HB ${dominantBin.binNumber}` : '—'}
              foot={
                dominantBin
                  ? `${dominantBin.dieCount.toLocaleString()} dies · ${dominantBin.binPercentage.toFixed(2)}%`
                  : 'No failed hard bins'
              }
            />
          </div>

          <div className="grid-2 triage-top-grid">
            <Card>
              <CardHead
                title="Pattern match"
                subtitle="Compares this wafer with three fixed practice examples."
                help={help.signatureMatch}
              />
              <CardBody>
                <SignatureAssessment match={data.match} />
              </CardBody>
            </Card>

            <Card>
              <CardHead
                title="Where failures appear"
                subtitle="The share of failed dies in the center, middle, and edge."
              />
              <CardBody>
                <div className="triage-profile">
                  <TriageProfileBar
                    label="Center"
                    value={data.match.analytics.radialFailureRates.center}
                  />
                  <TriageProfileBar
                    label="Middle"
                    value={data.match.analytics.radialFailureRates.middle}
                  />
                  <TriageProfileBar
                    label="Edge"
                    value={data.match.analytics.radialFailureRates.edge}
                  />
                </div>
                <div className="triage-metric-grid">
                  <div className="triage-metric">
                    <span>Line-like shape</span>
                    <strong>{percentage(data.match.analytics.spatialLinearity)}</strong>
                  </div>
                  <div className="triage-metric">
                    <span>Failures in groups</span>
                    <strong>{percentage(data.match.analytics.clusteredFailureShare)}</strong>
                  </div>
                  <div className="triage-metric">
                    <span>Failures in largest group</span>
                    <strong>{percentage(data.match.analytics.largestClusterShare)}</strong>
                  </div>
                  <div className="triage-metric">
                    <span>Failures in top bin</span>
                    <strong>{percentage(data.match.analytics.dominantFailBinShare)}</strong>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="grid-2">
            <Card>
              <CardHead
                title="Wafer map with clusters"
                subtitle={
                  data.clusters.clustersFound > 0
                    ? `Ringed dies belong to ${data.clusters.clustersFound} side-touching group${data.clusters.clustersFound === 1 ? '' : 's'}.`
                    : 'No side-touching group has at least two failed dies.'
                }
              />
              <CardBody>
                <WaferMap dies={data.wafer.dies} highlight={highlighted} />
              </CardBody>
            </Card>

            <Card>
              <CardHead
                title="Top failure bins"
                subtitle="Failed hard bins with the most dies first."
              />
              {data.pareto.bins.length > 0 ? (
                <CardBody tight>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th className="num" scope="col">
                            Hard bin
                          </th>
                          <th className="num align-right" scope="col">
                            Dies
                          </th>
                          <th className="num align-right" scope="col">
                            Wafer share
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pareto.bins.slice(0, 6).map((bin) => (
                          <tr key={bin.binNumber}>
                            <td>
                              <code>{bin.binNumber}</code>
                              <small>{bin.binName}</small>
                            </td>
                            <td className="num align-right cell-strong">
                              {bin.dieCount.toLocaleString()}
                            </td>
                            <td className="num align-right">{bin.binPercentage.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              ) : (
                <EmptyState
                  icon="chart"
                  title="No failed bins"
                  hint="Every measured die is currently in a passing hard bin."
                />
              )}
              <footer className="card-foot triage-next">
                <div>
                  <p className="kicker">Suggested review order</p>
                  <ol>
                    {nextChecks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              </footer>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
