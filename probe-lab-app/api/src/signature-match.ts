import type {
  DieRecord,
  SignatureMatchCandidate,
  SignatureMatchResponse,
} from '../../shared/contracts.js';
import { detectClusters } from './cluster-detection.js';
import { sampleWafers } from './sample-data.js';
import { parseWaferCsv } from './wafer-csv.js';

type SignatureDie = Pick<DieRecord, 'x' | 'y' | 'hardBin' | 'passFailFlag'>;

interface WaferSignature {
  totalDies: number;
  failureDies: number;
  failRate: number;
  centerFailureRate: number;
  middleFailureRate: number;
  edgeFailureRate: number;
  upperLeftFailureRate: number;
  upperRightFailureRate: number;
  lowerLeftFailureRate: number;
  lowerRightFailureRate: number;
  centroidX: number;
  centroidY: number;
  linearity: number;
  clusterCount: number;
  clusteredShare: number;
  largestClusterShare: number;
  dominantFailBinShare: number;
}

type ComparableFeature = Exclude<keyof WaferSignature, 'totalDies' | 'failureDies'>;

interface ReferenceSignature {
  key: string;
  label: string;
  summary: string;
  signature: WaferSignature;
}

interface NormalizedPoint {
  die: SignatureDie;
  x: number;
  y: number;
  failed: boolean;
  radial: number;
}

const MINIMUM_FAILURE_DIES = 3;
const MATCH_THRESHOLD = 0.62;
const DISCLAIMER =
  'A shape match against three fixed practice examples, not a root-cause diagnosis.';

const featureWeights: ReadonlyArray<readonly [ComparableFeature, number]> = [
  ['failRate', 0.7],
  ['centerFailureRate', 1.3],
  ['middleFailureRate', 1.3],
  ['edgeFailureRate', 1.3],
  ['upperLeftFailureRate', 0.5],
  ['upperRightFailureRate', 0.5],
  ['lowerLeftFailureRate', 0.5],
  ['lowerRightFailureRate', 0.5],
  ['centroidX', 0.25],
  ['centroidY', 0.25],
  ['linearity', 1.1],
  ['clusterCount', 0.5],
  ['clusteredShare', 1],
  ['largestClusterShare', 0.9],
  ['dominantFailBinShare', 0.3],
];

const referenceMetadata = new Map([
  ['baseline', { label: 'Healthy baseline', summary: 'High yield with scattered failures.' }],
  ['scratch', { label: 'Handling scratch', summary: 'A directional scratch with a dense knot.' }],
  ['edge-ring', { label: 'Edge ring', summary: 'Failure density concentrated at the perimeter.' }],
]);

let cachedReferences: ReferenceSignature[] | null = null;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function failureRateFor(
  points: NormalizedPoint[],
  predicate: (point: NormalizedPoint) => boolean = () => true,
): number {
  const region = points.filter(predicate);
  return ratio(region.filter((point) => point.failed).length, region.length);
}

function spatialLinearity(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covarianceX = 0;
  let covarianceY = 0;
  let covarianceXY = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    covarianceX += dx * dx;
    covarianceY += dy * dy;
    covarianceXY += dx * dy;
  }
  const trace = covarianceX + covarianceY;
  if (trace === 0) return 0;
  const eigenvalueGap = Math.sqrt((covarianceX - covarianceY) ** 2 + 4 * covarianceXY ** 2);
  return clamp(eigenvalueGap / trace);
}

