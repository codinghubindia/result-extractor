import React, { useState, useEffect, useCallback } from 'react';
import { ResultsFilterBar } from './ResultsFilterBar';
import { AnalyticsSummaryCards } from './AnalyticsSummaryCards';
import { ResultsDataTable } from './ResultsDataTable';
import { BatchLedgerView } from './BatchLedgerView';
import { ExportToolbar } from '../common/ExportToolbar';
import { TableSkeleton } from '../common/SkeletonLoader';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { StudentProfileHeader } from '../single/StudentProfileHeader';
import { MetricCards } from '../single/MetricCards';
import { CoursesTable } from '../single/CoursesTable';
import { Button } from '../common/Button';
import { RefreshCw, Trash2, FileSpreadsheet, GraduationCap } from 'lucide-react';
import { cn } from '../../utils/cn';
import { clearAllResults } from '../../api/apiClient';

/**
 * Academic Results & Analytics view coordinating search/filters, summary analytics,
 * paginated records table, expandable course marks, and multi-format export.
 *
 * @param {Object} props
 * @param {Array} [props.data] - Array of student records
 * @param {Object} [props.pagination] - Pagination metadata { page, limit, total, totalPages }
 * @param {boolean} [props.isLoading=false]
 * @param {string|Object} [props.error=null]
 * @param {Function} [props.onQueryChange] - Filter / pagination change callback
 * @param {Function} [props.onExport] - Export callback
 * @param {string} [props.className]
 */
