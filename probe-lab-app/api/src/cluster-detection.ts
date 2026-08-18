import type {
  ClusterDetectionOptions,
  ClusterDetectionResult,
  DieRecord,
  DetectedCluster,
  SignatureAdjacency,
} from '../../shared/contracts.js';
import { dieLattice, latticeColumn, latticeRow } from '../../shared/die-lattice.js';

/*
 * Cluster detection — a trimmed port of the real "Cluster Size" detector
 * (contiguous fail-die components). The real engine has five detectors and a
 * signature/rule/policy model; this practice version keeps the one detector
 * that QA can reason about: connected components of failing dies under 4- or
 * 8-way adjacency, filtered by a minimum connected-die threshold.
 *
 * Adjacency is walked in lattice indices, not raw coordinates. CLD-08 defines a
 * connection as coordinates differing by "one step", and a step is the die pitch
 * the wafer was recorded with — 1 in the CSV practice files, commonly 5 in a real
 * ATDF. Stepping by a hardcoded 1 made physically touching dies on a wide-pitch
 * wafer look isolated, so no cluster was ever found. Clusters still report the raw
 * coordinates the file recorded; only the neighbour walk is in index space.
 */
interface Coord {
  x: number;
  y: number;
}

/** A failing die held by both its lattice cell and the coordinates it recorded. */
interface Cell extends Coord {
  column: number;
  row: number;
}

const neighborOffsets: Record<SignatureAdjacency, Array<[number, number]>> = {
  '4-way': [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
  '8-way': [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
};

function compareCoordinates(left: Coord, right: Coord): number {
  return left.y - right.y || left.x - right.x;
}

export function detectClusters(
  waferSequence: number,
  dies: DieRecord[],
  options: ClusterDetectionOptions,
): ClusterDetectionResult {
  // The pitch comes from every die on the wafer: the spacing of the failing ones
  // says nothing about the grid they sit on.
  const lattice = dieLattice(dies);
  const failDies = dies.filter((die) => die.passFailFlag === 'F');
  const offsets = neighborOffsets[options.adjacency];

  /** Lattice cell → the raw coordinate recorded for the die in it. */
  const candidates = new Map<string, Cell>();
  for (const die of failDies) {
    const column = latticeColumn(lattice, die.x);
    const row = latticeRow(lattice, die.y);
    candidates.set(`${column}:${row}`, { column, row, x: die.x, y: die.y });
  }

  const visited = new Set<string>();
  const components: Coord[][] = [];

  for (const candidate of candidates.values()) {
    const key = `${candidate.column}:${candidate.row}`;
    if (visited.has(key)) continue;
    const component: Coord[] = [];
    const queue: Cell[] = [candidate];
    visited.add(key);
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const current = queue[queueIndex] as Cell;
      component.push({ x: current.x, y: current.y });
      for (const [dx, dy] of offsets) {
        const neighborKey = `${current.column + dx}:${current.row + dy}`;
        const neighbor = candidates.get(neighborKey);
        if (neighbor && !visited.has(neighborKey)) {
          visited.add(neighborKey);
          queue.push(neighbor);
        }
      }
    }
    component.sort(compareCoordinates);
    components.push(component);
  }

  const qualifying = components
    .filter((component) => component.length >= options.minimumConnectedDies)
    .sort(
      (left, right) =>
        right.length - left.length || compareCoordinates(left[0] as Coord, right[0] as Coord),
    );

  const clusters: DetectedCluster[] = qualifying.map((component, index) => ({
    ordinal: index + 1,
    dieCount: component.length,
    coordinates: component,
  }));

  return {
    waferSequence,
    adjacency: options.adjacency,
    minimumConnectedDies: options.minimumConnectedDies,
    clustersFound: clusters.length,
    clusters,
  };
}
