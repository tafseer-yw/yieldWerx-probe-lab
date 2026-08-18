import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type { WaferDetail } from '../../shared/contracts.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { help } from './help.js';
import { WaferMap } from './WaferMap.js';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHead,
  Icon,
  Skeleton,
  Stat,
  formatDateTime,
} from './ui.js';

export function WaferDetailPage(): ReactElement {
  const { api } = useAuth();
  const { waferSequence } = useParams<{ waferSequence: string }>();
  const navigate = useNavigate();
  const [wafer, setWafer] = useState<WaferDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const sequence = Number(waferSequence);
    setWafer(undefined);
    setError(undefined);
    if (!Number.isInteger(sequence) || sequence < 1) {
      setError('Invalid wafer sequence.');
      return;
    }
    void api
      .getWafer(sequence)
      .then((value) => {
        if (active) setWafer(value);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [api, waferSequence]);

  const hardBins = useMemo(() => {
    const counts = new Map<number, number>();
    for (const die of wafer?.dies ?? []) {
      counts.set(die.hardBin, (counts.get(die.hardBin) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left - right);
  }, [wafer?.dies]);

  const dieTotal = wafer?.dies.length ?? 0;

  return (
    <>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/wafers')}>
          <Icon name="back" size={15} />
          Back to wafers
        </button>
        {wafer ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/triage', { state: { waferSequence: wafer.waferSequence } })}
            >
              <Icon name="target" size={15} />
              Triage wafer
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                navigate('/detection', { state: { waferSequence: wafer.waferSequence } })
              }
            >
              <Icon name="scan" size={15} />
              Detect clusters
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                navigate('/reports/bin-pareto', { state: { waferSequence: wafer.waferSequence } })
              }
            >
              <Icon name="chart" size={15} />
              Bin pareto
            </button>
          </>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!wafer && !error ? (
        <Card>
          <Skeleton rows={4} />
        </Card>
      ) : null}

      {wafer ? (
        <>
          <div className="stats">
            <Stat
              label="Wafer"
              value={<span style={{ fontSize: 19 }}>{wafer.lot}</span>}
              foot={`Wafer ${wafer.waferNumber} · sequence ${wafer.waferSequence}`}
              icon={<Icon name="wafer" size={14} />}
            />
            <Stat
              label="Part count"
              value={wafer.partCount.toLocaleString()}
              foot="Dies recorded"
            />
            <Stat
              label="Pass count"
              value={wafer.passCount.toLocaleString()}
              foot={`${(wafer.partCount - wafer.passCount).toLocaleString()} failing`}
            />
            <Stat label="Yield" value={`${wafer.yield.toFixed(2)}%`} accent foot="Pass ÷ parts" />
            <Stat
              label="Finished"
              value={<span style={{ fontSize: 15 }}>{formatDateTime(wafer.finishTime)}</span>}
              foot={
                <Badge tone="accent">
                  {wafer.device} · {wafer.testProgram}
                </Badge>
              }
            />
          </div>

          <div className="grid-2">
            <Card>
              <CardHead
                title="Wafer map"
                subtitle="Hover a die for its coordinate and bins."
                help={help.waferMap}
              />
              <CardBody>
                <WaferMap dies={wafer.dies} />
              </CardBody>
            </Card>

            <Card>
              <CardHead
                title="Hard bin distribution"
                subtitle={`${dieTotal.toLocaleString()} dies`}
              />
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
                          Share
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {hardBins.map(([bin, count]) => (
                        <tr key={bin}>
                          <td>
                            <code>{bin}</code>
                            {bin <= 1 ? (
                              <small>
                                <span
                                  className="dot dot-pass"
                                  style={{ display: 'inline-block' }}
                                />{' '}
                                pass bin
                              </small>
                            ) : (
                              <small>
                                <span
                                  className="dot dot-fail"
                                  style={{ display: 'inline-block' }}
                                />{' '}
                                fail bin
                              </small>
                            )}
                          </td>
                          <td className="num align-right cell-strong">{count.toLocaleString()}</td>
                          <td className="num align-right">
                            {((count / dieTotal) * 100).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
