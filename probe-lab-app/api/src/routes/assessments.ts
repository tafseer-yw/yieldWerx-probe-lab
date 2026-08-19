import type { FastifyInstance } from 'fastify';

import {
  assessmentCatalogue,
  findAssessment,
  levelForScore,
  MAX_ASSESSMENT_SCORE,
  nextLevelAfter,
  penaltyFor,
  pointsFor,
  scoreResults,
  type AssessmentsResponse,
  type AssessmentStanding,
} from '../../../shared/assessments.js';
import { apiError, requireRole, type JwtPayload } from '../security.js';
import type { ApplicationStore, AssessmentStandingRow } from '../store.js';
import { errorResponseSchema } from './schemas.js';

/*
 * PROBE assessments — the self-paced skill ladder, with self-recorded results.
 *
 * The catalogue is code (shared/assessments.ts); this API stores only what a
 * person recorded about their own attempt and computes score and level from
 * it. Results are recorded on the honor system, the same way a PROBE gate
 * records a human's statement: recording "passed" is that person's word, and
 * nothing here pretends to verify it.
 *
 * Everyone records only their own results — there is deliberately no way to
 * record for someone else, admin included, because a reward that someone else
 * can write for you (or against you) stops meaning anything.
 */

const levelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['index', 'name', 'minPoints'],
  properties: {
    index: { type: 'integer', minimum: 0 },
    name: { type: 'string' },
    minPoints: { type: 'integer', minimum: 0 },
  },
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assessments', 'summary', 'standings'],
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'track',
          'order',
          'title',
          'effort',
          'skills',
          'mission',
          'passWhen',
          'points',
          'penalty',
          'timeHint',
          'status',
          'attempts',
          'evidenceUrl',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string' },
          track: { type: 'string', enum: ['dev', 'qa'] },
          order: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          effort: { type: 'string', enum: ['starter', 'core', 'advanced', 'expert'] },
          skills: { type: 'array', items: { type: 'string' } },
          mission: { type: 'string' },
          passWhen: { type: 'array', items: { type: 'string' } },
          points: { type: 'integer', minimum: 1 },
          penalty: { type: 'integer', minimum: 1 },
          timeHint: { type: 'string' },
          status: { anyOf: [{ type: 'string', enum: ['passed', 'failed'] }, { type: 'null' }] },
          attempts: { type: 'integer', minimum: 0 },
          evidenceUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          updatedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'level', 'nextLevel', 'passed', 'failed', 'maxScore'],
      properties: {
        score: { type: 'integer', minimum: 0 },
        level: levelSchema,
        nextLevel: { anyOf: [levelSchema, { type: 'null' }] },
        passed: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
        maxScore: { type: 'integer', minimum: 0 },
      },
    },
    standings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['username', 'role', 'score', 'levelName', 'passed', 'failed'],
        properties: {
          username: { type: 'string' },
          role: { type: 'string' },
          score: { type: 'integer', minimum: 0 },
          levelName: { type: 'string' },
          passed: { type: 'integer', minimum: 0 },
          failed: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

/** Standings: one row per person who has recorded anything, best score first. */
function buildStandings(rows: AssessmentStandingRow[]): AssessmentStanding[] {
  const byUser = new Map<string, { role: string; rows: AssessmentStandingRow[] }>();
  for (const row of rows) {
    const entry = byUser.get(row.username) ?? { role: row.role, rows: [] };
    entry.rows.push(row);
    byUser.set(row.username, entry);
  }
  return [...byUser.entries()]
    .map(([username, entry]) => {
      const score = scoreResults(entry.rows);
      return {
        username,
        role: entry.role,
        score,
        levelName: levelForScore(score).name,
        passed: entry.rows.filter((row) => row.outcome === 'passed').length,
        failed: entry.rows.filter((row) => row.outcome === 'failed').length,
      };
    })
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
}

async function buildResponse(
  store: ApplicationStore,
  userId: string,
): Promise<AssessmentsResponse> {
  const mine = await store.listAssessmentResults(userId);
  const byId = new Map(mine.map((row) => [row.assessmentId, row]));
  const score = scoreResults(mine);
  return {
    assessments: assessmentCatalogue.map((assessment) => {
      const result = byId.get(assessment.id);
      return {
        ...assessment,
        points: pointsFor(assessment),
        penalty: penaltyFor(assessment),
        timeHint: timeHintFor(assessment.effort),
        status: result?.outcome ?? null,
        attempts: result?.attempts ?? 0,
        evidenceUrl: result?.evidenceUrl ?? null,
        updatedAt: result?.updatedAt ?? null,
      };
    }),
    summary: {
      score,
      level: levelForScore(score),
      nextLevel: nextLevelAfter(score),
      passed: mine.filter((row) => row.outcome === 'passed').length,
      failed: mine.filter((row) => row.outcome === 'failed').length,
      maxScore: MAX_ASSESSMENT_SCORE,
    },
    standings: buildStandings(await store.listAllAssessmentResults()),
  };
}

function timeHintFor(effort: 'starter' | 'core' | 'advanced' | 'expert'): string {
  return {
    starter: 'about an hour',
    core: 'half a day',
    advanced: 'a day',
    expert: 'two to three days',
  }[effort];
}

export async function registerAssessmentRoutes(
  app: FastifyInstance,
  store: ApplicationStore,
): Promise<void> {
  app.get(
    '/api/assessments',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Assessments'],
        summary: 'The assessment catalogue with your results, score, and team standings',
        security: [{ bearerAuth: [] }],
        response: { 200: responseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => buildResponse(store, (request.user as JwtPayload).sub),
  );

  app.post<{
    Params: { assessmentId: string };
    Body: { outcome: 'passed' | 'failed'; evidenceUrl?: string };
  }>(
    '/api/assessments/:assessmentId/result',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Assessments'],
        summary:
          'Record your own pass or fail on one assessment, with the PR it was submitted through',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['assessmentId'],
          properties: { assessmentId: { type: 'string', maxLength: 32 } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['outcome'],
          properties: {
            outcome: { type: 'string', enum: ['passed', 'failed'] },
            evidenceUrl: { type: 'string', maxLength: 300 },
          },
        },
        response: {
          200: responseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { assessmentId } = request.params;
      if (!findAssessment(assessmentId)) {
        throw apiError(404, 'UNKNOWN_ASSESSMENT', `No assessment is named '${assessmentId}'.`);
      }
      /* The submission method is a pull request: do the work on a branch, open
         the PR, and record its link here so the result points at reviewable
         evidence. The link is optional — some assessments produce artifacts, a
         gate approval, or a session log rather than a diff — but when present
         it must at least be a web address. */
      const evidence = request.body.evidenceUrl?.trim() || null;
      if (evidence !== null && !/^https?:\/\/\S+$/u.test(evidence)) {
        throw apiError(
          400,
          'INVALID_EVIDENCE_URL',
          'The evidence link must be a full http(s) URL, e.g. the pull request address.',
        );
      }
      const user = request.user as JwtPayload;
      await store.recordAssessmentResult(user.sub, assessmentId, request.body.outcome, evidence);
      return buildResponse(store, user.sub);
    },
  );

  app.delete<{ Params: { assessmentId: string } }>(
    '/api/assessments/:assessmentId/result',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['Assessments'],
        summary: 'Clear your own recorded result on one assessment',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['assessmentId'],
          properties: { assessmentId: { type: 'string', maxLength: 32 } },
        },
        response: { 200: responseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const { assessmentId } = request.params;
      if (!findAssessment(assessmentId)) {
        throw apiError(404, 'UNKNOWN_ASSESSMENT', `No assessment is named '${assessmentId}'.`);
      }
      const user = request.user as JwtPayload;
      await store.clearAssessmentResult(user.sub, assessmentId);
      return buildResponse(store, user.sub);
    },
  );
}
