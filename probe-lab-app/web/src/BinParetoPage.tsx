import { useState, type FormEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

import type { BinParetoResponse } from '../../shared/contracts.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import { ParetoChart } from './ParetoChart.js';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Field,
  Icon,
  Skeleton,
  Stat,
} from './ui.js';

interface ReportRequest {
  waferSequence: number;
  binType: string;
  specifyBins: string;
  sortBy: string;
  customBins: number[];
}

const reportOptionLabels: Record<string, string> = {
  'Hard Bin': 'Hard bin',
  'Soft Bin': 'Soft bin',
  'All Bins': 'All bins',
  'Failed Bins Only': 'Failed bins only',
  'Bin Occurrence': 'Most dies first',
  'Bin Number': 'Bin number',
};

function reportOptionLabel(value: string): string {
  return reportOptionLabels[value] ?? value;
}

function parseCustomBins(text: string): number[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

function initialSequence(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'waferSequence' in state) {
    const value = (state as { waferSequence: unknown }).waferSequence;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  }
  return '1';
}

export function BinParetoPage(): ReactElement {
  const { api } = useAuth();
  const location = useLocation();
  const [waferSequence, setWaferSequence] = useState(() => initialSequence(location.state));
  const [binType, setBinType] = useState('Hard Bin');
  const [specifyBins, setSpecifyBins] = useState('Failed Bins Only');
  const [sortBy, setSortBy] = useState('Bin Occurrence');
  const [customBins, setCustomBins] = useState('');
  const [request, setRequest] = useState<ReportRequest | null>(null);
  const [formError, setFormError] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();

  const query = useQuery({
    queryKey: ['bin-pareto', request],
    enabled: request !== null,
    queryFn: () =>
      api.getBinPareto(request!.waferSequence, {
        binType: request!.binType,
        specifyBins: request!.specifyBins,
        sortBy: request!.sortBy,
        customBins: request!.customBins,
      }),
  });

  const report: BinParetoResponse | undefined = query.data;

  /**
   * Save the report currently on screen.
   *
   * Uses the same `request` the report was fetched with, not the form's current
   * values — the form can be edited after a report is run, and downloading the
   * options someone has half-typed rather than the table they are looking at is
   * exactly the mismatch this feature exists to prevent.
   */
  const onDownload = async (): Promise<void> => {
    if (!request) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const { filename, blob } = await api.downloadBinParetoCsv(request.waferSequence, {
        binType: request.binType,
        specifyBins: request.specifyBins,
        sortBy: request.sortBy,
        customBins: request.customBins,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      /* Release the object URL once the browser has taken the download. */
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const sequence = Number(waferSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      setFormError('Enter a valid whole-number wafer sequence.');
      return;
    }
    if (specifyBins === 'Custom') {
      const parts = customBins.split(',').map((part) => part.trim());
      if (parts.length === 0 || parts.some((part) => !/^\d+$/u.test(part))) {
        setFormError('Enter one or more whole-number bins separated by commas, such as 2,3,4.');
        return;
      }
    }
    setFormError(undefined);
    setRequest({
      waferSequence: sequence,
      binType,
      specifyBins,
      sortBy,
      customBins: parseCustomBins(customBins),
    });
  };

  return (
    <>
      <Card>
        <CardHead
          title="Bin pareto"
          subtitle="Bins ranked biggest-first, with a running share of the wafer."
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
              <Field label="Bin type" help={help.binType}>
                <select value={binType} onChange={(event) => setBinType(event.target.value)}>
                  <option value="Hard Bin">Hard bin</option>
                  <option value="Soft Bin">Soft bin</option>
                </select>
              </Field>
              <Field label="Bins to show" help={help.specifyBins}>
                <select
                  value={specifyBins}
                  onChange={(event) => setSpecifyBins(event.target.value)}
                >
                  <option value="All Bins">All bins</option>
                  <option value="Failed Bins Only">Failed bins only</option>
                  <option>Custom</option>
                </select>
              </Field>
              <Field label="Sort by" help={help.sortBy}>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                  <option value="Bin Occurrence">Most dies first</option>
                  <option value="Bin Number">Bin number</option>
                </select>
              </Field>
              {specifyBins === 'Custom' ? (
                <Field
                  label="Custom bins (comma-separated)"
                  hint="Non-negative whole numbers"
                  help={help.customBins}
                >
                  <input
                    value={customBins}
                    onChange={(event) => setCustomBins(event.target.value)}
                    placeholder="2,3,4"
                    maxLength={255}
                    required
                  />
                </Field>
              ) : null}
            </div>
            {formError ? <Alert tone="error">{formError}</Alert> : null}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <Icon name="chart" size={15} />
                Run report
              </button>
              <span className="muted">
                Percentages are taken against every die on the wafer, not the filtered subset.
              </span>
            </div>
          </form>
        </CardBody>
      </Card>

      {query.error ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}

      {query.isLoading && request !== null ? (
        <Card>
          <Skeleton rows={4} />
        </Card>
      ) : null}

      {report ? (
        <>
          <div className="stats">
            <Stat
              label="Wafer"
              value={<span style={{ fontSize: 17 }}>{report.header.lot}</span>}
              foot={`Wafer ${report.header.waferNumber} · ${report.header.device}`}
              icon={<Icon name="wafer" size={14} />}
            />
            <Stat
              label="Total dies"
              value={report.header.totalDies.toLocaleString()}
              foot="Whole wafer"
            />
            <Stat
              label="Pass count"
              value={report.header.passCount.toLocaleString()}
              foot={`${(report.header.totalDies - report.header.passCount).toLocaleString()} failing`}
            />
            <Stat
              label="Yield"
              value={`${report.header.yield.toFixed(2)}%`}
              accent
              foot={`By ${report.options.binType.toLowerCase()}`}
            />
            <Stat
              label="Bins reported"
              value={report.bins.length.toLocaleString()}
              foot={
                <Badge tone="accent">
                  {reportOptionLabel(report.options.specifyBins)} ·{' '}
                  {reportOptionLabel(report.options.sortBy)}
                </Badge>
              }
            />
          </div>

          <Card>
            <CardHead
              title="Bin loss"
              subtitle={`${reportOptionLabel(report.options.binType)} · ${reportOptionLabel(report.options.specifyBins)} · sorted by ${reportOptionLabel(report.options.sortBy).toLowerCase()}`}
              help={help.binLoss}
              helpTitle="Bin loss"
              actions={
                <button
                  type="button"
                  className="btn"
                  data-testid="bin-pareto-download-csv"
                  onClick={() => void onDownload()}
                  disabled={downloading}
                >
                  <Icon name="download" size={14} />
                  {downloading ? 'Preparing…' : 'Download CSV'}
                </button>
              }
            />
            {downloadError ? (
              <CardBody>
                <Alert tone="error">{downloadError}</Alert>
              </CardBody>
            ) : null}
            {report.bins.length === 0 ? (
              <EmptyState
                icon="chart"
                title="No bins match these options."
                hint="Show more bins, or check that your custom bin numbers exist on this wafer."
              />
            ) : (
              <>
                <CardBody>
                  <ParetoChart bins={report.bins} />
                </CardBody>
                <CardBody tight>
                  <div className="table-wrap">
                    <table className="data" data-testid="bin-pareto-table">
                      <thead>
                        <tr>
                          <th className="num" scope="col">
                            Bin
                          </th>
                          <th scope="col">Name</th>
                          <th className="num align-right" scope="col">
                            Dies
                          </th>
                          <th className="num align-right" scope="col">
                            Bin %
                          </th>
                          <th className="num align-right" scope="col">
                            Running total %
                          </th>
                        </tr>
                      </thead>
                      <tbody data-testid="bin-pareto-rows">
                        {report.bins.map((bin) => (
                          <tr key={bin.binNumber}>
                            <td>
                              <code>{bin.binNumber}</code>
                            </td>
                            <td className="cell-strong">{bin.binName}</td>
                            <td className="num align-right cell-strong">
                              {bin.dieCount.toLocaleString()}
                            </td>
                            <td className="num align-right">{bin.binPercentage.toFixed(2)}%</td>
                            <td className="num align-right">
                              {bin.cumulativePercentage.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </>
            )}
          </Card>
        </>
      ) : null}

      {request === null ? (
        <Card>
          <EmptyState
            icon="chart"
            title="No report run yet"
            hint="Pick a wafer sequence and the report options, then select Run report."
          />
        </Card>
      ) : null}
    </>
  );
}
