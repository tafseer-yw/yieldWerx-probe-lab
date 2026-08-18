/*
 * Sample wafers — the optional demo set behind the Sample wafers dialog.
 *
 * These are NOT seeded reference data. The reference hierarchy (facility, work
 * center, device, test program) and the demo users are created by
 * `npm run setup` and are always present; these wafers are loaded and removed
 * on demand by an admin.
 *
 * Each wafer is emitted as CSV text and pushed through the ordinary upload
 * path — the same parser, the same validation, the same landing. Nothing here
 * writes to the die table directly, so a sample wafer is indistinguishable
 * from one an engineer uploaded, and the last file deliberately carries bad
 * rows so Upload history and the validation report have something to show.
 *
 * Every value is deterministic: loading twice produces identical wafers.
 */

export const SAMPLE_LOT_PREFIX = 'DEMO-';

export interface SampleWafer {
  /** Stable id the UI selects by. */
  key: string;
  fileName: string;
  lot: string;
  wafer: number;
  title: string;
  summary: string;
  csv: string;
}

interface DieSpec {
  hardBin: number;
  softBin: number;
  hardBinName: string;
  softBinName: string;
}

const PASS: DieSpec = { hardBin: 1, softBin: 1, hardBinName: 'Pass', softBinName: 'Pass' };

/* Fail bins. The soft bin is finer than the hard bin, so the wafer map's
 * Hard Bin and Soft Bin views genuinely differ. */
const FAILS: Record<string, DieSpec> = {
  leakage: { hardBin: 2, softBin: 21, hardBinName: 'Parametric', softBinName: 'Leakage high' },
  vt: { hardBin: 2, softBin: 22, hardBinName: 'Parametric', softBinName: 'Vt shift' },
  open: { hardBin: 3, softBin: 31, hardBinName: 'Continuity', softBinName: 'Pin open' },
  short: { hardBin: 4, softBin: 41, hardBinName: 'Short', softBinName: 'Rail short' },
  fmax: { hardBin: 5, softBin: 51, hardBinName: 'Speed', softBinName: 'Fmax fail' },
  edge: { hardBin: 7, softBin: 71, hardBinName: 'Edge', softBinName: 'Edge die' },
};

const HEADER = 'Lot,Wafer,X,Y,HB#,SB#,PF_Flag,HB name,SB name';

/** Deterministic 0..1 from a coordinate and a seed — no Math.random anywhere. */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function row(lot: string, wafer: number, x: number, y: number, spec: DieSpec): string {
  const flag = spec.hardBin <= 1 ? 'P' : 'F';
  return `${lot},${wafer},${x},${y},${spec.hardBin},${spec.softBin},${flag},${spec.hardBinName},${spec.softBinName}`;
}

/** Round wafer: every site inside the radius of a square grid. */
function sites(size: number): Array<{ x: number; y: number; radial: number }> {
  const centre = (size - 1) / 2;
  const radius = centre + 0.45;
  const out: Array<{ x: number; y: number; radial: number }> = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.sqrt((x - centre) ** 2 + (y - centre) ** 2);
      if (distance <= radius) out.push({ x, y, radial: distance / radius });
    }
  }
  return out;
}

/** A healthy wafer: high yield, a few scattered random failures. */
function baselineWafer(): SampleWafer {
  const lot = `${SAMPLE_LOT_PREFIX}BASELINE`;
  const wafer = 1;
  const lines = [HEADER];
  for (const site of sites(21)) {
    const roll = noise(site.x, site.y, 11);
    let spec = PASS;
    if (roll > 0.975) spec = FAILS.leakage as DieSpec;
    else if (roll > 0.962) spec = FAILS.fmax as DieSpec;
    lines.push(row(lot, wafer, site.x, site.y, spec));
  }
  return {
    key: 'baseline',
    fileName: 'demo-baseline-w1.csv',
    lot,
    wafer,
    title: 'Healthy baseline',
    summary: 'High yield, only scattered failures.',
    csv: lines.join('\n'),
  };
}

