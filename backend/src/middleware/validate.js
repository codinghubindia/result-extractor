import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';
import { isValidUsn, normalizeUsn } from '../utils/usn-range.js';

/**
 * Creates an Express middleware that validates req.body, req.query, and/or req.params against Zod schemas.
 * Throws RFC 9457-compatible ValidationError with detailed field issues on mismatch.
 * Fully compatible with Express 5 where req.query is a prototype getter.
 * 
 * @param {object} schemas
 * @param {z.ZodSchema} [schemas.body]
 * @param {z.ZodSchema} [schemas.query]
 * @param {z.ZodSchema} [schemas.params]
 */
export function validate(schemas = {}) {
    return async (req, res, next) => {
        try {
            if (schemas.params) {
                const parsedParams = await schemas.params.parseAsync(req.params);
                Object.defineProperty(req, 'params', {
                    value: parsedParams,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            }
            if (schemas.query) {
                const parsedQuery = await schemas.query.parseAsync(req.query);
                Object.defineProperty(req, 'query', {
                    value: parsedQuery,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            }
            if (schemas.body) {
                req.body = await schemas.body.parseAsync(req.body);
            }
            next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                const details = {};
                for (const issue of err.issues) {
                    const field = issue.path.length > 0 ? issue.path.join('.') : 'general';
                    details[field] = issue.message;
                }
                const firstMsg = err.issues[0]?.message || 'Invalid request parameters';
                return next(new ValidationError(firstMsg, details));
            }
            next(err);
        }
    };
}

// -------------------------------------------------------------
// REUSABLE ZOD SCHEMAS
// -------------------------------------------------------------

/**
 * Custom USN Zod string schema with normalization and regex syntax check.
 */
export const usnZodSchema = z
    .string({ required_error: 'USN is required' })
    .trim()
    .min(3, 'USN must be at least 3 characters')
    .refine((val) => isValidUsn(val), {
        message: 'Invalid USN syntax. Expected alphanumeric prefix followed by numbers (e.g. 1GA23IS073)',
    })
    .transform(normalizeUsn);

/**
 * Single USN scrape request schema
 * POST /api/scrape/single
 */
export const singleScrapeSchema = {
    body: z.object({
        usn: usnZodSchema,
        examId: z.string().trim().optional(),
        semester: z.string().trim().optional(),
        latestOnly: z.boolean().optional().default(false),
    }),
};

/**
 * Bulk USN scrape request schema
 * POST /api/scrape/bulk
 */
export const bulkScrapeSchema = {
    body: z
        .object({
            fromUsn: z.string().trim().optional(),
            toUsn: z.string().trim().optional(),
            usnList: z.union([z.array(z.string().trim()), z.string().trim()]).optional(),
            examId: z.string().trim().optional(),
            semester: z.string().trim().optional(),
            latestOnly: z.boolean().optional().default(false),
            concurrency: z.coerce.number().int().min(1).max(4).optional().default(2),
            maxRetries: z.coerce.number().int().min(0).max(5).optional().default(2),
            clearPreviousData: z.boolean().optional().default(false),
            enableRelay: z.boolean().optional().default(false),
            relayTimeoutMs: z.coerce.number().int().min(5000).max(120000).optional().default(20000),
        })
        .refine(
            (data) => {
                const hasRange = Boolean(data.fromUsn && data.toUsn);
                const hasList = Boolean(data.usnList && (Array.isArray(data.usnList) ? data.usnList.length > 0 : data.usnList.length > 0));
                return hasRange || hasList;
            },
            {
                message: 'Must provide either both fromUsn and toUsn, or a non-empty usnList',
                path: ['fromUsn'],
            }
        ),
};

/**
 * Bulk Job ID route param schema
 * GET /api/scrape/bulk/:jobId
 */
export const jobIdParamSchema = {
    params: z.object({
        jobId: z.string().trim().min(1, 'jobId cannot be empty'),
    }),
};

/**
 * Single USN route param schema
 * GET /api/results/:usn
 */
export const usnParamSchema = {
    params: z.object({
        usn: usnZodSchema,
    }),
};

/**
 * Results query filter schema
 * GET /api/results
 */
export const resultsQuerySchema = {
    query: z.object({
        usn: z.string().trim().optional(),
        search: z.string().trim().optional(),
        semester: z.string().trim().optional(),
        department: z.string().trim().optional(),
        exam: z.string().trim().optional(),
        minSgpa: z.coerce.number().min(0).max(10).optional(),
        maxSgpa: z.coerce.number().min(0).max(10).optional(),
        minCgpa: z.coerce.number().min(0).max(10).optional(),
        maxCgpa: z.coerce.number().min(0).max(10).optional(),
        status: z.enum(['PASS', 'FAIL', 'ALL', 'pass', 'fail', 'all']).optional().default('ALL'),
        sortBy: z.enum(['scrapedAt', 'usn', 'name', 'sgpa', 'cgpa', 'semester']).optional().default('scrapedAt'),
        sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional().default('desc'),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.union([z.coerce.number().int().min(1).max(500), z.literal('all')]).optional().default(50),
    }),
};

/**
 * Jobs list query filter schema
 * GET /api/scrape/bulk
 */
export const jobsQuerySchema = {
    query: z.object({
        status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'all']).optional(),
        sortBy: z.enum(['createdAt', 'updatedAt', 'total', 'processed']).optional().default('createdAt'),
        sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional().default('desc'),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.union([z.coerce.number().int().min(1).max(500), z.literal('all')]).optional().default(50),
    }),
};

/**
 * Data export query schema
 * GET /api/export
 */
export const exportQuerySchema = {
    query: z.object({
        format: z.enum(['json', 'excel', 'xlsx', 'csv']).optional().default('json'),
        jobId: z.string().trim().optional(),
        usn: z.string().trim().optional(),
        type: z.enum(['detailed', 'summary']).optional().default('detailed'),
        semester: z.string().trim().optional(),
        department: z.string().trim().optional(),
        exam: z.string().trim().optional(),
        status: z.enum(['PASS', 'FAIL', 'ALL', 'pass', 'fail', 'all']).optional(),
        minSgpa: z.coerce.number().min(0).max(10).optional(),
        maxSgpa: z.coerce.number().min(0).max(10).optional(),
    }),
};

/**
 * CAPTCHA solve submission schema
 * POST /api/scrape/captcha-solve and POST /api/bulk/:jobId/captcha-solve
 */
export const captchaSolveSchema = {
    body: z.object({
        challengeId: z.string({ required_error: 'challengeId is required' }).trim().min(1, 'challengeId cannot be empty'),
        text: z.string({ required_error: 'text solution is required' }).trim().min(1, 'CAPTCHA text solution cannot be empty'),
        jobId: z.string().trim().optional(),
    }),
};

/**
 * Pending CAPTCHA challenge query schema
 * GET /api/scrape/captcha-pending
 */
export const captchaPendingSchema = {
    query: z.object({
        jobId: z.string().trim().optional(),
    }),
};

/**
 * CAPTCHA reload request schema
 * POST /api/scrape/captcha-reload
 */
export const captchaReloadSchema = {
    body: z.object({
        challengeId: z.string({ required_error: 'challengeId is required' }).trim().min(1, 'challengeId cannot be empty'),
        jobId: z.string().trim().optional(),
    }),
};
