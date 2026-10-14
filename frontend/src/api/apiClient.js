import { httpClient, normalizeApiError } from './client.js';
import {
  extractFilenameFromHeader,
  generateExportFilename,
  triggerBlobDownload,
  buildExportUrl,
} from '../utils/export.js';

/**
 * Checks server health and operational status.
 * Tests `/health` first, with graceful fallback to `/api/health`.
 *
 * @returns {Promise<{ status: string, service: string, timestamp: string, uptime: number }>}
 */
export async function checkHealth() {
  try {
    const response = await httpClient.get('/health');
    return response.data;
  } catch {
    return { status: 'down' };
  }
}

/**
 * Triggers automated single student result extraction with CAPTCHA auto-solving.
 *
 * @param {Object} params
 * @param {string} params.usn - University Seat Number (e.g. '1GA23IS073')
 * @param {string} [params.examId] - Optional specific examination ID
 * @param {boolean} [params.latestOnly=false] - If true, extracts only the latest exam
 * @param {AbortSignal} [params.signal] - Optional request cancellation signal
 * @returns {Promise<{ success: boolean, message: string, usn: string, count: number, data: Array<Object> }>}
 */
export async function scrapeSingle({ usn, examId, latestOnly = false, signal } = {}) {
  if (!usn || typeof usn !== 'string' || usn.trim().length === 0) {
    throw normalizeApiError(new Error('USN parameter is required'));
  }

  const payload = {
    usn: usn.trim().toUpperCase(),
    ...(examId ? { examId: examId.trim() } : {}),
    ...(latestOnly ? { latestOnly: true } : {}),
  };

  const response = await httpClient.post('/scrape/single', payload, { signal });
  return response.data;
}

/**
 * Initiates an asynchronous bulk scraping batch across a range or list of USNs.
 *
 * @param {Object} params
 * @param {string} [params.fromUsn] - Starting USN (e.g. '1GA23IS001')
 * @param {string} [params.toUsn] - Ending USN (e.g. '1GA23IS080')
 * @param {string[]|string} [params.usnList] - Explicit list of USNs
 * @param {string} [params.examId] - Specific exam ID to extract
 * @param {boolean} [params.latestOnly=false] - Only extract latest exam
 * @param {number} [params.concurrency=2] - Worker concurrency (1 to 4)
 * @param {number} [params.maxRetries=2] - Retries per USN (0 to 5)
 * @param {AbortSignal} [params.signal] - Cancellation signal
 * @returns {Promise<{ success: boolean, message: string, data: { jobId: string, status: string, total: number, fromUsn: string, toUsn: string } }>}
 */
export async function startBulkScrape({
  fromUsn,
  toUsn,
  usnList,
  examId,
  latestOnly = false,
  concurrency = 2,
  maxRetries = 2,
  signal,
} = {}) {
  const payload = {
    ...(fromUsn ? { fromUsn: fromUsn.trim().toUpperCase() } : {}),
    ...(toUsn ? { toUsn: toUsn.trim().toUpperCase() } : {}),
    ...(usnList ? { usnList } : {}),
    ...(examId ? { examId: examId.trim() } : {}),
    ...(latestOnly ? { latestOnly: true } : {}),
    concurrency: Number(concurrency) || 2,
    maxRetries: Number(maxRetries) || 2,
  };

  const response = await httpClient.post('/scrape/bulk', payload, { signal });
  return response.data;
}

/**
 * Retrieves the snapshot status, metrics, and partial results of a bulk job.
 *
 * @param {string} jobId - Unique bulk job ID
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, data: Object }>}
 */
export async function getBulkJobStatus(jobId, signal) {
  if (!jobId) {
    throw normalizeApiError(new Error('jobId parameter is required'));
  }

  const response = await httpClient.get(`/scrape/bulk/${encodeURIComponent(jobId)}`, { signal });
  return response.data;
}

/**
 * Lists bulk scraping jobs with optional status filter and pagination.
 *
 * @param {Object} [params={}]
 * @param {'pending'|'in_progress'|'completed'|'failed'|'cancelled'|'all'} [params.status]
 * @param {'createdAt'|'updatedAt'|'total'|'processed'} [params.sortBy='createdAt']
 * @param {'asc'|'desc'} [params.sortOrder='desc']
 * @param {number} [params.page=1]
 * @param {number|'all'} [params.limit=50]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, data: Array<Object>, pagination: Object }>}
 */
export async function listBulkJobs(params = {}, signal) {
  const response = await httpClient.get('/scrape/bulk', {
    params,
    signal,
  });
  return response.data;
}

/**
 * Signals cancellation of an active or pending bulk scrape job.
 *
 * @param {string} jobId - Unique bulk job ID
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, message: string, data: Object }>}
 */
export async function cancelBulkJob(jobId, signal) {
  if (!jobId) {
    throw normalizeApiError(new Error('jobId parameter is required'));
  }

  const response = await httpClient.post(
    `/scrape/bulk/${encodeURIComponent(jobId)}/cancel`,
    {},
    { signal }
  );
  return response.data;
}

/**
 * Returns the Server-Sent Events (SSE) streaming URL for a specific bulk job.
 *
 * @param {string} jobId - Bulk job ID
 * @returns {string} - Absolute path to SSE endpoint
 */
export function getBulkJobStreamUrl(jobId) {
  return `/api/scrape/bulk/${encodeURIComponent(jobId)}/stream`;
}

