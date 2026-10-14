import React, { useState } from 'react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { CoursesTable } from '../single/CoursesTable';
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  GraduationCap,
  Layers,
} from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Paginated student results table with expandable inline course marks.
 */
export function ResultsDataTable({
  records = [],
  pagination = {},
  onPageChange,
  onPageSizeChange,
  onViewRecord,
  className,
}) {
  const [expandedRows, setExpandedRows] = useState(new Set());

  const toggleRow = (usn) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(usn)) {
        next.delete(usn);
      } else {
        next.add(usn);
      }
      return next;
    });
  };

  const currentPage = pagination.page || 1;
  const pageSize = pagination.limit || 20;
  const totalRecords = pagination.total !== undefined ? pagination.total : records.length;
  const totalPages = pagination.totalPages || Math.max(1, Math.ceil(totalRecords / pageSize));

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th scope="col" className="w-10 py-3 pl-4 pr-1"></th>
              <th scope="col" className="py-3 px-3 sm:px-4">USN</th>
              <th scope="col" className="py-3 px-4">Student Name</th>
              <th scope="col" className="py-3 px-4">Department</th>
              <th scope="col" className="py-3 px-3 text-center">Sem</th>
              <th scope="col" className="py-3 px-4 text-center">SGPA</th>
              <th scope="col" className="py-3 px-4 text-center">CGPA</th>
              <th scope="col" className="py-3 px-4 text-center">Status</th>
              <th scope="col" className="py-3 pr-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.length > 0 ? (
              records.map((record, idx) => {
                const usn = record.usn || `USN-${idx}`;
                const name = record.student?.name || 'Name Not Available';
                const department = record.student?.department || 'Engg';
                const semester = record.student?.semester || '-';
                const sgpa = record.summary?.sgpa || '-';
                const cgpa = record.summary?.cgpa || '-';
                const passFail = record.summary?.passFail || (sgpa !== '-' ? 'PASS' : 'PENDING');
                const isPass =
                  String(passFail).toUpperCase().includes('PASS') ||
                  String(passFail).toUpperCase().includes('FIRST');
                const isExpanded = expandedRows.has(usn);

                return (
                  <React.Fragment key={`${usn}-${idx}`}>
                    <tr
                      className={cn(
                        'transition-colors hover:bg-slate-50/70 cursor-pointer',
                        isExpanded && 'bg-blue-50/30'
                      )}
                      onClick={() => toggleRow(usn)}
                    >
                      {/* Expand Chevron */}
                      <td className="py-3.5 pl-4 pr-1 text-slate-400">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(usn);
                          }}
                          aria-label={isExpanded ? 'Collapse course details' : 'Expand course details'}
                          aria-expanded={isExpanded}
                          className="p-1 rounded hover:bg-slate-200/60 text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>

                      {/* USN */}
                      <td className="py-3.5 px-3 sm:px-4 font-mono text-xs font-bold text-slate-900">
                        {usn}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-4 font-medium text-slate-800 max-w-xs truncate">
                        {name}
                      </td>

                      {/* Department */}
                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-[140px] truncate">
                        {department}
                      </td>

                      {/* Semester */}
                      <td className="py-3.5 px-3 text-center text-xs text-slate-600 font-mono">
                        {semester}
                      </td>

                      {/* SGPA */}
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-900">
                        {sgpa}
                      </td>

                      {/* CGPA */}
                      <td className="py-3.5 px-4 text-center font-mono text-slate-600">
                        {cgpa}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <Badge variant={isPass ? 'success' : 'danger'} size="sm">
                          {passFail}
                        </Badge>
                      </td>

                      {/* View Button */}
                      <td className="py-3.5 pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onViewRecord) onViewRecord(record);
                            else toggleRow(usn);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          {isExpanded ? 'Hide' : 'Courses'}
                        </Button>
                      </td>
                    </tr>

                    {/* Expandable Course Marks Row */}
                    {isExpanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={9} className="p-4 sm:px-8">
                          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <GraduationCap className="h-4 w-4 text-blue-600" />
                                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                                  Course Marks for {usn} ({name})
                                </span>
                              </div>
                              <span className="text-xs text-slate-500 font-mono">
                                SGPA: {sgpa} | CGPA: {cgpa}
                              </span>
                            </div>
                            <CoursesTable courses={record.courses || []} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="py-14 text-center text-slate-400">
                  <Layers className="mx-auto h-8 w-8 text-slate-300 mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-600">
                    No student results found matching current criteria.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Try adjusting your search query, semester, or SGPA range filters.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalRecords > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 sm:px-6 py-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange && onPageSizeChange(Number(e.target.value))}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="Records per page"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-slate-400 pl-2">
              Showing {Math.min((currentPage - 1) * pageSize + 1, totalRecords)} -{' '}
              {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage <= 1}
              onClick={() => onPageChange && onPageChange(1)}
              aria-label="First page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage <= 1}
              onClick={() => onPageChange && onPageChange(currentPage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>

            <span className="px-3 font-semibold text-slate-700">
              Page {currentPage} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="xs"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange && onPageChange(currentPage + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange && onPageChange(totalPages)}
              aria-label="Last page"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default ResultsDataTable;
