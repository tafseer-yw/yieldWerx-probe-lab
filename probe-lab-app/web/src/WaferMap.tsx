import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import type { DieRecord } from '../../shared/contracts.js';
import {
  dieLattice,
  latticeColumn,
  latticeRow,
  type DieLattice,
} from '../../shared/die-lattice.js';
import { help } from './help.js';
import { useResolvedTheme } from './theme.js';
import { HelpDot } from './ui.js';

/*
 * Wafer map — a round wafer drawn on a <canvas>.
 *
 * Geometry: the disc is centred on the die-grid bounds and sized to enclose
 * every landed die, with a notch cut at the bottom like a real wafer. Every
 * lattice position inside the disc is drawn — faint where no die was measured —
 * so the die pitch reads to the wafer edge.
 *
 * Colour: pass/fail is the blue↔red diverging pair, never green/red, which
 * fails deuteranope separation (ΔE 4.1 vs 23.8). Note the real product paints
 * passing dies green; this build trades that convention for CVD safety.
 * Hard Bin / Soft Bin modes ramp pass bins through one blue scale and fail bins
 * through one red scale ordered by die count — a magnitude encoding, not a
 * rainbow — and name every bin with its die count in the legend, so identity
 * never rests on hue alone. A soft bin has no pass/fail flag of its own, so
 * bins 0 and 1 count as passing, matching the bin pareto.
 *
 * The three-way control is a playground affordance. yieldWerx itself exposes
 * this as the Bin Type report option (soft vs hard) and as separate Soft-Bin
 * and Hard-Bin Wafer Map report types; only the bin names here are product
 * terminology.
 *
 * Testability: a canvas has no per-die DOM, so the component also renders a
 * visually-hidden mirror carrying one element per die with the
 * data-x / data-y / data-hardbin / data-softbin / data-passfail / data-cluster
 * contract the QA suite asserts against (`.claude/rules/locator-policy.md`).
 */

interface WaferMapProps {
  dies: DieRecord[];
  highlight?: ReadonlySet<string>;
  maxCellSize?: number;
  maxHeight?: number;
}

type ColourMode = 'flag' | 'hard' | 'soft';

interface BinCount {
  bin: number;
  count: number;
  passing: boolean;
}

interface WaferModel {
  cols: number;
  rows: number;
  /** Raw coordinates are lattice positions whose step is not always 1. */
  lattice: DieLattice;
  /** Keyed by lattice cell `column:row`, not by raw coordinate. */
  byKey: Map<string, DieRecord>;
  passCount: number;
  failCount: number;
  /** Farthest die centre from the grid centre, in cell units. */
  spread: number;
  hardBins: BinCount[];
  softBins: BinCount[];
}

interface HoverState {
  die: DieRecord;
  left: number;
  top: number;
  inCluster: boolean;
}

const MIN_CELL = 4;
const NOTCH_HALF_ANGLE = 0.055 * Math.PI;

/* One blue scale for pass bins, one red scale for fail bins. Fail bins are
 * ranked by die count, so the dominant failure is always the darkest red. */
const PASS_RAMP_LIGHT = ['#9ec5f4', '#2a78d6'];
const PASS_RAMP_DARK = ['#86b6ef', '#3987e5'];
const FAIL_RAMP = ['#a32424', '#c73434', '#d95050', '#e57070', '#ef9494', '#f6b8b8'];

