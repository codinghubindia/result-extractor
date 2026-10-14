import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { scraperService as defaultScraperService, ScraperService } from './scraper.service.js';
import {
    jobsRepository as defaultJobsRepository,
    JobsRepository,
} from '../storage/jobs.repository.js';
import {
    resultsRepository as defaultResultsRepository,
    ResultsRepository,
} from '../storage/results.repository.js';
import {
    generateUsnRange,
    parseUsnInput,
    normalizeUsn,
} from '../utils/usn-range.js';
import {
    JobNotFoundError,
    StudentNotFoundError,
    ValidationError,
    ScraperTimeoutError,
} from '../utils/errors.js';

const DEFAULT_CONCURRENCY = parseInt(process.env.SCRAPER_CONCURRENCY || '2', 10);
const DEFAULT_MAX_RETRIES = 2;

class AsyncMutex {
    constructor() {
        this._queue = [];
        this._locked = false;
    }
    async acquire(timeoutMs = 15000) {
        if (!this._locked) {
            this._locked = true;
            let released = false;
            return () => {
                if (!released) {
                    released = true;
                    this._release();
                }
            };
        }
        return new Promise((resolve, reject) => {
            let timer = null;
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    const idx = this._queue.indexOf(entry);
                    if (idx !== -1) {
                        this._queue.splice(idx, 1);
                    }
                    reject(new Error('AsyncMutex acquisition timed out'));
                }, timeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            }

            const entry = (proceed) => {
                if (timer) clearTimeout(timer);
                if (proceed) {
                    let released = false;
                    resolve(() => {
                        if (!released) {
                            released = true;
                            this._release();
                        }
                    });
                } else {
                    reject(new Error('AsyncMutex cancelled or reset'));
                }
            };

            this._queue.push(entry);
        });
    }
    _release() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            next(true);
        } else {
            this._locked = false;
        }
    }
    reset() {
        while (this._queue.length > 0) {
            const next = this._queue.shift();
            try { next(false); } catch {}
        }
        this._locked = false;
    }
}

/**
 * BulkService coordinates multi-USN scraping batches using a parallel worker pool,
 * per-USN retry logic, graceful skipping of unassigned USNs, atomic progress tracking,
 * and real-time Server-Sent Events / event streaming.
 */
export class BulkService extends EventEmitter {
    /**
     * @param {object} [dependencies={}]
     * @param {ScraperService} [dependencies.scraperService]
     * @param {JobsRepository} [dependencies.jobsRepository]
     * @param {ResultsRepository} [dependencies.resultsRepository]
     * @param {number} [dependencies.defaultConcurrency=2]
     */
    constructor(dependencies = {}) {
        super();
        this.scraperService = dependencies.scraperService || defaultScraperService;
        this.jobsRepository = dependencies.jobsRepository || defaultJobsRepository;
        this.resultsRepository = dependencies.resultsRepository || defaultResultsRepository;
        this.defaultConcurrency = Math.max(1, Math.min(dependencies.defaultConcurrency || DEFAULT_CONCURRENCY, 4));

        /** @type {Map<string, { isCancelled: boolean, listeners: Set<Function> }>} */
        this.activeJobs = new Map();
    }

