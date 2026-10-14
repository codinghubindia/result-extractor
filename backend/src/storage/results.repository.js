import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AtomicJsonFile } from './atomicFile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RESULTS_PATH = path.resolve(__dirname, '../../data/results.json');

/**
 * Extracts numeric semester from department string or exam title if not present.
 * e.g. "B.E. - IS,Semester 5" -> "5"
 * @param {string} [department=""]
 * @param {string} [exam=""]
 * @returns {string}
 */
export function extractSemester(department = '', exam = '') {
    const semRegex = /(?:Semester|Sem|SEM)[\s:-]*([0-9]+)/i;
    const matchDept = (department || '').match(semRegex);
    if (matchDept && matchDept[1]) {
        return matchDept[1];
    }
    const matchExam = (exam || '').match(semRegex);
    if (matchExam && matchExam[1]) {
        return matchExam[1];
    }
    return '';
}

/**
 * Determines whether a student result has passed all registered courses.
 * Fails if any course has grade F, FAIL, AB, ABSENT, or if SGPA is 0 with registered credits.
 * @param {any} record
 * @returns {boolean}
 */
export function isPassingResult(record) {
    if (!record || !Array.isArray(record.courses)) {
        return false;
    }
    const failGrades = new Set(['F', 'FAIL', 'AB', 'ABSENT', 'NE', 'NP', 'W', 'WITHHELD']);
    for (const course of record.courses) {
        const grade = (course.GRADE || course.grade || '').toString().trim().toUpperCase();
        if (failGrades.has(grade)) {
            return false;
        }
    }
    const rawSgpa = (record.summary?.sgpa || '').toString().trim();
    const sgpa = parseFloat(rawSgpa === '--' || rawSgpa.toUpperCase() === 'N/A' ? '0' : (rawSgpa || '0'));
    const creditsReg = parseFloat(record.summary?.creditsRegistered || '0');
    if (creditsReg > 0 && (Number.isNaN(sgpa) || sgpa === 0)) {
        return false;
    }
    return true;
}

/**
 * Normalizes a raw scraped student result into a standardized ResultRecord.
 * @param {any} raw
 * @returns {any} Normalized ResultRecord
 */
export function normalizeResultRecord(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid result payload: expected an object');
    }

    const usn = (raw.usn || raw.student?.srn || raw.student?.usn || '').toString().trim().toUpperCase();
    const exam = (raw.exam || raw.examName || raw.examId || '').toString().trim();
    const department = (raw.student?.department || '').toString().trim();
    const rawSemester = (raw.student?.semester || '').toString().trim();
    const semester = rawSemester || extractSemester(department, exam);

    const sanitizedExamId = exam ? exam.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) : 'default';
    const recordId = raw.id || (usn ? `${usn}_${sanitizedExamId}` : randomUUID());

    const studentName = (raw.student?.name || raw.name || '').toString().trim();

    const summary = {
        creditsRegistered: (raw.summary?.creditsRegistered ?? '0').toString(),
        creditsEarned: (raw.summary?.creditsEarned ?? '0').toString(),
        sgpa: (raw.summary?.sgpa ?? '0').toString(),
        cgpa: (raw.summary?.cgpa ?? '0').toString(),
    };

    const courses = Array.isArray(raw.courses) ? raw.courses : [];
    const scrapedAt = raw.scrapedAt || raw.timestamp || new Date().toISOString();

    const normalized = {
        id: recordId,
        usn,
        exam,
        student: {
            name: studentName,
            srn: usn,
            department,
            semester,
        },
        summary,
        courses,
        scrapedAt,
        updatedAt: raw.updatedAt || new Date().toISOString(),
    };

    return normalized;
}

/**
 * ResultsRepository manages persistence and querying of scraped student records.
 */
export class ResultsRepository {
    /**
     * @param {string} [filePath] Optional custom file path for storage
     */
    constructor(filePath = DEFAULT_RESULTS_PATH) {
        this.storage = new AtomicJsonFile(filePath, []);
    }

    /**
     * Saves or updates a student result atomically.
     * @param {any} resultData Scraped result object or ResultRecord
     * @returns {Promise<any>} Persisted ResultRecord
     */
    async saveResult(resultData) {
        const record = normalizeResultRecord(resultData);

        await this.storage.mutate((records) => {
            const index = records.findIndex(
                (item) => item.id === record.id || (record.usn && item.usn === record.usn && item.exam === record.exam)
            );

            if (index >= 0) {
                records[index] = {
                    ...records[index],
                    ...record,
                    updatedAt: new Date().toISOString(),
                };
            } else {
                records.push(record);
            }
        });

        return record;
    }

