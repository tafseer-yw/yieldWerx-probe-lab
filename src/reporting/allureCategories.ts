import { Status } from 'allure-js-commons';
import type { Category } from 'allure-js-commons/sdk';

/**
 * Allure defect taxonomy — the buckets shown on the report's Categories tab.
 * Passed inline to the `allure-playwright` reporter (`categories` option),
 * which writes `categories.json` into the results dir; `allure generate` then
 * classifies every failed/broken test into the FIRST matching category.
 *
 * WHY DOMAIN BUCKETS: a raw "N failed" list makes triage guess. These separate
 * the failure modes this repo actually produces — wrong business data (the
 * severity this project calls `blocker`), visual pixel drift, testId/contract
 * breaks, and infrastructure noise — so a reviewer sees the SHAPE of a red run
 * at a glance.
 *
 * ORDER MATTERS: Allure assigns each test to the FIRST matching category, so
 * the most specific/severe patterns come first and the broad catch-alls come
 * last. The regexes key off failure text the suite really emits — the numeric
 * assertions in steps, the odiff visual matcher, and Playwright's own locator
 * and timeout messages.
 */
export const ALLURE_CATEGORIES: Category[] = [
  {
    /* This repo's keystone rule: wrong business data is always a blocker. A
       calculated result asserted against an independently-derived expected
       value — a yield, a bin count, a cumulative share — that disagrees is real
       scrap/ship risk, not cosmetic. */
    name: 'Wrong business data (blocker)',
    messageRegex:
      '(?s).*(wrong.?data|blocker|expected .* received|yield|bin ?count|cumulative|toBeCloseTo|toEqual).*',
    matchedStatuses: [Status.FAILED],
  },
  {
    /* Pixel regression: the odiff screenshot comparison failed. A rendering
       finding, never a wrong-number finding (that is the row above). */
    name: 'Visual pixel drift',
    messageRegex: '(?s).*(Screenshot comparison failed|odiff|toHaveScreenshot|maxDiffPixel).*',
    matchedStatuses: [Status.FAILED],
  },
  {
    /* A locator resolved to nothing or the wrong element — usually a removed or
       renamed testId or role, a UI-contract break rather than a product bug. */
    name: 'Locator / testId contract break',
    messageRegex:
      '(?s).*(getByTestId|getByRole|strict mode violation|waiting for locator|element\\(s\\) not found|not a <select>).*',
    matchedStatuses: [Status.FAILED],
  },
  {
    /* A wait exceeded its budget — navigation, an upload that never landed, or
       the overall test timeout. Often environment/async, triaged before it is
       called an app bug. */
    name: 'Timeout / wait exceeded',
    messageRegex: '(?s).*(Test timeout of|Timed out|exceeded while|timeout).*',
    matchedStatuses: [Status.FAILED, Status.BROKEN],
  },
  {
    /* Any remaining genuine assertion failure — a product-defect candidate
       until a human triages it. */
    name: 'Product defect (untriaged)',
    matchedStatuses: [Status.FAILED],
  },
  {
    /* Broken = the test errored before it could assert (a hook, a fixture, bad
       data, the harness). Infrastructure, not a product verdict. */
    name: 'Test or infrastructure error',
    matchedStatuses: [Status.BROKEN],
  },
];
