import React from 'react';
import { cn } from '../../utils/cn';

/**
 * Base skeleton placeholder with shimmer animation.
 */
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-slate-200/80', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * Table skeleton with matching column and row structure.
 */
export function TableSkeleton({ rows = 5, columns = 6, className }) {
  return (
    <div className={cn('w-full space-y-3 p-4', className)} aria-hidden="true">
      {/* Header skeleton */}
      <div className="flex gap-4 border-b border-slate-200 pb-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`th-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`tr-${r}`} className="flex gap-4 py-2 border-b border-slate-100 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={`td-${r}-${c}`}
              className={cn(
                'h-4',
                c === 0 ? 'w-24' : c === 1 ? 'flex-[2]' : 'flex-1'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton matching student profile summary card.
 */
export function StudentProfileSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6" aria-hidden="true">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-7 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-slate-100 p-4 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Metric card skeleton.
 */
export function MetricCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" aria-hidden="true">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-36" />
    </div>
  );
}

export default Skeleton;