    /**
     * Initiates a bulk scraping job across a range or list of USNs.
     * Starts execution asynchronously and returns immediate job metadata.
     * 
     * @param {object} params
     * @param {string} [params.fromUsn] Starting USN (e.g., '1GA23IS001')
     * @param {string} [params.toUsn] Ending USN (e.g., '1GA23IS080')
     * @param {string[]|string} [params.usnList] Explicit list or array of USNs
     * @param {string} [params.examId] Specific exam ID to extract
     * @param {boolean} [params.latestOnly=false] Extract only the latest exam
     * @param {number} [params.concurrency] Max concurrent browser workers (1-4)
     * @param {number} [params.maxRetries=2] Max retries per USN on network/captcha errors
     * @returns {Promise<{ jobId: string, status: string, total: number, fromUsn: string, toUsn: string }>}
     */
    async startBulkJob(params = {}) {
        const usns = parseUsnInput(params);

        if (!usns || usns.length === 0) {
            throw new ValidationError('No valid USNs provided for bulk scrape job', { params });
        }

        const jobId = `job_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const fromUsn = normalizeUsn(params.fromUsn || usns[0]);
        const toUsn = normalizeUsn(params.toUsn || usns[usns.length - 1]);
        const concurrency = Math.min(
            params.concurrency ? Math.max(1, Math.min(params.concurrency, 4)) : this.defaultConcurrency,
            usns.length
        );
        const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;

        // Clean up previously scraped results ONLY if explicitly requested
        if (params.clearPreviousData === true && typeof this.resultsRepository?.clearResults === 'function') {
            await this.resultsRepository.clearResults().catch((err) => {
                console.warn('[BulkService] Failed to clear old results:', err.message);
            });
        }

        // Persist initial job record
        const initialRecord = {
            jobId,
            fromUsn,
            toUsn,
            examId: params.examId || null,
            semester: params.semester || null,
            status: 'in_progress',
            total: usns.length,
            processed: 0,
            successful: 0,
            failed: 0,
            currentUsn: usns[0] || null,
            results: [],
            errors: [],
            startedAt: new Date().toISOString(),
        };

        await this.jobsRepository.saveJob(initialRecord);

        // Register in active jobs map
        const jobControl = {
            isCancelled: false,
            userAway: false,
            listeners: new Set(),
        };
        this.activeJobs.set(jobId, jobControl);

        // Spawn background worker execution without awaiting
        this._runJobPool(jobId, usns, {
            examId: params.examId,
            semester: params.semester,
            latestOnly: params.latestOnly,
            concurrency,
            maxRetries,
            enableRelay: params.enableRelay ?? false,
            relayTimeoutMs: params.relayTimeoutMs || 20000,
        }).catch(async (err) => {
            console.error(`[BulkService] Unhandled failure in job ${jobId}:`, err);
            await this.jobsRepository.updateJobProgress(jobId, {
                status: 'failed',
                newError: { error: `Job execution failed: ${err.message}`, timestamp: new Date().toISOString() },
            }).catch(() => {});
            this._broadcastToSubscribers(jobId, {
                type: 'job:error',
                jobId,
                status: 'failed',
                error: err.message,
            });
            this.activeJobs.delete(jobId);
        });

        return {
            jobId,
            status: 'in_progress',
            total: usns.length,
            fromUsn,
            toUsn,
        };
    }

    /**
     * Retrieves current job status and progress.
     * @param {string} jobId
     * @returns {Promise<any>}
     */
    async getJobStatus(jobId) {
        if (!jobId) {
            throw new ValidationError('jobId parameter is required');
        }

        const job = await this.jobsRepository.getJob(jobId);
        if (!job) {
            throw new JobNotFoundError(jobId);
        }

        return job;
    }

    /**
     * Signals cancellation of an active bulk job.
     * @param {string} jobId
     * @returns {Promise<{ jobId: string, status: string, message: string }>}
     */
    async cancelJob(jobId) {
        const job = await this.getJobStatus(jobId);
        const control = this.activeJobs.get(jobId);

        if (control) {
            control.isCancelled = true;
        }

        await this.jobsRepository.updateJobProgress(jobId, {
            status: 'cancelled',
        });

        this._broadcastToSubscribers(jobId, {
            type: 'job:cancelled',
            jobId,
            status: 'cancelled',
            timestamp: new Date().toISOString(),
        });

        return {
            jobId,
            status: 'cancelled',
            message: `Job ${jobId} cancelled successfully.`,
        };
    }

    /**
     * Subscribes a listener function to real-time progress events for a specific job.
     * Used for Server-Sent Events (SSE) or WebSocket streaming.
     * 
     * @param {string} jobId
     * @param {(event: any) => void} callback
     * @returns {() => void} Unsubscribe function
     */
    subscribeJob(jobId, callback) {
        let control = this.activeJobs.get(jobId);
        if (!control) {
            control = { isCancelled: false, listeners: new Set() };
            this.activeJobs.set(jobId, control);
        }

        control.listeners.add(callback);

        // Immediately send current snapshot to newly connected subscriber
        this.jobsRepository.getJob(jobId).then((snapshot) => {
            if (snapshot) {
                callback({
                    type: 'snapshot',
                    jobId,
                    data: snapshot,
                });
            }
        }).catch(() => {});

        return () => {
            if (control) {
                control.listeners.delete(callback);
            }
        };
    }

    /**
     * Internal broadcaster for real-time progress events.
     * @private
     */
    _broadcastToSubscribers(jobId, payload) {
        const control = this.activeJobs.get(jobId);
        if (control && control.listeners) {
            for (const listener of control.listeners) {
                try {
                    listener(payload);
                } catch (err) {
                    console.error(`[BulkService] Error in subscriber callback for ${jobId}:`, err);
                }
            }
        }

        this.emit('progress', { jobId, ...payload });
    }

    /**
     * Internal worker pool loop. Launches parallel Puppeteer instances and distributes USNs.
     * @private
     */
    async _runJobPool(jobId, usns, options) {
        const control = this.activeJobs.get(jobId);
        const queue = [...usns];
        const concurrency = Math.min(options.concurrency, queue.length);
        const captchaMutex = new AsyncMutex();

        let processedCount = 0;
        let successfulCount = 0;
        let failedCount = 0;

        /**
         * Individual worker task runner.
         * Keeps a single browser and OCR worker alive for all assigned USNs.
         */
        const runWorker = async (workerIndex) => {
            let browser = null;
            let ocrWorker = null;

            try {
                browser = await this.scraperService.launchBrowser();
                ocrWorker = await this.scraperService.createOcrWorker();

                const pages = await browser.pages();
                let page = pages.length > 0 ? pages[0] : await browser.newPage();

                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );

                while (queue.length > 0) {
                    if (control?.isCancelled) {
                        break;
                    }

                    const currentUsn = queue.shift();
                    if (!currentUsn) break;

                    // Broadcast start of USN scrape
                    this._broadcastToSubscribers(jobId, {
                        type: 'usn:start',
                        jobId,
                        usn: currentUsn,
                        workerIndex,
                        processed: processedCount,
                        total: usns.length,
                    });
                    this._broadcastToSubscribers(jobId, {
                        type: 'log',
                        jobId,
                        message: `[Worker ${workerIndex + 1}] Started scraping ${currentUsn}`,
                        time: new Date().toLocaleTimeString(),
                    });

                    let usnStatus = 'FAILED';
                    let extractedResults = null;
                    let lastError = null;

                    // Per-USN retry loop
                    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
                        if (control?.isCancelled) break;

                        try {
                            // Ensure browser and page are healthy before starting
                            const isPageClosed = typeof page?.isClosed === 'function' && page.isClosed();
                            if (!browser || !browser.connected || isPageClosed) {
                                browser = await this.scraperService.launchBrowser();
                                const newPages = await browser.pages();
                                page = newPages.length > 0 ? newPages[0] : await browser.newPage();
                                if (typeof page?.setUserAgent === 'function') {
                                    await page.setUserAgent(
                                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                                    );
                                }
                            }

                            // Ensure OCR worker is active
                            if (!ocrWorker) {
                                ocrWorker = await this.scraperService.createOcrWorker();
                            }

                            // Allow relay only if requested, user has not been flagged away, and on attempt 1
                            const isRelayAllowed = Boolean(options.enableRelay) && !control?.userAway && attempt === 1;

                            // Per-USN watchdog timer (75s max per attempt) to prevent workers stalling for minutes
                            const USN_TIMEOUT_MS = 75000;
                            let usnTimer = null;
                            const timeoutPromise = new Promise((_, reject) => {
                                usnTimer = setTimeout(() => {
                                    reject(new ScraperTimeoutError(`Scraping timed out for USN ${currentUsn} after ${USN_TIMEOUT_MS / 1000}s`));
                                }, USN_TIMEOUT_MS);
                                if (typeof usnTimer.unref === 'function') usnTimer.unref();
                            });

                            const scrapePromise = this.scraperService.scrapeUsnWithPage(
                                page,
                                ocrWorker,
                                currentUsn,
                                {
                                    jobId,
                                    examId: options.examId,
                                    semester: options.semester,
                                    latestOnly: options.latestOnly,
                                    enableRelay: isRelayAllowed,
                                    maxRelayAttempts: 1,
                                    relayTimeoutMs: options.relayTimeoutMs || 20000,
                                    acquireRelayLock: () => captchaMutex.acquire(15000),
                                    onCaptchaRequired: (challenge) => {
                                        this._broadcastToSubscribers(jobId, {
                                            type: 'captcha_required',
                                            jobId,
                                            usn: challenge.usn,
                                            challengeId: challenge.challengeId,
                                            captchaImageBase64: challenge.captchaImageBase64,
                                            attempt: challenge.attempt,
                                        });
                                        this._broadcastToSubscribers(jobId, {
                                            type: 'log',
                                            jobId,
                                            message: `[Worker ${workerIndex + 1}] CAPTCHA required for ${challenge.usn}. Awaiting solution (max 20s)...`,
                                            time: new Date().toLocaleTimeString(),
                                        });
                                    },
                                }
                            );

                            try {
                                extractedResults = await Promise.race([scrapePromise, timeoutPromise]);
                            } finally {
                                if (usnTimer) clearTimeout(usnTimer);
                            }

                            usnStatus = 'SUCCESS';
                            break;
                        } catch (err) {
                            lastError = err;

                            // If human relay actually timed out, mark userAway so future USNs run automated without pausing
                            if (control && (err.message?.includes('Human CAPTCHA relay failed') || err.message?.includes('challenge expired') || err.name === 'CaptchaRelayTimeoutError')) {
                                control.userAway = true;
                                this._broadcastToSubscribers(jobId, {
                                    type: 'log',
                                    jobId,
                                    message: `[Worker ${workerIndex + 1}] Human relay timed out for ${currentUsn}. Switching remaining batch to pure automated OCR.`,
                                    time: new Date().toLocaleTimeString(),
                                });
                            }

                            // Non-existent or invalid USN: no retry needed, skip gracefully
                            if (
                                err instanceof StudentNotFoundError ||
                                err.name === 'StudentNotFoundError' ||
                                err.code === 'STUDENT_NOT_FOUND' ||
                                this.scraperService.isNotFoundError(err.message)
                            ) {
                                usnStatus = 'NOT_FOUND';
                                break;
                            }

                            // If timed out or browser disconnected/crashed, cleanly reset browser & page
                            const isPageClosed = typeof page?.isClosed === 'function' && page.isClosed();
                            const isTimeout = err instanceof ScraperTimeoutError || err.name === 'ScraperTimeoutError';
                            if (!browser || !browser.connected || isPageClosed || isTimeout) {
                                try {
                                    if (page && !isPageClosed) {
                                        await page.close().catch(() => {});
                                    }
                                    if (!browser || !browser.connected) {
                                        browser = await this.scraperService.launchBrowser();
                                    }
                                    page = await browser.newPage();
                                    await page.setUserAgent(
                                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                                    );
                                } catch {}
                            }

                            if (attempt < options.maxRetries) {
                                await new Promise((r) => setTimeout(r, 1000 * attempt));
                            }
                        }
                    }

                    if (control?.isCancelled) break;

                    processedCount++;

                    if (usnStatus === 'SUCCESS' && extractedResults && extractedResults.length > 0) {
                        successfulCount++;

                        // Persist to storage repository
                        await this.resultsRepository.saveResultsBatch(extractedResults).catch((e) => {
                            console.error(`[BulkService] Failed to persist results for ${currentUsn}:`, e.message);
                        });

                        const primary = extractedResults[0];
                        const summary = {
                            usn: currentUsn,
                            status: 'SUCCESS',
                            name: primary?.student?.name || '',
                            department: primary?.student?.department || '',
                            semester: primary?.student?.semester || '',
                            sgpa: primary?.summary?.sgpa || '',
                            cgpa: primary?.summary?.cgpa || '',
                            exam: primary?.exam || '',
                            coursesCount: primary?.courses?.length || 0,
                            examsCount: extractedResults.length,
                            courses: primary?.courses || [],
                            student: primary?.student || {},
                            summary: primary?.summary || {},
                        };

                        await this.jobsRepository.updateJobProgress(jobId, {
                            processed: processedCount,
                            successful: successfulCount,
                            currentUsn,
                            newResult: summary,
                        });

                        this._broadcastToSubscribers(jobId, {
                            type: 'usn:result',
                            jobId,
                            usn: currentUsn,
                            status: 'SUCCESS',
                            data: summary,
                            record: summary,
                            processed: processedCount,
                            successful: successfulCount,
                            failed: failedCount,
                            total: usns.length,
                        });
                        this._broadcastToSubscribers(jobId, {
                            type: 'log',
                            jobId,
                            message: `[Worker ${workerIndex + 1}] Successfully scraped ${currentUsn} (SGPA: ${summary.sgpa || 'N/A'}, ${summary.coursesCount} courses)`,
                            time: new Date().toLocaleTimeString(),
                        });
                    } else if (usnStatus === 'NOT_FOUND') {
                        failedCount++;

                        const notFoundEntry = {
                            usn: currentUsn,
                            status: 'NOT_FOUND',
                            message: lastError?.message || 'Student result not found on portal',
                        };

                        await this.jobsRepository.updateJobProgress(jobId, {
                            processed: processedCount,
                            failed: failedCount,
                            currentUsn,
                            newError: notFoundEntry,
                        });

                        this._broadcastToSubscribers(jobId, {
                            type: 'usn:skipped',
                            jobId,
                            usn: currentUsn,
                            status: 'NOT_FOUND',
                            message: notFoundEntry.message,
                            processed: processedCount,
                            successful: successfulCount,
                            failed: failedCount,
                            total: usns.length,
                        });
                        this._broadcastToSubscribers(jobId, {
                            type: 'log',
                            jobId,
                            message: `[Worker ${workerIndex + 1}] USN ${currentUsn} not found on portal (Skipped)`,
                            time: new Date().toLocaleTimeString(),
                        });
                    } else {
                        failedCount++;

                        const failedEntry = {
                            usn: currentUsn,
                            status: 'FAILED',
                            error: lastError?.message || 'Extraction failed after retries',
                        };

                        await this.jobsRepository.updateJobProgress(jobId, {
                            processed: processedCount,
                            failed: failedCount,
                            currentUsn,
                            newError: failedEntry,
                        });

                        this._broadcastToSubscribers(jobId, {
                            type: 'usn:error',
                            jobId,
                            usn: currentUsn,
                            status: 'FAILED',
                            error: failedEntry.error,
                            processed: processedCount,
                            successful: successfulCount,
                            failed: failedCount,
                            total: usns.length,
                        });
                        this._broadcastToSubscribers(jobId, {
                            type: 'log',
                            jobId,
                            message: `[Worker ${workerIndex + 1}] Failed ${currentUsn}: ${failedEntry.error}`,
                            time: new Date().toLocaleTimeString(),
                        });
                    }

                    // Clean reset page state between USNs
                    try {
                        if (page && typeof page.goto === 'function') {
                            const isPageClosed = typeof page?.isClosed === 'function' && page.isClosed();
                            if (!isPageClosed) {
                                await page.goto('about:blank').catch(() => {});
                            }
                        }
                    } catch (_) {}

                    // Politeness interval between USNs per worker
                    await new Promise((r) => setTimeout(r, 400));
                }
            } finally {
                // Ensure browser and OCR worker are strictly terminated
                if (ocrWorker) {
                    await ocrWorker.terminate().catch(() => {});
                }
                if (browser && browser.connected) {
                    await browser.close().catch(() => {});
                }
            }
        };

        // Launch worker pool
        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(runWorker(i));
        }

        await Promise.all(workers);
        captchaMutex.reset();

        // Finalize job record
        const finalStatus = control?.isCancelled
            ? 'cancelled'
            : failedCount === usns.length && usns.length > 0
            ? 'failed'
            : 'completed';

        const completedAt = new Date().toISOString();

        await this.jobsRepository.updateJobProgress(jobId, {
            status: finalStatus,
            currentUsn: null,
            processed: processedCount,
            successful: successfulCount,
            failed: failedCount,
        });

        this._broadcastToSubscribers(jobId, {
            type: 'job:completed',
            jobId,
            status: finalStatus,
            total: usns.length,
            processed: processedCount,
            successful: successfulCount,
            failed: failedCount,
            completedAt,
        });

        // Retain active job listeners briefly for pending SSE closes, then clean up
        const cleanupTimer = setTimeout(() => {
            this.activeJobs.delete(jobId);
        }, 15000);
        if (typeof cleanupTimer.unref === 'function') {
            cleanupTimer.unref();
        }
    }
}

export const bulkService = new BulkService();
