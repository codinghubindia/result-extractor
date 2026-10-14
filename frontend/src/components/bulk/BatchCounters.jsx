import React from 'react';
import { Card, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { CheckCircle2, AlertTriangle, Layers, Radio, SkipForward } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Metric counters for active bulk scraping job (Total, Scraped, Failed, Current USN).
 */
export function BatchCounters({ metrics = {}, isRunning = false, className }) {
  const total = metrics.total || 0;
  const successful = metrics.successful || 0;
  const failed = metrics.failed || 0;
  const skipped = metrics.skipped || 0;
  const currentUsn = metrics.currentUsn || (isRunning ? 'Initializing...' : 'Idle');

  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-5 gap-3.5', className)}>
      {/* Total USNs */}
      <Card className="transition-all">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Total USNs</span>
            <Layers className="h-4 w-4 text-blue-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-slate-800 tracking-tight">
            {total}
          </div>
          <span className="text-[11px] text-slate-400">Scheduled in range</span>
        </CardContent>
      </Card>

      {/* Successfully Scraped */}
      <Card className="transition-all">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Scraped</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 tracking-tight">
            {successful}
          </div>
          <span className="text-[11px] text-emerald-600 font-medium">
            {total > 0 ? `${Math.round((successful / total) * 100)}% completed` : '0%'}
          </span>
        </CardContent>
      </Card>

      {/* Failed / Not Found */}
      <Card className="transition-all">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Failed</span>
            <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-rose-700 tracking-tight">
            {failed}
          </div>
          <span className="text-[11px] text-rose-500 font-medium">
            {failed > 0 ? 'Invalid or CAPTCHA errors' : 'None'}
          </span>
        </CardContent>
      </Card>

      {/* Skipped */}
      <Card className="transition-all">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Skipped</span>
            <SkipForward className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="text-2xl font-extrabold text-slate-700 tracking-tight">
            {skipped}
          </div>
          <span className="text-[11px] text-slate-400">Unassigned roll numbers</span>
        </CardContent>
      </Card>

      {/* Current USN */}
      <Card className={cn('col-span-2 lg:col-span-1 transition-all', isRunning && 'border-blue-300 bg-blue-50/20')}>
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Current USN</span>
            <Radio
              className={cn('h-4 w-4', isRunning ? 'text-blue-600 animate-pulse' : 'text-slate-400')}
              aria-hidden="true"
            />
          </div>
          <div className="font-mono text-base sm:text-lg font-bold text-slate-900 truncate">
            {currentUsn}
          </div>
          <Badge
            variant={isRunning ? 'primary' : 'secondary'}
            size="sm"
            dot={isRunning}
            className="text-[10px]"
          >
            {isRunning ? 'Scraping now' : 'Standby'}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

export default BatchCounters;
