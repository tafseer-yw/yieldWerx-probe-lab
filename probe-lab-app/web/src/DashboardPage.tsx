import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Icon,
  Skeleton,
  Stat,
  StatusBadge,
  formatDateTime,
  type IconName,
  type Tone,
} from './ui.js';

/*
 * Dashboard — the landing page. It summarizes the app's four workflows
 * (upload → wafer map, wafer triage, cluster detection, bin pareto) and the current data
 * state, and deep-links into each feature. Everything is derived from the
 * existing viewer endpoints — the API needs no dashboard-specific route.
 */

const RECENT_ROWS = 5;
const YIELD_SAMPLE_SIZE = 100;

interface WorkflowTile {
  to: string;
  icon: IconName;
  title: string;
  summary: string;
  state?: { waferSequence: number };
}

export function DashboardPage(): ReactElement {
  const { api, session } = useAuth();

  const readiness = useQuery({ queryKey: ['readiness'], queryFn: () => api.getReadiness() });
  const wafers = useQuery({
    queryKey: ['dashboard', 'wafers'],
    queryFn: () => api.listWafers({ page: 1, pageSize: YIELD_SAMPLE_SIZE }),
  });
  const uploads = useQuery({
    queryKey: ['dashboard', 'uploads'],
    queryFn: () => api.listUploads({ page: 1, pageSize: RECENT_ROWS }),
  });
  const rejectedUploads = useQuery({
    queryKey: ['dashboard', 'uploads', 'rejected'],
    queryFn: () => api.listUploads({ status: 'Rejected', page: 1, pageSize: 1 }),
  });
  const clusterSummary = useQuery({
    queryKey: ['dashboard', 'cluster-summary'],
    queryFn: () => api.getClusterSummary({}),
  });

  const waferItems = wafers.data?.items ?? [];
  const waferTotal = wafers.data?.total ?? 0;
  const uploadItems = uploads.data?.items ?? [];
  const uploadTotal = uploads.data?.total ?? 0;
  const rejectedTotal = rejectedUploads.data?.total ?? 0;

  // Die-weighted yield: a 2,000-die wafer must count for more than a 25-die one.
  const parts = waferItems.reduce((sum, wafer) => sum + wafer.partCount, 0);
  const passes = waferItems.reduce((sum, wafer) => sum + wafer.passCount, 0);
  const averageYield = parts > 0 ? (passes / parts) * 100 : null;
  const yieldFoot =
    waferTotal > waferItems.length
      ? `${passes.toLocaleString()} of ${parts.toLocaleString()} dies pass — latest ${waferItems.length} of ${waferTotal} wafers`
      : `${passes.toLocaleString()} of ${parts.toLocaleString()} dies pass`;

  const serviceTone: Tone = readiness.isError
    ? 'critical'
    : readiness.data
      ? readiness.data.status === 'ok'
        ? 'good'
        : 'warning'
      : 'neutral';
  const serviceLabel = readiness.isError
    ? 'Unreachable'
    : readiness.data
      ? readiness.data.status === 'ok'
        ? 'Healthy'
        : 'Degraded'
      : 'Checking…';
  const serviceFoot = readiness.isError
    ? errorMessage(readiness.error)
    : readiness.data
      ? `Database ${readiness.data.dependencies.database}`
      : undefined;

  const latest = waferItems[0];
  const tiles: WorkflowTile[] = [
    ...(session?.user.role === 'viewer'
      ? []
      : [
          {
            to: '/upload',
            icon: 'upload',
            title: 'Upload data',
            summary: 'Check and save a wafer CSV with its dies, bins, and yield.',
          } satisfies WorkflowTile,
        ]),
    {
      to: '/wafers',
      icon: 'wafer',
      title: 'Wafers',
      summary: 'Open a wafer to see its die map and pass/fail split.',
    },
    {
      to: '/detection',
      icon: 'scan',
      title: 'Cluster detection',
      summary: 'Find groups of failing dies that touch on a wafer.',
      state: latest ? { waferSequence: latest.waferSequence } : undefined,
    },
    {
      to: '/reports/bin-pareto',
      icon: 'chart',
      title: 'Bin pareto',
      summary: 'Put the biggest bin losses first and show a running total.',
      state: latest ? { waferSequence: latest.waferSequence } : undefined,
    },
    {
      to: '/triage',
      icon: 'target',
      title: 'Wafer triage',
      summary: 'Prioritize a wafer using patterns, clusters and failed bins.',
      state: latest ? { waferSequence: latest.waferSequence } : undefined,
    },
  ];

  const recentWafers = waferItems.slice(0, RECENT_ROWS);

  const clusters = clusterSummary.data;
  const topClustered = (clusters?.wafers ?? [])
    .filter((wafer) => wafer.clustersFound > 0)
    .sort(
      (left, right) =>
        right.clustersFound - left.clustersFound ||
        right.largestClusterDies - left.largestClusterDies,
    )
    .slice(0, RECENT_ROWS);

  return (
    <>
      <div className="stats" aria-label="PROBE Lab summary">
        <Stat
          label="Wafers stored"
          value={wafers.isLoading ? '…' : waferTotal.toLocaleString()}
          foot={
            waferTotal === 1
              ? '1 wafer in the database'
              : `${waferTotal.toLocaleString()} wafers in the database`
          }
          icon={<Icon name="wafer" size={14} />}
        />
        <Stat
          label="Average yield"
          value={averageYield === null ? '—' : `${averageYield.toFixed(2)}%`}
          foot={averageYield === null ? 'No dies stored yet' : yieldFoot}
          icon={<Icon name="target" size={14} />}
          accent
        />
        <Stat
          label="Uploads"
          value={uploads.isLoading ? '…' : uploadTotal.toLocaleString()}
          foot="CSV files submitted"
          icon={<Icon name="upload" size={14} />}
        />
        <Stat
          label="Rejected uploads"
          value={rejectedUploads.isLoading ? '…' : rejectedTotal.toLocaleString()}
          foot="Files where no row passed validation"
          icon={<Icon name="error" size={14} />}
        />
        <Stat
          label="Service"
          value={<Badge tone={serviceTone}>{serviceLabel}</Badge>}
          foot={serviceFoot}
          icon={<Icon name="check" size={14} />}
        />
      </div>

      <Card>
        <CardHead
          title="Cluster detection"
          subtitle={
            clusters
              ? `${clusters.adjacency === '4-way' ? 'Sides only' : 'Sides and corners'} · groups of at least ${clusters.minimumConnectedDies} dies · latest ${clusters.wafersAnalyzed} ${clusters.wafersAnalyzed === 1 ? 'wafer' : 'wafers'}`
              : 'Groups of touching failed dies across the latest wafers.'
          }
        />
        {clusterSummary.error ? (
          <CardBody>
            <Alert tone="error">{errorMessage(clusterSummary.error)}</Alert>
          </CardBody>
        ) : null}
        {clusterSummary.isLoading ? <Skeleton rows={4} /> : null}
        {clusters ? (
          <CardBody>
            <div className="stats">
              <Stat
                label="Clusters found"
                value={clusters.totalClusters.toLocaleString()}
                foot={`across ${clusters.wafersAnalyzed} ${clusters.wafersAnalyzed === 1 ? 'wafer' : 'wafers'}`}
                icon={<Icon name="scan" size={14} />}
                accent
              />
              <Stat
                label="Wafers with clusters"
                value={`${clusters.wafersWithClusters} of ${clusters.wafersAnalyzed}`}
                foot="wafers carrying at least one cluster"
                icon={<Icon name="wafer" size={14} />}
              />
              <Stat
                label="Largest cluster"
                value={
                  clusters.largestClusterDies > 0 ? `${clusters.largestClusterDies} dies` : '—'
                }
                foot="biggest single group of touching failures"
                icon={<Icon name="target" size={14} />}
              />
            </div>
          </CardBody>
        ) : null}
        {clusters && clusters.wafersAnalyzed === 0 ? (
          <EmptyState
            icon="scan"
            title="No wafers to analyze yet."
            hint={
              session?.user.role === 'viewer'
                ? 'Ask an engineer or admin to upload a wafer CSV; its groups will appear here.'
                : 'Upload a wafer CSV — its groups of failing dies are then counted here.'
            }
          />
        ) : null}
        {clusters && clusters.wafersAnalyzed > 0 && clusters.totalClusters === 0 ? (
          <EmptyState
            icon="check"
            title="No clusters found."
            hint={`No fail-die clusters on the latest ${clusters.wafersAnalyzed} ${clusters.wafersAnalyzed === 1 ? 'wafer' : 'wafers'} under these settings.`}
          />
        ) : null}
        {topClustered.length > 0 ? (
          <CardBody tight>
            <div className="dash-list">
              {topClustered.map((wafer) => (
                <Link
                  key={wafer.waferSequence}
                  to="/detection"
                  state={{ waferSequence: wafer.waferSequence }}
                  className="dash-row"
                >
                  <span className="dash-row-main">
                    <span className="dash-row-title">
                      #{wafer.waferSequence} · {wafer.lot}
                    </span>
                    <span className="dash-row-sub">
                      Wafer {wafer.waferNumber} · {wafer.yield.toFixed(2)}% yield
                    </span>
                  </span>
                  <Badge tone="accent">
                    {wafer.clustersFound} {wafer.clustersFound === 1 ? 'cluster' : 'clusters'}
                  </Badge>
                  <span className="dash-row-sub">largest {wafer.largestClusterDies} dies</span>
                </Link>
              ))}
            </div>
          </CardBody>
        ) : null}
        {clusters ? (
          <footer className="card-foot">
            <Link
              to="/detection"
              state={latest ? { waferSequence: latest.waferSequence } : undefined}
              className="btn btn-ghost btn-sm"
            >
              Run cluster detection
              <Icon name="right" size={14} />
            </Link>
          </footer>
        ) : null}
      </Card>

      <Card>
        <CardHead
          title="Workflows"
          subtitle={`Welcome back, ${session?.user.username ?? ''}. Jump into any part of the practice lab.`}
        />
        <CardBody>
          <div className="workflow-tiles">
            {tiles.map((tile) => (
              <Link key={tile.to} to={tile.to} state={tile.state} className="workflow-tile">
                <span className="workflow-tile-icon" aria-hidden="true">
                  <Icon name={tile.icon} size={18} />
                </span>
                <span className="workflow-tile-text">
                  <strong>{tile.title}</strong>
                  <small>{tile.summary}</small>
                </span>
                <Icon name="right" size={16} />
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Practice tracks"
          subtitle="Choose an engineering practice track, then take the result through the PROBE loop: specify, codify, automate, attest, promote."
        />
        <CardBody>
          <div className="workflow-tiles">
            <Link className="workflow-tile" to="/guide?section=dev">
              <span className="workflow-tile-icon" aria-hidden="true">
                <Icon name="file" size={18} />
              </span>
              <span className="workflow-tile-text">
                <strong>Dev track</strong>
                <small>
                  Review the API contract, challenge validation and RBAC, implement a change, and
                  run every gate.
                </small>
              </span>
              <Icon name="right" size={16} />
            </Link>
            <Link to="/guide?section=qa" className="workflow-tile">
              <span className="workflow-tile-icon" aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
              <span className="workflow-tile-text">
                <strong>QA track</strong>
                <small>
                  Define outcomes, upload edge cases, inspect evidence, and turn checks into BDD
                  scenarios.
                </small>
              </span>
              <Icon name="right" size={16} />
            </Link>
          </div>
        </CardBody>
      </Card>

      <div className="grid-2">
        <Card>
          <CardHead
            title="Recent wafers"
            subtitle="Most recently finished wafers — select one to open its die map."
          />
          {wafers.error ? (
            <CardBody>
              <Alert tone="error">{errorMessage(wafers.error)}</Alert>
            </CardBody>
          ) : null}
          {wafers.isLoading ? <Skeleton rows={4} /> : null}
          {!wafers.isLoading && !wafers.error && recentWafers.length === 0 ? (
            <EmptyState
              icon="wafer"
              title="No wafers yet."
              hint={
                session?.user.role === 'viewer'
                  ? 'Ask an engineer or admin to upload a wafer CSV.'
                  : 'Upload a wafer CSV and it will show up here with its yield.'
              }
              action={
                session?.user.role === 'viewer' ? undefined : (
                  <Link to="/upload" className="btn btn-primary btn-sm">
                    <Icon name="upload" size={14} />
                    Upload a wafer CSV
                  </Link>
                )
              }
            />
          ) : null}
          {recentWafers.length > 0 ? (
            <>
              <CardBody tight>
                <div className="dash-list">
                  {recentWafers.map((wafer) => (
                    <Link
                      key={wafer.waferSequence}
                      to={`/wafers/${wafer.waferSequence}`}
                      className="dash-row"
                    >
                      <span className="dash-row-main">
                        <span className="dash-row-title">
                          #{wafer.waferSequence} · {wafer.lot}
                        </span>
                        <span className="dash-row-sub">
                          Wafer {wafer.waferNumber} · {wafer.device}
                        </span>
                      </span>
                      <span className="dash-row-yield">
                        <span className="dash-row-title">{wafer.yield.toFixed(2)}%</span>
                        <span className="meter" style={{ height: 4, width: 72 }} aria-hidden="true">
                          <span className="meter-fill" style={{ width: `${wafer.yield}%` }} />
                        </span>
                      </span>
                      <span className="dash-row-sub">{formatDateTime(wafer.finishTime)}</span>
                    </Link>
                  ))}
                </div>
              </CardBody>
              <footer className="card-foot">
                <Link to="/wafers" className="btn btn-ghost btn-sm">
                  All wafers
                  <Icon name="right" size={14} />
                </Link>
              </footer>
            </>
          ) : null}
        </Card>

        <Card>
          <CardHead
            title="Recent uploads"
            subtitle="The latest CSV submissions with their validation outcome."
          />
          {uploads.error ? (
            <CardBody>
              <Alert tone="error">{errorMessage(uploads.error)}</Alert>
            </CardBody>
          ) : null}
          {uploads.isLoading ? <Skeleton rows={4} /> : null}
          {!uploads.isLoading && !uploads.error && uploadItems.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No uploads yet."
              hint="Submitted CSV files land here with their status."
            />
          ) : null}
          {uploadItems.length > 0 ? (
            <>
              <CardBody tight>
                <div className="dash-list">
                  {uploadItems.map((upload) => (
                    <Link key={upload.id} to="/uploads" className="dash-row">
                      <span className="dash-row-main">
                        <span className="dash-row-title">{upload.fileName}</span>
                        <span className="dash-row-sub">
                          {upload.lot ?? 'No lot'} · {upload.rowsAccepted.toLocaleString()} rows
                          accepted
                        </span>
                      </span>
                      <StatusBadge status={upload.status} />
                      <span className="dash-row-sub">{formatDateTime(upload.submittedAt)}</span>
                    </Link>
                  ))}
                </div>
              </CardBody>
              <footer className="card-foot">
                <Link to="/uploads" className="btn btn-ghost btn-sm">
                  Upload history
                  <Icon name="right" size={14} />
                </Link>
              </footer>
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
