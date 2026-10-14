import { exportService } from '../services/export.service.js';

/**
 * Controller handling multi-format student data export (JSON, CSV, Excel/XLSX).
 */
export class ExportController {
    /**
     * Streams or sends exported dataset in the requested format.
     * GET /api/export
     */
    async exportResults(req, res, next) {
        try {
            const { format, jobId, usn, type, semester, department, exam, status, minSgpa, maxSgpa } = req.query;

            const exportOutput = await exportService.exportData({
                format: format || 'json',
                jobId,
                usn,
                csvType: type || 'detailed',
                semester,
                department,
                exam,
                status,
                minSgpa,
                maxSgpa,
            });

            res.setHeader('Content-Type', exportOutput.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${exportOutput.filename}"`);

            if (Buffer.isBuffer(exportOutput.data)) {
                res.setHeader('Content-Length', exportOutput.data.length);
                return res.end(exportOutput.data);
            }

            return res.send(exportOutput.data);
        } catch (err) {
            next(err);
        }
    }
}

export const exportController = new ExportController();
