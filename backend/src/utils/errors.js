/**
 * Domain-specific error hierarchy for the GAT Results Scraper application.
 * Follows RFC 9457 Problem Details conventions.
 */

export class AppError extends Error {
    /**
     * @param {string} message Error description
     * @param {number} [statusCode=500] HTTP status code
     * @param {string} [code='INTERNAL_ERROR'] Machine-readable error code
     * @param {Record<string, unknown>} [details={}] Supplementary error context
     */
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: this.name,
            code: this.code,
            message: this.message,
            statusCode: this.statusCode,
            details: this.details,
        };
    }
}

export class ValidationError extends AppError {
    constructor(message, details = {}) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}

export class StudentNotFoundError extends AppError {
    constructor(message = 'Student results not found for the specified USN', details = {}) {
        super(message, 404, 'STUDENT_NOT_FOUND', details);
    }
}

export class CaptchaSolveError extends AppError {
    constructor(message = 'Failed to automatically resolve CAPTCHA after maximum attempts', details = {}) {
        super(message, 422, 'CAPTCHA_SOLVE_FAILED', details);
    }
}

export class PortalUnavailableError extends AppError {
    constructor(message = 'Target examination results portal is currently unreachable or unresponsive', details = {}) {
        super(message, 503, 'PORTAL_UNAVAILABLE', details);
    }
}

export class ScraperTimeoutError extends AppError {
    constructor(message = 'Scraping operation timed out waiting for portal response', details = {}) {
        super(message, 504, 'SCRAPER_TIMEOUT', details);
    }
}

export class JobNotFoundError extends AppError {
    constructor(jobId, details = {}) {
        super(`Bulk scrape job '${jobId}' was not found`, 404, 'JOB_NOT_FOUND', { jobId, ...details });
    }
}

export class BulkJobError extends AppError {
    constructor(message, details = {}) {
        super(message, 500, 'BULK_JOB_ERROR', details);
    }
}
