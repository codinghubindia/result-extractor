import ExcelJS from 'exceljs';
import { resultsRepository } from '../storage/results.repository.js';
import { jobsRepository } from '../storage/jobs.repository.js';
import { isPassingResult } from '../storage/results.repository.js';
import { JobNotFoundError, StudentNotFoundError, ValidationError } from '../utils/errors.js';

/**
 * Escapes a single string field according to RFC 4180 CSV specifications.
 * @param {any} val
 * @returns {string}
 */
export function escapeCsvField(val) {
    if (val === null || val === undefined) {
        return '';
    }
    const str = String(val).trim();
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * ExportService generates structured data exports across JSON, CSV, and Excel (XLSX)
 * formats from student results or bulk scraping jobs.
 */
export class ExportService {
    /**
     * @param {object} [dependencies={}]
     * @param {import('../storage/results.repository.js').ResultsRepository} [dependencies.resultsRepo]
     * @param {import('../storage/jobs.repository.js').JobsRepository} [dependencies.jobsRepo]
     */
    constructor(dependencies = {}) {
        this.resultsRepo = dependencies.resultsRepo || resultsRepository;
        this.jobsRepo = dependencies.jobsRepo || jobsRepository;
    }

    /**
     * Gathers and normalizes records based on query criteria (jobId, single USN, or general filter).
     * 
     * @param {object} [options={}]
     * @param {string} [options.jobId] Export results associated with a bulk job
     * @param {string} [options.usn] Export results for a specific student USN
     * @param {string} [options.semester] Filter by semester
     * @param {string} [options.department] Filter by department
     * @param {string} [options.exam] Filter by exam name
     * @param {string} [options.status] Filter by PASS/FAIL
     * @param {string|number} [options.minSgpa] Minimum SGPA
     * @param {string|number} [options.maxSgpa] Maximum SGPA
     * @returns {Promise<{ records: any[], meta: object }>}
     */
    async fetchExportRecords(options = {}) {
        let records = [];
        let contextMeta = {
            exportedAt: new Date().toISOString(),
            source: 'all',
        };

        if (options.jobId) {
            const jobId = options.jobId.trim();
            const job = await this.jobsRepo.getJob(jobId);
            if (!job) {
                throw new JobNotFoundError(jobId);
            }

            contextMeta.source = 'job';
            contextMeta.jobId = job.jobId;
            contextMeta.fromUsn = job.fromUsn;
            contextMeta.toUsn = job.toUsn;
            contextMeta.status = job.status;

            // Fetch stored detailed records for all USNs in this job
            const jobUsns = (job.results || []).map((r) => r.usn).filter(Boolean);
            if (jobUsns.length > 0) {
                const allSaved = await this.resultsRepo.getAllResults({ limit: 'all' });
                const usnSet = new Set(jobUsns.map((u) => u.toUpperCase()));
                records = (allSaved.results || []).filter((r) => usnSet.has((r.usn || '').toUpperCase()));
            }

            // Fallback or augment with job results
            if (records.length === 0 && Array.isArray(job.results) && job.results.length > 0) {
                records = job.results.map((r) => ({
                    id: `${r.usn}_summary`,
                    usn: r.usn,
                    exam: r.exam || '',
                    student: {
                        name: r.name || r.student?.name || '',
                        srn: r.usn,
                        department: r.department || r.student?.department || '',
                        semester: r.semester || r.student?.semester || '',
                    },
                    summary: {
                        sgpa: r.sgpa || r.summary?.sgpa || '0',
                        cgpa: r.cgpa || r.summary?.cgpa || '0',
                        creditsRegistered: r.summary?.creditsRegistered || '0',
                        creditsEarned: r.summary?.creditsEarned || '0',
                    },
                    courses: Array.isArray(r.courses) ? r.courses : [],
                    scrapedAt: job.updatedAt || job.createdAt,
                }));
            }
        } else if (options.usn) {
            const queryUsn = options.usn.trim().toUpperCase();
            records = await this.resultsRepo.getResultsByUsn(queryUsn);
            if (!records || records.length === 0) {
                throw new StudentNotFoundError(`No saved results found for USN '${queryUsn}'`, { usn: queryUsn });
            }
            contextMeta.source = 'single_student';
            contextMeta.usn = queryUsn;
        } else {
            // General query with optional filters
            const filterParams = {
                ...options,
                limit: 'all',
            };
            const queryResult = await this.resultsRepo.getAllResults(filterParams);
            records = queryResult.results || [];
            contextMeta.source = 'filtered_query';
            contextMeta.filters = {
                semester: options.semester || null,
                department: options.department || null,
                status: options.status || null,
                exam: options.exam || null,
            };
        }

        // Natural sort records by USN in ascending order (e.g. 1GA23IS001 -> 1GA23IS080)
        records.sort((a, b) => {
            const usnA = (a.usn || '').toString().toUpperCase();
            const usnB = (b.usn || '').toString().toUpperCase();
            return usnA.localeCompare(usnB, undefined, { numeric: true, sensitivity: 'base' });
        });

        return { records, meta: contextMeta };
    }

    /**
     * Serializes records into a clean JSON string or formatted JSON envelope.
     * 
     * @param {any[]} records
     * @param {object} meta
     * @returns {string} JSON string
     */
    generateJson(records, meta = {}) {
        const payload = {
            success: true,
            meta: {
                exportedAt: new Date().toISOString(),
                totalStudents: records.length,
                ...meta,
            },
            data: records,
        };
        return JSON.stringify(payload, null, 2);
    }

    /**
     * Converts records into RFC 4180 compliant CSV format.
     * Generates comprehensive row entries flattened at course-level, with summary fallback.
     * 
     * @param {any[]} records
     * @param {object} [options={}]
     * @param {'detailed'|'summary'} [options.type='detailed']
     * @returns {string} CSV text
     */
    generateCsv(records, options = {}) {
        const type = options.type || 'detailed';

        if (type === 'summary') {
            const headers = [
                'USN',
                'Student Name',
                'Semester',
                'Department',
                'Exam Title',
                'SGPA',
                'CGPA',
                'Credits Registered',
                'Credits Earned',
                'Status',
                'Total Courses',
                'Scraped At',
            ];

            const rows = [headers.map(escapeCsvField).join(',')];

            for (const r of records) {
                const passed = isPassingResult(r);
                const row = [
                    r.usn || '',
                    r.student?.name || '',
                    r.student?.semester || '',
                    r.student?.department || '',
                    r.exam || '',
                    r.summary?.sgpa || '0',
                    r.summary?.cgpa || '0',
                    r.summary?.creditsRegistered || '0',
                    r.summary?.creditsEarned || '0',
                    passed ? 'PASS' : 'FAIL',
                    (r.courses || []).length,
                    r.scrapedAt || '',
                ];
                rows.push(row.map(escapeCsvField).join(','));
            }

            return rows.join('\r\n');
        }

        // Option 2: Grouped / Master-Detail Hierarchy CSV
        const headers = [
            'USN',
            'Student Name',
            'Semester',
            'Course Code',
            'Course Name',
            'CIE',
            'SEE',
            'Total Marks',
            'Grade',
            'Credits',
            'SGPA',
            'CGPA',
            'Status',
        ];

        const rows = [headers.map(escapeCsvField).join(',')];

        for (const r of records) {
            const passed = isPassingResult(r);
            const courses = Array.isArray(r.courses) && r.courses.length > 0 ? r.courses : [null];

            courses.forEach((c, idx) => {
                const isFirstCourse = idx === 0;
                const credits = c ? (c['CREDITS EARNED'] || c.creditsEarned || c['CREDITS REG.'] || c.creditsReg || c.credits || '') : '';
                const row = [
                    isFirstCourse ? (r.usn || '') : '',
                    isFirstCourse ? (r.student?.name || '') : '',
                    isFirstCourse ? (r.student?.semester || '') : '',
                    c ? (c['COURSE CODE'] || c.courseCode || c.code || '') : 'N/A',
                    c ? (c['COURSE NAME'] || c.courseName || c.name || '') : 'No course records found',
                    c ? (c['CIE'] || c.cie || '') : '',
                    c ? (c['SEE'] || c.see || '') : '',
                    c ? (c['TOTAL'] || c.total || '') : '',
                    c ? (c['GRADE'] || c.grade || '').trim().toUpperCase() : '',
                    credits,
                    isFirstCourse ? (r.summary?.sgpa || '0') : '',
                    isFirstCourse ? (r.summary?.cgpa || '0') : '',
                    isFirstCourse ? (passed ? 'PASS' : 'FAIL') : '',
                ];
                rows.push(row.map(escapeCsvField).join(','));
            });
        }

        return rows.join('\r\n');
    }

    /**
     * Builds a formatted, multi-tab Excel workbook using ExcelJS.
     * - Tab 1: Option 2 Grouped / Master-Detail Course Results (with merged cells & clear student dividers)
     * - Tab 2: Student Summaries (compact 1-row-per-student roster)
     * - Tab 3: Performance Analytics (pass rates, SGPA stats, toppers)
     * 
     * @param {any[]} records
     * @param {object} [meta={}]
     * @returns {Promise<Buffer>} Excel file buffer
     */
    /**
     * Builds a formatted, multi-tab Excel workbook using ExcelJS.
     * - Tab 1: Exact Batch Result Sheet (matching VTU/GAT college template with dynamic core & open electives)
     * - Tab 2: Grouped Master-Detail Course Results
     * - Tab 3: Student Summaries (compact cohort roster)
     * - Tab 4: Performance Analytics
     * 
     * @param {any[]} records
     * @param {object} [meta={}]
     * @returns {Promise<Buffer>} Excel file buffer
     */
    async generateExcel(records, meta = {}) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'GLOBAL ACADEMY OF TECHNOLOGY - Result Extractor';
        workbook.created = new Date();

        // -------------------------------------------------------------
        // 1. EXTRACT AND ORDER ALL UNIQUE COURSES ACROSS THE COHORT
        // -------------------------------------------------------------
        const courseMap = new Map();
        const courseStudentCounts = new Map();

        // Detect department and semester context from records
        const firstStudent = records[0] || {};
        const department = firstStudent.student?.department || meta.department || 'Information Science & Engineering';
        const semester = firstStudent.student?.semester || meta.semester || '';
        const examName = firstStudent.exam || meta.exam || '';

        // Count course occurrences
        for (const r of records) {
            for (const c of (r.courses || [])) {
                const rawCode = (c['COURSE CODE'] || c.courseCode || c.code || '').trim();
                const rawName = (c['COURSE NAME'] || c.courseName || c.name || '').trim();
                if (!rawCode) continue;

                const normCode = rawCode.toUpperCase();
                courseStudentCounts.set(normCode, (courseStudentCounts.get(normCode) || 0) + 1);

                if (!courseMap.has(normCode)) {
                    courseMap.set(normCode, {
                        code: rawCode,
                        name: rawName || rawCode,
                        credits: parseFloat(c['CREDITS REG.'] || c.creditsReg || c.credits || 0) || 0,
                    });
                }
            }
        }

        // -------------------------------------------------------------
        // DYNAMIC COURSE CLASSIFICATION & ORDERING
        // Works universally for ANY department, semester, scheme, or subjects.
        // Group 1: Core / Common courses (taken by majority of cohort >= 40%)
        // Group 2: Program / Track Electives (medium cohort distribution 15% - 40%)
        // Group 3: Open Electives & Minor options (diverse individual choices < 15%)
        // Inside each group, courses are sorted naturally by Course Code.
        // Non-credit courses (credits === 0) are placed cleanly after regular credit courses.
        // -------------------------------------------------------------
        const cohortSize = Math.max(1, records.length);
        const courses = Array.from(courseMap.values()).sort((a, b) => {
            const codeA = a.code.toUpperCase();
            const codeB = b.code.toUpperCase();
            const countA = courseStudentCounts.get(codeA) || 0;
            const countB = courseStudentCounts.get(codeB) || 0;
            const ratioA = countA / cohortSize;
            const ratioB = countB / cohortSize;

            const isCreditA = (a.credits || 0) > 0;
            const isCreditB = (b.credits || 0) > 0;

            // Priority tier:
            // Tier 1: Core courses (ratio >= 0.40)
            // Tier 2: Mid-cohort electives (0.15 <= ratio < 0.40)
            // Tier 3: Open electives / low-enrollment courses (ratio < 0.15)
            const getTier = (ratio, isCredit) => {
                if (ratio >= 0.40) return 1; // Core
                if (ratio >= 0.15) return 2; // Track / Professional Elective
                return 3; // Open Elective
            };

            const tierA = getTier(ratioA, isCreditA);
            const tierB = getTier(ratioB, isCreditB);

            if (tierA !== tierB) {
                return tierA - tierB;
            }

            // Within same tier, credit courses appear before 0-credit audit courses
            if (isCreditA && !isCreditB) return -1;
            if (!isCreditA && isCreditB) return 1;

            // Finally, natural alphanumeric sort by course code
            return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
        });

        // -------------------------------------------------------------
        // SHEET 1: EXACT UNIVERSITY RESULT SHEET TEMPLATE
        // -------------------------------------------------------------
        const semTitle = semester ? `${semester}TH SEM` : 'RESULT';
        const batchSheet = workbook.addWorksheet(`${semTitle} RESULT SHEET`, {
            views: [{ state: 'frozen', xSplit: 3, ySplit: 8 }],
        });

        const totalCourses = courses.length;
        const totalCols = 3 + (totalCourses * 6) + 7;

        // Banner Rows 1-5
        const titleRow1 = batchSheet.getRow(1);
        titleRow1.height = 30;
        batchSheet.mergeCells(1, 1, 1, totalCols);
        const cell1 = batchSheet.getCell(1, 1);
        cell1.value = 'GLOBAL ACADEMY OF TECHNOLOGY';
        cell1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF0F172A' } };
        cell1.alignment = { vertical: 'middle', horizontal: 'center' };

        const titleRow2 = batchSheet.getRow(2);
        titleRow2.height = 28;
        batchSheet.mergeCells(2, 1, 2, totalCols);
        const cell2 = batchSheet.getCell(2, 1);
        cell2.value = 'Ideal Homes Township, Rajarajeshwari Nagar, Bengaluru – 560 098\nTel: +91 80 28603158 (Ext - 700), Email: hodise@gat.ac.in Web: www.gat.ac.in';
        cell2.font = { name: 'Calibri', size: 9, color: { argb: 'FF334155' } };
        cell2.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

        const titleRow3 = batchSheet.getRow(3);
        titleRow3.height = 24;
        batchSheet.mergeCells(3, 1, 3, totalCols);
        const cell3 = batchSheet.getCell(3, 1);
        cell3.value = `Department of ${department}`;
        cell3.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
        cell3.alignment = { vertical: 'middle', horizontal: 'center' };

        // Batch year estimation
        const batchMatch = (firstStudent.usn || '').match(/1GA(\d\d)/i);
        const batchYear = batchMatch ? `20${batchMatch[1]}` : '';
        const titleRow4 = batchSheet.getRow(4);
        titleRow4.height = 24;
        batchSheet.mergeCells(4, 1, 4, totalCols);
        const cell4 = batchSheet.getCell(4, 1);
        cell4.value = `${batchYear ? `${batchYear} BATCH ` : ''}${semester ? `${semester}TH SEMESTER ` : ''}RESULT SHEET ${examName ? `(${examName})` : ''}`.trim();
        cell4.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
        cell4.alignment = { vertical: 'middle', horizontal: 'center' };

        const titleRow5 = batchSheet.getRow(5);
        titleRow5.height = 20;
        const cell5 = batchSheet.getCell(5, 1);
        cell5.value = 'SECTION: ALL';
        cell5.font = { name: 'Calibri', size: 10, bold: true };
        cell5.alignment = { vertical: 'middle', horizontal: 'left' };

        // Row 6, 7, 8: Multi-tier headers
        batchSheet.getRow(6).height = 26;
        batchSheet.getRow(7).height = 48; // wrap text for course name
        batchSheet.getRow(8).height = 22; // subheaders CIE, SEE, etc.

        // Merge SI.No, USN, NAME across Rows 6-8
        batchSheet.mergeCells(6, 1, 8, 1);
        const slHeader = batchSheet.getCell(6, 1);
        slHeader.value = 'SI.No';
        slHeader.font = { name: 'Calibri', size: 10, bold: true };
        slHeader.alignment = { vertical: 'middle', horizontal: 'center' };
        slHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        batchSheet.mergeCells(6, 2, 8, 2);
        const usnHeader = batchSheet.getCell(6, 2);
        usnHeader.value = 'USN';
        usnHeader.font = { name: 'Calibri', size: 10, bold: true };
        usnHeader.alignment = { vertical: 'middle', horizontal: 'center' };
        usnHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        batchSheet.mergeCells(6, 3, 8, 3);
        const nameHeader = batchSheet.getCell(6, 3);
        nameHeader.value = 'NAME';
        nameHeader.font = { name: 'Calibri', size: 10, bold: true };
        nameHeader.alignment = { vertical: 'middle', horizontal: 'center' };
        nameHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        // Set column widths for fixed columns
        batchSheet.getColumn(1).width = 8;
        batchSheet.getColumn(2).width = 16;
        batchSheet.getColumn(3).width = 32;

        // Populate course headers across columns
        courses.forEach((crs, cIdx) => {
            const startCol = 4 + (cIdx * 6);
            const endCol = startCol + 5;

            // Row 6: Course Code (merged 6 cols wide)
            batchSheet.mergeCells(6, startCol, 6, endCol);
            const codeCell = batchSheet.getCell(6, startCol);
            codeCell.value = crs.code;
            codeCell.font = { name: 'Calibri', size: 10, bold: true };
            codeCell.alignment = { vertical: 'middle', horizontal: 'center' };
            codeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

            // Row 7: Course Name (merged 6 cols wide)
            batchSheet.mergeCells(7, startCol, 7, endCol);
            const nameCell = batchSheet.getCell(7, startCol);
            nameCell.value = crs.name;
            nameCell.font = { name: 'Calibri', size: 9, bold: true };
            nameCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

            // Row 8: Subheaders (CIE, SEE, TOTAL, CR, CRE, GRADE)
            const subheaders = ['CIE', 'SEE', 'TOTAL', 'CR', 'CRE', 'GRADE'];
            subheaders.forEach((sub, sIdx) => {
                const subCol = startCol + sIdx;
                const subCell = batchSheet.getCell(8, subCol);
                subCell.value = sub;
                subCell.font = { name: 'Calibri', size: 9, bold: true };
                subCell.alignment = { vertical: 'middle', horizontal: 'center' };
                subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

                // Column width
                batchSheet.getColumn(subCol).width = sub === 'GRADE' || sub === 'TOTAL' ? 8 : (sub === 'CR' || sub === 'CRE' ? 6 : 7);
            });
        });

        // Summary Column Headers at the end
        const summaryStartCol = 4 + (totalCourses * 6);
        const summaryHeaders = [
            'CRDT REG IN CRNT SEM',
            'CRDT ACQ IN CRNT SEM',
            'SGPA',
            'CGPA',
            'TOTAL',
            'PERCENTAGE',
            'RESULT',
        ];

        summaryHeaders.forEach((sh, shIdx) => {
            const shCol = summaryStartCol + shIdx;
            batchSheet.mergeCells(6, shCol, 8, shCol);
            const shCell = batchSheet.getCell(6, shCol);
            shCell.value = sh;
            shCell.font = { name: 'Calibri', size: 9, bold: true };
            shCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            shCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

            batchSheet.getColumn(shCol).width = sh === 'PERCENTAGE' ? 12 : (sh === 'RESULT' || sh.includes('CRDT') ? 11 : 9);
        });

        // Border helper
        const thinBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };

        // Apply borders to header cells (rows 6 to 8)
        for (let r = 6; r <= 8; r++) {
            for (let c = 1; c <= totalCols; c++) {
                batchSheet.getCell(r, c).border = thinBorder;
            }
        }

        // -------------------------------------------------------------
        // STUDENT DATA ROWS (ROW 9 ONWARDS)
        // -------------------------------------------------------------
        let studentStartRow = 9;
        let appearedCount = 0;
        let passCount = 0;
        let failCount = 0;
        let fcdCount = 0;
        let fcCount = 0;
        let scCount = 0;
        let absentCount = 0;

        records.forEach((studentRec, sIdx) => {
            const rowNum = studentStartRow + sIdx;
            const rowObj = batchSheet.getRow(rowNum);
            rowObj.height = 20;

            const usn = studentRec.usn || studentRec.student?.srn || '';
            const studentName = (studentRec.student?.name || '').toUpperCase();
            const studentCourses = studentRec.courses || [];

            // Map student courses by uppercase code
            const studentCourseMap = new Map();
            studentCourses.forEach((c) => {
                const cCode = (c['COURSE CODE'] || c.courseCode || c.code || '').trim().toUpperCase();
                if (cCode) studentCourseMap.set(cCode, c);
            });

            // Sl.No, USN, Name
            batchSheet.getCell(rowNum, 1).value = sIdx + 1;
            batchSheet.getCell(rowNum, 1).alignment = { vertical: 'middle', horizontal: 'center' };

            batchSheet.getCell(rowNum, 2).value = usn;
            batchSheet.getCell(rowNum, 2).font = { name: 'Calibri', size: 10, bold: true };
            batchSheet.getCell(rowNum, 2).alignment = { vertical: 'middle', horizontal: 'center' };

            batchSheet.getCell(rowNum, 3).value = studentName;
            batchSheet.getCell(rowNum, 3).alignment = { vertical: 'middle', horizontal: 'left' };

            let studentMarksSum = 0;
            let studentMaxMarks = 0;
            let hasAnyCourse = false;
            let hasFailGrade = false;
            let isAbsent = false;

            // Fill course marks
            courses.forEach((crs, cIdx) => {
                const startCol = 4 + (cIdx * 6);
                const normCrsCode = crs.code.toUpperCase();
                const studentCrs = studentCourseMap.get(normCrsCode);

                if (studentCrs) {
                    hasAnyCourse = true;
                    const cie = studentCrs['CIE'] !== undefined && studentCrs['CIE'] !== '' ? Number(studentCrs['CIE']) || studentCrs['CIE'] : '';
                    const see = studentCrs['SEE'] !== undefined && studentCrs['SEE'] !== '' ? Number(studentCrs['SEE']) || studentCrs['SEE'] : '';
                    const totalMarks = studentCrs['TOTAL'] !== undefined && studentCrs['TOTAL'] !== '' ? Number(studentCrs['TOTAL']) || studentCrs['TOTAL'] : '';
                    const cr = studentCrs['CREDITS REG.'] !== undefined ? studentCrs['CREDITS REG.'] : (studentCrs['CREDITS'] || crs.credits || '');
                    const cre = studentCrs['CREDITS EARNED'] !== undefined ? studentCrs['CREDITS EARNED'] : (studentCrs.creditsEarned || '');
                    const grade = (studentCrs['GRADE'] || studentCrs.grade || '').trim().toUpperCase();

                    if (typeof totalMarks === 'number' && !isNaN(totalMarks)) {
                        studentMarksSum += totalMarks;
                        studentMaxMarks += 100;
                    }

                    if (['F', 'FAIL', 'FL', 'AB', 'ABSENT', 'NE', 'X', 'I'].includes(grade)) {
                        hasFailGrade = true;
                    }
                    if (grade === 'AB' || grade === 'ABSENT' || grade === 'X') {
                        isAbsent = true;
                    }

                    batchSheet.getCell(rowNum, startCol + 0).value = cie;
                    batchSheet.getCell(rowNum, startCol + 1).value = see;
                    batchSheet.getCell(rowNum, startCol + 2).value = totalMarks;
                    batchSheet.getCell(rowNum, startCol + 3).value = cr !== '' ? Number(cr) || cr : '';
                    batchSheet.getCell(rowNum, startCol + 4).value = cre !== '' ? Number(cre) || cre : '';
                    batchSheet.getCell(rowNum, startCol + 5).value = grade;

                    for (let sc = 0; sc < 6; sc++) {
                        const cell = batchSheet.getCell(rowNum, startCol + sc);
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    }

                    // Highlight fail grade
                    if (['F', 'FAIL', 'FL', 'AB', 'ABSENT', 'NE', 'X', 'I'].includes(grade)) {
                        const grCell = batchSheet.getCell(rowNum, startCol + 5);
                        grCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } };
                        grCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                    }
                } else {
                    // Open elective or PE not taken by this student -> EMPTY CELLS
                    for (let sc = 0; sc < 6; sc++) {
                        const cell = batchSheet.getCell(rowNum, startCol + sc);
                        cell.value = '';
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    }
                }
            });

            if (hasAnyCourse) appearedCount++;
            if (isAbsent) absentCount++;

            // Summary metrics
            const creditsReg = parseFloat(studentRec.summary?.creditsRegistered || '0') || '';
            const creditsEarned = parseFloat(studentRec.summary?.creditsEarned || '0') || '';
            const sgpa = parseFloat(studentRec.summary?.sgpa || '0') || (studentRec.summary?.sgpa || '');
            const cgpa = parseFloat(studentRec.summary?.cgpa || '0') || (studentRec.summary?.cgpa || '');

            const totalScore = studentMarksSum > 0 ? studentMarksSum : '';
            const percentage = studentMaxMarks > 0 ? Number(((studentMarksSum / studentMaxMarks) * 100).toFixed(2)) : '';

            // Result determination
            let resultClass = 'PASS';
            if (hasFailGrade || (typeof sgpa === 'number' && sgpa === 0)) {
                resultClass = 'F';
                failCount++;
            } else {
                passCount++;
                const effectiveSgpa = typeof sgpa === 'number' ? sgpa : 0;
                const effectivePct = typeof percentage === 'number' ? percentage : 0;

                if (effectiveSgpa >= 7.75 || effectivePct >= 70) {
                    resultClass = 'FCD';
                    fcdCount++;
                } else if (effectiveSgpa >= 6.75 || effectivePct >= 60) {
                    resultClass = 'FC';
                    fcCount++;
                } else if (effectiveSgpa >= 5.75 || effectivePct >= 50) {
                    resultClass = 'SC';
                    scCount++;
                }
            }

            // Write summary values
            batchSheet.getCell(rowNum, summaryStartCol + 0).value = creditsReg;
            batchSheet.getCell(rowNum, summaryStartCol + 1).value = creditsEarned;
            batchSheet.getCell(rowNum, summaryStartCol + 2).value = sgpa;
            batchSheet.getCell(rowNum, summaryStartCol + 3).value = cgpa;
            batchSheet.getCell(rowNum, summaryStartCol + 4).value = totalScore;
            batchSheet.getCell(rowNum, summaryStartCol + 5).value = percentage;
            batchSheet.getCell(rowNum, summaryStartCol + 6).value = resultClass;

            for (let sc = 0; sc < 7; sc++) {
                const cell = batchSheet.getCell(rowNum, summaryStartCol + sc);
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            }

            // Result class styling
            const resCell = batchSheet.getCell(rowNum, summaryStartCol + 6);
            if (resultClass === 'FCD') {
                resCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF15803D' } };
                resCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
            } else if (resultClass === 'FC') {
                resCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
                resCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            } else if (resultClass === 'SC') {
                resCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB45309' } };
                resCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            } else if (resultClass === 'F') {
                resCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
                resCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            }

            // Apply borders across whole row
            for (let c = 1; c <= totalCols; c++) {
                batchSheet.getCell(rowNum, c).border = thinBorder;
            }
        });

        // -------------------------------------------------------------
        // BOTTOM STATISTICS & COURSE CATALOG BLOCK
        // -------------------------------------------------------------
        const statsStartRow = studentStartRow + records.length + 2;
        const totalStudents = records.length;
        const passPercentage = appearedCount > 0 ? ((passCount / appearedCount) * 100).toFixed(2) : '0.00';

        const statsItems = [
            { label: 'TOTAL NO OF STUDENTS', val: totalStudents },
            { label: 'NO OF STUDENTS APPEARED', val: appearedCount },
            { label: 'TOTAL PASS', val: passCount },
            { label: 'FCD', val: fcdCount },
            { label: 'FC', val: fcCount },
            { label: 'SC', val: scCount },
            { label: 'F', val: failCount },
            { label: 'NE', val: 0 },
            { label: 'X(AB)', val: absentCount },
            { label: 'PASS %', val: Number(passPercentage) },
        ];

        // Header for subject legend on the right
        batchSheet.mergeCells(statsStartRow, 9, statsStartRow, 11);
        batchSheet.getCell(statsStartRow, 9).value = 'SUBJECT CODE';
        batchSheet.getCell(statsStartRow, 9).font = { name: 'Calibri', size: 10, bold: true };
        batchSheet.getCell(statsStartRow, 9).alignment = { vertical: 'middle', horizontal: 'center' };

        batchSheet.mergeCells(statsStartRow, 13, statsStartRow, 20);
        batchSheet.getCell(statsStartRow, 13).value = 'SUBJECT NAME';
        batchSheet.getCell(statsStartRow, 13).font = { name: 'Calibri', size: 10, bold: true };
        batchSheet.getCell(statsStartRow, 13).alignment = { vertical: 'middle', horizontal: 'left' };

        const maxStatsRows = Math.max(statsItems.length, courses.length);
        for (let i = 0; i < maxStatsRows; i++) {
            const curRow = statsStartRow + 1 + i;
            batchSheet.getRow(curRow).height = 19;

            // Stats metrics on the left (Cols B to F)
            if (i < statsItems.length) {
                batchSheet.mergeCells(curRow, 2, curRow, 5);
                const lblCell = batchSheet.getCell(curRow, 2);
                lblCell.value = statsItems[i].label;
                lblCell.font = { name: 'Calibri', size: 10, bold: true };
                lblCell.alignment = { vertical: 'middle', horizontal: 'left' };

                const valCell = batchSheet.getCell(curRow, 6);
                valCell.value = statsItems[i].val;
                valCell.font = { name: 'Calibri', size: 10, bold: true };
                valCell.alignment = { vertical: 'middle', horizontal: 'center' };
                valCell.border = thinBorder;
            }

            // Subject catalog on the right (Cols I and M)
            if (i < courses.length) {
                batchSheet.mergeCells(curRow, 9, curRow, 11);
                const sCode = batchSheet.getCell(curRow, 9);
                sCode.value = courses[i].code;
                sCode.font = { name: 'Calibri', size: 9, bold: true };
                sCode.alignment = { vertical: 'middle', horizontal: 'center' };

                batchSheet.mergeCells(curRow, 13, curRow, 20);
                const sName = batchSheet.getCell(curRow, 13);
                sName.value = courses[i].name;
                sName.font = { name: 'Calibri', size: 9 };
                sName.alignment = { vertical: 'middle', horizontal: 'left' };
            }
        }

        // -------------------------------------------------------------
        // SHEET 2: Grouped Master-Detail Course Results
        // -------------------------------------------------------------
        const courseSheet = workbook.addWorksheet('Detailed Course Results', {
            views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
        });

        courseSheet.columns = [
            { header: 'USN', key: 'usn', width: 16 },
            { header: 'Student Name', key: 'name', width: 28 },
            { header: 'Semester', key: 'semester', width: 12 },
            { header: 'Course Code', key: 'courseCode', width: 16 },
            { header: 'Course Name', key: 'courseName', width: 38 },
            { header: 'CIE', key: 'cie', width: 10 },
            { header: 'SEE', key: 'see', width: 10 },
            { header: 'Total Marks', key: 'total', width: 12 },
            { header: 'Grade', key: 'grade', width: 10 },
            { header: 'Credits', key: 'credits', width: 10 },
            { header: 'SGPA', key: 'sgpa', width: 11 },
            { header: 'CGPA', key: 'cgpa', width: 11 },
            { header: 'Status', key: 'status', width: 13 },
        ];

        const headerRow1 = courseSheet.getRow(1);
        headerRow1.height = 28;
        headerRow1.eachCell((cell) => {
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        records.forEach((r, studentIdx) => {
            const passed = isPassingResult(r);
            const sgpaNum = parseFloat(r.summary?.sgpa || '0');
            const studentCourses = Array.isArray(r.courses) && r.courses.length > 0 ? r.courses : [null];
            const startRow = courseSheet.rowCount + 1;

            studentCourses.forEach((c, idx) => {
                const isFirstCourse = idx === 0;
                const grade = c ? (c['GRADE'] || c.grade || '').trim().toUpperCase() : '-';
                const isFailGrade = ['F', 'FAIL', 'AB', 'ABSENT', 'NE'].includes(grade);
                const credits = c ? (c['CREDITS EARNED'] || c.creditsEarned || c['CREDITS REG.'] || c.creditsReg || c.credits || '') : '';

                const row = courseSheet.addRow({
                    usn: isFirstCourse ? (r.usn || '') : '',
                    name: isFirstCourse ? (r.student?.name || '') : '',
                    semester: isFirstCourse ? (r.student?.semester || '') : '',
                    courseCode: c ? (c['COURSE CODE'] || c.courseCode || c.code || '') : 'N/A',
                    courseName: c ? (c['COURSE NAME'] || c.courseName || c.name || '') : 'No course records found',
                    cie: c ? (c['CIE'] || c.cie || '') : '',
                    see: c ? (c['SEE'] || c.see || '') : '',
                    total: c ? (c['TOTAL'] || c.total || '') : '',
                    grade: grade,
                    credits: credits,
                    sgpa: isFirstCourse ? (sgpaNum > 0 ? sgpaNum : (r.summary?.sgpa || '0')) : '',
                    cgpa: isFirstCourse ? (parseFloat(r.summary?.cgpa || '0') || (r.summary?.cgpa || '0')) : '',
                    status: isFirstCourse ? (passed ? 'PASS' : 'FAIL') : '',
                });

                row.height = 19;
                const isEven = studentIdx % 2 === 0;

                row.eachCell((cell, colNumber) => {
                    cell.font = { name: 'Calibri', size: 10 };
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: colNumber === 2 || colNumber === 5 ? 'left' : 'center',
                    };

                    if (isEven) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                    }

                    if (colNumber === 9 && isFailGrade) {
                        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                    }

                    if (colNumber === 13 && isFirstCourse) {
                        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: passed ? 'FF15803D' : 'FFB91C1C' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: passed ? 'FFDCFCE7' : 'FFFEE2E2' } };
                    }
                });
            });

            const endRow = courseSheet.rowCount;
            if (endRow > startRow) {
                try {
                    courseSheet.mergeCells(startRow, 1, endRow, 1);
                    courseSheet.mergeCells(startRow, 2, endRow, 2);
                    courseSheet.mergeCells(startRow, 3, endRow, 3);
                    courseSheet.mergeCells(startRow, 11, endRow, 11);
                    courseSheet.mergeCells(startRow, 12, endRow, 12);
                    courseSheet.mergeCells(startRow, 13, endRow, 13);
                } catch (_) {}
            }
        });

        // -------------------------------------------------------------
        // SHEET 3: Student Summaries (Cohort Roster)
        // -------------------------------------------------------------
        const summarySheet = workbook.addWorksheet('Student Summaries', {
            views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
        });

        summarySheet.columns = [
            { header: 'USN', key: 'usn', width: 16 },
            { header: 'Student Name', key: 'name', width: 30 },
            { header: 'Semester', key: 'semester', width: 12 },
            { header: 'Department', key: 'department', width: 26 },
            { header: 'Exam Title', key: 'exam', width: 32 },
            { header: 'SGPA', key: 'sgpa', width: 12 },
            { header: 'CGPA', key: 'cgpa', width: 12 },
            { header: 'Credits Reg.', key: 'creditsReg', width: 14 },
            { header: 'Credits Earned', key: 'creditsEarned', width: 14 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Courses Count', key: 'coursesCount', width: 14 },
            { header: 'Scraped At', key: 'scrapedAt', width: 22 },
        ];

        const headerRow2 = summarySheet.getRow(1);
        headerRow2.height = 28;
        headerRow2.eachCell((cell) => {
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        records.forEach((r, idx) => {
            const passed = isPassingResult(r);
            const sgpaNum = parseFloat(r.summary?.sgpa || '0');

            const row = summarySheet.addRow({
                usn: r.usn || '',
                name: r.student?.name || '',
                semester: r.student?.semester || '',
                department: r.student?.department || '',
                exam: r.exam || '',
                sgpa: sgpaNum > 0 ? sgpaNum : (r.summary?.sgpa || '0'),
                cgpa: parseFloat(r.summary?.cgpa || '0') || (r.summary?.cgpa || '0'),
                creditsReg: parseFloat(r.summary?.creditsRegistered || '0'),
                creditsEarned: parseFloat(r.summary?.creditsEarned || '0'),
                status: passed ? 'PASS' : 'FAIL',
                coursesCount: (r.courses || []).length,
                scrapedAt: r.scrapedAt ? new Date(r.scrapedAt).toLocaleString() : '',
            });

            row.height = 20;
            const isEven = idx % 2 === 0;

            row.eachCell((cell, colNumber) => {
                cell.font = { name: 'Calibri', size: 10 };
                cell.alignment = { vertical: 'middle', horizontal: colNumber === 2 || colNumber === 4 || colNumber === 5 ? 'left' : 'center' };

                if (isEven) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                }

                if (colNumber === 10) {
                    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: passed ? 'FF15803D' : 'FFB91C1C' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: passed ? 'FFDCFCE7' : 'FFFEE2E2' } };
                }
            });
        });

        // -------------------------------------------------------------
        // SHEET 4: Performance Analytics & Metadata
        // -------------------------------------------------------------
        const analyticsSheet = workbook.addWorksheet('Analytics Overview');
        analyticsSheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 35 },
        ];

        const headerRow3 = analyticsSheet.getRow(1);
        headerRow3.height = 26;
        headerRow3.eachCell((cell) => {
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
        });

        const statsData = [
            { metric: 'Total Scraped Records', value: totalStudents },
            { metric: 'Students Appeared', value: appearedCount },
            { metric: 'Successful Passes', value: `${passCount} (${passPercentage}%)` },
            { metric: 'First Class with Distinction (FCD)', value: fcdCount },
            { metric: 'First Class (FC)', value: fcCount },
            { metric: 'Second Class (SC)', value: scCount },
            { metric: 'Failures / Backlogs', value: failCount },
            { metric: 'Export Timestamp', value: new Date().toISOString() },
            { metric: 'Export Scope', value: meta.source || 'General query' },
        ];

        if (meta.jobId) statsData.push({ metric: 'Associated Job ID', value: meta.jobId });
        if (meta.fromUsn && meta.toUsn) statsData.push({ metric: 'USN Range Scraped', value: `${meta.fromUsn} → ${meta.toUsn}` });

        statsData.forEach((item) => {
            const row = analyticsSheet.addRow(item);
            row.height = 20;
            row.getCell(1).font = { bold: true };
        });

        return await workbook.xlsx.writeBuffer();
    }

    /**
     * Unified export execution handler returning binary or text payload, content type, and filename.
     * 
     * @param {object} options
     * @param {'json'|'excel'|'xlsx'|'csv'} [options.format='json'] Target export format
     * @param {string} [options.jobId]
     * @param {string} [options.usn]
     * @param {string} [options.csvType='detailed'] 'detailed' or 'summary'
     * @returns {Promise<{ data: Buffer|string, contentType: string, filename: string }>}
     */
    async exportData(options = {}) {
        const rawFormat = (options.format || 'json').toString().toLowerCase().trim();
        const validFormats = ['json', 'excel', 'xlsx', 'csv'];

        if (!validFormats.includes(rawFormat)) {
            throw new ValidationError(
                `Unsupported export format '${rawFormat}'. Permitted formats: json, excel, xlsx, csv.`,
                { format: rawFormat, supported: validFormats }
            );
        }

        const { records, meta } = await this.fetchExportRecords(options);
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        let prefix = 'results';
        if (options.usn) prefix = `result_${options.usn.toUpperCase()}`;
        else if (options.jobId) prefix = `job_${options.jobId}`;

        if (rawFormat === 'json') {
            const jsonText = this.generateJson(records, meta);
            return {
                data: jsonText,
                contentType: 'application/json',
                filename: `${prefix}_export_${dateStr}.json`,
            };
        }

        if (rawFormat === 'csv') {
            const csvText = this.generateCsv(records, { type: options.csvType || 'detailed' });
            return {
                data: csvText,
                contentType: 'text/csv; charset=utf-8',
                filename: `${prefix}_export_${dateStr}.csv`,
            };
        }

        if (rawFormat === 'excel' || rawFormat === 'xlsx') {
            const buffer = await this.generateExcel(records, meta);
            return {
                data: buffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename: `${prefix}_export_${dateStr}.xlsx`,
            };
        }

        throw new ValidationError(`Unknown format ${rawFormat}`);
    }
}

export const exportService = new ExportService();
