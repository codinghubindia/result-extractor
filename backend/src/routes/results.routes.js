import { Router } from 'express';
import { resultsController } from '../controllers/results.controller.js';
import {
    validate,
    resultsQuerySchema,
    usnParamSchema,
} from '../middleware/validate.js';

const router = Router();

/**
 * @route   GET /api/results
 * @desc    Query persisted student results with filtering, search, sorting, and pagination
 * @access  Public
 */
router.get(
    '/',
    validate(resultsQuerySchema),
    (req, res, next) => resultsController.queryResults(req, res, next)
);

/**
 * @route   GET /api/results/:usn
 * @desc    Retrieve all saved exam results for a specific student USN
 * @access  Public
 */
router.get(
    '/:usn',
    validate(usnParamSchema),
    (req, res, next) => resultsController.getResultByUsn(req, res, next)
);

/**
 * @route   DELETE /api/results
 * @desc    Clear all persisted student results
 * @access  Public
 */
router.delete(
    '/',
    (req, res, next) => resultsController.clearAllResults(req, res, next)
);

export default router;
