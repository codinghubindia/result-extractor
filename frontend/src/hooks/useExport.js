import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { downloadExport } from '../api/apiClient';

/**
 * Hook to execute file export downloads (Excel, CSV, JSON) with loading states
 * and convenience helpers.
 *
 * @param {Object} [options={}] - Additional mutation callbacks
 * @returns {Object} Export trigger methods and status flags
 */
export function useExportDownload(options = {}) {
  const [downloadedFile, setDownloadedFile] = useState(null);

  const mutation = useMutation({
    mutationFn: (params) => downloadExport(params),
    onSuccess: (data, variables, context) => {
      setDownloadedFile(data);
      if (options.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options,
  });

  const exportExcel = useCallback(
    (params = {}) => {
      const p = typeof params === 'string' ? { jobId: params } : params;
      return mutation.mutateAsync({ ...p, format: 'excel' });
    },
    [mutation]
  );

  const exportCsv = useCallback(
    (params = {}, type = 'detailed') => {
      const p = typeof params === 'string' ? { jobId: params } : params;
      return mutation.mutateAsync({ ...p, format: 'csv', type });
    },
    [mutation]
  );

  const exportJson = useCallback(
    (params = {}) => {
      const p = typeof params === 'string' ? { jobId: params } : params;
      return mutation.mutateAsync({ ...p, format: 'json' });
    },
    [mutation]
  );

  return {
    ...mutation,
    isExporting: mutation.isPending,
    downloadedFile,
    exportData: mutation.mutateAsync,
    exportExcel,
    exportCsv,
    exportJson,
  };
}

export default useExportDownload;
