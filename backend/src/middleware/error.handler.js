import { AppError } from '../utils/errors.js';

/**
 * Standardized RFC 9457 Problem Details error-handling middleware.
 * Guarantees uniform error envelopes across all routes and prevents silent leaks of internals.
 */
export function errorHandler(err, req, res, next) {
    // If headers already sent (e.g. during SSE streaming), delegate to default Express handler
    if (res.headersSent) {
        return next(err);
    }

    const isAppError = err instanceof AppError;
    const statusCode = err.statusCode || err.status || (isAppError ? 400 : 500);
    const errorCode = err.code || (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');

    // Structured logging for server-side diagnosis
    if (statusCode >= 500) {
        console.error(`[Error] Unhandled Exception at ${req.method} ${req.originalUrl}:`, err);
    } else {
        console.warn(`[Warn] Operational Error [${statusCode}] ${errorCode} at ${req.method} ${req.originalUrl}: ${err.message}`);
    }

    const problemEnvelope = {
        success: false,
        type: `https://errors.gat-results.local/${errorCode.toLowerCase().replace(/_/g, '-')}`,
        title: err.name || 'Application Error',
        status: statusCode,
        detail: err.message || 'An unexpected error occurred during request processing.',
        code: errorCode,
        details: err.details || {},
        instance: req.originalUrl,
        timestamp: new Date().toISOString(),
    };

    res.setHeader('Content-Type', 'application/problem+json');
    res.status(statusCode).json(problemEnvelope);
}

/**
 * Fallthrough 404 Route Not Found middleware.
 */
export function notFoundHandler(req, res) {
    const statusCode = 404;
    res.setHeader('Content-Type', 'application/problem+json');
    res.status(statusCode).json({
        success: false,
        type: 'https://errors.gat-results.local/route-not-found',
        title: 'Route Not Found',
        status: 404,
        detail: `The endpoint ${req.method} ${req.originalUrl} does not exist on this server.`,
        code: 'ROUTE_NOT_FOUND',
        instance: req.originalUrl,
        timestamp: new Date().toISOString(),
    });
}
