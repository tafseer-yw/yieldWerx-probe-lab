import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import type { BinParetoBin } from '../../shared/contracts.js';
import { useResolvedTheme } from './theme.js';

/*
 * Bin pareto chart — drawn on a <canvas>.
 *
 * Both series are percentages of the wafer's total dies, so they share ONE
 * 0–100% axis: no dual-scale axis. Bars carry bin %, the line carries the
 * running cumulative %. The data table beside the chart is the table view, and
 * the two series are named in a legend, so nothing depends on hue alone.
 *
 * The chart draws no DOM text — axis ticks and the two direct labels are canvas
 * text — so the table stays the single DOM source of every bin's numbers.
 */

interface ParetoChartProps {
  bins: BinParetoBin[];
  height?: number;
}

interface HoverState {
  bin: BinParetoBin;
  left: number;
  top: number;
}

interface Geometry {
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  band: number;
  barWidth: number;
}

const PAD = { left: 44, right: 20, top: 22, bottom: 30 };
const MAX_BAR = 24;
/** Keep the plot compact when there are only a few bins, so bars are not lost in a wide band. */
const MAX_BAND = 108;

function geometryFor(width: number, height: number, count: number): Geometry {
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = Math.max(0, height - PAD.top - PAD.bottom);
  const band = count > 0 ? plotWidth / count : 0;
  return {
    plotLeft: PAD.left,
    plotTop: PAD.top,
    plotWidth,
    plotHeight,
    band,
    barWidth: Math.max(3, Math.min(MAX_BAR, band - 10)),
  };
}

function barRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  // 4px rounded data-end, square at the baseline.
  const radius = Math.min(4, width / 2, height);
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, width, height, [radius, radius, 0, 0]);
    return;
  }
  context.beginPath();
  context.rect(x, y, width, height);
}

