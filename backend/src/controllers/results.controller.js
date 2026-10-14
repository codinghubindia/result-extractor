import { resultsRepository } from '../storage/results.repository.js';
import { StudentNotFoundError } from '../utils/errors.js';

/**
 * Controller handling query, search, filtering, and retrieval of persisted student academic results.
 */
export class ResultsController {
    /**
     * Queries saved student records with filtering, full-text search, and pagination.
     * GET /api/results
     */
    async queryResults(req, res, next) {
        try {
            const queryFilter = {
                usn: req.query.usn,
                search: req.query.search,
                semester: req.query.semester,
                department: req.query.department,
                exam: req.query.exam,
                minSgpa: req.query.minSgpa,
                maxSgpa: req.query.maxSgpa,
                minCgpa: req.query.minCgpa,
                maxCgpa: req.query.maxCgpa,
                status: req.query.status,
                sortBy: req.query.sortBy,
                sortOrder: req.query.sortOrder,
                page: req.query.page,
                limit: req.query.limit,
            };

            const result = await resultsRepository.getAllResults(queryFilter);

            res.status(200).json({
                success: true,
                count: result.results.length,
                data: result.results,
                pagination: result.pagination,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Retrieves all saved exam results for a specific student USN.
     * GET /api/results/:usn
     */
    async getResultByUsn(req, res, next) {
        try {
            const usn = req.params.usn.trim().toUpperCase();
            const records = await resultsRepository.getResultsByUsn(usn);

            if (!records || records.length === 0) {
                throw new StudentNotFoundError(`No persisted records found for USN '${usn}'`, { usn });
            }

            res.status(200).json({
                success: true,
                usn,
                count: records.length,
                data: records,
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Clears all persisted results from storage.
     * DELETE /api/results
     */
    async clearAllResults(req, res, next) {
        try {
            await resultsRepository.clearResults();
            res.status(200).json({
                success: true,
                message: 'All persisted results have been cleared successfully',
            });
        } catch (err) {
            next(err);
        }
    }
}

export const resultsController = new ResultsController();
