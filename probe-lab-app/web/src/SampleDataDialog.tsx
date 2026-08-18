import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SampleWaferState } from '../../shared/contracts.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { Alert, Badge, Icon, Skeleton } from './ui.js';
import { useDialogFocus } from './useDialogFocus.js';

/*
 * Sample wafers — load or remove the optional demo set, one wafer at a time.
 *
 * The whole set is shown at once, as a grid of compact cards: four choices do
 * not deserve a scrollbar. Reference data (facility, work center, device, test
 * program) and the demo users are seeded by `npm run setup` and are never
 * touched here — this only ever affects wafers the loader itself created.
 */
export function SampleDataDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();

  const status = useQuery({ queryKey: ['sample-data'], queryFn: () => api.getSampleData() });
  const wafers = useMemo<SampleWaferState[]>(() => status.data?.wafers ?? [], [status.data]);

  const load = useMutation({
    mutationFn: (keys: string[]) => api.loadSampleData(keys),
    onSuccess: () => {
      setChosen(new Set());
      setTouched(true);
      return queryClient.invalidateQueries();
    },
    onError: (err: unknown) => setError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (keys: string[]) => api.removeSampleData(keys),
    onSuccess: () => {
      setChosen(new Set());
      setTouched(true);
      return queryClient.invalidateQueries();
    },
    onError: (err: unknown) => setError(errorMessage(err)),
  });

  const busy = load.isPending || remove.isPending;
  const dialogRef = useDialogFocus(onClose, busy);

  // Pre-select whatever is not loaded yet, so "load everything" stays one click.
  useEffect(() => {
    if (touched || wafers.length === 0) return;
    setChosen(new Set(wafers.filter((wafer) => !wafer.loaded).map((wafer) => wafer.key)));
  }, [touched, wafers]);

  const toLoad = wafers.filter((wafer) => chosen.has(wafer.key) && !wafer.loaded);
  const toRemove = wafers.filter((wafer) => chosen.has(wafer.key) && wafer.loaded);
  const loadedCount = status.data?.loadedCount ?? 0;
  const allChosen = wafers.length > 0 && chosen.size === wafers.length;

  const toggle = (key: string): void => {
    setTouched(true);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = (): void => {
    setTouched(true);
    setChosen(allChosen ? new Set() : new Set(wafers.map((wafer) => wafer.key)));
  };

  /*
   * Rendered into <body>. The trigger lives in the header, and .topbar carries a
   * backdrop-filter — which makes it the containing block for fixed-position
   * descendants, so an in-place backdrop would size itself to the header strip
   * instead of the viewport and the dialog would sit clipped at the top.
   */
  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="dialog dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-data-title"
      >
        <header className="card-head">
          <div className="card-head-titles">
            <p className="kicker">Workspace</p>
            <h2 id="sample-data-title">Sample wafers</h2>
            <p className="muted">Demo wafers, uploaded exactly the way you would upload them.</p>
          </div>
          <div className="card-head-actions">
            <span className="pager-info">
              {loadedCount} of {wafers.length} loaded
            </span>
            <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        {status.isLoading ? <Skeleton rows={2} /> : null}

        {status.error ? (
          <div className="choice-panel">
            <Alert tone="error">{errorMessage(status.error)}</Alert>
          </div>
        ) : null}

        {wafers.length > 0 ? (
          <div className="choice-panel">
            <label className="choice-all">
              <input type="checkbox" checked={allChosen} onChange={toggleAll} disabled={busy} />
              Select all
            </label>

            <div className="choice-grid">
              {wafers.map((wafer) => (
                <label
                  key={wafer.key}
                  className={chosen.has(wafer.key) ? 'choice is-chosen' : 'choice'}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(wafer.key)}
                    onChange={() => toggle(wafer.key)}
                    disabled={busy}
                  />
                  <span className="choice-body">
                    <span className="choice-title">
                      {wafer.title}
                      {wafer.loaded ? (
                        <Badge tone="good" icon="check">
                          Loaded
                        </Badge>
                      ) : null}
                    </span>
                    <span className="choice-meta">
                      <code>{wafer.lot}</code>
                      <span className="num">
                        W{wafer.waferNumber} · {wafer.dieCount.toLocaleString()} dies
                        {wafer.rejectedRows > 0 ? ` · ${wafer.rejectedRows} bad rows` : ''}
                      </span>
                    </span>
                    <span className="choice-summary">{wafer.summary}</span>
                  </span>
                </label>
              ))}
            </div>

            {error ? <Alert tone="error">{error}</Alert> : null}
            <p className="muted choice-note">
              Removing deletes only the wafers you pick. Your own uploads, the suite's wafers,
              reference data and users are never touched.
            </p>
          </div>
        ) : null}

        <footer className="card-foot">
          <span className="pager-info">
            {toLoad.length > 0 || toRemove.length > 0
              ? `${toLoad.length} to load · ${toRemove.length} to remove`
              : `${chosen.size} selected`}
          </span>
          <div className="pager">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || toRemove.length === 0}
              onClick={() => {
                setError(undefined);
                remove.mutate(toRemove.map((wafer) => wafer.key));
              }}
            >
              <Icon name="close" size={15} />
              {remove.isPending
                ? 'Removing…'
                : `Remove${toRemove.length > 0 ? ` (${toRemove.length})` : ''}`}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || toLoad.length === 0}
              onClick={() => {
                setError(undefined);
                load.mutate(toLoad.map((wafer) => wafer.key));
              }}
            >
              <Icon name="upload" size={15} />
              {load.isPending
                ? 'Loading…'
                : `Load${toLoad.length > 0 ? ` (${toLoad.length})` : ''}`}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
