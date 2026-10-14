import axios from 'axios';

/**
 * Standard normalized API Error representation across the frontend.
 */
export class ApiError extends Error {
  /**
   * @param {Object} params
   * @param {string} params.message - Human-readable error message
   * @param {string} [params.code='API_ERROR'] - Machine-readable error code
   * @param {number} [params.status=500] - HTTP status code
   * @param {string} [params.title='API Error'] - Error category title
   * @param {Record<string, string>} [params.field_errors={}] - Field-specific validation messages
   * @param {Record<string, any>} [params.details={}] - Supplemental server error details
   * @param {any} [params.raw] - Raw original response/error payload
   */
  constructor({
    message,
    code = 'API_ERROR',
    status = 500,
    title = 'API Error',
    field_errors = {},
    details = {},
    raw = null,
  }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.title = title;
    this.field_errors = field_errors;
    this.details = details;
    this.raw = raw;
  }
}

/**
 * Normalizes any error (Axios, Network, RFC 9457 Problem Details, or unexpected)
 * into a predictable ApiError instance.
 *
 * @param {any} error
 * @returns {ApiError}
 */
export function normalizeApiError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  // Axios error with server response
  if (error?.response) {
    const data = error.response.data;
    const status = error.response.status || 500;

    // Check if response is an RFC 9457 Problem Details object
    const detailMsg = data?.detail || data?.message || data?.error;
    const title = data?.title || error.response.statusText || 'Request Failed';
    const code = data?.code || (status === 404 ? 'NOT_FOUND' : status === 422 ? 'UNPROCESSABLE' : 'API_ERROR');
    const details = data?.details || {};
    const field_errors = (typeof details === 'object' && !Array.isArray(details)) ? details : {};

    return new ApiError({
      message: detailMsg || `Request failed with HTTP status ${status}`,
      code,
      status,
      title,
      field_errors,
      details,
      raw: data,
    });
  }

  // Axios network error (offline, refused, timeout)
  if (error?.request) {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return new ApiError({
        message: 'Request timed out waiting for server response. Please try again.',
        code: 'TIMEOUT',
        status: 504,
        title: 'Request Timeout',
        raw: error,
      });
    }

    return new ApiError({
      message: 'Unable to connect to server. Please verify your internet or backend connection.',
      code: 'NETWORK_ERROR',
      status: 0,
      title: 'Network Error',
      raw: error,
    });
  }

  // Generic Javascript Error
  return new ApiError({
    message: error?.message || 'An unexpected error occurred.',
    code: 'UNKNOWN_ERROR',
    status: 500,
    title: 'Error',
    raw: error,
  });
}

/**
 * Pre-configured Axios instance for backend /api calls.
 */
export const httpClient = axios.create({
  baseURL: '/api',
  timeout: 60000, // 60s timeout for Puppeteer + OCR scraping jobs
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Request interceptor: add timestamp or correlation header if needed
httpClient.interceptors.request.use(
  (config) => {
    config.headers['X-Requested-With'] = 'XMLHttpRequest';
    return config;
  },
  (error) => Promise.reject(normalizeApiError(error))
);

// Response interceptor: automatically unpack response data and normalize errors
httpClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeApiError(error))
);

export default httpClient;
