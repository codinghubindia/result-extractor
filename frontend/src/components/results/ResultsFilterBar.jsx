import React from 'react';
import { Search, Filter, RotateCcw } from 'lucide-react';
import { Button } from '../common/Button';
import { cn } from '../../utils/cn';

/**
 * Filter and search bar for student results database.
 */
export function ResultsFilterBar({
  filters = {},
  onChange,
  onReset,
  className,
}) {
  const {
    search = '',
    semester = '',
    sgpaRange = '',
    status = '',
  } = filters;

  const handleFieldChange = (field, val) => {
    onChange({
      ...filters,
      [field]: val,
    });
  };

  const hasActiveFilters = Boolean(search || semester || sgpaRange || status);

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Search & Filter Records
          </span>
        </div>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onReset}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            className="text-slate-500 hover:text-slate-800"
          >
            Reset Filters
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search input */}
        <div className="relative">
          <Search className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleFieldChange('search', e.target.value)}
            placeholder="Search USN or Name..."
            aria-label="Search by student USN or Name"
            className="block w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          />
        </div>

        {/* Semester Filter */}
        <div>
          <select
            value={semester}
            onChange={(e) => handleFieldChange('semester', e.target.value)}
            aria-label="Filter by Semester"
            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs sm:text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          >
            <option value="">All Semesters</option>
            <option value="1">Semester 1</option>
            <option value="2">Semester 2</option>
            <option value="3">Semester 3</option>
            <option value="4">Semester 4</option>
            <option value="5">Semester 5</option>
            <option value="6">Semester 6</option>
            <option value="7">Semester 7</option>
            <option value="8">Semester 8</option>
          </select>
        </div>

        {/* SGPA Range Filter */}
        <div>
          <select
            value={sgpaRange}
            onChange={(e) => handleFieldChange('sgpaRange', e.target.value)}
            aria-label="Filter by SGPA Range"
            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs sm:text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          >
            <option value="">All SGPA Ranges</option>
            <option value="9.0-10.0">Outstanding (SGPA &ge; 9.0)</option>
            <option value="8.0-8.99">Distinction (8.0 &le; SGPA &lt; 9.0)</option>
            <option value="7.0-7.99">First Class (7.0 &le; SGPA &lt; 8.0)</option>
            <option value="5.0-6.99">Second Class (5.0 &le; SGPA &lt; 7.0)</option>
            <option value="0.0-4.99">Backlog / Fail (SGPA &lt; 5.0)</option>
          </select>
        </div>

        {/* Pass/Fail Status Filter */}
        <div>
          <select
            value={status}
            onChange={(e) => handleFieldChange('status', e.target.value)}
            aria-label="Filter by Pass/Fail Status"
            className="block w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs sm:text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          >
            <option value="">All Statuses</option>
            <option value="PASS">Pass / Completed</option>
            <option value="FAIL">Fail / Arrears</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export default ResultsFilterBar;
