import React, { useState } from 'react';
import { Play, Square, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '../common/Button';
import { cn } from '../../utils/cn';

export function BulkConfigForm({
  onStart,
  onCancel,
  isRunning = false,
  isStarting = false,
  className,
}) {
  const [fromUsn, setFromUsn] = useState('');
  const [toUsn, setToUsn] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [semesterTarget, setSemesterTarget] = useState('all');
  const [clearPreviousData, setClearPreviousData] = useState(false);
  const [enableRelay, setEnableRelay] = useState(true);
  const [formError, setFormError] = useState('');

  const validateRange = (from, to) => {
    if (!from || !to) return 'Both From USN and To USN are required.';
    const f = from.trim().toUpperCase();
    const t = to.trim().toUpperCase();

    const fromMatch = f.match(/^(.*?)(\d+)$/);
    const toMatch = t.match(/^(.*?)(\d+)$/);

    if (!fromMatch || !toMatch) {
      return 'USN must end with numerical digits (e.g. 1GA23IS001).';
    }

    if (fromMatch[1] !== toMatch[1]) {
      return `USN prefixes do not match ("${fromMatch[1]}" vs "${toMatch[1]}").`;
    }

    const startNum = parseInt(fromMatch[2], 10);
    const endNum = parseInt(toMatch[2], 10);

    if (startNum > endNum) {
      return `Starting USN number (${startNum}) cannot be greater than ending number (${endNum}).`;
    }

    const total = endNum - startNum + 1;
    if (total > 300) {
      return `Range of ${total} students exceeds safe batch limit of 300. Please split the batch.`;
    }

    return null;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRunning) return;

    const err = validateRange(fromUsn, toUsn);
    if (err) {
      setFormError(err);
      return;
    }

    setFormError('');
    onStart({
      fromUsn: fromUsn.trim().toUpperCase(),
      toUsn: toUsn.trim().toUpperCase(),
      concurrency: Number(concurrency),
      latestOnly: semesterTarget === 'latest',
      semester: ['all', 'latest'].includes(semesterTarget) ? undefined : semesterTarget,
      clearPreviousData,
      enableRelay,
    });
  };

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-5 sm:p-6', className)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          {/* From USN */}
          <div className="space-y-1.5">
            <label
              htmlFor="from-usn-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              From USN
            </label>
            <input
              id="from-usn-input"
              type="text"
              value={fromUsn}
              onChange={(e) => {
                setFromUsn(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                if (formError) setFormError('');
              }}
              disabled={isRunning}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-wider disabled:bg-slate-50"
              required
            />
          </div>

          {/* To USN */}
          <div className="space-y-1.5">
            <label
              htmlFor="to-usn-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              To USN
            </label>
            <input
              id="to-usn-input"
              type="text"
              value={toUsn}
              onChange={(e) => {
                setToUsn(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                if (formError) setFormError('');
              }}
              disabled={isRunning}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-wider disabled:bg-slate-50"
              required
            />
          </div>

          {/* Concurrency Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="concurrency-select"
              className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              <span>Concurrency</span>
              <span className="text-[10px] text-slate-400 font-normal">Browsers</span>
            </label>
            <select
              id="concurrency-select"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={isRunning}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 font-medium"
            >
              <option value={1}>1 Worker (Gentle)</option>
              <option value={2}>2 Workers (Balanced)</option>
              <option value={3}>3 Workers (Fast)</option>
              <option value={4}>4 Workers (Turbo)</option>
            </select>
          </div>

          {/* Semester / Exam Target */}
          <div className="space-y-1.5">
            <label
              htmlFor="semester-target-select"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              Semester Target
            </label>
            <select
              id="semester-target-select"
              value={semesterTarget}
              onChange={(e) => setSemesterTarget(e.target.value)}
              disabled={isRunning}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 font-medium"
            >
              <option value="all">All Semesters</option>
              <option value="latest">Latest Sem Only</option>
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

          {/* Start / Stop Buttons */}
          <div className="flex gap-2">
            {!isRunning ? (
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={isStarting}
                loadingText="Starting..."
                icon={<Play className="h-4 w-4 fill-current" />}
                className="w-full font-semibold"
              >
                Start Bulk
              </Button>
            ) : (
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={onCancel}
                icon={<Square className="h-4 w-4 fill-current" />}
                className="w-full font-semibold"
              >
                Stop Scraper
              </Button>
            )}
          </div>
        </div>

        {/* Options Row */}
        <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-slate-600">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={clearPreviousData}
              onChange={(e) => setClearPreviousData(e.target.checked)}
              disabled={isRunning}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            <span>Clear old data before scraping (Default: unchecked to preserve all previous records)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enableRelay}
              onChange={(e) => setEnableRelay(e.target.checked)}
              disabled={isRunning}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            <span>Enable manual CAPTCHA solving fallback (Default: enabled)</span>
          </label>
        </div>

        {formError && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

      </form>
    </div>
  );
}

export default BulkConfigForm;
