/*
 * Die coordinates are lattice positions, but the step between two neighbouring
 * dies is whatever the tester recorded. The CSV practice files step by 1; a real
 * ATDF commonly steps by 5 or more, because its X_COORD/Y_COORD are stepper
 * positions rather than die indices.
 *
 * So anything reasoning about dies touching — cluster adjacency, grid rendering —
 * must work in lattice indices rather than raw coordinates, or physically
 * neighbouring dies look far apart. CLD-08 says two candidates are connected when
 * their coordinates differ by "one step"; this module is what defines a step.
 *
 * Raw coordinates are never rewritten. A die keeps the coordinates its source file
 * recorded, and the lattice is derived on the way in to each calculation.
 */
import type { DieCoordinateFrame } from './contracts.js';

export interface DieLattice {
  /** Raw coordinate of column 0 / row 0. */
  originX: number;
  originY: number;
  /** Raw-coordinate distance between neighbouring columns / rows. */
  pitchX: number;
  pitchY: number;
  /** Lattice extent, in dies rather than raw coordinate units. */
  columns: number;
  rows: number;
}

interface Positioned {
  x: number;
  y: number;
}

function greatestCommonDivisor(left: number, right: number): number {
  let larger = Math.abs(left);
  let smaller = Math.abs(right);
  while (smaller !== 0) {
    const remainder = larger % smaller;
    larger = smaller;
    smaller = remainder;
  }
  return larger;
}

/**
 * The step between neighbouring positions on one axis: the greatest common
 * divisor of the gaps between the distinct values present. A single column, or
 * gaps sharing no common divisor, steps by 1 — which is the old behaviour, so
 * data that was already unit-pitch is unaffected.
 */
export function axisPitch(values: Iterable<number>): number {
  const distinct = [...new Set(values)].sort((left, right) => left - right);
  if (distinct.length < 2) return 1;
  let pitch = 0;
  for (let index = 1; index < distinct.length; index += 1) {
    const gap = (distinct[index] as number) - (distinct[index - 1] as number);
    pitch = greatestCommonDivisor(pitch, gap);
    if (pitch === 1) return 1;
  }
  return pitch < 1 ? 1 : pitch;
}

/**
 * Derives the lattice from every die on the wafer — not only the failing ones,
 * whose spacing says nothing about the grid they sit on.
 */
export function dieLattice(dies: readonly Positioned[]): DieLattice {
  if (dies.length === 0) {
    return { originX: 0, originY: 0, pitchX: 1, pitchY: 1, columns: 0, rows: 0 };
  }
  // Accumulated rather than spread: a wafer may carry 50,000 dies.
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  const xValues: number[] = [];
  const yValues: number[] = [];
  for (const die of dies) {
    if (die.x < minimumX) minimumX = die.x;
    if (die.x > maximumX) maximumX = die.x;
    if (die.y < minimumY) minimumY = die.y;
    if (die.y > maximumY) maximumY = die.y;
    xValues.push(die.x);
    yValues.push(die.y);
  }
  const pitchX = axisPitch(xValues);
  const pitchY = axisPitch(yValues);
  return {
    originX: minimumX,
    originY: minimumY,
    pitchX,
    pitchY,
    columns: Math.round((maximumX - minimumX) / pitchX) + 1,
    rows: Math.round((maximumY - minimumY) / pitchY) + 1,
  };
}

/**
 * Column index of a raw x. Because the pitch divides every gap between distinct
 * coordinates, distinct coordinates always land on distinct indices.
 */
export function latticeColumn(lattice: DieLattice, x: number): number {
  return Math.round((x - lattice.originX) / lattice.pitchX);
}

export function latticeRow(lattice: DieLattice, y: number): number {
  return Math.round((y - lattice.originY) / lattice.pitchY);
}

/*
 * Lattice indices count up from the smallest coordinate. Where on screen index
 * 0 belongs is not a property of the wafer — it is whatever the source file
 * declared. A file stating that positive X grows to the left is drawn with its
 * largest X in column 0; drawing it from the smallest X instead mirrors the
 * whole map, which is exactly the defect these two functions exist to prevent.
 *
 * An undeclared frame keeps the historical behaviour — smallest coordinate
 * first — so CSV data and its approved images do not move.
 */
export function displayColumn(lattice: DieLattice, frame: DieCoordinateFrame, x: number): number {
  const column = latticeColumn(lattice, x);
  return frame.positiveX === 'left' ? lattice.columns - 1 - column : column;
}

export function displayRow(lattice: DieLattice, frame: DieCoordinateFrame, y: number): number {
  const row = latticeRow(lattice, y);
  return frame.positiveY === 'up' ? lattice.rows - 1 - row : row;
}
