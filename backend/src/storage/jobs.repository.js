import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AtomicJsonFile } from './atomicFile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_JOBS_PATH = path.resolve(__dirname, '../../data/jobs.json');

/**
 * Normalizes a raw job object into a standardized JobRecord.
 * @param {any} raw
 * @returns {any} Normalized JobRecord
 */
export function normalizeJobRecord(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid job payload: expected an object');
    }

    const now = new Date().toISOString();
    const jobId = (raw.jobId || raw.id || `job_${Date.now()}_${randomUUID().slice(0, 8)}`).toString().trim();
    const fromUsn = (raw.fromUsn || raw.startUsn || '').toString().trim().toUpperCase();
    const toUsn = (raw.toUsn || raw.endUsn || '').toString().trim().toUpperCase();
    const examId = raw.examId ? raw.examId.toString().trim() : null;

    const total = Math.max(0, parseInt(raw.total || 0, 10));
    const processed = Math.max(0, parseInt(raw.processed || 0, 10));
    const successful = Math.max(0, parseInt(raw.successful || 0, 10));
    const failed = Math.max(0, parseInt(raw.failed || 0, 10));

    const status = (raw.status || 'pending').toString().toLowerCase();

    return {
        jobId,
        id: jobId,
        fromUsn,
        toUsn,
        examId,
        status,
        total,
        processed,
        successful,
        failed,
        currentUsn: raw.currentUsn || null,
        results: Array.isArray(raw.results) ? raw.results : [],
        errors: Array.isArray(raw.errors) ? raw.errors : [],
        startedAt: raw.startedAt || (status === 'in_progress' ? now : null),
        completedAt: raw.completedAt || (['completed', 'failed', 'cancelled'].includes(status) ? now : null),
        createdAt: raw.createdAt || now,
        updatedAt: raw.updatedAt || now,
    };
}

/**
 * JobsRepository manages persistence, status tracking, and concurrent progress updates
 * for bulk USN scraping jobs.
 */
export class JobsRepository {
    /**
     * @param {string} [filePath] Optional custom file path for storage
     */
    constructor(filePath = DEFAULT_JOBS_PATH) {
        this.storage = new AtomicJsonFile(filePath, []);
    }

    /**
     * Saves or creates a new job atomically.
     * @param {any} jobData
     * @returns {Promise<any>} Persisted JobRecord
     */
    async saveJob(jobData) {
        const record = normalizeJobRecord(jobData);

        await this.storage.mutate((jobs) => {
            const index = jobs.findIndex((j) => j.jobId === record.jobId || j.id === record.jobId);
            if (index >= 0) {
                jobs[index] = {
                    ...jobs[index],
                    ...record,
                    updatedAt: new Date().toISOString(),
                };
            } else {
                jobs.push(record);
            }
        });

        return record;
    }

    /**
     * Retrieves a job by jobId or id.
     * @param {string} jobId
     * @returns {Promise<any | null>}
     */
    async getJob(jobId) {
        if (!jobId) return null;
        const targetId = jobId.toString().trim();
        const jobs = await this.storage.read();
        return jobs.find((j) => j.jobId === targetId || j.id === targetId) || null;
    }

    /**
     * Updates job progress, status, and appends results or errors atomically.
     * Guaranteed thread-safe against concurrent updates during bulk scraping.
     * 
     * @param {string} jobId Unique job ID
     * @param {object} updates Update instructions
     * @param {string} [updates.status] New status ('pending'|'in_progress'|'completed'|'failed'|'cancelled')
     * @param {number} [updates.total] Override total
     * @param {number} [updates.processed] Explicit processed count
     * @param {number} [updates.successful] Explicit successful count
     * @param {number} [updates.failed] Explicit failed count
     * @param {number} [updates.incrementProcessed=0] Increment processed count
     * @param {number} [updates.incrementSuccessful=0] Increment successful count
     * @param {number} [updates.incrementFailed=0] Increment failed count
     * @param {string} [updates.currentUsn] Current USN being processed
     * @param {any} [updates.newResult] Single result summary to append
     * @param {any[]} [updates.newResults] Batch of result summaries to append
     * @param {any} [updates.newError] Error entry to append { usn, error, timestamp }
     * @param {any[]} [updates.newErrors] Array of error entries to append
     * 
     * @returns {Promise<any>} Updated JobRecord
     */
    async updateJobProgress(jobId, updates = {}) {
        if (!jobId) {
            throw new Error('jobId is required to update job progress');
        }

        const targetId = jobId.toString().trim();
        let updatedRecord = null;

        await this.storage.mutate((jobs) => {
            const index = jobs.findIndex((j) => j.jobId === targetId || j.id === targetId);
            if (index < 0) {
                throw new Error(`Job not found with ID '${targetId}'`);
            }

            const current = jobs[index];
            const now = new Date().toISOString();

            // Status transitions
            const nextStatus = updates.status !== undefined ? updates.status.toString().toLowerCase() : current.status;
            let startedAt = current.startedAt;
            let completedAt = current.completedAt;

            if (nextStatus === 'in_progress' && !startedAt) {
                startedAt = now;
            }
            if (['completed', 'failed', 'cancelled'].includes(nextStatus) && !completedAt) {
                completedAt = now;
            }

            // Numeric updates and increments
            const processed = updates.processed !== undefined 
                ? updates.processed 
                : current.processed + (updates.incrementProcessed || 0);

            const successful = updates.successful !== undefined 
                ? updates.successful 
                : current.successful + (updates.incrementSuccessful || 0);

            const failed = updates.failed !== undefined 
                ? updates.failed 
                : current.failed + (updates.incrementFailed || 0);

            const total = updates.total !== undefined ? updates.total : current.total;

            // Results array updates
            const results = [...current.results];
            if (updates.newResult) {
                results.push(updates.newResult);
            }
            if (Array.isArray(updates.newResults)) {
                results.push(...updates.newResults);
            }

            // Errors array updates
            const errors = [...current.errors];
            if (updates.newError) {
                errors.push(typeof updates.newError === 'object' ? updates.newError : { error: String(updates.newError), timestamp: now });
            }
            if (Array.isArray(updates.newErrors)) {
                errors.push(...updates.newErrors);
            }

            current.status = nextStatus;
            current.total = total;
            current.processed = processed;
            current.successful = successful;
            current.failed = failed;
            current.currentUsn = updates.currentUsn !== undefined ? updates.currentUsn : current.currentUsn;
            current.results = results;
            current.errors = errors;
            current.startedAt = startedAt;
            current.completedAt = completedAt;
            current.updatedAt = now;

            updatedRecord = { ...current };
        });

        return updatedRecord;
    }