export function ResultsAnalyticsView({
  data,
  pagination,
  isLoading = false,
  error = null,
  onQueryChange,
  onExport,
  className,
}) {
  const [internalData, setInternalData] = useState([]);
  const [internalPagination, setInternalPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState(null);

  const [filters, setFilters] = useState({
    search: '',
    semester: '',
    sgpaRange: '',
    status: '',
  });

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [displayMode, setDisplayMode] = useState('excel');

  const isControlled = data !== undefined;
  const currentRecords = isControlled ? data : internalData;
  const currentPagination = isControlled ? pagination || {} : internalPagination;
  const currentLoading = isControlled ? isLoading : internalLoading;
  const currentError = isControlled ? error : internalError;

  // Internal data fetching when running in standalone mode
  const fetchResults = useCallback(async (activeFilters, page = 1, limit = 20) => {
    if (isControlled) {
      if (onQueryChange) {
        onQueryChange({ ...activeFilters, page, limit });
      }
      return;
    }

    try {
      setInternalLoading(true);
      setInternalError(null);

      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (activeFilters.search) params.set('search', activeFilters.search);
      if (activeFilters.semester) params.set('semester', activeFilters.semester);
      if (activeFilters.status) params.set('status', activeFilters.status);

      if (activeFilters.sgpaRange) {
        const [min, max] = activeFilters.sgpaRange.split('-');
        if (min) params.set('minSgpa', min);
        if (max) params.set('maxSgpa', max);
      }

      const res = await fetch(`/api/results?${params.toString()}`);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Failed to fetch results from database');
      }

      const items = json.data || json.results || (Array.isArray(json) ? json : []);
      const pag = json.pagination || {
        page: json.page || page,
        limit: json.limit || limit,
        total: json.total || items.length,
        totalPages: json.totalPages || Math.max(1, Math.ceil((json.total || items.length) / limit)),
      };

      setInternalData(items);
      setInternalPagination(pag);
    } catch (err) {
      setInternalError(err.message || 'Error loading academic results database');
    } finally {
      setInternalLoading(false);
    }
  }, [isControlled, onQueryChange]);

  useEffect(() => {
    let isMounted = true;
    if (!isControlled) {
      (async () => {
        try {
          await fetchResults(filters, 1, 20);
        } catch {
          if (!isMounted) return;
        }
      })();
    }
    return () => {
      isMounted = false;
    };
  }, [filters, fetchResults, isControlled]);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    if (isControlled && onQueryChange) {
      onQueryChange({ ...newFilters, page: 1 });
    }
  };

  const handleFilterReset = () => {
    const emptyFilters = { search: '', semester: '', sgpaRange: '', status: '' };
    setFilters(emptyFilters);
    if (isControlled && onQueryChange) {
      onQueryChange({ ...emptyFilters, page: 1 });
    }
  };

  const handlePageChange = (newPage) => {
    if (isControlled && onQueryChange) {
      onQueryChange({ ...filters, page: newPage });
    } else {
      fetchResults(filters, newPage, internalPagination.limit);
    }
  };

  const handlePageSizeChange = (newSize) => {
    if (isControlled && onQueryChange) {
      onQueryChange({ ...filters, page: 1, limit: newSize });
    } else {
      fetchResults(filters, 1, newSize);
    }
  };

  const handleClearAllData = async () => {
    if (!window.confirm('Are you sure you want to delete all saved student results? This cannot be undone.')) {
      return;
    }
    try {
      setInternalLoading(true);
      await clearAllResults();
      if (!isControlled) {
        setInternalData([]);
        setInternalPagination({ page: 1, limit: 20, total: 0, totalPages: 1 });
      } else if (onQueryChange) {
        onQueryChange({ ...filters, page: 1 });
      }
    } catch (err) {
      setInternalError(err.message || 'Failed to clear results data');
    } finally {
      setInternalLoading(false);
    }
  };

  const errorMessage =
    typeof currentError === 'string'
      ? currentError
      : currentError?.detail || currentError?.message || null;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Academic Results & Analytics
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Search, filter, and analyze scraped student records with expandable course marks and 1-click export.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentRecords.length === 0 || currentLoading}
              onClick={handleClearAllData}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
              icon={<Trash2 className="h-4 w-4" />}
            >
              Clear All Data
            </Button>
            <ExportToolbar onExport={onExport} disabled={currentRecords.length === 0} />
          </div>
        </div>
      </div>

      {/* Summary Analytics Cards */}
      <AnalyticsSummaryCards records={currentRecords} />

      {/* Filters Bar */}
      <ResultsFilterBar
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
      />

      {/* Error alert */}
      {errorMessage && (
        <Alert
          variant="error"
          title="Query Error"
          onClose={() => (isControlled ? null : setInternalError(null))}
          action={
            <button
              type="button"
              onClick={() => fetchResults(filters, 1, 20)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-800 hover:text-rose-950 underline underline-offset-2"
            >
              <RefreshCw className="h-3 w-3" /> Retry Loading
            </button>
          }
        >
          {errorMessage}
        </Alert>
      )}

      {/* Loading Skeleton */}
      {currentLoading && <TableSkeleton rows={6} columns={8} />}

      {/* View Switcher Toggle */}
      {!currentLoading && currentRecords.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-100/80 p-1.5 rounded-lg border border-slate-200">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDisplayMode('excel')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                displayMode === 'excel'
                  ? 'bg-white text-blue-900 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              University Excel Ledger View
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('table')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                displayMode === 'table'
                  ? 'bg-white text-blue-900 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <GraduationCap className="h-4 w-4 text-blue-600" />
              Detailed Transcript List
            </button>
          </div>
          <span className="text-[11px] text-slate-500 font-mono pr-2 hidden sm:inline">
            Matches 4th & 6th Sem Excel format with Open Electives
          </span>
        </div>
      )}

      {/* Results Rendering: BatchLedgerView or ResultsDataTable */}
      {!currentLoading && (
        displayMode === 'excel' && currentRecords.length > 0 ? (
          <BatchLedgerView
            records={currentRecords}
            onViewRecord={(record) => setSelectedRecord(record)}
            onExport={onExport}
          />
        ) : (
          <ResultsDataTable
            records={currentRecords}
            pagination={currentPagination}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            onViewRecord={(record) => setSelectedRecord(record)}
          />
        )
      )}

      {/* Detailed Modal for inspect record */}
      {selectedRecord && (
        <Modal
          isOpen={!!selectedRecord}
          onClose={() => setSelectedRecord(null)}
          title={`Academic Transcript: ${selectedRecord.usn}`}
          size="lg"
          footer={
            <Button variant="secondary" size="sm" onClick={() => setSelectedRecord(null)}>
              Close Transcript
            </Button>
          }
        >
          <div className="space-y-4">
            <StudentProfileHeader result={selectedRecord} onExport={onExport} />
            <MetricCards summary={selectedRecord.summary || {}} />
            <CoursesTable courses={selectedRecord.courses || []} />
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ResultsAnalyticsView;
