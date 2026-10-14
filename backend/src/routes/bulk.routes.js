import { Router } from 'express';
import { scrapeController } from '../controllers/scrape.controller.js';
import {
    validate,
    bulkScrapeSchema,
    jobIdParamSchema,
    jobsQuerySchema,
    captchaSolveSchema,
} from '../middleware/validate.js';

const router = Router();

/**
 * @route   POST /api/bulk
 * @desc    Initialize a concurrent bulk scraping job
 * @access  Public
 */
router.post(
    '/',
    validate(bulkScrapeSchema),
    (req, res, next) => scrapeController.startBulkScrape(req, res, next)
);

/**
 * @route   GET /api/bulk
 * @desc    List all recent and active bulk scraping jobs
 * @access  Public
 */
router.get(
    '/',
    validate(jobsQuerySchema),
    (req, res, next) => scrapeController.listBulkJobs(req, res, next)
);

/**
 * @route   POST /api/bulk/captcha-solve
 * @desc    Submit human resolution for a pending Web CAPTCHA challenge
 * @access  Public
 */
router.post(
    '/captcha-solve',
    validate(captchaSolveSchema),
    (req, res, next) => scrapeController.submitCaptchaSolution(req, res, next)
);

/**
 * @route   GET /api/bulk/:jobId
 * @desc    Get status, metrics, and progress snapshot for a specific bulk job
 * @access  Public
 */
router.get(
    '/:jobId',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.getBulkJobStatus(req, res, next)
);

/**
 * @route   GET /api/bulk/:jobId/stream
 * @desc    Server-Sent Events (SSE) stream for real-time bulk job progress and CAPTCHA relays
 * @access  Public
 */
router.get(
    '/:jobId/stream',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.streamBulkJobProgress(req, res, next)
);

/**
 * @route   POST /api/bulk/:jobId/cancel
 * @desc    Cancel an active bulk scraping job
 * @access  Public
 */
router.post(
    '/:jobId/cancel',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.cancelBulkJob(req, res, next)
);

/**
 * @route   DELETE /api/bulk/:jobId
 * @desc    Cancel an active bulk scraping job (RESTful alternative)
 * @access  Public
 */
router.delete(
    '/:jobId',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.cancelBulkJob(req, res, next)
);

/**
 * @route   POST /api/bulk/:jobId/captcha-solve
 * @desc    Submit human resolution for a pending Web CAPTCHA challenge associated with this job
 * @access  Public
 */
router.post(
    '/:jobId/captcha-solve',
    validate(jobIdParamSchema),
    validate(captchaSolveSchema),
    (req, res, next) => scrapeController.submitCaptchaSolution(req, res, next)
);

/**
 * @route   GET /api/bulk/:jobId/captcha-pending
 * @desc    Retrieve any currently pending CAPTCHA challenge for this specific job
 * @access  Public
 */
router.get(
    '/:jobId/captcha-pending',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.getPendingCaptchaChallenge(req, res, next)
);

export default router;
