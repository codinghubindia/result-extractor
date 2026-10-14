import React from 'react';
import { cn } from '../../utils/cn';

/**
 * Accessible, animated Progress Bar component.
 *
 * @param {Object} props
 * @param {number} props.value - Current progress (0 to max)
 * @param {number} [props.max=100] - Maximum value
 * @param {string} [props.label] - Accessible label and display label
 * @param {boolean} [props.showPercentage=true] - Display percentage text
 * @param {'primary' | 'success' | 'warning' | 'danger'} [props.status='primary']
 * @param {'sm' | 'md' | 'lg'} [props.size='md']
 * @param {string} [props.className]
 */
export function ProgressBar({
  value = 0,
  max = 100,
  label,
  showPercentage = true,
  status = 'primary',
  size = 'md',
  className,
}) {
  const clampedValue = Math.min(Math.max(0, value), max);
  const percentage = max > 0 ? Math.round((clampedValue / max) * 100) : 0;

  const barColors = {
    primary: 'bg-blue-600',
    success: 'bg-emerald-600',
    warning: 'bg-amber-500',
    danger: 'bg-rose-600',
  };

  const heights = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between text-xs font-medium text-slate-700">
          <span>{label}</span>
          {showPercentage && <span className="font-semibold text-slate-900">{percentage}%</span>}
        </div>
      )}
      <div
        className={cn('w-full overflow-hidden rounded-full bg-slate-100', heights[size])}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label || `${percentage}% completed`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out motion-reduce:transition-none',
            barColors[status]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