    /**
     * Saves or updates an array of student results in a single atomic disk write.
     * @param {any[]} resultsList
     * @returns {Promise<any[]>} Persisted records
     */
    async saveResultsBatch(resultsList) {
        if (!Array.isArray(resultsList) || resultsList.length === 0) {
            return [];
        }

        const normalizedList = resultsList.map(normalizeResultRecord);

        await this.storage.mutate((records) => {
            for (const record of normalizedList) {
                const index = records.findIndex(
                    (item) => item.id === record.id || (record.usn && item.usn === record.usn && item.exam === record.exam)
                );

                if (index >= 0) {
                    records[index] = {
                        ...records[index],
                        ...record,
                        updatedAt: new Date().toISOString(),
                    };
                } else {
                    records.push(record);
                }
            }
        });

        return normalizedList;
    }

    /**
     * Retrieves the latest saved result for a given USN.
     * @param {string} usn
     * @returns {Promise<any | null>}
     */
    async getResultByUsn(usn) {
        if (!usn) return null;
        const normalizedUsn = usn.toString().trim().toUpperCase();
        const records = await this.storage.read();

        const matches = records.filter((r) => r.usn === normalizedUsn);
        if (matches.length === 0) {
            return null;
        }

        // Return latest record by scrapedAt
        return matches.sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime())[0];
    }

    /**
     * Retrieves all exam results saved for a given USN.
     * @param {string} usn
     * @returns {Promise<any[]>}
     */
    async getResultsByUsn(usn) {
        if (!usn) return [];
        const normalizedUsn = usn.toString().trim().toUpperCase();
        const records = await this.storage.read();
        return records
            .filter((r) => r.usn === normalizedUsn)
            .sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime());
    }

    /**
     * Retrieves a result by unique record ID.
     * @param {string} id
     * @returns {Promise<any | null>}
     */
    async getResultById(id) {
        if (!id) return null;
        const records = await this.storage.read();
        return records.find((r) => r.id === id) || null;
    }

    /**
     * Queries saved student records with rich filtering, searching, sorting, and pagination.
     * 
     * @param {object} [filter={}]
     * @param {string} [filter.usn] USN filter (substring or exact)
     * @param {string} [filter.search] Global text search (USN, student name, department)
     * @param {string} [filter.semester] Semester filter
     * @param {string} [filter.department] Department substring filter
     * @param {string} [filter.exam] Exam title substring filter
     * @param {number|string} [filter.minSgpa] Minimum SGPA
     * @param {number|string} [filter.maxSgpa] Maximum SGPA
     * @param {number|string} [filter.minCgpa] Minimum CGPA
     * @param {number|string} [filter.maxCgpa] Maximum CGPA
     * @param {'PASS'|'FAIL'|'ALL'} [filter.status] Pass/fail filter
     * @param {'scrapedAt'|'usn'|'name'|'sgpa'|'cgpa'|'semester'} [filter.sortBy='scrapedAt'] Sort column
     * @param {'asc'|'desc'} [filter.sortOrder='desc'] Sort direction
     * @param {number} [filter.page=1] 1-indexed page number
     * @param {number|'all'} [filter.limit=50] Page size limit (0 or 'all' for unpaginated)
     * 
     * @returns {Promise<{ results: any[], pagination: { total: number, page: number, limit: number, totalPages: number } }>}
     */
    async getAllResults(filter = {}) {
        const records = await this.storage.read();
        let filtered = [...records];

        // 1. Filter by USN
        if (filter.usn) {
            const queryUsn = filter.usn.toString().trim().toUpperCase();
            filtered = filtered.filter((r) => r.usn && r.usn.includes(queryUsn));
        }

        // 2. Filter by Search Query (USN, Name, Department)
        if (filter.search) {
            const q = filter.search.toString().trim().toLowerCase();
            filtered = filtered.filter((r) => {
                const usnMatch = r.usn && r.usn.toLowerCase().includes(q);
                const nameMatch = r.student?.name && r.student.name.toLowerCase().includes(q);
                const deptMatch = r.student?.department && r.student.department.toLowerCase().includes(q);
                return Boolean(usnMatch || nameMatch || deptMatch);
            });
        }

        // 3. Filter by Semester
        if (filter.semester !== undefined && filter.semester !== null && filter.semester !== '') {
            const semStr = filter.semester.toString().trim();
            filtered = filtered.filter((r) => {
                const recordSem = r.student?.semester || extractSemester(r.student?.department, r.exam);
                return recordSem === semStr;
            });
        }

        // 4. Filter by Department
        if (filter.department) {
            const dept = filter.department.toString().trim().toLowerCase();
            filtered = filtered.filter((r) => r.student?.department && r.student.department.toLowerCase().includes(dept));
        }

        // 5. Filter by Exam
        if (filter.exam) {
            const examQuery = filter.exam.toString().trim().toLowerCase();
            filtered = filtered.filter((r) => r.exam && r.exam.toLowerCase().includes(examQuery));
        }

        // 6. Filter by SGPA range
        if (filter.minSgpa !== undefined && filter.minSgpa !== null && filter.minSgpa !== '') {
            const min = parseFloat(filter.minSgpa);
            if (!Number.isNaN(min)) {
                filtered = filtered.filter((r) => parseFloat(r.summary?.sgpa || '0') >= min);
            }
        }
        if (filter.maxSgpa !== undefined && filter.maxSgpa !== null && filter.maxSgpa !== '') {
            const max = parseFloat(filter.maxSgpa);
            if (!Number.isNaN(max)) {
                filtered = filtered.filter((r) => parseFloat(r.summary?.sgpa || '0') <= max);
            }
        }

        // 7. Filter by CGPA range
        if (filter.minCgpa !== undefined && filter.minCgpa !== null && filter.minCgpa !== '') {
            const min = parseFloat(filter.minCgpa);
            if (!Number.isNaN(min)) {
                filtered = filtered.filter((r) => parseFloat(r.summary?.cgpa || '0') >= min);
            }
        }
        if (filter.maxCgpa !== undefined && filter.maxCgpa !== null && filter.maxCgpa !== '') {
            const max = parseFloat(filter.maxCgpa);
            if (!Number.isNaN(max)) {
                filtered = filtered.filter((r) => parseFloat(r.summary?.cgpa || '0') <= max);
            }
        }

        // 8. Filter by Status (PASS/FAIL)
        if (filter.status && filter.status.toString().toUpperCase() !== 'ALL') {
            const targetStatus = filter.status.toString().toUpperCase();
            filtered = filtered.filter((r) => {
                const passed = isPassingResult(r);
                return targetStatus === 'PASS' ? passed : !passed;
            });
        }

        // 9. Sorting
        const sortBy = filter.sortBy || 'scrapedAt';
        const sortOrder = (filter.sortOrder || 'desc').toString().toLowerCase() === 'asc' ? 1 : -1;

        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'usn':
                    return (a.usn || '').localeCompare(b.usn || '') * sortOrder;
                case 'name':
                    return ((a.student?.name || '').localeCompare(b.student?.name || '')) * sortOrder;
                case 'sgpa': {
                    const sgpaA = parseFloat(a.summary?.sgpa || '0');
                    const sgpaB = parseFloat(b.summary?.sgpa || '0');
                    return (sgpaA - sgpaB) * sortOrder;
                }
                case 'cgpa': {
                    const cgpaA = parseFloat(a.summary?.cgpa || '0');
                    const cgpaB = parseFloat(b.summary?.cgpa || '0');
                    return (cgpaA - cgpaB) * sortOrder;
                }
                case 'semester': {
                    const semA = parseInt(a.student?.semester || extractSemester(a.student?.department, a.exam) || '0', 10);
                    const semB = parseInt(b.student?.semester || extractSemester(b.student?.department, b.exam) || '0', 10);
                    return (semA - semB) * sortOrder;
                }
                case 'scrapedAt':
                default: {
                    const timeA = new Date(a.scrapedAt || 0).getTime();
                    const timeB = new Date(b.scrapedAt || 0).getTime();
                    return (timeA - timeB) * sortOrder;
                }
            }
        });

        // 10. Pagination
        const total = filtered.length;
        const limitParam = filter.limit;
        const isUnpaginated = limitParam === 'all' || limitParam === 0 || limitParam === '0';

        if (isUnpaginated) {
            return {
                results: filtered,
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
        const paginatedResults = filtered.slice(offset, offset + limit);

        return {
            results: paginatedResults,
            pagination: {
                total,
                page,
                limit,
                totalPages,
            },
        };
    }

    /**
     * Deletes a record by its unique ID or USN.
     * @param {string} idOrUsn
     * @returns {Promise<boolean>} True if record was found and deleted
     */
    async deleteResult(idOrUsn) {
        if (!idOrUsn) return false;
        const target = idOrUsn.toString().trim();
        const targetUpper = target.toUpperCase();

        return this.storage.mutate((records) => {
            const initialLength = records.length;
            const remaining = records.filter(
                (r) => r.id !== target && r.usn !== targetUpper
            );
            if (remaining.length !== initialLength) {
                records.length = 0;
                records.push(...remaining);
                return true;
            }
            return false;
        });
    }

    /**
     * Returns total count of saved results, optionally filtered.
     * @param {object} [filter={}]
     * @returns {Promise<number>}
     */
    async countResults(filter = {}) {
        const { pagination } = await this.getAllResults({ ...filter, limit: 'all' });
        return pagination.total;
    }

    /**
     * Clears all results from storage.
     * @returns {Promise<void>}
     */
    async clearResults() {
        await this.storage.write([]);
    }
}

// Export default singleton instance
export const resultsRepository = new ResultsRepository();
