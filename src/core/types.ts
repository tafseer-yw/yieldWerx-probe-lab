/**
 * Shared framework types. Domain types (wafer, bins, clusters) live in
 * src/oracle/ and src/data/; this file is framework plumbing only.
 *
 * WHY the split: src/core sits at the bottom of the strictly-downward
 * dependency graph, so types here must be domain-free — anything wafer- or
 * bin-shaped would drag domain knowledge below the layers (oracle/data) that
 * own it. What lives here instead is the contract for data-driven testing:
 * the shape of `*.data.json` dataset files and cross-cutting metadata
 * (retry policy, Allure labels) consumed by DataLoader and the API clients.
 */

/** Retry behaviour for API clients. */
export interface RetryConfig {
  /** Maximum retry attempts after the initial request. */
  maxRetries: number;
  /** Base delay before the first retry, in milliseconds. */
  backoffMs: number;
  /** Factor applied to the delay after each attempt (exponential backoff). */
  backoffMultiplier: number;
  /** HTTP statuses worth retrying (e.g. 429, 502, 503). */
  retryableStatuses: number[];
}

/**
 * Allure annotation metadata carried by data files, so data-driven scenarios
 * can be labeled (epic/feature/story/owner/severity) from the dataset itself
 * instead of hard-coding labels in step code.
 */
export interface AllureMetadata {
  epic?: string;
  feature?: string;
  story?: string;
  owner?: string;
  severity?: string;
}

/** Metadata block of a JSON dataset file. */
export interface DatasetMeta {
  /** Human summary of what the file's datasets exercise. */
  description: string;
  /** Tags applied to every dataset in the file (filterable). */
  tags: string[];
  author?: string;
  version?: string;
}

/**
 * One test case inside a dataset file: an `input` payload plus an optional
 * `expected` outcome, both intentionally untyped records — each consumer
 * narrows them (zod or type guards) to its own domain shape.
 */
export interface Dataset {
  /** Unique id within the file; used to select a single dataset. */
  id: string;
  description?: string;
  tags?: string[];
  /** Restrict to specific environments; empty/absent = all. */
  env?: string[];
  input: Record<string, unknown>;
  expected?: Record<string, unknown>;
}

/**
 * Shape of a *.data.json file: file-level meta + optional Allure labels +
 * the dataset list. DataLoader validates files against this contract.
 */
export interface TestDataFile {
  meta: DatasetMeta;
  allure?: AllureMetadata;
  /** Merged into every dataset's input. */
  shared?: Record<string, unknown>;
  datasets: Dataset[];
}
