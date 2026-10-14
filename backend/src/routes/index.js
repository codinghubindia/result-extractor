import { Router } from 'express';
import scrapeRouter from './scrape.routes.js';
import bulkRouter from './bulk.routes.js';
import resultsRouter from './results.routes.js';
import exportRouter from './export.routes.js';

const router = Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'gat-results-backend',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// Domain Feature Routers
router.use('/scrape', scrapeRouter);
router.use('/bulk', bulkRouter);
router.use('/results', resultsRouter);
router.use('/export', exportRouter);

export default router;