/** A handling scratch: a diagonal run of failures plus one dense knot. */
function scratchWafer(): SampleWafer {
  const lot = `${SAMPLE_LOT_PREFIX}SCRATCH`;
  const wafer = 3;
  const scratch = new Set<string>();
  for (let step = 0; step < 11; step += 1) {
    const x = 4 + step;
    const y = 5 + Math.floor(step * 0.7);
    scratch.add(`${x}:${y}`);
    if (step % 2 === 0) scratch.add(`${x}:${y + 1}`);
  }
  const knot = new Set<string>();
  for (let y = 13; y <= 15; y += 1) for (let x = 5; x <= 7; x += 1) knot.add(`${x}:${y}`);

  const lines = [HEADER];
  for (const site of sites(21)) {
    const key = `${site.x}:${site.y}`;
    let spec = PASS;
    if (scratch.has(key)) spec = FAILS.open as DieSpec;
    else if (knot.has(key)) spec = FAILS.short as DieSpec;
    else if (noise(site.x, site.y, 23) > 0.985) spec = FAILS.leakage as DieSpec;
    lines.push(row(lot, wafer, site.x, site.y, spec));
  }
  return {
    key: 'scratch',
    fileName: 'demo-scratch-w3.csv',
    lot,
    wafer,
    title: 'Handling scratch',
    summary: 'A diagonal scratch plus a dense knot.',
    csv: lines.join('\n'),
  };
}

/** An edge ring: failures crowd the perimeter, with two clusters inside it. */
function edgeRingWafer(): SampleWafer {
  const lot = `${SAMPLE_LOT_PREFIX}EDGE-RING`;
  const wafer = 7;
  const patch = new Set<string>();
  for (let y = 8; y <= 10; y += 1) for (let x = 14; x <= 16; x += 1) patch.add(`${x}:${y}`);
  for (let y = 15; y <= 16; y += 1) for (let x = 9; x <= 11; x += 1) patch.add(`${x}:${y}`);

  const lines = [HEADER];
  for (const site of sites(23)) {
    const key = `${site.x}:${site.y}`;
    let spec = PASS;
    if (site.radial > 0.86) spec = FAILS.edge as DieSpec;
    else if (patch.has(key)) spec = FAILS.vt as DieSpec;
    else if (site.radial > 0.72 && noise(site.x, site.y, 37) > 0.72) spec = FAILS.edge as DieSpec;
    else if (noise(site.x, site.y, 41) > 0.972) spec = FAILS.fmax as DieSpec;
    lines.push(row(lot, wafer, site.x, site.y, spec));
  }
  return {
    key: 'edge-ring',
    fileName: 'demo-edge-ring-w7.csv',
    lot,
    wafer,
    title: 'Edge ring',
    summary: 'Perimeter loss, two clusters, five bins.',
    csv: lines.join('\n'),
  };
}

/** A file a tester produced badly: good rows land, bad rows are reported. */
function partlyBadWafer(): SampleWafer {
  const lot = `${SAMPLE_LOT_PREFIX}BAD-ROWS`;
  const wafer = 9;
  const lines = [HEADER];
  for (const site of sites(11)) {
    const spec = noise(site.x, site.y, 53) > 0.86 ? (FAILS.leakage as DieSpec) : PASS;
    lines.push(row(lot, wafer, site.x, site.y, spec));
  }
  // One row per error code the parser can raise.
  lines.push(`${lot},9,,4,1,1,P,Pass,Pass`);
  lines.push(`${lot},9,4,4,abc,1,F,Parametric,Leakage high`);
  lines.push(`${lot},9,4,120,2,21,F,Parametric,Leakage high`);
  lines.push(`${lot},9,5,5,2,21,X,Parametric,Leakage high`);
  lines.push(`${lot},9,6,5,2,21,P,Parametric,Leakage high`);
  lines.push(`${lot},9,0,5,1,1,P,Pass,Pass`);
  lines.push(`${SAMPLE_LOT_PREFIX}OTHER,9,7,5,1,1,P,Pass,Pass`);
  return {
    key: 'bad-rows',
    fileName: 'demo-bad-rows-w9.csv',
    lot,
    wafer,
    title: 'Partly bad file',
    summary: 'Good rows land, bad rows are reported.',
    csv: lines.join('\n'),
  };
}

export function sampleWafers(): SampleWafer[] {
  return [baselineWafer(), scratchWafer(), edgeRingWafer(), partlyBadWafer()];
}

/** Metadata only — no CSV — for listing the set without shipping the data. */
export interface SampleWaferEntry {
  key: string;
  lot: string;
  waferNumber: number;
  title: string;
  summary: string;
  dieCount: number;
  rejectedRows: number;
}

let catalogue: SampleWaferEntry[] | null = null;

/** Counts what each file would land, so the dialog can show real numbers. */
export function sampleCatalogue(
  countRows: (csv: string) => { accepted: number; rejected: number },
): SampleWaferEntry[] {
  if (catalogue) return catalogue;
  catalogue = sampleWafers().map((wafer) => {
    const counted = countRows(wafer.csv);
    return {
      key: wafer.key,
      lot: wafer.lot,
      waferNumber: wafer.wafer,
      title: wafer.title,
      summary: wafer.summary,
      dieCount: counted.accepted,
      rejectedRows: counted.rejected,
    };
  });
  return catalogue;
}
