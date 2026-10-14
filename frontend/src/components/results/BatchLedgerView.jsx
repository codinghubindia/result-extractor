import React, { useState, useMemo } from 'react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import {
  Download,
  Search,
  GraduationCap,
  Maximize2,
  Minimize2,
  FileSpreadsheet,
  BookOpen,
  CheckCircle2,
  XCircle,
  Award,
} from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Dynamically categorizes any course based on cohort enrolment distribution and credits.
 * Adapts to any department, semester, scheme, or elective structure without hardcoding.
 */
function getCourseType(code = '', studentRatio = 1, credits = 0) {
  const norm = code.toUpperCase();
  const isZeroCredit = credits === 0;

  if (isZeroCredit) {
    return { label: 'Audit / Non-Credit', variant: 'neutral', isOE: false };
  }
  if (studentRatio >= 0.40) {
    return { label: 'Core', variant: 'primary', isOE: false };
  }
  if (studentRatio >= 0.15) {
    return { label: 'Track Elective', variant: 'warning', isOE: false };
  }
  // Low cohort ratio elective chosen by student subset -> Open Elective
  return { label: 'Open Elective', variant: 'accent', isOE: true };
}

/**
 * BatchLedgerView renders student results in the exact ledger / matrix grid format
 * seen in the official VTU / GAT semester result sheets (e.g. 4th & 6th Sem results).
 *
 * It dynamically detects all Core courses and Open Electives across students,
 * displays empty cells for electives not taken by a student, and renders the bottom
 * statistics summary and subject catalog.
 */
