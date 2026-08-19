import fs from 'node:fs';
import path from 'node:path';
import { type Download, type Locator, type Page } from '@playwright/test';
import { ARTIFACTS_DIR } from '@core/paths';

/**
 * File upload/download helpers — CSV/ATDF ingest and export flows are
 * first-class YieldWerx workflows.
 *
 * Why centralized: uploads pre-verify source files so a bad fixture path
 * fails as "upload source not found" rather than a silent empty upload;
 * downloads follow Playwright's race-free event pattern and land under the
 * artifacts directory (`@core/paths`) so exported files survive the run
 * for content validation (`@utils/exportValidators`) and report review.
 */

/**
 * Resolve an untrusted relative path below a fixed directory. Absolute paths,
 * empty paths, and parent traversal are rejected before any filesystem write.
 */
export function resolveWithinDirectory(
  baseDir: string,
  relativePath: string,
  label = 'Path',
): string {
  if (relativePath.trim() === '' || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path: ${relativePath}`);
  }
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);
  const relative = path.relative(base, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its allowed directory: ${relativePath}`);
  }
  return resolved;
}

/** Reserve a unique file name so parallel workers never silently overwrite one another. */
function reserveUniquePath(directory: string, requestedName: string): string {
  const extension = path.extname(requestedName);
  const stem = path.basename(requestedName, extension);
  for (let suffix = 0; suffix < 10_000; suffix++) {
    const name = suffix === 0 ? requestedName : `${stem}-${suffix}${extension}`;
    const candidate = resolveWithinDirectory(directory, name, 'Artifact filename');
    try {
      const handle = fs.openSync(candidate, 'wx');
      fs.closeSync(handle);
      return candidate;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error(`Unable to reserve a unique artifact path for ${requestedName}`);
}

/**
 * Upload one or more files through a file input (by its testId locator).
 *
 * Verifies every source path exists BEFORE calling `setInputFiles` — a
 * missing fixture would otherwise surface later as a confusing app-side
 * failure instead of an immediate, named error.
 *
 * @param input - The file-input locator (per locator policy, by testId).
 * @param filePaths - One or more source file paths to attach.
 */
export async function uploadFiles(input: Locator, ...filePaths: string[]): Promise<void> {
  for (const p of filePaths) {
    if (!fs.existsSync(p)) throw new Error(`Upload source not found: ${p}`);
  }
  await input.setInputFiles(filePaths);
}

/**
 * Trigger a download (via `action`) and persist it under test artifacts.
 * Returns the saved path.
 *
 * Race-safe ordering: the `download` event listener is registered BEFORE
 * `action()` runs — subscribing afterwards could miss a fast download.
 * The file is saved under `<artifacts>/downloads/` (directory created on
 * demand), named by `saveAs` or the browser's suggested filename, so
 * content validators and report reviewers can find it after the run.
 *
 * @param page - Page the download will originate from.
 * @param action - Interaction that triggers the download (e.g. clicking
 *   an export button).
 * @param options - `saveAs` to override the filename; `timeout` for the
 *   download event (default 30s).
 * @returns The Playwright `Download` handle plus the persisted path.
 * @example
 *   const { savedPath } = await expectDownload(page, () => exportBtn.click());
 *   await validateExcelExport(savedPath, { minRows: 1 });
 */
export async function expectDownload(
  page: Page,
  action: () => Promise<void>,
  options: { saveAs?: string; timeout?: number } = {},
): Promise<{ download: Download; savedPath: string }> {
  const downloadPromise = page.waitForEvent('download', { timeout: options.timeout ?? 30_000 });
  await action();
  const download = await downloadPromise;
  const fileName = options.saveAs ?? download.suggestedFilename();
  if (path.basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
    throw new Error(`Download filename must not contain a directory: ${fileName}`);
  }
  const downloadsDir = path.join(ARTIFACTS_DIR, 'downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  const savedPath = reserveUniquePath(downloadsDir, fileName);
  try {
    await download.saveAs(savedPath);
  } catch (error) {
    if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath);
    throw error;
  }
  return { download, savedPath };
}

/**
 * Write content to a scratch artifact file; returns its path.
 *
 * Resolves `relativePath` under the artifacts directory and creates any
 * missing parent folders, so generated evidence (debug dumps, derived
 * fixtures) always lands in the one gitignored, report-adjacent place
 * instead of scattering across the repo or OS temp.
 *
 * @param relativePath - Path relative to the artifacts root (may include
 *   subdirectories).
 * @param content - Text or binary content to write.
 * @returns The absolute path of the written file.
 */
export function writeArtifact(
  relativePath: string,
  content: string | Buffer,
  options: { overwrite?: boolean } = {},
): string {
  const fullPath = resolveWithinDirectory(ARTIFACTS_DIR, relativePath, 'Artifact path');
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { flag: options.overwrite === true ? 'w' : 'wx' });
  return fullPath;
}
