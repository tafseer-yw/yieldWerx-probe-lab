import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';

import { uploadHistoryStatuses, type UploadSummary } from '../../shared/contracts.js';
import { errorMessage, type WaferIntelligenceApi } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import { useDialogFocus } from './useDialogFocus.js';
import {
  Alert,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Field,
  Icon,
  Pager,
  Skeleton,
  Stat,
  StatusBadge,
  formatDateTime,
} from './ui.js';

const PAGE_SIZE = 25;

export function UploadHistoryPage(): ReactElement {
  const { api } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openUpload, setOpenUpload] = useState<UploadSummary>();

  const history = useQuery({
    queryKey: ['uploads', status, search, page],
    queryFn: () =>
      api.listUploads({
        status: status || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const items = history.data?.items ?? [];
  const total = history.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (history.data && page > totalPages) setPage(totalPages);
  }, [history.data, page, totalPages]);

  return (
    <>
      <Card>
        <CardHead title="Upload history" subtitle="Select a row to read its validation report." />

        <div className="filter-bar">
          <Field label="Status" help={help.historyStatus}>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {uploadHistoryStatuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search" help={help.historySearch}>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="File name or lot"
            />
          </Field>
        </div>

        {history.error ? (
          <CardBody>
            <Alert tone="error">{errorMessage(history.error)}</Alert>
          </CardBody>
        ) : null}

        {history.isLoading ? <Skeleton rows={5} /> : null}

        {!history.isLoading && !history.error && items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No uploads match these filters."
            hint="Clear the status filter or the search box, or upload a wafer CSV to get started."
          />
        ) : null}

        {items.length > 0 ? (
          <>
            <CardBody tight>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col">Device / Program</th>
                      <th scope="col">Lot / Wafer</th>
                      <th scope="col">Status</th>
                      <th className="num align-right" scope="col">
                        Rows
                      </th>
                      <th scope="col">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((upload) => (
                      <tr
                        key={upload.id}
                        className="is-clickable"
                        tabIndex={0}
                        onClick={() => setOpenUpload(upload)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setOpenUpload(upload);
                          }
                        }}
                      >
                        <td className="cell-strong">
                          <button
                            type="button"
                            className="table-link"
                            onClick={() => setOpenUpload(upload)}
                          >
                            {upload.fileName}
                          </button>
                        </td>
                        <td>
                          {upload.device}
                          <small>{upload.testProgram}</small>
                        </td>
                        <td>
                          {upload.lot ?? '—'}
                          <small>{upload.wafer ? `Wafer ${upload.wafer}` : 'Wafer —'}</small>
                        </td>
                        <td>
                          <StatusBadge status={upload.status} />
                        </td>
                        <td className="num align-right">
                          <span className="cell-strong">
                            {upload.rowsAccepted.toLocaleString()}
                          </span>
                          <small>{upload.rowsRejected.toLocaleString()} rejected</small>
                        </td>
                        <td>
                          {upload.submittedBy}
                          <small>{formatDateTime(upload.submittedAt)}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
            <footer className="card-foot">
              <Pager
                page={page}
                totalPages={totalPages}
                total={total}
                unit={total === 1 ? 'upload' : 'uploads'}
                onPrevious={() => setPage((value) => value - 1)}
                onNext={() => setPage((value) => value + 1)}
              />
            </footer>
          </>
        ) : null}
      </Card>

      {openUpload ? (
        <ValidationReportDialog
          api={api}
          upload={openUpload}
          onClose={() => setOpenUpload(undefined)}
        />
      ) : null}
    </>
  );
}

function ValidationReportDialog({
  api,
  upload,
  onClose,
}: {
  api: WaferIntelligenceApi;
  upload: UploadSummary;
  onClose: () => void;
}): ReactElement {
  const dialogRef = useDialogFocus(onClose);
  const errors = useQuery({
    queryKey: ['upload-errors', upload.id],
    queryFn: () => api.listUploadErrors(upload.id),
  });
  const items = errors.data?.items ?? [];

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
      >
        <CardHead
          kicker="Validation report"
          title={upload.fileName}
          titleId="report-title"
          subtitle={`${upload.device} · ${upload.testProgram} · ${upload.lot ?? '—'} · Wafer ${
            upload.wafer ?? '—'
          }`}
          actions={
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Close report"
              onClick={onClose}
            >
              <Icon name="close" size={18} />
            </button>
          }
        />
        <CardBody>
          <div className="stats">
            <Stat label="Rows read" value={upload.rowsRead.toLocaleString()} />
            <Stat label="Rows accepted" value={upload.rowsAccepted.toLocaleString()} />
            <Stat label="Rows rejected" value={upload.rowsRejected.toLocaleString()} />
          </div>

          {upload.terminalMessage ? <Alert tone="error">{upload.terminalMessage}</Alert> : null}

          {errors.isLoading ? <Skeleton rows={3} /> : null}

          {errors.error ? <Alert tone="error">{errorMessage(errors.error)}</Alert> : null}

          {!errors.isLoading && !errors.error && items.length === 0 ? (
            <EmptyState
              icon="check"
              title="No validation errors."
              hint="Every data row in this file was accepted."
            />
          ) : null}

          {items.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num" scope="col">
                      Row
                    </th>
                    <th scope="col">Column</th>
                    <th scope="col">Code</th>
                    <th scope="col">Message</th>
                    <th scope="col">Raw</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((error) => (
                    <tr key={error.id}>
                      <td className="num cell-strong">{error.rowNumber}</td>
                      <td>{error.column}</td>
                      <td>
                        <code>{error.code}</code>
                      </td>
                      <td>{error.message}</td>
                      <td className="mono">{error.rawText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardBody>
      </section>
    </div>,
    document.body,
  );
}