export function BatchLedgerView({
  records = [],
  onViewRecord,
  onExport,
  className,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [isExpandedFull, setIsExpandedFull] = useState(false);

  // Metadata detection from records
  const firstStudent = records[0] || {};
  const department =
    firstStudent.student?.department || 'Engineering';
  const semester = firstStudent.student?.semester || '';
  const examTitle = firstStudent.exam || 'ACADEMIC RESULTS';

  const batchMatch = (firstStudent.usn || '').match(/1GA(\d\d)/i);
  const batchYear = batchMatch ? `20${batchMatch[1]}` : '';

  // 1. Collect and dynamically order all unique courses across the cohort
  const { courses, courseCounts } = useMemo(() => {
    const map = new Map();
    const counts = new Map();

    records.forEach((r) => {
      (r.courses || []).forEach((c) => {
        const rawCode = (c['COURSE CODE'] || c.courseCode || c.code || '').trim();
        const rawName = (c['COURSE NAME'] || c.courseName || c.name || '').trim();
        if (!rawCode) return;

        const normCode = rawCode.toUpperCase();
        counts.set(normCode, (counts.get(normCode) || 0) + 1);

        if (!map.has(normCode)) {
          map.set(normCode, {
            code: rawCode,
            name: rawName || rawCode,
            credits:
              parseFloat(c['CREDITS REG.'] || c.creditsReg || c.credits || 0) || 0,
          });
        }
      });
    });

    const totalStudents = Math.max(1, records.length);

    // Dynamic 3-tier sorting:
    // Tier 1: Core courses (enrolment ratio >= 40%)
    // Tier 2: Track / Professional Electives (15% <= ratio < 40%)
    // Tier 3: Open Electives & options (ratio < 15%)
    // Within tiers: credit subjects before 0-credit audit subjects, then code alphanumeric
    const sorted = Array.from(map.values()).sort((a, b) => {
      const codeA = a.code.toUpperCase();
      const codeB = b.code.toUpperCase();
      const countA = counts.get(codeA) || 0;
      const countB = counts.get(codeB) || 0;
      const ratioA = countA / totalStudents;
      const ratioB = countB / totalStudents;
      const isCreditA = (a.credits || 0) > 0;
      const isCreditB = (b.credits || 0) > 0;

      const getTier = (ratio) => {
        if (ratio >= 0.40) return 1;
        if (ratio >= 0.15) return 2;
        return 3;
      };

      const tierA = getTier(ratioA);
      const tierB = getTier(ratioB);

      if (tierA !== tierB) {
        return tierA - tierB;
      }

      if (isCreditA && !isCreditB) return -1;
      if (!isCreditA && isCreditB) return 1;

      return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
    });

    return { courses: sorted, courseCounts: counts };
  }, [records]);

  // 2. Compute individual student row data & batch-level statistics
  const { studentRows, stats } = useMemo(() => {
    let appeared = 0;
    let passed = 0;
    let failed = 0;
    let fcd = 0;
    let fc = 0;
    let sc = 0;
    let absent = 0;

    const rows = records.map((r, idx) => {
      const usn = r.usn || r.student?.srn || `STU-${idx + 1}`;
      const name = (r.student?.name || 'NAME NOT AVAILABLE').toUpperCase();
      const studentCourses = r.courses || [];

      const courseMap = new Map();
      studentCourses.forEach((c) => {
        const cCode = (c['COURSE CODE'] || c.courseCode || c.code || '').trim().toUpperCase();
        if (cCode) courseMap.set(cCode, c);
      });

      let totalMarks = 0;
      let maxMarks = 0;
      let hasFailGrade = false;
      let isStudentAbsent = false;
      let hasCourses = false;

      // Extract marks per unique course
      const courseGrades = courses.map((crs) => {
        const normCode = crs.code.toUpperCase();
        const sc = courseMap.get(normCode);
        if (!sc) {
          return null; // Not taken (Open Elective / PE alternative)
        }

        hasCourses = true;
        const cie = sc['CIE'] !== undefined && sc['CIE'] !== '' ? sc['CIE'] : '-';
        const see = sc['SEE'] !== undefined && sc['SEE'] !== '' ? sc['SEE'] : '-';
        const total = sc['TOTAL'] !== undefined && sc['TOTAL'] !== '' ? sc['TOTAL'] : '-';
        const cr =
          sc['CREDITS REG.'] !== undefined
            ? sc['CREDITS REG.']
            : sc['CREDITS'] || crs.credits || '-';
        const cre =
          sc['CREDITS EARNED'] !== undefined
            ? sc['CREDITS EARNED']
            : sc.creditsEarned || '-';
        const grade = (sc['GRADE'] || sc.grade || '').trim().toUpperCase();

        const numericTotal = Number(total);
        if (!isNaN(numericTotal) && numericTotal >= 0) {
          totalMarks += numericTotal;
          maxMarks += 100;
        }

        if (['F', 'FAIL', 'FL', 'AB', 'ABSENT', 'NE', 'X', 'I'].includes(grade)) {
          hasFailGrade = true;
        }
        if (grade === 'AB' || grade === 'ABSENT' || grade === 'X') {
          isStudentAbsent = true;
        }

        return { cie, see, total, cr, cre, grade };
      });

      if (hasCourses) appeared++;
      if (isStudentAbsent) absent++;

      const sgpaVal = parseFloat(r.summary?.sgpa || '0') || 0;
      const cgpaVal = parseFloat(r.summary?.cgpa || '0') || 0;
      const creditsReg = r.summary?.creditsRegistered || '-';
      const creditsEarned = r.summary?.creditsEarned || '-';

      const pct = maxMarks > 0 ? Number(((totalMarks / maxMarks) * 100).toFixed(2)) : 0;

      let resultClass = 'PASS';
      if (hasFailGrade || sgpaVal === 0) {
        resultClass = 'F';
        failed++;
      } else {
        passed++;
        if (sgpaVal >= 7.75 || pct >= 70) {
          resultClass = 'FCD';
          fcd++;
        } else if (sgpaVal >= 6.75 || pct >= 60) {
          resultClass = 'FC';
          fc++;
        } else if (sgpaVal >= 5.75 || pct >= 50) {
          resultClass = 'SC';
          sc++;
        }
      }

      return {
        raw: r,
        slNo: idx + 1,
        usn,
        name,
        courseGrades,
        creditsReg,
        creditsEarned,
        sgpa: sgpaVal > 0 ? sgpaVal.toFixed(2) : (r.summary?.sgpa || '-'),
        cgpa: cgpaVal > 0 ? cgpaVal.toFixed(2) : (r.summary?.cgpa || '-'),
        totalMarks: totalMarks > 0 ? totalMarks : '-',
        percentage: pct > 0 ? `${pct}%` : '-',
        resultClass,
      };
    });

    const passPct = appeared > 0 ? ((passed / appeared) * 100).toFixed(2) : '0.00';

    return {
      studentRows: rows,
      stats: {
        total: records.length,
        appeared,
        passed,
        failed,
        fcd,
        fc,
        sc,
        absent,
        passPercentage: passPct,
      },
    };
  }, [records, courses]);

  // Filter rows by search and result status
  const filteredRows = useMemo(() => {
    return studentRows.filter((row) => {
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'PASS' && row.resultClass === 'F') return false;
        if (statusFilter === 'FAIL' && row.resultClass !== 'F') return false;
        if (statusFilter === 'FCD' && row.resultClass !== 'FCD') return false;
        if (statusFilter === 'FC' && row.resultClass !== 'FC') return false;
      }

      if (courseFilter !== 'ALL') {
        const crsIdx = courses.findIndex(
          (c) => c.code.toUpperCase() === courseFilter.toUpperCase()
        );
        if (crsIdx >= 0 && !row.courseGrades[crsIdx]) return false;
      }

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        row.usn.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q)
      );
    });
  }, [studentRows, searchQuery, statusFilter, courseFilter, courses]);

  // Count Open Electives
  const openElectivesCount = useMemo(() => {
    return courses.filter((c) => {
      const count = courseCounts.get(c.code.toUpperCase()) || 0;
      const ratio = count / Math.max(1, records.length);
      const type = getCourseType(c.code, ratio, c.credits);
      return type.isOE;
    }).length;
  }, [courses, courseCounts, records.length]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* College Header Card */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-md bg-blue-600 px-2 py-0.5 text-xs font-bold text-white tracking-wider">
                GAT
              </span>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 uppercase">
                GLOBAL ACADEMY OF TECHNOLOGY
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Ideal Homes Township, Rajarajeshwari Nagar, Bengaluru – 560 098 | Tel: +91 80 28603158
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="font-semibold text-xs text-blue-900 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                Department of {department}
              </span>
              <span className="font-semibold text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {batchYear} BATCH • {semester}TH SEMESTER
              </span>
              {openElectivesCount > 0 && (
                <span className="font-semibold text-xs text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  ⚡ {openElectivesCount} Open Electives Tracked
                </span>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            {onExport && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onExport('excel')}
                icon={<Download className="h-4 w-4" />}
                className="bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm"
              >
                Export Excel (.xlsx)
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpandedFull(!isExpandedFull)}
              icon={
                isExpandedFull ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )
              }
              title={isExpandedFull ? 'Exit wide view' : 'Fit wide screen'}
            >
              {isExpandedFull ? 'Compact' : 'Wide Ledger'}
            </Button>
          </div>
        </div>

        {/* Filter and Search Bar inside Ledger */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-[220px]">
              <Search className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search USN or Name..."
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 bg-white py-1.5 px-2.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All Results ({studentRows.length})</option>
              <option value="PASS">Pass Only ({stats.passed})</option>
              <option value="FCD">FCD (Distinction) ({stats.fcd})</option>
              <option value="FC">First Class ({stats.fc})</option>
              <option value="FAIL">Backlogs / Fail ({stats.failed})</option>
            </select>

            {/* Course Filter */}
            {courses.length > 0 && (
              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white py-1.5 px-2.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[200px] truncate"
              >
                <option value="ALL">All Courses ({courses.length})</option>
                {courses.map((crs) => (
                  <option key={crs.code} value={crs.code}>
                    {crs.code} - {crs.name.slice(0, 24)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="text-xs text-slate-500">
            Showing <span className="font-semibold text-slate-900">{filteredRows.length}</span> of {studentRows.length} students
          </div>
        </div>
      </div>

      {/* Main Ledger Table with Sticky Headers & Columns */}
      <Card className={cn('overflow-hidden border-slate-300 shadow-sm', isExpandedFull && 'max-w-none')}>
        <div className="overflow-x-auto max-h-[720px] relative scrollbar-thin">
          <table className="min-w-full border-collapse text-xs text-slate-800">
            {/* Header Tier 1: Course Codes */}
            <thead className="sticky top-0 z-30 bg-slate-100 shadow-sm text-center">
              <tr className="border-b border-slate-300">
                {/* Sl.No */}
                <th
                  rowSpan={3}
                  className="sticky left-0 z-40 bg-slate-200 border-r border-b border-slate-300 px-2 py-2 text-center font-bold text-slate-800 w-12 min-w-[48px]"
                >
                  SI.No
                </th>
                {/* USN */}
                <th
                  rowSpan={3}
                  className="sticky left-12 z-40 bg-slate-200 border-r border-b border-slate-300 px-3 py-2 text-center font-bold text-blue-900 w-28 min-w-[110px]"
                >
                  USN
                </th>
                {/* NAME */}
                <th
                  rowSpan={3}
                  className="sticky left-40 z-40 bg-slate-200 border-r border-b border-slate-300 px-3 py-2 text-left font-bold text-slate-800 w-52 min-w-[200px]"
                >
                  NAME
                </th>

                {/* Course Code Columns (spanning 6 columns each) */}
                {courses.map((crs) => {
                  const count = courseCounts.get(crs.code.toUpperCase()) || 0;
                  const ratio = count / Math.max(1, records.length);
                  const type = getCourseType(crs.code, ratio, crs.credits);

                  return (
                    <th
                      key={crs.code}
                      colSpan={6}
                      className={cn(
                        'border-r border-b border-slate-300 px-2 py-1.5 font-bold tracking-tight text-center',
                        type.isOE
                          ? 'bg-amber-100/90 text-amber-950'
                          : type.label === 'Track Elective'
                          ? 'bg-purple-100/90 text-purple-950'
                          : type.label === 'Audit / Non-Credit'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-slate-200 text-slate-900'
                      )}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="font-mono text-xs">{crs.code}</span>
                        {type.isOE && (
                          <span className="rounded bg-amber-200/80 px-1 py-0.2 text-[9px] font-semibold text-amber-800 uppercase tracking-wider">
                            OE
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}

                {/* Summary Column Headers (Merged across rows 1-3) */}
                <th
                  rowSpan={3}
                  className="border-r border-b border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-800 w-16 min-w-[64px]"
                  title="Credits Registered in Current Semester"
                >
                  CRDT REG
                </th>
                <th
                  rowSpan={3}
                  className="border-r border-b border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-800 w-16 min-w-[64px]"
                  title="Credits Acquired in Current Semester"
                >
                  CRDT ACQ
                </th>
                <th
                  rowSpan={3}
                  className="border-r border-b border-slate-300 bg-blue-100 px-2 py-2 text-center font-bold text-blue-950 w-14 min-w-[56px]"
                >
                  SGPA
                </th>
                <th
                  rowSpan={3}
                  className="border-r border-b border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-800 w-14 min-w-[56px]"
                >
                  CGPA
                </th>
                <th
                  rowSpan={3}
                  className="border-r border-b border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-800 w-16 min-w-[64px]"
                >
                  TOTAL
                </th>
                <th
                  rowSpan={3}
                  className="border-r border-b border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-800 w-16 min-w-[64px]"
                >
                  %
                </th>
                <th
                  rowSpan={3}
                  className="border-b border-slate-300 bg-emerald-100 px-2 py-2 text-center font-bold text-emerald-950 w-20 min-w-[80px]"
                >
                  RESULT
                </th>
              </tr>

              {/* Header Tier 2: Course Full Titles */}
              <tr className="border-b border-slate-300 text-[10px]">
                {courses.map((crs) => (
                  <th
                    key={`title-${crs.code}`}
                    colSpan={6}
                    className="border-r border-b border-slate-300 bg-slate-50 px-1 py-1 font-semibold text-slate-700 text-center max-w-[180px] truncate"
                    title={crs.name}
                  >
                    <div className="truncate max-w-[190px]">{crs.name}</div>
                  </th>
                ))}
              </tr>

              {/* Header Tier 3: Subheaders (CIE, SEE, TOTAL, CR, CRE, GRADE) */}
              <tr className="border-b border-slate-400 bg-slate-100 text-[10px] text-slate-600 font-bold uppercase tracking-wider">
                {courses.map((crs) => (
                  <React.Fragment key={`sub-${crs.code}`}>
                    <th className="border-r border-slate-300 px-1 py-1 w-8 text-center bg-slate-50/80">CIE</th>
                    <th className="border-r border-slate-300 px-1 py-1 w-8 text-center bg-slate-50/80">SEE</th>
                    <th className="border-r border-slate-300 px-1 py-1 w-9 text-center bg-slate-100 font-bold text-slate-900">TOT</th>
                    <th className="border-r border-slate-300 px-1 py-1 w-6 text-center bg-slate-50/80">CR</th>
                    <th className="border-r border-slate-300 px-1 py-1 w-6 text-center bg-slate-50/80">CRE</th>
                    <th className="border-r border-slate-400 px-1 py-1 w-9 text-center bg-slate-200/70 font-bold text-slate-900">GRD</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>

            {/* Table Body: Student Rows */}
            <tbody className="divide-y divide-slate-200 font-mono">
              {filteredRows.length > 0 ? (
                filteredRows.map((row) => {
                  const isFail = row.resultClass === 'F';

                  return (
                    <tr
                      key={row.usn}
                      className={cn(
                        'transition-colors hover:bg-blue-50/40 cursor-pointer',
                        isFail ? 'bg-rose-50/20' : 'bg-white'
                      )}
                      onClick={() => onViewRecord && onViewRecord(row.raw)}
                    >
                      {/* Sl.No */}
                      <td className="sticky left-0 z-20 bg-slate-100 border-r border-slate-200 px-2 py-2 text-center text-slate-600">
                        {row.slNo}
                      </td>

                      {/* USN */}
                      <td className="sticky left-12 z-20 bg-slate-100 border-r border-slate-200 px-2.5 py-2 text-center font-bold text-blue-900">
                        {row.usn}
                      </td>

                      {/* Name */}
                      <td className="sticky left-40 z-20 bg-slate-100 border-r border-slate-300 px-3 py-2 text-left font-sans text-xs font-medium text-slate-800 truncate max-w-[200px]">
                        {row.name}
                      </td>

                      {/* Course Marks */}
                      {row.courseGrades.map((gradeData, gIdx) => {
                        const crs = courses[gIdx];

                        // If student did NOT take this elective -> Render empty cells
                        if (!gradeData) {
                          return (
                            <React.Fragment key={`empty-${crs.code}`}>
                              <td className="border-r border-slate-100 bg-slate-50/40 text-center text-slate-300">-</td>
                              <td className="border-r border-slate-100 bg-slate-50/40 text-center text-slate-300">-</td>
                              <td className="border-r border-slate-100 bg-slate-50/40 text-center text-slate-300">-</td>
                              <td className="border-r border-slate-100 bg-slate-50/40 text-center text-slate-300">-</td>
                              <td className="border-r border-slate-100 bg-slate-50/40 text-center text-slate-300">-</td>
                              <td className="border-r border-slate-300 bg-slate-50/40 text-center text-slate-300">-</td>
                            </React.Fragment>
                          );
                        }

                        const isCourseFail = ['F', 'FAIL', 'FL', 'AB', 'ABSENT', 'NE', 'X'].includes(
                          gradeData.grade
                        );

                        return (
                          <React.Fragment key={`cell-${crs.code}`}>
                            <td className="border-r border-slate-200 px-1 py-1.5 text-center text-slate-700">
                              {gradeData.cie}
                            </td>
                            <td className="border-r border-slate-200 px-1 py-1.5 text-center text-slate-700">
                              {gradeData.see}
                            </td>
                            <td className="border-r border-slate-200 px-1 py-1.5 text-center font-bold text-slate-900 bg-slate-50/50">
                              {gradeData.total}
                            </td>
                            <td className="border-r border-slate-200 px-1 py-1.5 text-center text-slate-600">
                              {gradeData.cr}
                            </td>
                            <td className="border-r border-slate-200 px-1 py-1.5 text-center text-slate-600">
                              {gradeData.cre}
                            </td>
                            <td
                              className={cn(
                                'border-r border-slate-300 px-1 py-1.5 text-center font-bold',
                                isCourseFail
                                  ? 'bg-rose-100 text-rose-700 font-extrabold'
                                  : gradeData.grade === 'O' || gradeData.grade === 'A+'
                                  ? 'text-emerald-700'
                                  : 'text-slate-800'
                              )}
                            >
                              {gradeData.grade}
                            </td>
                          </React.Fragment>
                        );
                      })}

                      {/* Summary Columns */}
                      <td className="border-r border-slate-200 px-2 py-1.5 text-center text-slate-700">
                        {row.creditsReg}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1.5 text-center text-slate-700">
                        {row.creditsEarned}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold text-blue-950 bg-blue-50/30">
                        {row.sgpa}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1.5 text-center text-slate-700">
                        {row.cgpa}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold text-slate-900">
                        {row.totalMarks}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-1.5 text-center text-slate-700">
                        {row.percentage}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider',
                            row.resultClass === 'FCD'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : row.resultClass === 'FC'
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : row.resultClass === 'SC'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : row.resultClass === 'F'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300 font-black'
                              : 'bg-slate-100 text-slate-800'
                          )}
                        >
                          {row.resultClass}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={3 + courses.length * 6 + 7}
                    className="p-12 text-center text-sm text-slate-500"
                  >
                    No matching student records found for the active filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bottom Statistics & Subject Catalog Block (Exact Replica of Excel Footer) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
        {/* Left: Performance Statistics */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5 mb-3">
            <Award className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Batch Performance Statistics
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200/80">
              <span className="text-slate-600">Total Students</span>
              <span className="font-bold text-slate-900">{stats.total}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200/80">
              <span className="text-slate-600">Appeared</span>
              <span className="font-bold text-slate-900">{stats.appeared}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-emerald-50 border border-emerald-200">
              <span className="font-semibold text-emerald-800">Total Pass</span>
              <span className="font-bold text-emerald-950">{stats.passed}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-emerald-50/60 border border-emerald-200">
              <span className="text-emerald-800">FCD (Distinction)</span>
              <span className="font-bold text-emerald-950">{stats.fcd}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-blue-50/60 border border-blue-200">
              <span className="text-blue-800">FC (First Class)</span>
              <span className="font-bold text-blue-950">{stats.fc}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-amber-50/60 border border-amber-200">
              <span className="text-amber-800">SC (Second Class)</span>
              <span className="font-bold text-amber-950">{stats.sc}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-rose-50 border border-rose-200">
              <span className="font-semibold text-rose-800">Fail / Backlogs</span>
              <span className="font-bold text-rose-950">{stats.failed}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-purple-50 border border-purple-200">
              <span className="font-bold text-purple-900">Pass Percentage</span>
              <span className="font-extrabold text-purple-950">{stats.passPercentage}%</span>
            </div>
          </div>
        </div>

        {/* Right: Subject Catalog & Open Electives Legend */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Course Catalog & Electives Breakdown ({courses.length} Courses)
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              Core + PE + Open Electives
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs scrollbar-thin">
            {courses.map((crs) => {
              const count = courseCounts.get(crs.code.toUpperCase()) || 0;
              const ratio = count / Math.max(1, records.length);
              const type = getCourseType(crs.code, ratio, crs.credits);

              return (
                <div key={crs.code} className="flex items-center justify-between py-1.5 px-1 hover:bg-slate-50">
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span className="font-mono font-bold text-slate-900 w-24 shrink-0">
                      {crs.code}
                    </span>
                    <span className="truncate text-slate-700 font-medium" title={crs.name}>
                      {crs.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                        type.isOE
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : type.label === 'Track Elective'
                          ? 'bg-purple-100 text-purple-900'
                          : type.label === 'Audit / Non-Credit'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-blue-100 text-blue-900'
                      )}
                    >
                      {type.label}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono w-16 text-right">
                      {count} {count === 1 ? 'student' : 'students'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
