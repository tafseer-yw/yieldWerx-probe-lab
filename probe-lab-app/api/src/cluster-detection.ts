import type {
  ClusterDetectionOptions,
  ClusterDetectionResult,
  DieRecord,
  DetectedCluster,
  SignatureAdjacency,
} from '../../shared/contracts.js';

/*
 * Cluster detection — a trimmed port of the real "Cluster Size" detector
 * (contiguous fail-die components). The real engine has five detectors and a
 * signature/rule/policy model; this practice version keeps the one detector
 * that QA can reason about: connected components of failing dies under 4- or
 * 8-way adjacency, filtered by a minimum connected-die threshold.
 */
interface Coord {
  x: number;
  y: number;
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
  const failDies = dies.filter((die) => die.passFailFlag === 'F');
  const candidateKeys = new Set(failDies.map((die) => `${die.x}:${die.y}`));
  const offsets = neighborOffsets[options.adjacency];
  const visited = new Set<string>();
  const components: Coord[][] = [];

  for (const die of failDies) {
    const key = `${die.x}:${die.y}`;
    if (visited.has(key)) continue;
    const component: Coord[] = [];
    const queue: Coord[] = [{ x: die.x, y: die.y }];
    visited.add(key);
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const current = queue[queueIndex] as Coord;
      component.push(current);
      for (const [dx, dy] of offsets) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const nkey = `${nx}:${ny}`;
        if (candidateKeys.has(nkey) && !visited.has(nkey)) {
          visited.add(nkey);
          queue.push({ x: nx, y: ny });
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