export function extractWaferSignature(dies: SignatureDie[]): WaferSignature {
  if (dies.length === 0) {
    return {
      totalDies: 0,
      failureDies: 0,
      failRate: 0,
      centerFailureRate: 0,
      middleFailureRate: 0,
      edgeFailureRate: 0,
      upperLeftFailureRate: 0,
      upperRightFailureRate: 0,
      lowerLeftFailureRate: 0,
      lowerRightFailureRate: 0,
      centroidX: 0.5,
      centroidY: 0.5,
      linearity: 0,
      clusterCount: 0,
      clusteredShare: 0,
      largestClusterShare: 0,
      dominantFailBinShare: 0,
    };
  }

  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const die of dies) {
    minimumX = Math.min(minimumX, die.x);
    maximumX = Math.max(maximumX, die.x);
    minimumY = Math.min(minimumY, die.y);
    maximumY = Math.max(maximumY, die.y);
  }
  const middleX = (minimumX + maximumX) / 2;
  const middleY = (minimumY + maximumY) / 2;
  const halfWidth = Math.max((maximumX - minimumX) / 2, 1);
  const halfHeight = Math.max((maximumY - minimumY) / 2, 1);
  const normalized: NormalizedPoint[] = dies.map((die) => ({
    die,
    x: clamp((die.x - middleX) / halfWidth, -1, 1),
    y: clamp((die.y - middleY) / halfHeight, -1, 1),
    failed: die.passFailFlag === 'F',
    radial: 0,
  }));
  let maximumRadius = 1;
  for (const point of normalized) {
    maximumRadius = Math.max(maximumRadius, Math.sqrt(point.x ** 2 + point.y ** 2));
  }
  for (const point of normalized) {
    point.radial = Math.sqrt(point.x ** 2 + point.y ** 2) / maximumRadius;
  }

  const failed = normalized.filter((point) => point.failed);
  const failedCoordinates = failed.map((point) => ({ x: point.x, y: point.y }));
  const meanFailedX =
    failed.length === 0 ? 0 : failed.reduce((sum, point) => sum + point.x, 0) / failed.length;
  const meanFailedY =
    failed.length === 0 ? 0 : failed.reduce((sum, point) => sum + point.y, 0) / failed.length;

  const clusterInput: DieRecord[] = dies.map((die, index) => ({
    ...die,
    dieId: index + 1,
    softBin: die.hardBin,
  }));
  const clusters = detectClusters(0, clusterInput, {
    adjacency: '4-way',
    minimumConnectedDies: 2,
  }).clusters;
  const clusteredDies = clusters.reduce((sum, cluster) => sum + cluster.dieCount, 0);
  const failBins = new Map<number, number>();
  for (const point of failed) {
    failBins.set(point.die.hardBin, (failBins.get(point.die.hardBin) ?? 0) + 1);
  }
  let dominantFailBin = 0;
  for (const count of failBins.values()) dominantFailBin = Math.max(dominantFailBin, count);

  return {
    totalDies: dies.length,
    failureDies: failed.length,
    failRate: ratio(failed.length, dies.length),
    centerFailureRate: failureRateFor(normalized, (point) => point.radial < 0.4),
    middleFailureRate: failureRateFor(
      normalized,
      (point) => point.radial >= 0.4 && point.radial < 0.75,
    ),
    edgeFailureRate: failureRateFor(normalized, (point) => point.radial >= 0.75),
    upperLeftFailureRate: failureRateFor(normalized, (point) => point.x < 0 && point.y < 0),
    upperRightFailureRate: failureRateFor(normalized, (point) => point.x >= 0 && point.y < 0),
    lowerLeftFailureRate: failureRateFor(normalized, (point) => point.x < 0 && point.y >= 0),
    lowerRightFailureRate: failureRateFor(normalized, (point) => point.x >= 0 && point.y >= 0),
    centroidX: (meanFailedX + 1) / 2,
    centroidY: (meanFailedY + 1) / 2,
    linearity: spatialLinearity(failedCoordinates),
    clusterCount: clamp(clusters.length / 5),
    clusteredShare: ratio(clusteredDies, failed.length),
    largestClusterShare: ratio(clusters[0]?.dieCount ?? 0, failed.length),
    dominantFailBinShare: ratio(dominantFailBin, failed.length),
  };
}

function references(): ReferenceSignature[] {
  if (cachedReferences) return cachedReferences;
  cachedReferences = sampleWafers().flatMap((sample) => {
    const metadata = referenceMetadata.get(sample.key);
    if (!metadata) return [];
    const parsed = parseWaferCsv(sample.csv);
    if (parsed.kind !== 'ready') {
      throw new Error(`Signature reference ${sample.key} could not be parsed.`);
    }
    return [
      {
        key: sample.key,
        ...metadata,
        signature: extractWaferSignature(parsed.acceptedDies),
      },
    ];
  });
  return cachedReferences;
}

