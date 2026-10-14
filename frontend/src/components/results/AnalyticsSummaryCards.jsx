import React from 'react';
import { Card, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Users, TrendingUp, Trophy, Percent } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Summary analytics cards showing aggregate metrics across student records.
 */
export function AnalyticsSummaryCards({ records = [], className }) {
  if (!records || records.length === 0) return null;

  const total = records.length;
  let sgpaSum = 0;
  let sgpaCount = 0;
  let maxSgpa = 0;
  let passCount = 0;

  records.forEach((r) => {
    const sgpa = parseFloat(r.summary?.sgpa);
    if (!isNaN(sgpa) && sgpa > 0) {
      sgpaSum += sgpa;
      sgpaCount++;
      if (sgpa > maxSgpa) maxSgpa = sgpa;
    }

    const pf = String(r.summary?.passFail || '').toUpperCase();
    if (pf.includes('PASS') || pf.includes('FIRST') || pf.includes('DISTINCTION')) {
      passCount++;
    } else if (sgpa >= 5.0) {
      passCount++;
    }
  });

  const avgSgpa = sgpaCount > 0 ? (sgpaSum / sgpaCount).toFixed(2) : '-';
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;

  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3.5', className)}>
      {/* Total Students */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Class Strength</span>
            <Users className="h-4 w-4 text-blue-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-slate-800 tracking-tight">
            {total}
          </div>
          <span className="text-[11px] text-slate-400">Total records evaluated</span>
        </CardContent>
      </Card>

      {/* Average SGPA */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Average SGPA</span>
            <TrendingUp className="h-4 w-4 text-indigo-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-indigo-700 tracking-tight">
            {avgSgpa}
          </div>
          <Badge variant="info" size="sm">
            Cohort Benchmark
          </Badge>
        </CardContent>
      </Card>

      {/* Highest SGPA */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Highest SGPA</span>
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-amber-700 tracking-tight">
            {maxSgpa > 0 ? maxSgpa.toFixed(2) : '-'}
          </div>
          <Badge variant="warning" size="sm">
            Batch Topper
          </Badge>
        </CardContent>
      </Card>

      {/* Pass Percentage */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Pass Rate</span>
            <Percent className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 tracking-tight">
            {passRate}%
          </div>
          <Badge variant={passRate >= 75 ? 'success' : 'danger'} size="sm">
            {passCount} of {total} Passed
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

export default AnalyticsSummaryCards;
