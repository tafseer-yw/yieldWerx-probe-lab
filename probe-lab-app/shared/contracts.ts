/*
 * Shared DTO contracts for the lightweight yieldWerx PROBE Lab practice app.
 * A slimmed-down mirror of packages/contracts in the real app — same field
 * names and error codes so PROBE scenarios transfer.
 */

export const userRoles = ['viewer', 'dev', 'qa', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];

export const uploadStatuses = [
  'Queued',
  'Parsing',
  'Succeeded',
  'Completed with errors',
  'Rejected',
] as const;
export type UploadStatus = (typeof uploadStatuses)[number];
export const uploadHistoryStatuses = [
  'Succeeded',
  'Completed with errors',
  'Rejected',
] as const satisfies readonly UploadStatus[];

export const serviceStatuses = ['ok', 'degraded'] as const;
export type ServiceStatus = (typeof serviceStatuses)[number];

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  user: AuthenticatedUser;
}

export interface ReferenceValue {
  id: string;
  code: string;
  name: string;
}

export interface HealthResponse {
  service: string;
  status: ServiceStatus;
  timestamp: string;
  version: string;
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: {
    database: 'available' | 'unavailable';
  };
}

export interface UploadSummary {
  id: string;
  fileName: string;
  device: string;
  testProgram: string;
  lot: string | null;
  wafer: number | null;
  waferSequence: number | null;
  status: UploadStatus;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  submittedBy: string;
  submittedAt: string;
  terminalMessage: string | null;
}

export interface UploadSubmissionResponse {
  uploadId: string;
  status: 'Queued';
}

export interface UploadErrorRecord {
  id: number;
  rowNumber: number;
  column: string;
  code: string;
  message: string;
  rawText: string;
}

export interface UploadErrorPage {
  items: UploadErrorRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UploadHistoryPage {
  items: UploadSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DieRecord {
  dieId: number;
  x: number;
  y: number;
  hardBin: number;
  hardBinName?: string | null;
  softBin: number;
  softBinName?: string | null;
  passFailFlag: 'P' | 'F';
}

export interface WaferSummary {
  waferSequence: number;
  lot: string;
  waferNumber: number;
  device: string;
  testProgram: string;
  partCount: number;
  passCount: number;
  yield: number;
  finishTime: string;
}

export interface WaferDetail extends WaferSummary {
  uploadId: string;
  dies: DieRecord[];
}

export interface WaferPage {
  items: WaferSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---- Bin Pareto report (single-wafer scope) ----
export const reportBinTypes = ['Hard Bin', 'Soft Bin'] as const;
export type ReportBinType = (typeof reportBinTypes)[number];
export const reportBinSpecifications = ['All Bins', 'Failed Bins Only', 'Custom'] as const;
export type ReportBinSpecification = (typeof reportBinSpecifications)[number];
export const reportSortValues = ['Bin Occurrence', 'Bin Number'] as const;
export type ReportSortBy = (typeof reportSortValues)[number];

export interface BinParetoOptions {
  binType: ReportBinType;
  specifyBins: ReportBinSpecification;
  customBins: number[];
  sortBy: ReportSortBy;
}

export interface BinParetoBin {
  binNumber: number;
  binName: string;
  dieCount: number;
  binPercentage: number;
  cumulativePercentage: number;
}

export interface BinParetoHeader {
  waferSequence: number;
  lot: string;
  waferNumber: number;
  device: string;
  testProgram: string;
  totalDies: number;
  passCount: number;
  yield: number;
}

export interface BinParetoResponse {
  header: BinParetoHeader;
  bins: BinParetoBin[];
  options: BinParetoOptions;
}

// ---- Cluster detection (contiguous fail-die components) ----
export const signatureAdjacencies = ['4-way', '8-way'] as const;
export type SignatureAdjacency = (typeof signatureAdjacencies)[number];

export interface ClusterDetectionOptions {
  adjacency: SignatureAdjacency;
  minimumConnectedDies: number;
}

export interface DetectedCluster {
  ordinal: number;
  dieCount: number;
  coordinates: Array<{ x: number; y: number }>;
}

export interface ClusterDetectionResult {
  waferSequence: number;
  adjacency: SignatureAdjacency;
  minimumConnectedDies: number;
  clustersFound: number;
  clusters: DetectedCluster[];
}

// ---- Cluster detection summary (aggregate over the latest wafers) ----
export interface ClusterDetectionWaferSummary {
  waferSequence: number;
  lot: string;
  waferNumber: number;
  yield: number;
  clustersFound: number;
  largestClusterDies: number;
}

export interface ClusterDetectionSummary {
  adjacency: SignatureAdjacency;
  minimumConnectedDies: number;
  wafersAnalyzed: number;
  wafersWithClusters: number;
  totalClusters: number;
  largestClusterDies: number;
  wafers: ClusterDetectionWaferSummary[];
}

// ---- Lightweight wafer-signature matching (fixed reference patterns) ----
export const signatureMatchStatuses = ['matched', 'no-close-match', 'insufficient-data'] as const;
export type SignatureMatchStatus = (typeof signatureMatchStatuses)[number];

export interface SignatureMatchCandidate {
  referenceKey: string;
  label: string;
  summary: string;
  matchScore: number;
}

export interface SignatureMatchAnalytics {
  failureRate: number;
  radialFailureRates: {
    center: number;
    middle: number;
    edge: number;
  };
  spatialLinearity: number;
  clusteredFailureShare: number;
  largestClusterShare: number;
  dominantFailBinShare: number;
}

export interface SignatureMatchResponse {
  waferSequence: number;
  status: SignatureMatchStatus;
  threshold: number;
  totalDies: number;
  failureDies: number;
  bestMatch: SignatureMatchCandidate | null;
  alternatives: SignatureMatchCandidate[];
  evidence: string[];
  analytics: SignatureMatchAnalytics;
  matcher: {
    algorithm: 'weighted-pattern-distance';
    version: '1.0';
    referenceCount: number;
  };
  disclaimer: string;
}

/** One wafer in the optional Sample wafers set, with whether it is loaded. */
export interface SampleWaferState {
  key: string;
  lot: string;
  waferNumber: number;
  title: string;
  summary: string;
  dieCount: number;
  rejectedRows: number;
  loaded: boolean;
  waferSequence: number | null;
}

export interface SampleDataStatus {
  wafers: SampleWaferState[];
  loadedCount: number;
}

export const productBrand = {
  company: 'yieldWerx',
  name: 'yieldWerx PROBE Lab',
  shortName: 'PROBE Lab',
  subtitle: 'Hands-on PROBE practice for Dev and QA',
  slug: 'yieldwerx-probe-lab',
} as const;

/** Independently visible build versions for the browser app and HTTP API. */
export const productVersions = {
  ui: '0.1.0',
  api: '0.1.0',
} as const;
