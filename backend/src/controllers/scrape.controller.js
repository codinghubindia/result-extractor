import { scraperService } from '../services/scraper.service.js';
import { bulkService } from '../services/bulk.service.js';
import { captchaRelayService } from '../services/captcha-relay.service.js';
import { jobsRepository } from '../storage/jobs.repository.js';
import { resultsRepository } from '../storage/results.repository.js';

/**
 * Controller handling individual and bulk USN scraping operations,
 * CAPTCHA relay resolution, job lifecycle management, and real-time SSE streaming.
 */
export class ScrapeController {
    /**
     * Executes real-time scrape for a single USN with CAPTCHA auto-solving.
     * POST /api/scrape/single
     */
    async singleScrape(req, res, next) {
        try {
            const { usn, examId, semester, latestOnly } = req.body;

            // Trigger headless Puppeteer scraping with OCR
            const results = await scraperService.scrapeUsn(usn, {
                examId,
                semester,
                latestOnly: Boolean(latestOnly),
            });

            // Automatically persist extracted results into storage
            if (Array.isArray(results) && results.length > 0) {
                await resultsRepository.saveResultsBatch(results).catch((err) => {
                    console.error(`[ScrapeController] Warning: Failed to persist results for ${usn}:`, err.message);
                });
            }

            res.status(200).json({
                success: true,
                message: `Successfully retrieved results for USN ${usn.toUpperCase()}`,
                usn: usn.toUpperCase(),
                count: results.length,
                data: results,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Spawns an asynchronous bulk scraping batch across a range or array of USNs.
     * POST /api/scrape/bulk
     */
    async startBulkScrape(req, res, next) {
        try {
            const { fromUsn, toUsn, usnList, examId, semester, latestOnly, concurrency, maxRetries, clearPreviousData, enableRelay, relayTimeoutMs } = req.body;

            const jobMeta = await bulkService.startBulkJob({
                fromUsn,
                toUsn,
                usnList,
                examId,
                semester,
                latestOnly: Boolean(latestOnly),
                concurrency,
                maxRetries,
                clearPreviousData: Boolean(clearPreviousData),
                enableRelay: Boolean(enableRelay),
                relayTimeoutMs: relayTimeoutMs ? Number(relayTimeoutMs) : undefined,
            });

            res.status(202).json({
                success: true,
                message: `Bulk scraping batch initialized for ${jobMeta.total} USNs.`,
                data: jobMeta,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Retrieves status, metrics, and progress snapshot for a specific bulk job.
     * GET /api/scrape/bulk/:jobId
     */
    async getBulkJobStatus(req, res, next) {
        try {
            const { jobId } = req.params;
            const job = await bulkService.getJobStatus(jobId);

            res.status(200).json({
                success: true,
                data: job,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Lists recent and active bulk scraping jobs with pagination and status filters.
     * GET /api/scrape/bulk
     */
    async listBulkJobs(req, res, next) {
        try {
            const result = await jobsRepository.getAllJobs(req.query);

            res.status(200).json({
                success: true,
                data: result.jobs,
                pagination: result.pagination,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Cancels an in-flight bulk scraping job.
     * POST /api/scrape/bulk/:jobId/cancel or DELETE /api/scrape/bulk/:jobId
     */
    async cancelBulkJob(req, res, next) {
        try {
            const { jobId } = req.params;
            const result = await bulkService.cancelJob(jobId);

            res.status(200).json({
                success: true,
                message: result.message,
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Resolves an active web-based CAPTCHA challenge with human input.
     * POST /api/scrape/captcha-solve and POST /api/bulk/:jobId/captcha-solve
     */
    async submitCaptchaSolution(req, res, next) {
        try {
            const { challengeId, text } = req.body;
            const jobId = req.body.jobId || req.params.jobId || null;

            const resolved = captchaRelayService.resolveChallenge(challengeId, text);
            if (!resolved) {
                return res.status(400).json({
                    success: false,
                    error: 'CaptchaSolveError',
                    code: 'CAPTCHA_NOT_FOUND_OR_EXPIRED',
                    message: `Challenge '${challengeId}' does not exist, has expired, or is already settled.`,
                });
            }

            res.status(200).json({
                success: true,
                message: 'CAPTCHA solution submitted',
                challengeId,
                jobId,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Retrieves any pending CAPTCHA challenge requiring human solving.
     * GET /api/scrape/captcha-pending (optional query: jobId)
     */
    async getPendingCaptchaChallenge(req, res, next) {
        try {
            const jobId = req.query.jobId || req.params.jobId || null;
            const challenges = captchaRelayService.getPendingChallenges({ jobId });

            const pending = challenges.length > 0 ? {
                challengeId: challenges[0].challengeId,
                jobId: challenges[0].jobId,
                usn: challenges[0].usn,
                captchaImageBase64: challenges[0].captchaImageBase64,
                createdAt: challenges[0].createdAt,
                expiresAt: challenges[0].expiresAt,
            } : null;

            res.status(200).json({
                success: true,
                data: pending,
                challenge: pending,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Reloads the CAPTCHA image for an active challenge by triggering a reload in Puppeteer.
     * POST /api/scrape/captcha-reload
     */
    async reloadCaptchaChallenge(req, res, next) {
        try {
            const { challengeId } = req.body;
            if (!challengeId) {
                return res.status(400).json({
                    success: false,
                    error: 'ValidationError',
                    message: 'challengeId is required to reload a challenge',
                });
            }

            const result = await captchaRelayService.reloadChallenge(challengeId);
            res.status(200).json({
                success: true,
                message: 'CAPTCHA reloaded successfully',
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Streams real-time progress events for a bulk job via Server-Sent Events (SSE).
     * Includes broadcasting of captcha_required and captcha_solved events.
     * GET /api/scrape/bulk/:jobId/stream
     */
    async streamBulkJobProgress(req, res, next) {
        try {
            const { jobId } = req.params;

            // Verify job exists before opening SSE stream
            const initialJob = await bulkService.getJobStatus(jobId);

            // Establish SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof res.flushHeaders === 'function') {
                res.flushHeaders();
            }

            // Initial connection ack
            res.write(`event: connected\ndata: ${JSON.stringify({ jobId, status: initialJob.status, time: new Date().toISOString() })}\n\n`);

            // If a CAPTCHA challenge is currently pending for this job, emit immediately
            const pendingList = captchaRelayService.getPendingChallenges({ jobId });
            if (pendingList.length > 0) {
                const chal = pendingList[0];
                const captchaPayload = {
                    type: 'captcha_required',
                    event: 'captcha_required',
                    jobId: chal.jobId || jobId,
                    challengeId: chal.challengeId,
                    usn: chal.usn,
                    captchaImageBase64: chal.captchaImageBase64,
                    expiresAt: chal.expiresAt,
                };
                res.write(`event: captcha_required\ndata: ${JSON.stringify(captchaPayload)}\n\n`);
                res.write(`event: progress\ndata: ${JSON.stringify(captchaPayload)}\n\n`);
            }

            // Keep-alive heartbeat ping every 15s to prevent intermediary timeouts
            const heartbeat = setInterval(() => {
                res.write(': ping\n\n');
            }, 15000);

            // Real-time relay listeners for CAPTCHA challenges
            const onChallengeCreated = (payload) => {
                if (!payload.jobId || String(payload.jobId) === String(jobId)) {
                    const ssePayload = {
                        type: 'captcha_required',
                        event: 'captcha_required',
                        jobId: payload.jobId || jobId,
                        challengeId: payload.challengeId,
                        usn: payload.usn,
                        captchaImageBase64: payload.captchaImageBase64,
                        expiresAt: payload.expiresAt,
                    };
                    res.write(`event: captcha_required\ndata: ${JSON.stringify(ssePayload)}\n\n`);
                    res.write(`event: progress\ndata: ${JSON.stringify(ssePayload)}\n\n`);
                }
            };

            const onChallengeResolved = (payload) => {
                if (!payload.jobId || String(payload.jobId) === String(jobId)) {
                    const ssePayload = {
                        type: 'captcha_solved',
                        event: 'captcha_solved',
                        jobId: payload.jobId || jobId,
                        challengeId: payload.challengeId,
                        usn: payload.usn,
                    };
                    res.write(`event: captcha_solved\ndata: ${JSON.stringify(ssePayload)}\n\n`);
                    res.write(`event: progress\ndata: ${JSON.stringify(ssePayload)}\n\n`);
                }
            };

            captchaRelayService.on('challenge:created', onChallengeCreated);
            captchaRelayService.on('challenge:resolved', onChallengeResolved);

            // Subscribe to bulk service events
            const unsubscribe = bulkService.subscribeJob(jobId, (event) => {
                if (event.type === 'captcha_required' || event.event === 'captcha_required') {
                    res.write(`event: captcha_required\ndata: ${JSON.stringify(event)}\n\n`);
                } else if (event.type === 'captcha_solved' || event.event === 'captcha_solved') {
                    res.write(`event: captcha_solved\ndata: ${JSON.stringify(event)}\n\n`);
                } else {
                    res.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
                }

                // If terminal event received, close the stream gracefully
                if (['job:completed', 'job:cancelled', 'job:error'].includes(event.type)) {
                    setTimeout(() => {
                        clearInterval(heartbeat);
                        captchaRelayService.off('challenge:created', onChallengeCreated);
                        captchaRelayService.off('challenge:resolved', onChallengeResolved);
                        res.end();
                    }, 500);
                }
            });

            // Clean up resources on client disconnect
            req.on('close', () => {
                clearInterval(heartbeat);
                captchaRelayService.off('challenge:created', onChallengeCreated);
                captchaRelayService.off('challenge:resolved', onChallengeResolved);
                unsubscribe();
            });
        } catch (err) {
            next(err);
        }
    }
}

export const scrapeController = new ScrapeController();
