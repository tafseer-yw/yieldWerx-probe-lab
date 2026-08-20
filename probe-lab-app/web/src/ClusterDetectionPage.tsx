import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

import type { ClusterDetectionResult, WaferDetail } from '../../shared/contracts.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import { WaferMap } from './WaferMap.js';
import { Alert, Card, CardBody, CardHead, EmptyState, Field, Icon, Skeleton, Stat } from './ui.js';

interface DetectionRequest {
  waferSequence: number;
  adjacency: string;
  minimumConnectedDies: number;
}

function initialSequence(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'waferSequence' in state) {
    const value = (state as { waferSequence: unknown }).waferSequence;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  }
  return '1';
}

export function ClusterDetectionPage(): ReactElement {
  const { api } = useAuth();
  const location = useLocation();
  const [waferSequence, setWaferSequence] = useState(() => initialSequence(location.state));
  const [adjacency, setAdjacency] = useState('4-way');
  const [minimumConnectedDies, setMinimumConnectedDies] = useState('2');
  const [request, setRequest] = useState<DetectionRequest | null>(null);
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(null);
  const [formError, setFormError] = useState<string>();

  const waferQuery = useQuery({
    queryKey: ['wafer-cd', request?.waferSequence],
    enabled: request !== null,
    queryFn: () => api.getWafer(request!.waferSequence),
  });
  const detectionQuery = useQuery({
    queryKey: ['clusters', request],
    enabled: request !== null,
    queryFn: () =>
      api.detectClusters(request!.waferSequence, {
        adjacency: request!.adjacency,
        minimumConnectedDies: request!.minimumConnectedDies,
      }),
  });

  const wafer: WaferDetail | undefined = waferQuery.data;
  const result: ClusterDetectionResult | undefined = detectionQuery.data;
  const selectedCluster =
    result?.clusters.find((cluster) => cluster.ordinal === selectedOrdinal) ?? null;

  const highlight = useMemo<Set<string> | undefined>(() => {
    if (!wafer || !result || result.clusters.length === 0) return undefined;
    const target = selectedCluster ? [selectedCluster] : result.clusters;
    const set = new Set<string>();
    for (const cluster of target) {
      for (const coordinate of cluster.coordinates) set.add(`${coordinate.x}:${coordinate.y}`);
    }
    return set;
  }, [wafer, result, selectedCluster]);

  const largest = result?.clusters[0]?.dieCount ?? 0;
  const clusteredDies = result?.clusters.reduce((sum, cluster) => sum + cluster.dieCount, 0) ?? 0;
  const maxClusterSize = Math.max(1, largest);
  const loading = request !== null && (waferQuery.isLoading || detectionQuery.isLoading);
  const failure = waferQuery.error ?? detectionQuery.error;

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const sequence = Number(waferSequence);
    const minimum = Number(minimumConnectedDies);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      setFormError('Enter a valid whole-number wafer sequence.');
      return;
    }
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100) {
      setFormError('Minimum cluster size must be a whole number from 1 to 100.');
      return;
    }
    setFormError(undefined);
    setSelectedOrdinal(null);
    setRequest({ waferSequence: sequence, adjacency, minimumConnectedDies: minimum });
  };

  return (
    <>
      <Card>
        <CardHead
          title="Detect clusters"
          subtitle="Groups of touching failing dies. Nothing is saved and no die is re-binned."
        />
        <CardBody>
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}
          >
            <div className="form-grid">
              <Field label="Wafer sequence" hint="From the Wafers screen" help={help.waferSequence}>
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={waferSequence}
                  onChange={(event) => setWaferSequence(event.target.value)}
                />
              </Field>
              <Field
                label="How dies touch"
                hint="Corners count only in 8-way"
                help={help.adjacency}
              >
                <select value={adjacency} onChange={(event) => setAdjacency(event.target.value)}>
                  <option value="4-way">Sides only (4-way)</option>
                  <option value="8-way">Sides and corners (8-way)</option>
                </select>
              </Field>
              <Field
                label="Minimum cluster size"
                hint="1 to 100 dies"
                help={help.minimumConnectedDies}
              >
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  required
                  value={minimumConnectedDies}
                  onChange={(event) => setMinimumConnectedDies(event.target.value)}
                />
              </Field>
            </div>
            {formError ? <Alert tone="error">{formError}</Alert> : null}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <Icon name="scan" size={15} />
                Detect clusters
              </button>
              <span className="muted">Read-only — the wafer is never modified.</span>
            </div>
          </form>
        </CardBody>
      </Card>

      {failure ? <Alert tone="error">{errorMessage(failure)}</Alert> : null}

      {loading ? (
        <Card>
          <Skeleton rows={4} />
        </Card>
      ) : null}

      {wafer && result ? (
        <>
          <div className="stats">
            <Stat
              label="Clusters found"
              value={result.clustersFound.toLocaleString()}
              accent
              foot={`${result.adjacency === '4-way' ? 'Sides only' : 'Sides and corners'} · at least ${result.minimumConnectedDies} dies`}
            />
            <Stat
              label="Largest cluster"
              value={largest.toLocaleString()}
              foot={largest === 1 ? 'die' : 'dies'}
            />
            <Stat
              label="Dies in clusters"
              value={clusteredDies.toLocaleString()}
              foot={`of ${(wafer.partCount - wafer.passCount).toLocaleString()} failing dies`}
            />
            <Stat
              label="Wafer"
              value={<span style={{ fontSize: 17 }}>{wafer.lot}</span>}
              foot={`Wafer ${wafer.waferNumber} · yield ${wafer.yield.toFixed(2)}%`}
            />
          </div>

          <div className="grid-2">
            <Card>
              <CardHead
                title={
                  selectedCluster
                    ? `Wafer map (cluster ${selectedCluster.ordinal})`
                    : `Wafer map (${result.clustersFound} cluster${result.clustersFound === 1 ? '' : 's'})`
                }
                subtitle={
                  selectedCluster
                    ? 'Only the selected cluster is highlighted.'
                    : 'Ringed dies belong to a detected cluster.'
                }
              />
              <CardBody>
                <WaferMap
                  dies={wafer.dies}
                  frame={{ positiveX: wafer.positiveX, positiveY: wafer.positiveY }}
                  highlight={highlight}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHead
                title="Detected clusters"
                subtitle="Largest first. Select one to isolate it on the map."
                help={help.detectedClusters}
              />
              {result.clusters.length === 0 ? (
                <EmptyState
                  icon="target"
                  title="No clusters meet the minimum size."
                  hint="Lower the minimum, or count dies that touch at the corners."
                />
              ) : (
                <CardBody tight>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th className="num" scope="col">
                            #
                          </th>
                          <th className="num align-right" scope="col">
                            Dies
                          </th>
                          <th scope="col">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.clusters.map((cluster) => (
                          <tr
                            key={cluster.ordinal}
                            className={
                              selectedOrdinal === cluster.ordinal
                                ? 'is-clickable is-selected'
                                : 'is-clickable'
                            }
                            tabIndex={0}
                            onClick={() =>
                              setSelectedOrdinal(
                                cluster.ordinal === selectedOrdinal ? null : cluster.ordinal,
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                setSelectedOrdinal(
                                  cluster.ordinal === selectedOrdinal ? null : cluster.ordinal,
                                );
                              }
                            }}
                          >
                            <td className="num cell-strong">{cluster.ordinal}</td>
                            <td className="num align-right cell-strong">{cluster.dieCount}</td>
                            <td>
                              <span className="meter" aria-hidden="true">
                                <span
                                  className="meter-fill is-fail"
                                  style={{ width: `${(cluster.dieCount / maxClusterSize) * 100}%` }}
                                />
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              )}
              {selectedCluster ? (
                <footer
                  className="card-foot"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                >
                  <p className="kicker">
                    Cluster {selectedCluster.ordinal} — {selectedCluster.dieCount} dies
                  </p>
                  <p className="coords">
                    {selectedCluster.coordinates
                      .map((coordinate) => `(${coordinate.x},${coordinate.y})`)
                      .join(' ')}
                  </p>
                </footer>
              ) : null}
            </Card>
          </div>
        </>
      ) : null}

      {request === null ? (
        <Card>
          <EmptyState
            icon="scan"
            title="No detection run yet"
            hint="Pick a wafer sequence and how dies should touch, then select Detect clusters."
          />
        </Card>
      ) : null}
    </>
  );
}
