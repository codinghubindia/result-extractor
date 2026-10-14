import { Router } from 'express';
import { scrapeController } from '../controllers/scrape.controller.js';
import {
    validate,
    singleScrapeSchema,
    bulkScrapeSchema,
    jobIdParamSchema,
    jobsQuerySchema,
    captchaSolveSchema,
    captchaPendingSchema,
    captchaReloadSchema,
} from '../middleware/validate.js';

const router = Router();

/**
 * @route   POST /api/scrape/single
 * @desc    Scrape academic result for a single USN with automated CAPTCHA solving
 * @access  Public
 */
router.post(
    '/single',
    validate(singleScrapeSchema),
    (req, res, next) => scrapeController.singleScrape(req, res, next)
);

/**
 * @route   POST /api/scrape/bulk
 * @desc    Initialize a concurrent bulk scraping job across a range or array of USNs
 * @access  Public
 */
router.post(
    '/bulk',
    validate(bulkScrapeSchema),
    (req, res, next) => scrapeController.startBulkScrape(req, res, next)
);

/**
 * @route   GET /api/scrape/bulk
 * @desc    List all recent and active bulk scraping jobs with filtering and pagination
 * @access  Public
 */
router.get(
    '/bulk',
    validate(jobsQuerySchema),
    (req, res, next) => scrapeController.listBulkJobs(req, res, next)
);

/**
 * @route   GET /api/scrape/bulk/:jobId
 * @desc    Get status, metrics, and progress snapshot for a specific bulk job
 * @access  Public
 */
router.get(
    '/bulk/:jobId',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.getBulkJobStatus(req, res, next)
);

/**
 * @route   GET /api/scrape/bulk/:jobId/stream
 * @desc    Server-Sent Events (SSE) stream for real-time bulk job progress and CAPTCHA relays
 * @access  Public
 */
router.get(
    '/bulk/:jobId/stream',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.streamBulkJobProgress(req, res, next)
);

/**
 * @route   POST /api/scrape/bulk/:jobId/cancel
 * @desc    Cancel an active bulk scraping job
 * @access  Public
 */
router.post(
    '/bulk/:jobId/cancel',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.cancelBulkJob(req, res, next)
);

/**
 * @route   DELETE /api/scrape/bulk/:jobId
 * @desc    Cancel an active bulk scraping job (RESTful alternative)
 * @access  Public
 */
router.delete(
    '/bulk/:jobId',
    validate(jobIdParamSchema),
    (req, res, next) => scrapeController.cancelBulkJob(req, res, next)
);

/**
 * @route   POST /api/scrape/captcha-solve
 * @desc    Submit human resolution for a pending Web CAPTCHA challenge
 * @access  Public
 */
router.post(
    '/captcha-solve',
    validate(captchaSolveSchema),
    (req, res, next) => scrapeController.submitCaptchaSolution(req, res, next)
);

/**
 * @route   GET /api/scrape/captcha-pending
 * @desc    Retrieve any currently pending CAPTCHA challenge awaiting human input
 * @access  Public
 */
router.get(
    '/captcha-pending',
    validate(captchaPendingSchema),
    (req, res, next) => scrapeController.getPendingCaptchaChallenge(req, res, next)
);

/**
 * @route   POST /api/scrape/captcha-reload
 * @desc    Reload the CAPTCHA image for an active challenge
 * @access  Public
 */
router.post(
    '/captcha-reload',
    validate(captchaReloadSchema),
    (req, res, next) => scrapeController.reloadCaptchaChallenge(req, res, next)
);

export default router;
