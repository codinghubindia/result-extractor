import { Router } from 'express';
import { exportController } from '../controllers/export.controller.js';
import { validate, exportQuerySchema } from '../middleware/validate.js';

const router = Router();

/**
 * @route   GET /api/export
 * @desc    Export student results and course marks formatted as JSON, RFC-compliant CSV, or styled Excel (.xlsx)
 * @access  Public
 * @query   format ('json' | 'excel' | 'xlsx' | 'csv')
 * @query   jobId (optional bulk job ID)
 * @query   usn (optional student USN)
 * @query   type ('detailed' | 'summary')
 */
router.get(
    '/',
    validate(exportQuerySchema),
    (req, res, next) => exportController.exportResults(req, res, next)
);

export default router;
