import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '../api/apiClient';

/**
 * Hook to continuously monitor backend service availability.
 * Polls the health endpoint periodically to drive live status indicators.
 *
 * @param {Object} [options={}] - Custom useQuery options
 * @returns {Object} Health status object
 */
export function useHealth(options = {}) {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    refetchInterval: options.refetchInterval || 30000, // Check every 30s
    retry: 1,
    staleTime: 10000,
    ...options,
  });

  const isOnline = Boolean(query.data?.status === 'ok');

  return {
    ...query,
    isOnline,
    service: query.data?.service || 'gat-results-backend',
    uptime: query.data?.uptime || 0,
    lastChecked: query.data?.timestamp || null,
  };
}

export default useHealth;
