import { useEffect, useRef, useState, type ReactElement } from 'react';

/*
 * Ghost wafer for the sign-in panel — a watermark, not a picture. Drawn on a
 * canvas like every other wafer surface in the app, but in low-alpha ink so the
 * headline stays the loudest thing on the panel. Deterministic: a small seeded
 * generator places the dies, so the artwork never changes between renders.
 */

const DIE_INK = '255, 255, 255';
const FAIL_INK = '208, 59, 59';

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function drawWafer(canvas: HTMLCanvasElement, size: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);

  const centre = size / 2;
  const radius = size * 0.46;
  const random = seeded(20260817);

  // Disc: barely-there body with a hairline edge and a notch at the bottom.
  const notchHalf = 0.05 * Math.PI;
  const outline = new Path2D();
  outline.arc(
    centre,
    centre,
    radius,
    Math.PI / 2 + notchHalf,
    Math.PI / 2 - notchHalf + Math.PI * 2,
  );
  outline.lineTo(centre, centre + radius - radius * 0.06);
  outline.closePath();

  const body = context.createLinearGradient(0, centre - radius, 0, centre + radius);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
  body.addColorStop(1, 'rgba(255, 255, 255, 0.015)');
  context.fillStyle = body;
  context.fill(outline);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  context.stroke(outline);

  context.save();
  context.clip(outline);

  const cell = size / 30;
  const gap = Math.max(1.2, cell * 0.16);
  const inner = cell - gap;
  const reach = Math.ceil(size / cell / 2) + 1;

  // One diagonal scratch of failing dies, so the watermark still reads as a
  // wafer map rather than a texture.
  const scratch = new Set<string>();
  for (let step = 0; step < 10; step += 1) {
    const col = 5 + Math.round(step * 0.5);
    scratch.add(`${col}:${-6 + step}`);
    if (step % 2 === 0) scratch.add(`${col + 1}:${-6 + step}`);
  }

  for (let row = -reach; row <= reach; row += 1) {
    for (let col = -reach; col <= reach; col += 1) {
      const x = centre + col * cell;
      const y = centre + row * cell;
      const dx = x + cell / 2 - centre;
      const dy = y + cell / 2 - centre;
      if (Math.sqrt(dx * dx + dy * dy) > radius - cell * 0.7) continue;

      const roll = random();
      const failing = scratch.has(`${col}:${row}`) || roll > 0.972;
      context.fillStyle = failing
        ? `rgba(${FAIL_INK}, 0.42)`
        : `rgba(${DIE_INK}, ${0.05 + roll * 0.07})`;
      context.beginPath();
      if (typeof context.roundRect === 'function') {
        context.roundRect(x + gap / 2, y + gap / 2, inner, inner, Math.max(1, cell * 0.12));
      } else {
        context.rect(x + gap / 2, y + gap / 2, inner, inner);
      }
      context.fill();
    }
  }
  context.restore();
}

/**
 * Renders its own clipping layer — absolute with `inset: 0`, so it matches the
 * panel exactly, can never add to the page's layout or scroll width, and clips
 * the disc where it bleeds off the edge. The disc is sized from the measured
 * panel rather than a fixed pixel value, so it cannot outgrow a narrow panel.
 */
export function WaferHero(): ReactElement {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const fitted = Math.min(box.width * 0.72, box.height * 0.84, 660);
      setSize(Math.max(0, Math.round(fitted)));
    });
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && size > 0) drawWafer(canvas, size);
  }, [size]);

  return (
    <div className="wafer-ghost-layer" aria-hidden="true" ref={layerRef}>
      <canvas ref={canvasRef} className="wafer-ghost" />
    </div>
  );
}
