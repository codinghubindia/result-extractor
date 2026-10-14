import { Calendar, BookOpen, Layers, Clock } from 'lucide-react';
import { Badge } from '../common/Badge';
import { ExportToolbar } from '../common/ExportToolbar';
import { cn } from '../../utils/cn';

/**
 * Student profile banner showing student identity, department, semester, and export controls.
 */
export function StudentProfileHeader({ result, onExport, className }) {
  if (!result) return null;

  const student = result.student || {};
  const studentName = student.name || 'Student Name Not Available';
  const usn = result.usn || student.srn || 'N/A';
  const department = student.department || 'General Engineering';
  const semester = student.semester ? `Semester ${student.semester}` : 'N/A';
  const exam = result.exam || 'Semester Examination';
  const scrapedAt = result.scrapedAt
    ? new Date(result.scrapedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 transition-all',
        className
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Left identity section */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {studentName}
            </h2>
            <Badge variant="primary" className="font-mono text-xs px-2.5 py-0.5">
              {usn}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs sm:text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Layers className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {department}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <BookOpen className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {semester}
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {exam}
            </span>
          </div>

          {scrapedAt && (
            <p className="flex items-center gap-1 text-xs text-slate-400 pt-0.5">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Scraped: {scrapedAt}
            </p>
          )}
        </div>

        {/* Right action section: Export options */}
        <div className="shrink-0 flex items-center gap-2 pt-2 lg:pt-0">
          <ExportToolbar usn={usn} onExport={onExport} size="sm" />
        </div>
      </div>
    </div>
  );
}

export default StudentProfileHeader;
