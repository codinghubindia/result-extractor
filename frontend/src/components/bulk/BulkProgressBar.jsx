import React from 'react';
import { ProgressBar } from '../common/ProgressBar';
import { Badge } from '../common/Badge';
import { cn } from '../../utils/cn';

/**
 * Progress overview container for bulk scraping jobs.
 */
export function BulkProgressBar({
  processed = 0,
  total = 0,
  status = 'IDLE',
  className,
}) {
  const normalizedStatus = String(status).toUpperCase();

  const getStatusBadge = () => {
    switch (normalizedStatus) {
      case 'RUNNING':
        return <Badge variant="primary" dot size="sm">Scraping In Progress</Badge>;
      case 'COMPLETED':
        return <Badge variant="success" size="sm">Batch Completed</Badge>;
      case 'CANCELLED':
        return <Badge variant="warning" size="sm">Job Cancelled</Badge>;
      case 'FAILED':
        return <Badge variant="danger" size="sm">Job Failed</Badge>;
      default:
        return <Badge variant="secondary" size="sm">Ready to Start</Badge>;
    }
  };

  const getProgressStatus = () => {
    if (normalizedStatus === 'COMPLETED') return 'success';
    if (normalizedStatus === 'FAILED') return 'danger';
    if (normalizedStatus === 'CANCELLED') return 'warning';
    return 'primary';
  };

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-5 space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Job Progress
          </span>
          {getStatusBadge()}
        </div>
        <div className="text-xs font-mono font-medium text-slate-600">
          <span className="text-slate-900 font-bold">{processed}</span> of{' '}
          <span className="text-slate-900 font-bold">{total}</span> USNs processed
        </div>
      </div>

      <ProgressBar
        value={processed}
        max={total || 1}
        status={getProgressStatus()}
        size="md"
        showPercentage={true}
      />
    </div>
  );
}

export default BulkProgressBar;
