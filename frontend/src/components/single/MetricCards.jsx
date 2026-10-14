import React from 'react';
import { Award, CheckCircle2, TrendingUp, BookCheck } from 'lucide-react';
import { Card, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { cn } from '../../utils/cn';

/**
 * Metric cards highlighting SGPA, CGPA, Credits status, and overall pass/fail classification.
 */
export function MetricCards({ summary = {}, className }) {
  const sgpaNum = parseFloat(summary.sgpa);
  const cgpaNum = parseFloat(summary.cgpa);

  const creditsRegistered = parseInt(summary.creditsRegistered, 10) || 0;
  const creditsEarned = parseInt(summary.creditsEarned, 10) || 0;
  const passFail = summary.passFail || (summary.sgpa && sgpaNum > 0 ? 'PASS' : 'PENDING');

  const getSgpaTone = (val) => {
    if (isNaN(val)) return { color: 'text-slate-700', bg: 'bg-slate-50', badge: 'secondary', label: 'Recorded' };
    if (val >= 9.0) return { color: 'text-emerald-700', bg: 'bg-emerald-50/70', badge: 'success', label: 'Outstanding' };
    if (val >= 7.5) return { color: 'text-blue-700', bg: 'bg-blue-50/70', badge: 'primary', label: 'Distinction' };
    if (val >= 6.0) return { color: 'text-cyan-700', bg: 'bg-cyan-50/70', badge: 'info', label: 'First Class' };
    if (val >= 4.0) return { color: 'text-amber-700', bg: 'bg-amber-50/70', badge: 'warning', label: 'Second Class' };
    return { color: 'text-rose-700', bg: 'bg-rose-50/70', badge: 'danger', label: 'Arrears / Re-attempt' };
  };

  const sgpaTone = getSgpaTone(sgpaNum);

  const isPassed = String(passFail).toUpperCase().includes('PASS') || String(passFail).toUpperCase().includes('FIRST');

  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      {/* SGPA Card */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>SGPA</span>
            <Award className="h-4 w-4 text-blue-500" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={cn('text-2xl sm:text-3xl font-extrabold tracking-tight', sgpaTone.color)}>
              {!isNaN(sgpaNum) ? sgpaNum.toFixed(2) : summary.sgpa || 'N/A'}
            </span>
            <span className="text-xs text-slate-400 font-medium">/ 10.0</span>
          </div>
          <Badge variant={sgpaTone.badge} size="sm">
            {sgpaTone.label}
          </Badge>
        </CardContent>
      </Card>

      {/* CGPA Card */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>CGPA</span>
            <TrendingUp className="h-4 w-4 text-purple-500" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
              {!isNaN(cgpaNum) ? cgpaNum.toFixed(2) : summary.cgpa || 'N/A'}
            </span>
            <span className="text-xs text-slate-400 font-medium">/ 10.0</span>
          </div>
          <Badge variant="secondary" size="sm">
            Cumulative
          </Badge>
        </CardContent>
      </Card>

      {/* Credits Card */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Credits Earned</span>
            <BookCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
              {creditsEarned}
            </span>
            {creditsRegistered > 0 && (
              <span className="text-xs text-slate-400 font-medium">
                / {creditsRegistered} reg.
              </span>
            )}
          </div>
          <Badge
            variant={creditsRegistered > 0 && creditsEarned >= creditsRegistered ? 'success' : 'warning'}
            size="sm"
          >
            {creditsRegistered > 0 && creditsEarned >= creditsRegistered
              ? '100% Cleared'
              : `${creditsRegistered > 0 ? Math.round((creditsEarned / creditsRegistered) * 100) : 0}% Earned`}
          </Badge>
        </CardContent>
      </Card>

      {/* Result Status Card */}
      <Card className="transition-all hover:border-slate-300">
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Result Status</span>
            <CheckCircle2
              className={cn('h-4 w-4', isPassed ? 'text-emerald-500' : 'text-rose-500')}
              aria-hidden="true"
            />
          </div>
          <div className="truncate">
            <span
              className={cn(
                'text-lg sm:text-xl font-bold tracking-tight uppercase',
                isPassed ? 'text-emerald-700' : 'text-rose-700'
              )}
            >
              {passFail}
            </span>
          </div>
          <Badge variant={isPassed ? 'success' : 'danger'} size="sm" dot>
            {isPassed ? 'Eligible for Next Sem' : 'Needs Clearence'}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

export default MetricCards;
