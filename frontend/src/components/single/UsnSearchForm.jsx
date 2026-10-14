import React, { useState } from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import { Button } from '../common/Button';
import { cn } from '../../utils/cn';

const DEFAULT_SAMPLES = [
  '1GA23IS073',
  '1GA23IS001',
  '1GA23IS045',
  '1GA23CS012',
  '1GA22EC010',
];

/**
 * USN Search input form with one-click sample chips.
 *
 * @param {Object} props
 * @param {Function} props.onSubmit - Triggered with uppercase USN string
 * @param {boolean} [props.loading=false]
 * @param {string} [props.initialUsn='']
 * @param {string[]} [props.samples]
 */
export function UsnSearchForm({
  onSubmit,
  loading = false,
  initialUsn = '',
  samples = DEFAULT_SAMPLES,
  className,
}) {
  const [usn, setUsn] = useState(initialUsn);
  const [semesterTarget, setSemesterTarget] = useState('all');
  const [inputError, setInputError] = useState('');

  const handleChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setUsn(val);
    if (inputError) setInputError('');
  };

  const handleClear = () => {
    setUsn('');
    setInputError('');
  };

  const getOptions = () => ({
    latestOnly: semesterTarget === 'latest',
    semester: ['all', 'latest'].includes(semesterTarget) ? undefined : semesterTarget,
  });

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmed = usn.trim();
    if (!trimmed) {
      setInputError('Please enter a valid USN (e.g., 1GA23IS073)');
      return;
    }
    if (trimmed.length < 5) {
      setInputError('USN must be at least 5 alphanumeric characters');
      return;
    }
    setInputError('');
    onSubmit(trimmed, getOptions());
  };

  const handleSelectSample = (sample) => {
    setUsn(sample);
    setInputError('');
    onSubmit(sample, getOptions());
  };

  return (
    <div className={cn('w-full space-y-3', className)}>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
            <Search className="h-4 w-4" aria-hidden="true" />
          </div>
          <input
            type="text"
            value={usn}
            onChange={handleChange}
            placeholder="Enter Student USN (e.g. 1GA23IS073)..."
            disabled={loading}
            maxLength={15}
            aria-label="Student University Seat Number (USN)"
            aria-invalid={inputError ? 'true' : 'false'}
            className={cn(
              'block w-full rounded-lg border bg-white py-2.5 pl-10 pr-9 text-sm text-slate-900 placeholder:text-slate-400',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors uppercase font-mono tracking-wider',
              inputError
                ? 'border-rose-400 focus:ring-rose-500 focus:border-rose-500'
                : 'border-slate-300 hover:border-slate-400'
            )}
          />
          {usn && !loading && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear USN input"
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Semester / Exam Selection Target */}
        <div className="w-full sm:w-48 shrink-0">
          <select
            value={semesterTarget}
            onChange={(e) => setSemesterTarget(e.target.value)}
            disabled={loading}
            aria-label="Select Semester Target"
            className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-sm text-slate-900 font-medium focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 transition-colors"
          >
            <option value="all">All Semesters (Transcript)</option>
            <option value="latest">Latest Semester Only</option>
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

        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={loading}
          loadingText="Scraping Result..."
          icon={<Search className="h-4 w-4" />}
          className="shrink-0 font-semibold"
        >
          Scrape Result
        </Button>
      </form>

      {inputError && (
        <p className="text-xs text-rose-600 font-medium" role="alert">
          {inputError}
        </p>
      )}
    </div>
  );
}

export default UsnSearchForm;
