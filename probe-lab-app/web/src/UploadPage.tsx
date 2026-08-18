import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import type { ReferenceValue, UploadStatus } from '../../shared/contracts.js';
import { errorMessage, type WaferIntelligenceApi } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHead,
  Field,
  Icon,
  Skeleton,
  Stat,
  StatusBadge,
  formatBytes,
} from './ui.js';

const terminalStatuses = new Set<UploadStatus>(['Succeeded', 'Completed with errors', 'Rejected']);

export function UploadPage(): ReactElement {
  const { api } = useAuth();
  const [devices, setDevices] = useState<ReferenceValue[]>([]);
  const [programs, setPrograms] = useState<ReferenceValue[]>([]);
  const [device, setDevice] = useState('');
  const [program, setProgram] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<File>();
  const [csv, setCsv] = useState('');
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [uploadId, setUploadId] = useState<string>();

  useEffect(() => {
    let active = true;
    void api
      .listDevices()
      .then((value) => {
        if (active) setDevices(value);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!device) {
      setPrograms([]);
      setProgram('');
      return;
    }
    let active = true;
    void api
      .listTestPrograms(device)
      .then((value) => {
        if (active) setPrograms(value);
      })
      .catch((err: unknown) => {
        if (active) {
          setPrograms([]);
          setError(errorMessage(err));
        }
      });
    setProgram('');
    return () => {
      active = false;
    };
  }, [api, device]);

  const reset = (): void => {
    setUploadId(undefined);
    setFile(undefined);
    setCsv('');
    setError(undefined);
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!device || !program) {
      setError('Choose a device and test program.');
      return;
    }
    if (mode === 'file' && !file) {
      setError('Choose a CSV file.');
      return;
    }
    if (mode === 'paste' && !csv.trim()) {
      setError('Paste CSV rows.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const response =
        mode === 'file'
          ? await api.uploadFile(device, program, file as File)
          : await api.uploadCsv(device, program, csv);
      setUploadId(response.uploadId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (uploadId) {
    return <UploadResult api={api} uploadId={uploadId} onReset={reset} />;
  }

  return (
    <>
      <Card>
        <CardHead
          kicker="Step 1"
          title="Where does this wafer belong?"
          subtitle="Uploads attach to seeded reference data — they never create it."
        />
        <CardBody>
          <div className="form-grid">
            <Field label="Device" help={help.device}>
              <select value={device} onChange={(event) => setDevice(event.target.value)}>
                <option value="">Select a device</option>
                {devices.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.code} · {entry.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Test program"
              hint={device ? undefined : 'Pick a device first'}
              help={help.testProgram}
            >
              <select
                value={program}
                onChange={(event) => setProgram(event.target.value)}
                disabled={!device}
              >
                <option value="">Select a program</option>
                {programs.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.code} · {entry.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead
          kicker="Step 2"
          title="Add the wafer data"
          subtitle="Columns: Lot, Wafer, X, Y, HB#, SB#, PF_Flag — hard bin 0 or 1 is a pass."
          help={help.csvFile}
          helpTitle="Wafer CSV file"
          actions={
            <div className="segmented" role="tablist" aria-label="Upload source">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'file'}
                onClick={() => setMode('file')}
              >
                <Icon name="file" size={14} />
                File
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'paste'}
                onClick={() => setMode('paste')}
              >
                <Icon name="clipboard" size={14} />
                Paste CSV
              </button>
            </div>
          }
        />
        <CardBody>
          <form
            onSubmit={onSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}
          >
            {mode === 'file' ? (
              <>
                <div
                  className={dragging ? 'dropzone is-dragging' : 'dropzone'}
                  data-testid="upload-dropzone"
                  onDragEnter={() => setDragging(true)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    setFile(event.dataTransfer.files[0] ?? undefined);
                  }}
                >
                  <span className="dropzone-icon">
                    <Icon name="upload" size={18} />
                  </span>
                  <span className="dropzone-title">
                    Drop a .csv file here, or <em>browse</em>
                  </span>
                  <span className="muted">Up to 100 MB per file</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    data-testid="csv-file"
                    aria-label="Wafer CSV file"
                    onChange={(event) => setFile(event.target.files?.[0] ?? undefined)}
                  />
                </div>
                {file ? (
                  <span className="file-chip">
                    <Icon name="file" size={14} />
                    <span className="name">{file.name}</span>
                    <span className="size">{formatBytes(file.size)}</span>
                  </span>
                ) : null}
              </>
            ) : (
              <Field label="Wafer CSV rows" hint="Up to 5 MB of pasted rows." help={help.pasteCsv}>
                <textarea
                  value={csv}
                  onChange={(event) => setCsv(event.target.value)}
                  rows={9}
                  placeholder={'Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-001,1,0,0,1,1,P'}
                />
              </Field>
            )}

            {error ? <Alert tone="error">{error}</Alert> : null}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <Icon name="upload" size={15} />
                {submitting ? 'Uploading…' : 'Upload'}
              </button>
              <span className="muted">
                Parsing runs inside the request — the result comes back immediately.
              </span>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

function UploadResult({
  api,
  uploadId,
  onReset,
}: {
  api: WaferIntelligenceApi;
  uploadId: string;
  onReset: () => void;
}): ReactElement {
  const navigate = useNavigate();
  const uploadQuery = useQuery({
    queryKey: ['upload', uploadId],
    queryFn: () => api.getUpload(uploadId),
    refetchInterval: (query) => {
      const upload = query.state.data;
      return upload && terminalStatuses.has(upload.status) ? false : 1_000;
    },
  });

  const upload = uploadQuery.data;

  if (uploadQuery.error && !upload) {
    return (
      <Card>
        <CardHead kicker="Processing status" title="Upload status unavailable" />
        <CardBody>
          <Alert tone="error">{errorMessage(uploadQuery.error)}</Alert>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void uploadQuery.refetch()}
            >
              <Icon name="refresh" size={15} />
              Try again
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReset}>
              Upload another file
            </button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (!upload) {
    return (
      <Card>
        <CardHead kicker="Processing status" title="Reading the upload…" />
        <Skeleton rows={3} />
      </Card>
    );
  }

  const tone =
    upload.status === 'Succeeded' ? 'good' : upload.status === 'Rejected' ? 'critical' : 'warning';
  const icon =
    upload.status === 'Succeeded' ? 'check' : upload.status === 'Rejected' ? 'error' : 'warning';
  const acceptedShare = upload.rowsRead > 0 ? (upload.rowsAccepted / upload.rowsRead) * 100 : 0;

  return (
    <>
      <Card>
        <CardBody>
          <div className="result-hero" aria-live="polite">
            <span className={`result-icon is-${tone}`}>
              <Icon name={icon} size={22} />
            </span>
            <div className="card-head-titles">
              <p className="kicker">Processing status</p>
              <h2>{upload.fileName}</h2>
              <p className="muted">
                {upload.device} · {upload.testProgram}
                {upload.lot ? ` · ${upload.lot} · Wafer ${upload.wafer}` : ''}
              </p>
            </div>
            <div className="card-head-actions">
              <StatusBadge status={upload.status} />
            </div>
          </div>

          {upload.rowsRead > 0 ? (
            <div className="meter" aria-hidden="true">
              <span className="meter-fill" style={{ width: `${acceptedShare}%` }} />
              <span className="meter-fill is-fail" style={{ width: `${100 - acceptedShare}%` }} />
            </div>
          ) : null}

          {upload.terminalMessage ? <Alert tone="error">{upload.terminalMessage}</Alert> : null}

          <div className="stats">
            <Stat label="Rows read" value={upload.rowsRead.toLocaleString()} />
            <Stat
              label="Rows accepted"
              value={upload.rowsAccepted.toLocaleString()}
              foot={upload.rowsRead > 0 ? `${acceptedShare.toFixed(2)}% of the file` : undefined}
            />
            <Stat
              label="Rows rejected"
              value={upload.rowsRejected.toLocaleString()}
              foot={
                upload.rowsRejected > 0 ? 'Listed in the validation report' : 'Nothing rejected'
              }
            />
            <Stat
              label="Submitted by"
              value={<span style={{ fontSize: 18 }}>{upload.submittedBy}</span>}
              foot={<Badge tone="accent">{upload.status}</Badge>}
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate('/uploads')}>
              <Icon name="history" size={15} />
              View upload history
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReset}>
              <Icon name="refresh" size={15} />
              Upload another file
            </button>
            {upload.waferSequence ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate(`/wafers/${upload.waferSequence}`)}
              >
                <Icon name="wafer" size={15} />
                Open the wafer
              </button>
            ) : null}
          </div>
        </CardBody>
      </Card>
      {!terminalStatuses.has(upload.status) ? (
        <p className="muted">Refreshing every second until parsing finishes…</p>
      ) : null}
    </>
  );
}