function buildModel(dies: DieRecord[]): WaferModel {
  if (dies.length === 0) {
    return {
      cols: 0,
      rows: 0,
      lattice: dieLattice([]),
      byKey: new Map(),
      passCount: 0,
      failCount: 0,
      spread: 0,
      hardBins: [],
      softBins: [],
    };
  }
  const lattice = dieLattice(dies);
  let passCount = 0;
  const byKey = new Map<string, DieRecord>();
  const hardBins = new Map<number, { count: number; passing: boolean }>();
  const softBins = new Map<number, { count: number; passing: boolean }>();

  for (const die of dies) {
    if (die.passFailFlag === 'P') passCount += 1;
    byKey.set(`${latticeColumn(lattice, die.x)}:${latticeRow(lattice, die.y)}`, die);
    const hard = hardBins.get(die.hardBin);
    hardBins.set(die.hardBin, {
      count: (hard?.count ?? 0) + 1,
      passing: die.passFailFlag === 'P',
    });
    const soft = softBins.get(die.softBin);
    softBins.set(die.softBin, {
      count: (soft?.count ?? 0) + 1,
      // A soft bin carries no flag of its own: 0 and 1 are the passing bins,
      // the same rule the bin pareto applies when Bin type is Soft Bin.
      passing: die.softBin <= 1,
    });
  }

  const cols = lattice.columns;
  const rows = lattice.rows;
  const centreX = (cols - 1) / 2;
  const centreY = (rows - 1) / 2;
  let spread = 0;
  for (const die of dies) {
    const dx = latticeColumn(lattice, die.x) - centreX;
    const dy = latticeRow(lattice, die.y) - centreY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > spread) spread = distance;
  }

  return {
    cols,
    rows,
    lattice,
    byKey,
    passCount,
    failCount: dies.length - passCount,
    spread,
    hardBins: toBinCounts(hardBins),
    softBins: toBinCounts(softBins),
  };
}

function toBinCounts(source: Map<number, { count: number; passing: boolean }>): BinCount[] {
  return [...source.entries()]
    .map(([bin, value]) => ({ bin, count: value.count, passing: value.passing }))
    .sort((left, right) => left.bin - right.bin);
}

function binColours(bins: BinCount[], theme: 'light' | 'dark'): Map<number, string> {
  const passRamp = theme === 'dark' ? PASS_RAMP_DARK : PASS_RAMP_LIGHT;
  const colours = new Map<number, string>();
  const passing = bins.filter((entry) => entry.passing);
  passing.forEach((entry, index) => {
    colours.set(
      entry.bin,
      passRamp[Math.min(index, passRamp.length - 1)] ?? passRamp[0] ?? '#2a78d6',
    );
  });
  const failing = [...bins.filter((entry) => !entry.passing)].sort(
    (left, right) => right.count - left.count || left.bin - right.bin,
  );
  failing.forEach((entry, index) => {
    colours.set(entry.bin, FAIL_RAMP[Math.min(index, FAIL_RAMP.length - 1)] ?? '#d03b3b');
  });
  return colours;
}

function cellPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  context.beginPath();
  if (typeof context.roundRect === 'function') context.roundRect(x, y, size, size, radius);
  else context.rect(x, y, size, size);
}

/** The wafer outline: a full disc with a V notch cut at the bottom. */
function waferOutline(centre: number, radius: number): Path2D {
  const path = new Path2D();
  const start = Math.PI / 2 + NOTCH_HALF_ANGLE;
  const end = Math.PI / 2 - NOTCH_HALF_ANGLE + Math.PI * 2;
  path.arc(centre, centre, radius, start, end, false);
  path.lineTo(centre, centre + radius - Math.max(6, radius * 0.07));
  path.closePath();
  return path;
}

