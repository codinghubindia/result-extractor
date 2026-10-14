import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  startBulkScrape,
  getBulkJobStatus,
  listBulkJobs,
  cancelBulkJob,
} from '../api/apiClient';

/**
 * Query key factories for bulk scraping jobs.
 */
export const bulkJobKeys = {
  all: ['bulkJobs'],
  lists: () => [...bulkJobKeys.all, 'list'],
  list: (params = {}) => [...bulkJobKeys.lists(), params],
  details: () => [...bulkJobKeys.all, 'detail'],
  detail: (jobId) => [...bulkJobKeys.details(), jobId || ''],
};

/**
 * Mutation hook to start a new concurrent bulk scraping batch.
 *
 * @param {Object} [options={}] - Additional mutation options
 * @returns {Object} Mutation state and startBulk trigger
 */
export function useStartBulkScrape(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => startBulkScrape(payload),
    onSuccess: (data, variables, context) => {
      // Invalidate jobs list cache
      queryClient.invalidateQueries({ queryKey: bulkJobKeys.lists() });

      if (options.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options,
  });
}

/**
 * Query hook to fetch the current status and metrics snapshot of a bulk job.
 * Useful as a fallback or secondary sync alongside the SSE stream.
 *
 * @param {string|null} jobId - Target bulk job ID
 * @param {Object} [options={}] - Additional useQuery options (e.g. refetchInterval)
 * @returns {Object} Query result object
 */
export function useBulkJobStatus(jobId, options = {}) {
  const query = useQuery({
    queryKey: bulkJobKeys.detail(jobId),
    queryFn: ({ signal }) => getBulkJobStatus(jobId, signal),
    enabled: Boolean(jobId) && (options.enabled !== undefined ? options.enabled : true),
    refetchInterval: options.refetchInterval || false,
    ...options,
  });

  return {
    ...query,
    job: query.data?.data || null,
  };
}

/**
 * Query hook to list recent and active bulk scraping batches with pagination.
 *
 * @param {Object} [params={}] - Filter and pagination params
 * @param {Object} [options={}] - Additional useQuery options
 * @returns {Object} Query result object with extracted jobs and pagination
 */
export function useBulkJobsList(params = {}, options = {}) {
  const query = useQuery({
    queryKey: bulkJobKeys.list(params),
    queryFn: ({ signal }) => listBulkJobs(params, signal),
    staleTime: 1000 * 30, // 30s fresh
    ...options,
  });

  return {
    ...query,
    jobs: query.data?.data || [],
    pagination: query.data?.pagination || { total: 0, page: 1, limit: 50, pages: 1 },
  };
}

/**
 * Mutation hook to signal cancellation of an active bulk scraping job.
 *
 * @param {Object} [options={}] - Additional mutation options
 * @returns {Object} Mutation state and cancel trigger
 */
export function useCancelBulkJob(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId) => cancelBulkJob(jobId),
    onSuccess: (data, jobId, context) => {
      // Invalidate relevant job detail and job lists
      if (jobId) {
        queryClient.invalidateQueries({ queryKey: bulkJobKeys.detail(jobId) });
      }
      queryClient.invalidateQueries({ queryKey: bulkJobKeys.lists() });

      if (options.onSuccess) {
        options.onSuccess(data, jobId, context);
      }
    },
    ...options,
  });
}