export function ParetoChart({ bins, height = 268 }: ParetoChartProps): ReactElement {
  const theme = useResolvedTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const drawWidth = useMemo(() => {
    if (width === 0 || bins.length === 0) return width;
    return Math.min(width, PAD.left + PAD.right + bins.length * MAX_BAND);
  }, [bins.length, width]);

  const geometry = useMemo(
    () => geometryFor(drawWidth, height, bins.length),
    [bins.length, drawWidth, height],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawWidth === 0 || bins.length === 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(drawWidth * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${drawWidth}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, drawWidth, height);

    const styles = getComputedStyle(canvas);
    const read = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback;
    const barColor = read('--series-1', '#2a78d6');
    const lineColor = read('--series-2', '#eb6834');
    const gridColor = read('--gridline', '#e6e9ef');
    const axisColor = read('--axis', '#cfd5df');
    const mutedInk = read('--ink-3', '#79818f');
    const strongInk = read('--ink', '#101319');
    const surface = read('--surface', '#ffffff');

    const { plotLeft, plotTop, plotWidth, plotHeight, band, barWidth } = geometry;
    const yOf = (percentage: number): number => plotTop + plotHeight * (1 - percentage / 100);
    const font = getComputedStyle(document.body).fontFamily;

    // Gridlines + y ticks — hairline, solid, recessive.
    context.font = `500 11px ${font}`;
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (const tick of [0, 25, 50, 75, 100]) {
      const y = Math.round(yOf(tick)) + 0.5;
      context.strokeStyle = tick === 0 ? axisColor : gridColor;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(plotLeft, y);
      context.lineTo(plotLeft + plotWidth, y);
      context.stroke();
      context.fillStyle = mutedInk;
      context.fillText(`${tick}%`, plotLeft - 10, y);
    }

    // Bars — bin %.
    bins.forEach((bin, index) => {
      const center = plotLeft + band * (index + 0.5);
      const top = yOf(bin.binPercentage);
      const barHeight = Math.max(1, yOf(0) - top);
      context.globalAlpha = hover === null || hover.bin.binNumber === bin.binNumber ? 1 : 0.42;
      context.fillStyle = barColor;
      barRect(context, center - barWidth / 2, top, barWidth, barHeight);
      context.fill();
      context.globalAlpha = 1;
    });

    // Cumulative % line, on the same axis.
    context.strokeStyle = lineColor;
    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    bins.forEach((bin, index) => {
      const x = plotLeft + band * (index + 0.5);
      const y = yOf(bin.cumulativePercentage);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    bins.forEach((bin, index) => {
      const x = plotLeft + band * (index + 0.5);
      const y = yOf(bin.cumulativePercentage);
      context.beginPath();
      context.arc(x, y, 4.5, 0, Math.PI * 2);
      context.fillStyle = lineColor;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = surface; // surface ring keeps markers legible on the line
      context.stroke();
    });

    // X labels — bin numbers, thinned when the band is tight.
    const step = band < 26 ? Math.ceil(26 / Math.max(band, 1)) : 1;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = mutedInk;
    context.font = `500 11px ${font}`;
    bins.forEach((bin, index) => {
      if (index % step !== 0 && index !== bins.length - 1) return;
      context.fillText(String(bin.binNumber), plotLeft + band * (index + 0.5), yOf(0) + 9);
    });

    // Two selective direct labels: the leading bar, and the cumulative end.
    const leader = bins[0];
    if (leader && barWidth >= 12) {
      context.fillStyle = strongInk;
      context.font = `650 11.5px ${font}`;
      context.textBaseline = 'bottom';
      context.fillText(
        `${leader.binPercentage.toFixed(2)}%`,
        plotLeft + band * 0.5,
        yOf(leader.binPercentage) - 7,
      );
    }
    const last = bins[bins.length - 1];
    if (last && bins.length > 1) {
      context.fillStyle = mutedInk;
      context.font = `650 11.5px ${font}`;
      const text = `${last.cumulativePercentage.toFixed(2)}% running total`;
      const textWidth = context.measureText(text).width;
      const anchorX = plotLeft + band * (bins.length - 0.5);
      const markerY = yOf(last.cumulativePercentage);
      // Keep the label inside the plot: flip below the marker when it would
      // cross the top, and pull left when it would run past the right edge.
      const above = markerY - 12 >= plotTop + 12;
      context.textBaseline = above ? 'bottom' : 'top';
      const right = Math.min(anchorX + 8 + textWidth, plotLeft + plotWidth);
      context.textAlign = 'right';
      context.fillText(text, right, above ? markerY - 12 : markerY + 13);
    }
  }, [bins, drawWidth, geometry, height, hover, theme]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || geometry.band === 0) return;
      const bounds = canvas.getBoundingClientRect();
      const index = Math.floor((event.clientX - bounds.left - geometry.plotLeft) / geometry.band);
      const bin = bins[index];
      if (!bin) {
        setHover(null);
        return;
      }
      setHover({
        bin,
        left: geometry.plotLeft + geometry.band * (index + 0.5),
        top:
          geometry.plotTop +
          geometry.plotHeight * (1 - Math.max(bin.binPercentage, bin.cumulativePercentage) / 100),
      });
    },
    [bins, geometry],
  );

  return (
    <div className="wafer-map">
      {/* The visual-regression handle: the canvas and only the canvas. */}
      <div className="chart-wrap" ref={wrapRef} data-testid="bin-pareto-chart">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Bin pareto — ${bins.length} bins, bin percentage as bars with a running-total line. The data table below carries every value.`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        />
        {hover ? (
          <div className="map-tooltip" style={{ left: hover.left, top: hover.top }}>
            <span className="tip-head">Bin #{hover.bin.binNumber}</span>
            <span className="tip-row">
              {hover.bin.dieCount.toLocaleString()} dies · {hover.bin.binPercentage.toFixed(2)}%
            </span>
            <span className="tip-row">
              {hover.bin.cumulativePercentage.toFixed(2)}% running total
            </span>
          </div>
        ) : null}
      </div>
      <div className="legend">
        <span className="legend-item">
          <i className="legend-swatch" style={{ background: 'var(--series-1)' }} /> Bin %
        </span>
        <span className="legend-item">
          <i className="legend-line" /> Running total %
        </span>
        <span className="legend-item muted">share of all dies on the wafer</span>
      </div>
    </div>
  );
}
