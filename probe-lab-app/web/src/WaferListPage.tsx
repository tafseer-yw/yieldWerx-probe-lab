import { useEffect, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import {
  Alert,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Field,
  Pager,
  Skeleton,
  formatDateTime,
} from './ui.js';

const PAGE_SIZE = 25;

export function WaferListPage(): ReactElement {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [lot, setLot] = useState('');
  const [device, setDevice] = useState('');
  const [program, setProgram] = useState('');
  const [page, setPage] = useState(1);

  const wafers = useQuery({
    queryKey: ['wafers', lot, device, program, page],
    queryFn: () =>
      api.listWafers({
        lot: lot || undefined,
        device: device || undefined,
        program: program || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const items = wafers.data?.items ?? [];
  const total = wafers.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (wafers.data && page > totalPages) setPage(totalPages);
  }, [page, totalPages, wafers.data]);

  const open = (waferSequence: number): void => {
    navigate(`/wafers/${waferSequence}`);
  };

  return (
    <Card>
      <CardHead
        title="Wafers"
        subtitle="Every wafer saved by an upload, most recently finished first."
      />

      <div className="filter-bar">
        <Field label="Lot" help={help.filterLot}>
          <input
            value={lot}
            onChange={(event) => {
              setLot(event.target.value);
              setPage(1);
            }}
            placeholder="Any lot"
          />
        </Field>
        <Field label="Device" help={help.filterDevice}>
          <input
            value={device}
            onChange={(event) => {
              setDevice(event.target.value);
              setPage(1);
            }}
            placeholder="Any device"
          />
        </Field>
        <Field label="Program" help={help.filterProgram}>
          <input
            value={program}
            onChange={(event) => {
              setProgram(event.target.value);
              setPage(1);
            }}
            placeholder="Any program"
          />
        </Field>
      </div>

      {wafers.error ? (
        <CardBody>
          <Alert tone="error">{errorMessage(wafers.error)}</Alert>
        </CardBody>
      ) : null}

      {wafers.isLoading ? <Skeleton rows={5} /> : null}

      {!wafers.isLoading && !wafers.error && items.length === 0 ? (
        <EmptyState
          icon="wafer"
          title="No wafers match these filters."
          hint="Upload a wafer CSV, or clear the lot, device and program filters."
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <CardBody tight>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num" scope="col">
                      Sequence
                    </th>
                    <th scope="col">Lot / Wafer</th>
                    <th scope="col">Device / Program</th>
                    <th className="num align-right" scope="col">
                      Parts / Pass
                    </th>
                    <th className="num align-right" scope="col">
                      Yield
                    </th>
                    <th scope="col">Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((wafer) => (
                    <tr
                      key={wafer.waferSequence}
                      className="is-clickable"
                      tabIndex={0}
                      onClick={() => open(wafer.waferSequence)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') open(wafer.waferSequence);
                      }}
                    >
                      <td className="num">{wafer.waferSequence}</td>
                      <td>
                        <span className="cell-strong">{wafer.lot}</span>
                        <small>Wafer {wafer.waferNumber}</small>
                      </td>
                      <td>
                        {wafer.device}
                        <small>{wafer.testProgram}</small>
                      </td>
                      <td className="num align-right">
                        {wafer.partCount.toLocaleString()}
                        <small>{wafer.passCount.toLocaleString()} pass</small>
                      </td>
                      <td className="num align-right">
                        <span className="cell-strong">{wafer.yield.toFixed(2)}%</span>
                        <span
                          className="meter"
                          style={{ marginTop: 5, height: 4, width: 68, marginLeft: 'auto' }}
                          aria-hidden="true"
                        >
                          <span className="meter-fill" style={{ width: `${wafer.yield}%` }} />
                        </span>
                      </td>
                      <td>{formatDateTime(wafer.finishTime)}</td>
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
              unit={total === 1 ? 'wafer' : 'wafers'}
              onPrevious={() => setPage((value) => value - 1)}
              onNext={() => setPage((value) => value + 1)}
            />
          </footer>
        </>
      ) : null}
    </Card>
  );
}
