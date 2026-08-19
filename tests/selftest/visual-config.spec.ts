import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { VISUAL_BASELINE_TEMPLATE, VISUAL_ODIFF_OPTIONS } from '../../src/core/visual';

/*
 * Framework self-test: fails when a pinned visual-regression setting drifts.
 *
 * The tolerances and the baseline path are reviewed decisions, not defaults —
 * loosening a threshold quietly widens what "pixel-identical" means for every
 * future baseline, and moving the template orphans every committed PNG. This
 * spec makes either change fail a normal run instead of passing silently.
 */

test('the odiff tolerances are the reviewed ones', () => {
  expect(VISUAL_ODIFF_OPTIONS.threshold).toBe(0.1);
  expect(VISUAL_ODIFF_OPTIONS.antialiasing).toBe(true);
  expect(VISUAL_ODIFF_OPTIONS.maxDiffPixelRatio).toBe(0.001);
});

test('baselines stay in the committed directory', () => {
  expect(VISUAL_BASELINE_TEMPLATE).toBe('tests/visual/baselines/{projectName}/{arg}{ext}');
  const configSource = fs.readFileSync(
    path.resolve(__dirname, '../../playwright.config.ts'),
    'utf8',
  );
  expect(configSource).toContain('snapshotPathTemplate: VISUAL_BASELINE_TEMPLATE');
});

test('the everyday project never selects @visual, and the visual project only selects it', () => {
  const configSource = fs.readFileSync(
    path.resolve(__dirname, '../../playwright.config.ts'),
    'utf8',
  );
  expect(configSource).toContain('grepInvert: /@visual/');
  expect(configSource).toContain('grep: /@visual/');
});

test('the visual step compares with odiff, not the bundled pixelmatch matcher', () => {
  const stepSource = fs.readFileSync(
    path.resolve(__dirname, '../../steps/visual.steps.ts'),
    'utf8',
  );
  expect(stepSource).toContain('toHaveScreenshotOdiff');
  expect(stepSource).not.toMatch(/toHaveScreenshot\(/);
});