    /**
     * Queries bulk jobs with optional status filter, sorting, and pagination.
     * 
     * @param {object} [filter={}]
     * @param {string} [filter.status] Filter by status ('pending'|'in_progress'|'completed'|'failed'|'cancelled'|'all')
     * @param {'createdAt'|'updatedAt'|'total'|'processed'} [filter.sortBy='createdAt'] Sort column
     * @param {'asc'|'desc'} [filter.sortOrder='desc'] Sort direction
     * @param {number} [filter.page=1] 1-indexed page
     * @param {number|'all'} [filter.limit=50] Page size
     * 
     * @returns {Promise<{ jobs: any[], pagination: { total: number, page: number, limit: number, totalPages: number } }>}
     */
    async getAllJobs(filter = {}) {
        const jobs = await this.storage.read();
        let filtered = [...jobs];

        // 1. Filter by Status
        if (filter.status && filter.status.toLowerCase() !== 'all') {
            const statusTarget = filter.status.toLowerCase();
            filtered = filtered.filter((j) => (j.status || '').toLowerCase() === statusTarget);
        }

        // 2. Sorting
        const sortBy = filter.sortBy || 'createdAt';
        const sortOrder = (filter.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'total':
                    return ((a.total || 0) - (b.total || 0)) * sortOrder;
                case 'processed':
                    return ((a.processed || 0) - (b.processed || 0)) * sortOrder;
                case 'updatedAt': {
                    const timeA = new Date(a.updatedAt || 0).getTime();
                    const timeB = new Date(b.updatedAt || 0).getTime();
                    return (timeA - timeB) * sortOrder;
                }
                case 'createdAt':
                default: {
                    const timeA = new Date(a.createdAt || 0).getTime();
                    const timeB = new Date(b.createdAt || 0).getTime();
                    return (timeA - timeB) * sortOrder;
                }
            }
        });

        // 3. Pagination
        const total = filtered.length;
        const limitParam = filter.limit;
        const isUnpaginated = limitParam === 'all' || limitParam === 0 || limitParam === '0';

        if (isUnpaginated) {
            return {
                jobs: filtered,
                pagination: {
                    total,
                    page: 1,
                    limit: total,
                    totalPages: 1,
                },
            };
        }

        const page = Math.max(1, parseInt(filter.page || 1, 10));
        const limit = Math.max(1, Math.min(parseInt(limitParam || 50, 10), 500));
        const offset = (page - 1) * limit;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const paginatedJobs = filtered.slice(offset, offset + limit);

        return {
            jobs: paginatedJobs,
            pagination: {
                total,
                page,
                limit,
                totalPages,
            },
        };
    }

    /**
     * Deletes a job by jobId.
     * @param {string} jobId
     * @returns {Promise<boolean>}
     */
    async deleteJob(jobId) {
        if (!jobId) return false;
        const targetId = jobId.toString().trim();

        return this.storage.mutate((jobs) => {
            const initialLength = jobs.length;
            const remaining = jobs.filter((j) => j.jobId !== targetId && j.id !== targetId);
            if (remaining.length !== initialLength) {
                jobs.length = 0;
                jobs.push(...remaining);
                return true;
            }
            return false;
        });
    }

    /**
     * Clears all jobs.
     * @returns {Promise<void>}
     */
    async clearJobs() {
        await this.storage.write([]);
    }
}

// Export default singleton instance
export const jobsRepository = new JobsRepository();