function matchScore(query: WaferSignature, reference: WaferSignature): number {
  let weightedSquaredDistance = 0;
  let totalWeight = 0;
  for (const [feature, weight] of featureWeights) {
    weightedSquaredDistance += weight * (query[feature] - reference[feature]) ** 2;
    totalWeight += weight;
  }
  const normalizedDistance = Math.sqrt(weightedSquaredDistance / totalWeight);
  return round(clamp(1 - normalizedDistance));
}

function evidenceFor(signature: WaferSignature): string[] {
  if (signature.failureDies < MINIMUM_FAILURE_DIES) {
    return [
      `Only ${signature.failureDies.toLocaleString()} ${signature.failureDies === 1 ? 'die has' : 'dies have'} failed; at least ${MINIMUM_FAILURE_DIES} failed dies are needed to compare patterns.`,
    ];
  }

  const evidence = [
    `${percentage(signature.failRate)} of measured dies failed (${signature.failureDies.toLocaleString()} of ${signature.totalDies.toLocaleString()}).`,
  ];
  const otherZoneMaximum = Math.max(signature.centerFailureRate, signature.middleFailureRate);
  if (signature.edgeFailureRate >= otherZoneMaximum + 0.15) {
    evidence.push(`${percentage(signature.edgeFailureRate)} of dies around the edge failed.`);
  } else if (
    signature.centerFailureRate >=
    Math.max(signature.middleFailureRate, signature.edgeFailureRate) + 0.15
  ) {
    evidence.push(`${percentage(signature.centerFailureRate)} of dies in the center failed.`);
  }
  if (signature.linearity >= 0.72) {
    evidence.push('The failed dies make a clear line-like shape.');
  }
  if (signature.clusteredShare >= 0.55) {
    evidence.push(
      `${percentage(signature.clusteredShare)} of failed dies are in side-touching groups of at least two.`,
    );
  } else if (signature.clusteredShare <= 0.2) {
    evidence.push('Most failed dies are spread out instead of touching.');
  }
  if (evidence.length === 1) {
    evidence.push(
      `The largest touching group contains ${Math.round(signature.largestClusterShare * signature.failureDies).toLocaleString()} failed dies.`,
    );
  }
  return evidence.slice(0, 3);
}

export function matchWaferSignature(
  waferSequence: number,
  dies: SignatureDie[],
): SignatureMatchResponse {
  const signature = extractWaferSignature(dies);
  const knownReferences = references();
  const base = {
    waferSequence,
    threshold: MATCH_THRESHOLD,
    totalDies: signature.totalDies,
    failureDies: signature.failureDies,
    evidence: evidenceFor(signature),
    analytics: {
      failureRate: round(signature.failRate),
      radialFailureRates: {
        center: round(signature.centerFailureRate),
        middle: round(signature.middleFailureRate),
        edge: round(signature.edgeFailureRate),
      },
      spatialLinearity: round(signature.linearity),
      clusteredFailureShare: round(signature.clusteredShare),
      largestClusterShare: round(signature.largestClusterShare),
      dominantFailBinShare: round(signature.dominantFailBinShare),
    },
    matcher: {
      algorithm: 'weighted-pattern-distance' as const,
      version: '1.0' as const,
      referenceCount: knownReferences.length,
    },
    disclaimer: DISCLAIMER,
  };

  if (signature.failureDies < MINIMUM_FAILURE_DIES) {
    return {
      ...base,
      status: 'insufficient-data',
      bestMatch: null,
      alternatives: [],
    };
  }

  const candidates: SignatureMatchCandidate[] = knownReferences
    .map((reference) => ({
      referenceKey: reference.key,
      label: reference.label,
      summary: reference.summary,
      matchScore: matchScore(signature, reference.signature),
    }))
    .sort(
      (left, right) =>
        right.matchScore - left.matchScore || left.referenceKey.localeCompare(right.referenceKey),
    );
  const [bestMatch, ...alternatives] = candidates;
  if (!bestMatch) throw new Error('No wafer-signature references are configured.');

  return {
    ...base,
    status: bestMatch.matchScore >= MATCH_THRESHOLD ? 'matched' : 'no-close-match',
    bestMatch,
    alternatives,
  };
}
