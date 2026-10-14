import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { queryResults, getResultByUsn } from '../api/apiClient';

/**
 * Standard query key factories for results domain.
 */
export const resultKeys = {
  all: ['results'],
  lists: () => [...resultKeys.all, 'list'],
  list: (filters = {}) => [...resultKeys.lists(), filters],
  students: () => [...resultKeys.all, 'student'],
  student: (usn) => [...resultKeys.students(), usn ? usn.trim().toUpperCase() : ''],
};

/**
 * TanStack Query hook for querying persisted student academic records with pagination and filters.
 *
 * @param {Object} [filters={}] - Filter parameters (search, semester, department, SGPA range, etc.)
 * @param {Object} [options={}] - Custom useQuery options
 * @returns {Object} Query result object with extracted data and helpers
 */
export function useResults(filters = {}, options = {}) {
  const query = useQuery({
    queryKey: resultKeys.list(filters),
    queryFn: ({ signal }) => queryResults(filters, signal),
    placeholderData: keepPreviousData, // Keeps previous page active while fetching next
    staleTime: 1000 * 60 * 2, // 2 minutes fresh
    ...options,
  });

  return {
    ...query,
    results: query.data?.data || [],
    pagination: query.data?.pagination || { total: 0, page: 1, limit: 50, pages: 1 },
    count: query.data?.count || 0,
  };
}

/**
 * TanStack Query hook for fetching all recorded exam results for a specific student USN.
 *
 * @param {string|null} usn - Target student USN
 * @param {Object} [options={}] - Custom useQuery options
 * @returns {Object} Query result object
 */
export function useStudentResult(usn, options = {}) {
  const normalizedUsn = usn ? usn.trim().toUpperCase() : '';

  const query = useQuery({
    queryKey: resultKeys.student(normalizedUsn),
    queryFn: ({ signal }) => getResultByUsn(normalizedUsn, signal),
    enabled: Boolean(normalizedUsn) && (options.enabled !== undefined ? options.enabled : true),
    staleTime: 1000 * 60 * 5, // 5 minutes fresh
    ...options,
  });

  return {
    ...query,
    studentResults: query.data?.data || [],
    count: query.data?.count || 0,
    usn: normalizedUsn,
  };
}

export default useResults;
