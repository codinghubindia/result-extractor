import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, FileCode2, Check, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../utils/cn';

/**
 * 1-Click Data Export Toolbar for Excel (.xlsx), CSV, and JSON formats.
 *
 * @param {Object} props
 * @param {Function} [props.onExport] - Callback receiving format ('excel' | 'csv' | 'json')
 * @param {string} [props.jobId] - Optional job ID to export
 * @param {string} [props.usn] - Optional USN to export
 * @param {boolean} [props.disabled=false]
 * @param {'sm' | 'md'} [props.size='sm']
 * @param {string} [props.className]
 */
export function ExportToolbar({
  onExport,
  jobId,
  usn,
  disabled = false,
  size = 'sm',
  className,
}) {
  const [activeFormat, setActiveFormat] = useState(null);
  const [recentlyDownloaded, setRecentlyDownloaded] = useState(null);

  const handleExport = async (format) => {
    if (disabled || activeFormat) return;

    try {
      setActiveFormat(format);

      if (onExport) {
        await onExport(format);
      } else {
        // Direct browser download trigger via backend /api/export
        const params = new URLSearchParams();
        params.set('format', format);
        params.set('type', 'detailed');
        if (jobId) params.set('jobId', jobId);
        if (usn) params.set('usn', usn);

        const downloadUrl = `/api/export?${params.toString()}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', `gat_results_${format}_${Date.now()}.${format === 'excel' ? 'xlsx' : format}`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      setRecentlyDownloaded(format);
      setTimeout(() => {
        setRecentlyDownloaded(null);
      }, 2500);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setActiveFormat(null);
    }
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-50 border border-slate-200/80',
        className
      )}
      role="toolbar"
      aria-label="Data export options"
    >
      <span className="hidden sm:inline-flex items-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">
        <Download className="h-3.5 w-3.5 mr-1 text-slate-400" aria-hidden="true" />
        Export
      </span>

      {/* Excel Export */}
      <Button
        variant="outline"
        size={size}
        disabled={disabled || activeFormat !== null}
        onClick={() => handleExport('excel')}
        icon={
          activeFormat === 'excel' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
          ) : recentlyDownloaded === 'excel' ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
          )
        }
        className={cn(
          'text-xs font-medium border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-900',
          recentlyDownloaded === 'excel' && 'border-emerald-400 bg-emerald-50 text-emerald-900'
        )}
        aria-label="Export results as Excel spreadsheet (.xlsx)"
      >
        Excel (.xlsx)
      </Button>

      {/* CSV Export */}
      <Button
        variant="outline"
        size={size}
        disabled={disabled || activeFormat !== null}
        onClick={() => handleExport('csv')}
        icon={
          activeFormat === 'csv' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
          ) : recentlyDownloaded === 'csv' ? (
            <Check className="h-3.5 w-3.5 text-blue-600" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-blue-600" />
          )
        }
        className={cn(
          'text-xs font-medium border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-900',
          recentlyDownloaded === 'csv' && 'border-blue-400 bg-blue-50 text-blue-900'
        )}
        aria-label="Export results as CSV text (.csv)"
      >
        CSV
      </Button>

      {/* JSON Export */}
      <Button
        variant="outline"
        size={size}
        disabled={disabled || activeFormat !== null}
        onClick={() => handleExport('json')}
        icon={
          activeFormat === 'json' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
          ) : recentlyDownloaded === 'json' ? (
            <Check className="h-3.5 w-3.5 text-amber-600" />
          ) : (
            <FileCode2 className="h-3.5 w-3.5 text-amber-600" />
          )
        }
        className={cn(
          'text-xs font-medium border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 hover:text-amber-900',
          recentlyDownloaded === 'json' && 'border-amber-400 bg-amber-50 text-amber-900'
        )}
        aria-label="Export results as JSON data (.json)"
      >
        JSON
      </Button>
    </div>
  );
}

export default ExportToolbar;