export function WaferMap({
  dies,
  highlight,
  maxCellSize = 46,
  maxHeight = 480,
}: WaferMapProps): ReactElement {
  const theme = useResolvedTheme();
  const model = useMemo(() => buildModel(dies), [dies]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [mode, setMode] = useState<ColourMode>('flag');

  const activeBins = mode === 'soft' ? model.softBins : model.hardBins;
  const colours = useMemo(() => binColours(activeBins, theme), [activeBins, theme]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      setAvailable(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /* Disc radius in cell units, then the cell size that fits it. */
  const discRadiusCells = model.spread + 0.78;
  const spanCells = discRadiusCells * 2;

  const cell = useMemo(() => {
    if (model.cols === 0) return 0;
    const byWidth = available > 0 ? (available - 16) / spanCells : maxCellSize;
    const byHeight = (maxHeight - 16) / spanCells;
    return Math.max(MIN_CELL, Math.min(maxCellSize, Math.floor(byWidth), Math.floor(byHeight)));
  }, [available, maxCellSize, maxHeight, model.cols, spanCells]);

  const size = Math.round(cell * spanCells) + 16;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || model.cols === 0 || cell === 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);

    const styles = getComputedStyle(canvas);
    const read = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback;
    const passColour = read('--mark-pass', '#2a78d6');
    const failColour = read('--mark-fail', '#d03b3b');
    const ringColour = read('--map-cluster-ring', '#101319');
    const discFill = read('--map-disc', '#eef1f7');
    const discEdge = read('--map-disc-edge', '#c8d0dd');
    const latticeColour = read('--map-lattice', '#dfe4ec');

    const centre = size / 2;
    const radius = cell * discRadiusCells;
    const outline = waferOutline(centre, radius);

    // Wafer body: soft shadow, subtle vertical gradient, silicon sheen.
    context.save();
    context.shadowColor = theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(16,19,25,0.16)';
    context.shadowBlur = 14;
    context.shadowOffsetY = 3;
    const body = context.createLinearGradient(0, centre - radius, 0, centre + radius);
    body.addColorStop(0, discFill);
    body.addColorStop(1, theme === 'dark' ? '#111620' : '#e7ecf4');
    context.fillStyle = body;
    context.fill(outline);
    context.restore();

    const sheen = context.createRadialGradient(
      centre - radius * 0.45,
      centre - radius * 0.55,
      radius * 0.1,
      centre,
      centre,
      radius * 1.1,
    );
    sheen.addColorStop(0, theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.85)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = sheen;
    context.fill(outline);

    // Everything below is clipped to the wafer.
    context.save();
    context.clip(outline);

    const gap = cell >= 9 ? 2 : 1;
    const inner = cell - gap;
    const radiusPx = Math.max(1, Math.min(3, Math.round(cell / 5)));
    const originX = centre - (model.cols * cell) / 2;
    const originY = centre - (model.rows * cell) / 2;
    const dimOthers = highlight !== undefined && highlight.size > 0;

    // Lattice: every die site inside the disc, including unmeasured ones.
    const reach = Math.ceil(discRadiusCells) + 1;
    context.fillStyle = latticeColour;
    context.globalAlpha = theme === 'dark' ? 0.5 : 0.75;
    for (let row = -reach; row < model.rows + reach; row += 1) {
      for (let col = -reach; col < model.cols + reach; col += 1) {
        const cx = originX + col * cell + cell / 2;
        const cy = originY + row * cell + cell / 2;
        const dx = cx - centre;
        const dy = cy - centre;
        if (Math.sqrt(dx * dx + dy * dy) > radius - cell * 0.62) continue;
        if (model.byKey.has(`${col}:${row}`)) continue;
        cellPath(
          context,
          originX + col * cell + gap / 2,
          originY + row * cell + gap / 2,
          inner,
          radiusPx,
        );
        context.fill();
      }
    }
    context.globalAlpha = 1;

    // Measured dies.
    for (const die of model.byKey.values()) {
      const left = originX + latticeColumn(model.lattice, die.x) * cell;
      const top = originY + latticeRow(model.lattice, die.y) * cell;
      const inCluster = highlight?.has(`${die.x}:${die.y}`) === true;
      context.globalAlpha = dimOthers && !inCluster ? 0.24 : 1;
      context.fillStyle =
        mode === 'flag'
          ? die.passFailFlag === 'P'
            ? passColour
            : failColour
          : (colours.get(mode === 'soft' ? die.softBin : die.hardBin) ??
            (die.passFailFlag === 'P' ? passColour : failColour));
      cellPath(context, left + gap / 2, top + gap / 2, inner, radiusPx);
      context.fill();

      if (inCluster) {
        context.globalAlpha = 1;
        context.lineWidth = Math.max(1.5, Math.min(3, cell * 0.17));
        context.strokeStyle = ringColour;
        cellPath(
          context,
          left + gap / 2 + context.lineWidth / 2,
          top + gap / 2 + context.lineWidth / 2,
          inner - context.lineWidth,
          radiusPx,
        );
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    context.restore();

    // Wafer edge, drawn last so it sits above the dies.
    context.lineWidth = 1.5;
    context.strokeStyle = discEdge;
    context.stroke(outline);
  }, [cell, colours, discRadiusCells, highlight, mode, model, size, theme]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || cell === 0) return;
      const bounds = canvas.getBoundingClientRect();
      const displayScale = bounds.width / size;
      const canvasX = (event.clientX - bounds.left) / displayScale;
      const canvasY = (event.clientY - bounds.top) / displayScale;
      const originX = size / 2 - (model.cols * cell) / 2;
      const originY = size / 2 - (model.rows * cell) / 2;
      const col = Math.floor((canvasX - originX) / cell);
      const row = Math.floor((canvasY - originY) / cell);
      const die = model.byKey.get(`${col}:${row}`);
      if (!die) {
        setHover(null);
        return;
      }
      setHover({
        die,
        left: canvas.offsetLeft + (originX + col * cell + cell / 2) * displayScale,
        top: canvas.offsetTop + (originY + row * cell) * displayScale,
        inCluster: highlight?.has(`${die.x}:${die.y}`) === true,
      });
    },
    [cell, highlight, model, size],
  );

  if (dies.length === 0) {
    return <p className="muted">This wafer has no die-level results.</p>;
  }

  const clusterCount = highlight?.size ?? 0;
  const description =
    `Wafer die map — ${dies.length} dies, ${model.passCount} passing, ${model.failCount} failing` +
    (clusterCount > 0 ? `, ${clusterCount} in a detected cluster` : '');

  return (
    <div className="wafer-map">
      <div className="wafer-toolbar">
        <span className="muted">
          {model.cols} × {model.rows} die grid · {dies.length.toLocaleString()} dies
        </span>
        <span className="wafer-toolbar-control">
          <span className="field-label">Colour by</span>
          <HelpDot title="Colour dies by" help={help.colourDiesBy} />
        </span>
        <div className="segmented" role="tablist" aria-label="Colour dies by">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'flag'}
            onClick={() => setMode('flag')}
          >
            Pass / fail
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'hard'}
            onClick={() => setMode('hard')}
          >
            Hard bin
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'soft'}
            onClick={() => setMode('soft')}
          >
            Soft bin
          </button>
        </div>
      </div>

      <div className="wafer-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={description}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        />
        {hover ? (
          <div className="map-tooltip" style={{ left: hover.left, top: hover.top }}>
            <span className="tip-head">
              ({hover.die.x}, {hover.die.y}) {hover.die.passFailFlag === 'P' ? 'Pass' : 'Fail'}
            </span>
            <span className="tip-row">
              HB {hover.die.hardBin} · SB {hover.die.softBin}
              {hover.inCluster ? ' · in cluster' : ''}
            </span>
          </div>
        ) : null}
        <div className="wafer-data" aria-hidden="true" data-testid="wafer-map-data">
          {[...model.byKey.values()].map((die) => {
            const inCluster = highlight?.has(`${die.x}:${die.y}`) === true;
            return (
              <span
                key={die.dieId}
                className={`die die-${die.passFailFlag.toLowerCase()}${inCluster ? ' die-cluster' : ''}`}
                data-x={die.x}
                data-y={die.y}
                data-hardbin={die.hardBin}
                data-softbin={die.softBin}
                data-passfail={die.passFailFlag}
                data-cluster={inCluster ? 'true' : undefined}
              />
            );
          })}
        </div>
      </div>

      <div className="legend">
        {mode === 'flag' ? (
          <>
            <span className="legend-item">
              <i className="legend-swatch is-pass" /> Pass
              <span className="num">({model.passCount.toLocaleString()})</span>
            </span>
            <span className="legend-item">
              <i className="legend-swatch is-fail" /> Fail
              <span className="num">({model.failCount.toLocaleString()})</span>
            </span>
          </>
        ) : (
          activeBins.map((entry) => (
            <span className="legend-item" key={entry.bin}>
              <i className="legend-swatch" style={{ background: colours.get(entry.bin) }} />
              Bin {entry.bin}
              <span className="num">({entry.count.toLocaleString()})</span>
            </span>
          ))
        )}
        {clusterCount > 0 ? (
          <span className="legend-item">
            <i className="legend-swatch is-cluster" /> Cluster
            <span className="num">({clusterCount.toLocaleString()})</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