/**
 * Queries persisted student academic records with multi-facet filters, sorting, and pagination.
 *
 * @param {Object} [params={}]
 * @param {string} [params.usn] - Search specific USN
 * @param {string} [params.search] - Full-text search on student name or USN
 * @param {string} [params.semester] - Filter by semester number
 * @param {string} [params.department] - Filter by department code (e.g. 'IS', 'CS')
 * @param {string} [params.exam] - Filter by exam description
 * @param {number} [params.minSgpa] - Minimum SGPA threshold (0-10)
 * @param {number} [params.maxSgpa] - Maximum SGPA threshold (0-10)
 * @param {number} [params.minCgpa] - Minimum CGPA threshold (0-10)
 * @param {number} [params.maxCgpa] - Maximum CGPA threshold (0-10)
 * @param {'PASS'|'FAIL'|'ALL'} [params.status='ALL'] - Status filter
 * @param {'scrapedAt'|'usn'|'name'|'sgpa'|'cgpa'|'semester'} [params.sortBy='scrapedAt']
 * @param {'asc'|'desc'} [params.sortOrder='desc']
 * @param {number} [params.page=1]
 * @param {number|'all'} [params.limit=50]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, count: number, data: Array<Object>, pagination: Object }>}
 */
export async function queryResults(params = {}, signal) {
  const cleanParams = {};
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      cleanParams[key] = val;
    }
  }

  const response = await httpClient.get('/results', {
    params: cleanParams,
    signal,
  });
  return response.data;
}

/**
 * Retrieves all saved examination records for a specific student USN.
 *
 * @param {string} usn - Student University Seat Number
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, usn: string, count: number, data: Array<Object> }>}
 */
export async function getResultByUsn(usn, signal) {
  if (!usn || typeof usn !== 'string' || usn.trim().length === 0) {
    throw normalizeApiError(new Error('USN parameter is required'));
  }

  const formattedUsn = usn.trim().toUpperCase();
  const response = await httpClient.get(`/results/${encodeURIComponent(formattedUsn)}`, {
    signal,
  });
  return response.data;
}

/**
 * Deletes all persisted student results from the database.
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function clearAllResults(signal) {
  const response = await httpClient.delete('/results', { signal });
  return response.data;
}

/**
 * Triggers file download from the /api/export endpoint.
 * Fetches the binary or text blob, resolves filename from headers, and saves to user's disk.
 *
 * @param {Object} [params={}]
 * @param {'excel'|'xlsx'|'csv'|'json'} [params.format='excel']
 * @param {string} [params.jobId]
 * @param {string} [params.usn]
 * @param {'detailed'|'summary'} [params.type='detailed']
 * @param {string} [params.semester]
 * @param {string} [params.department]
 * @param {string} [params.exam]
 * @param {'PASS'|'FAIL'|'ALL'} [params.status]
 * @param {number} [params.minSgpa]
 * @param {number} [params.maxSgpa]
 * @param {Object} [options={}]
 * @param {boolean} [options.autoDownload=true] - Trigger browser download immediately
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ blob: Blob, filename: string, contentType: string, size: number }>}
 */
export async function downloadExport(params = {}, { autoDownload = true, signal } = {}) {
  const format = params.format === 'xlsx' ? 'excel' : (params.format || 'excel');

  const queryParams = {
    ...params,
    format,
  };

  const response = await httpClient.get('/export', {
    params: queryParams,
    responseType: 'blob',
    signal,
  });

  const contentType = response.headers['content-type'] || 'application/octet-stream';
  const disposition = response.headers['content-disposition'] || '';
  const fallback = generateExportFilename(format);
  const filename = extractFilenameFromHeader(disposition, fallback);

  const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType });

  if (autoDownload) {
    triggerBlobDownload(blob, filename, contentType);
  }

  return {
    blob,
    filename,
    contentType,
    size: blob.size,
  };
}

/**
 * Submits human-solved CAPTCHA response for an active challenge relay.
 *
 * @param {Object} params
 * @param {string} [params.challengeId] - Active CAPTCHA challenge ID
 * @param {string} [params.jobId] - Associated bulk job or session ID
 * @param {string} params.text - User entered CAPTCHA solution string
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, message: string, data?: Object }>}
 */
export async function submitCaptchaSolution({ challengeId, jobId, text } = {}, signal) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw normalizeApiError(new Error('CAPTCHA solution text is required'));
  }

  const payload = {
    ...(challengeId ? { challengeId } : {}),
    ...(jobId ? { jobId } : {}),
    text: text.trim(),
  };

  const response = await httpClient.post('/scrape/captcha-solve', payload, { signal });
  return response.data;
}

/**
 * Triggers a CAPTCHA reload on the backend and returns the fresh challenge image.
 *
 * @param {Object} params
 * @param {string} params.challengeId
 * @param {string} [params.jobId]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ success: boolean, message: string, data: Object }>}
 */
export async function reloadCaptchaChallenge({ challengeId, jobId } = {}, signal) {
  const payload = {
    challengeId,
    ...(jobId ? { jobId } : {}),
  };
  const response = await httpClient.post('/scrape/captcha-reload', payload, { signal });
  return response.data;
}

/**
 * Retrieves pending CAPTCHA challenge details for a specific job or session if available.
 *
 * @param {string} [jobId] - Optional job ID to check
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ hasPending: boolean, challenge: Object|null }>}
 */
export async function getPendingCaptcha(jobId, signal) {
  const response = await httpClient.get('/scrape/captcha-pending', {
    params: jobId ? { jobId } : {},
    signal,
  });
  return response.data;
}

// Grouped object export
export const apiClient = {
  checkHealth,
  scrapeSingle,
  startBulkScrape,
  getBulkJobStatus,
  listBulkJobs,
  cancelBulkJob,
  getBulkJobStreamUrl,
  queryResults,
  getResultByUsn,
  downloadExport,
  buildExportUrl,
  submitCaptchaSolution,
  reloadCaptchaChallenge,
  getPendingCaptcha,
};

export default apiClient;

