import React from 'react';
import { GradeBadge } from '../common/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { BookOpen } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Course grades breakdown table with CIE, SEE, Total, Credits, and Grade badges.
 */
export function CoursesTable({ courses = [], className }) {
  if (!courses || courses.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center text-slate-500">
          <BookOpen className="mx-auto h-8 w-8 text-slate-300 mb-2" aria-hidden="true" />
          <p className="text-sm font-medium">No course records found for this result.</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate totals safely
  let totalCie = 0;
  let totalSee = 0;
  let totalMarks = 0;
  let totalCredits = 0;
  let hasValidMarks = false;

  courses.forEach((c) => {
    const cieVal = parseInt(c.cie ?? c['CIE'], 10);
    const seeVal = parseInt(c.see ?? c['SEE'], 10);
    const totVal = parseInt(c.total ?? c['TOTAL'], 10);
    const crVal = parseInt(c.credits ?? c['CREDITS EARNED'] ?? c['CREDITS REG.'], 10);

    if (!isNaN(cieVal)) {
      totalCie += cieVal;
      hasValidMarks = true;
    }
    if (!isNaN(seeVal)) totalSee += seeVal;
    if (!isNaN(totVal)) totalMarks += totVal;
    if (!isNaN(crVal)) totalCredits += crVal;
  });

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-blue-600" aria-hidden="true" />
          <CardTitle as="h3">Course Performance Breakdown</CardTitle>
        </div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {courses.length} {courses.length === 1 ? 'Course' : 'Courses'}
        </span>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-600">
            <tr>
              <th scope="col" className="py-3 px-4 sm:px-6">Course Code</th>
              <th scope="col" className="py-3 px-4">Course Name</th>
              <th scope="col" className="py-3 px-4 text-center">CIE</th>
              <th scope="col" className="py-3 px-4 text-center">SEE</th>
              <th scope="col" className="py-3 px-4 text-center font-bold text-slate-900">Total</th>
              <th scope="col" className="py-3 px-4 text-center">Credits</th>
              <th scope="col" className="py-3 px-4 sm:px-6 text-center">Grade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {courses.map((course, idx) => {
              const code = course.courseCode || course['COURSE CODE'] || `CRS-${idx + 1}`;
              const name = course.courseName || course['COURSE NAME'] || 'Course Name';
              const cie = course.cie ?? course['CIE'] ?? '-';
              const see = course.see ?? course['SEE'] ?? '-';
              const total = course.total ?? course['TOTAL'] ?? '-';
              const credits = course.credits ?? course['CREDITS EARNED'] ?? course['CREDITS REG.'] ?? '-';
              const grade = course.grade || course['GRADE'] || '-';

              const isFail = String(grade).toUpperCase() === 'F' || String(grade).toUpperCase() === 'FAIL';

              return (
                <tr
                  key={`${code}-${idx}`}
                  className={cn(
                    'transition-colors hover:bg-slate-50/70',
                    isFail ? 'bg-rose-50/30' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'
                  )}
                >
                  <td className="py-3.5 px-4 sm:px-6 font-mono text-xs font-semibold text-slate-900">
                    {code}
                  </td>
                  <td className="py-3.5 px-4 font-medium text-slate-800 max-w-xs sm:max-w-md truncate">
                    {name}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-600">
                    {cie}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-600">
                    {see}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-900">
                    {total}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-600">
                    {credits}
                  </td>
                  <td className="py-3.5 px-4 sm:px-6 text-center">
                    <GradeBadge grade={grade} />
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Table Totals Footer */}
          {hasValidMarks && (
            <tfoot className="bg-slate-50/90 border-t-2 border-slate-200 text-xs font-semibold text-slate-800">
              <tr>
                <td colSpan={2} className="py-3 px-4 sm:px-6 text-slate-900 font-bold uppercase tracking-wider">
                  Summary Totals
                </td>
                <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                  {totalCie}
                </td>
                <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                  {totalSee}
                </td>
                <td className="py-3 px-4 text-center font-mono font-extrabold text-blue-700">
                  {totalMarks}
                </td>
                <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                  {totalCredits} cr.
                </td>
                <td className="py-3 px-4 sm:px-6 text-center text-slate-500 font-normal">
                  —
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

export default CoursesTable;
