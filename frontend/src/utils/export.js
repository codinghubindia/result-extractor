/**
 * Utility functions for exporting data and managing file downloads.
 */

/**
 * Extracts filename from Content-Disposition HTTP header.
 * Handles both standard `filename="foo.ext"` and RFC 5987 `filename*=UTF-8''foo.ext`.
 *
 * @param {string|null} disposition - Content-Disposition header value
 * @param {string} [fallbackFilename='export_data'] - Default fallback name
 * @returns {string} - Extracted or fallback filename
 */
export function extractFilenameFromHeader(disposition, fallbackFilename = 'export_data') {
  if (!disposition || typeof disposition !== 'string') {
    return fallbackFilename;
  }

  // Check for RFC 5987 UTF-8 encoding: filename*=UTF-8''encoded_name.ext
  const rfcMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (rfcMatch && rfcMatch[1]) {
    try {
      return decodeURIComponent(rfcMatch[1].trim());
    } catch {
      // Fall through to standard match on decode failure
    }
  }

  // Standard quoted filename: filename="name.ext"
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1].trim();
  }

  // Unquoted filename: filename=name.ext
  const unquotedMatch = disposition.match(/filename=([^;]+)/i);
  if (unquotedMatch && unquotedMatch[1]) {
    return unquotedMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  return fallbackFilename;
}

/**
 * Generates an appropriate default filename with current timestamp.
 *
 * @param {string} format - Export format ('excel' | 'xlsx' | 'csv' | 'json')
 * @param {string} [prefix='gat_results'] - Filename prefix
 * @returns {string} - Formatted filename (e.g. gat_results_2026-09-29.xlsx)
 */
export function generateExportFilename(format, prefix = 'gat_results') {
  const ext = format === 'excel' ? 'xlsx' : format.toLowerCase();
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${dateStr}.${ext}`;
}

/**
 * Constructs a fully qualified query string for the /api/export endpoint.
 *
 * @param {Object} [params={}] - Export query parameters
 * @param {'excel'|'xlsx'|'csv'|'json'} [params.format='json']
 * @param {string} [params.jobId]
 * @param {string} [params.usn]
 * @param {'detailed'|'summary'} [params.type='detailed']
 * @param {string} [params.semester]
 * @param {string} [params.department]
 * @param {string} [params.exam]
 * @param {'PASS'|'FAIL'|'ALL'} [params.status]
 * @param {number} [params.minSgpa]
 * @param {number} [params.maxSgpa]
 * @returns {string} - Path with query parameters (e.g. /api/export?format=excel&type=detailed)
 */
export function buildExportUrl(params = {}) {
  const searchParams = new URLSearchParams();

  const format = params.format === 'xlsx' ? 'excel' : (params.format || 'json');
  searchParams.set('format', format);

  if (params.type) searchParams.set('type', params.type);
  if (params.jobId) searchParams.set('jobId', params.jobId);
  if (params.usn) searchParams.set('usn', params.usn.trim().toUpperCase());
  if (params.semester) searchParams.set('semester', String(params.semester));
  if (params.department) searchParams.set('department', params.department);
  if (params.exam) searchParams.set('exam', params.exam);
  if (params.status && params.status !== 'ALL') searchParams.set('status', params.status);
  if (params.minSgpa !== undefined && params.minSgpa !== '') searchParams.set('minSgpa', String(params.minSgpa));
  if (params.maxSgpa !== undefined && params.maxSgpa !== '') searchParams.set('maxSgpa', String(params.maxSgpa));

  return `/api/export?${searchParams.toString()}`;
}

/**
 * Triggers an immediate browser file download from a Blob or ArrayBuffer.
 *
 * @param {Blob|ArrayBuffer|string} data - File data or string
 * @param {string} filename - Desired download filename
 * @param {string} [mimeType='application/octet-stream'] - MIME type for the Blob
 */
export function triggerBlobDownload(data, filename, mimeType = 'application/octet-stream') {
  if (typeof window === 'undefined') return;

  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const objectUrl = window.URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = objectUrl;
  anchor.setAttribute('download', filename);

  document.body.appendChild(anchor);
  anchor.click();

  // Defer cleanup to ensure browser initiates download
  setTimeout(() => {
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(objectUrl);
  }, 200);
}

/**
 * Initiates a direct window navigation download for a generated export URL.
 *
 * @param {string} url - Target URL to download from
 * @param {string} [filename] - Optional target filename
 */
export function triggerUrlDownload(url, filename) {
  if (typeof window === 'undefined') return;

  const anchor = document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = url;
  if (filename) {
    anchor.setAttribute('download', filename);
  }

  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    document.body.removeChild(anchor);
  }, 200);
}
