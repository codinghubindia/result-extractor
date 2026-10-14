import { useMutation, useQueryClient } from '@tanstack/react-query';
import { scrapeSingle } from '../api/apiClient';
import { resultKeys } from './useResults';

/**
 * TanStack Query mutation hook for executing single USN scrapes.
 * Automatically invalidates the academic results cache upon successful extraction.
 *
 * @param {Object} [options={}] - Additional TanStack useMutation options
 * @returns {Object} Mutation state and trigger functions
 */
export function useSingleScrape(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ usn, examId, latestOnly }) => scrapeSingle({ usn, examId, latestOnly }),
    onSuccess: (data, variables, context) => {
      // Invalidate saved results query cache so recent scrape shows immediately in results tables
      queryClient.invalidateQueries({ queryKey: resultKeys.all });

      // If specific USN query exists, invalidate or prime it
      if (variables?.usn) {
        queryClient.invalidateQueries({
          queryKey: resultKeys.student(variables.usn.trim().toUpperCase()),
        });
      }

      if (options.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options,
  });
}

export default useSingleScrape;
