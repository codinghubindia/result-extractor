import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ValidationError, CaptchaSolveError } from '../utils/errors.js';

const DEFAULT_CHALLENGE_TIMEOUT_MS = 60000; // 60 seconds

/**
 * CaptchaRelayService coordinates Web-Based Human-in-the-Loop CAPTCHA resolution.
 * When automated OCR cannot solve a challenge or reaches max retries, this service holds
 * the scraper in suspension, emits challenges to connected web clients (via SSE/REST),
 * and resumes the scraper once a human provides the solution.
 */
export class CaptchaRelayService extends EventEmitter {
    constructor() {
        super();
        /** 
         * Map of challengeId -> ChallengeEntry
         * @type {Map<string, {
         *   challengeId: string,
         *   jobId: string|null,
         *   usn: string,
         *   captchaImageBase64: string,
         *   createdAt: string,
         *   expiresAt: string,
         *   status: 'pending'|'resolved'|'cancelled'|'expired',
         *   metadata: Record<string, unknown>,
         *   resolve: (val: { text: string }) => void,
         *   reject: (err: Error) => void,
         *   timer?: NodeJS.Timeout
         * }>}
         */
        this.pendingChallenges = new Map();
    }

    /**
     * Creates a new pending CAPTCHA challenge and registers resolver hooks.
     * 
     * @param {object} params
     * @param {string} [params.jobId] Associated bulk job ID if applicable
     * @param {string} params.usn The USN being scraped
     * @param {string} params.captchaImageBase64 Base64 image string of the raw canvas
     * @param {Record<string, unknown>} [params.metadata={}] Additional contextual payload
     * @param {number} [params.timeoutMs=60000] Time to wait for user input before expiring
     * @returns {string} Unique challengeId
     */
    createChallenge(params = {}) {
        const { jobId = null, usn, captchaImageBase64, metadata = {}, timeoutMs = DEFAULT_CHALLENGE_TIMEOUT_MS } = params;

        if (!usn) {
            throw new ValidationError('USN is required to create a CAPTCHA challenge');
        }
        if (!captchaImageBase64) {
            throw new ValidationError('captchaImageBase64 is required to create a CAPTCHA challenge');
        }

        const challengeId = `chal_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeoutMs).toISOString();

        let resolvePromise;
        let rejectPromise;

        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });
        // Prevent unhandledRejection if challenge is cancelled/expired before waitForSolution is attached
        promise.catch(() => {});

        // Set automatic expiration timer
        const timer = setTimeout(() => {
            this._handleExpiration(challengeId);
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }

        const entry = {
            challengeId,
            jobId: jobId ? String(jobId) : null,
            usn: String(usn).toUpperCase(),
            captchaImageBase64,
            createdAt: now.toISOString(),
            expiresAt,
            status: 'pending',
            metadata,
            promise,
            resolve: resolvePromise,
            reject: rejectPromise,
            timer,
        };

        this.pendingChallenges.set(challengeId, entry);

        this.emit('challenge:created', {
            challengeId,
            jobId: entry.jobId,
            usn: entry.usn,
            captchaImageBase64,
            expiresAt,
        });

        return challengeId;
    }

    /**
     * Suspends scraper execution until the given challenge is resolved by user input or expires.
     * 
     * @param {string} challengeId
     * @param {number} [timeoutMs] Optional custom timeout override in ms
     * @returns {Promise<{ text: string }>} Resolved CAPTCHA solution text
     */
    async waitForSolution(challengeId, timeoutMs) {
        const entry = this.pendingChallenges.get(challengeId);
        if (!entry) {
            throw new CaptchaSolveError(`Challenge '${challengeId}' does not exist or has already completed`, {
                challengeId,
            });
        }

        if (timeoutMs && timeoutMs > 0 && entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = setTimeout(() => {
                this._handleExpiration(challengeId);
            }, timeoutMs);
            if (typeof entry.timer.unref === 'function') {
                entry.timer.unref();
            }
        }

        return await entry.promise;
    }

    /**
     * Resolves a pending challenge with user-provided CAPTCHA text.
     * 
     * @param {string} challengeId
     * @param {string} text The alphanumeric CAPTCHA text solved by the user
     * @returns {boolean} True if successfully resolved, false if already settled/expired
     */
    resolveChallenge(challengeId, text) {
        if (!challengeId) {
            throw new ValidationError('challengeId is required to resolve a CAPTCHA challenge');
        }
        if (text === undefined || text === null || String(text).trim().length === 0) {
            throw new ValidationError('CAPTCHA text solution cannot be empty', { challengeId });
        }

        const entry = this.pendingChallenges.get(challengeId);
        if (!entry || entry.status !== 'pending') {
            return false;
        }

        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = undefined;
        }

        const cleanText = String(text).trim().replace(/[^a-zA-Z0-9]/g, '');
        entry.status = 'resolved';

        entry.resolve({ text: cleanText });
        this.pendingChallenges.delete(challengeId);

        this.emit('challenge:resolved', {
            challengeId,
            jobId: entry.jobId,
            usn: entry.usn,
            text: cleanText,
        });

        return true;
    }

    /**
     * Cancels an active challenge, rejecting the scraper's waiting promise.
     * 
     * @param {string} challengeId
     * @param {string} [reason='Challenge cancelled by client']
     * @returns {boolean} True if successfully cancelled
     */
    cancelChallenge(challengeId, reason = 'Challenge cancelled by client') {
        const entry = this.pendingChallenges.get(challengeId);
        if (!entry || entry.status !== 'pending') {
            return false;
        }

        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = undefined;
        }

        entry.status = 'cancelled';
        entry.reject(new CaptchaSolveError(reason, { challengeId, cancelled: true }));
        this.pendingChallenges.delete(challengeId);

        this.emit('challenge:cancelled', {
            challengeId,
            jobId: entry.jobId,
            usn: entry.usn,
            reason,
        });

        return true;
    }

    /**
     * Registers a reload handler callback for a specific challenge.
     * @param {string} challengeId
     * @param {() => Promise<string>} onReloadFn
     */
    registerReloadHandler(challengeId, onReloadFn) {
        const entry = this.pendingChallenges.get(challengeId);
        if (entry) {
            entry.onReload = onReloadFn;
        }
    }

    /**
     * Triggers a reload for an active challenge, clicking reload on page and returning fresh base64.
     * @param {string} challengeId
     * @returns {Promise<{ success: boolean, challengeId: string, captchaImageBase64: string }>}
     */
    async reloadChallenge(challengeId) {
        const entry = this.pendingChallenges.get(challengeId);
        if (!entry || entry.status !== 'pending') {
            throw new ValidationError('Challenge does not exist or is no longer pending', { challengeId });
        }

        if (typeof entry.onReload === 'function') {
            const newBase64 = await entry.onReload();
            if (newBase64) {
                entry.captchaImageBase64 = newBase64;
            }
            this.emit('challenge:reloaded', {
                challengeId,
                jobId: entry.jobId,
                usn: entry.usn,
                captchaImageBase64: entry.captchaImageBase64,
            });
            return { success: true, challengeId, captchaImageBase64: entry.captchaImageBase64 };
        }

        return { success: true, challengeId, captchaImageBase64: entry.captchaImageBase64 };
    }

    /**
     * Retrieves an array of all currently pending CAPTCHA challenges.
     * Sanitized for safe JSON API output (omits internal promise hooks).
     * 
     * @param {object} [filter={}]
     * @param {string} [filter.jobId]
     * @param {string} [filter.usn]
     * @returns {Array<{ challengeId: string, jobId: string|null, usn: string, captchaImageBase64: string, createdAt: string, expiresAt: string, status: string }>}
     */
    getPendingChallenges(filter = {}) {
        const results = [];
        for (const entry of this.pendingChallenges.values()) {
            if (entry.status !== 'pending') continue;

            if (filter.jobId && entry.jobId !== String(filter.jobId)) {
                continue;
            }
            if (filter.usn && entry.usn !== String(filter.usn).toUpperCase()) {
                continue;
            }

            results.push({
                challengeId: entry.challengeId,
                jobId: entry.jobId,
                usn: entry.usn,
                captchaImageBase64: entry.captchaImageBase64,
                createdAt: entry.createdAt,
                expiresAt: entry.expiresAt,
                status: entry.status,
                metadata: entry.metadata,
            });
        }
        return results;
    }

    /**
     * Retrieves a single challenge by ID.
     * @param {string} challengeId
     * @returns {object|null}
     */
    getChallenge(challengeId) {
        const entry = this.pendingChallenges.get(challengeId);
        if (!entry) return null;

        return {
            challengeId: entry.challengeId,
            jobId: entry.jobId,
            usn: entry.usn,
            captchaImageBase64: entry.captchaImageBase64,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt,
            status: entry.status,
            metadata: entry.metadata,
        };
    }

    /**
     * Clears all pending challenges (useful for graceful shutdown or tests).
     */
    clearAll() {
        for (const [challengeId, entry] of this.pendingChallenges.entries()) {
            if (entry.timer) clearTimeout(entry.timer);
            if (entry.status === 'pending') {
                entry.reject(new CaptchaSolveError('Service cleared active challenges', { challengeId }));
            }
        }
        this.pendingChallenges.clear();
    }

    /**
     * Internal timeout expiration handler.
     * @private
     */
    _handleExpiration(challengeId) {
        const entry = this.pendingChallenges.get(challengeId);
        if (!entry || entry.status !== 'pending') return;

        entry.status = 'expired';
        entry.reject(new CaptchaSolveError('Human CAPTCHA resolution timed out', {
            challengeId,
            usn: entry.usn,
            expired: true,
        }));
        this.pendingChallenges.delete(challengeId);

        this.emit('challenge:expired', {
            challengeId,
            jobId: entry.jobId,
            usn: entry.usn,
        });
    }
}

export const captchaRelayService = new CaptchaRelayService();
