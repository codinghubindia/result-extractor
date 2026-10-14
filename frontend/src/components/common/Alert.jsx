import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Accessible Alert notification banner component.
 *
 * @param {Object} props
 * @param {'info' | 'success' | 'warning' | 'error'} [props.variant='info']
 * @param {string} [props.title]
 * @param {React.ReactNode} props.children
 * @param {Function} [props.onClose]
 * @param {React.ReactNode} [props.action]
 * @param {string} [props.className]
 */
export function Alert({
  variant = 'info',
  title,
  children,
  onClose,
  action,
  className,
  ...props
}) {
  const variantStyles = {
    info: 'border-blue-200 bg-blue-50/80 text-blue-900',
    success: 'border-emerald-200 bg-emerald-50/80 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50/80 text-amber-900',
    error: 'border-rose-200 bg-rose-50/80 text-rose-900',
  };

  const iconStyles = {
    info: 'text-blue-600',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    error: 'text-rose-600',
  };

  const icons = {
    info: <Info className="h-5 w-5 shrink-0" aria-hidden="true" />,
    success: <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />,
    warning: <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />,
    error: <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />,
  };

  return (
    <div
      role="alert"
      className={cn(
        'relative flex items-start gap-3 rounded-lg border p-4 text-sm transition-all',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      <span className={cn('mt-0.5', iconStyles[variant])}>{icons[variant]}</span>
      <div className="flex-1 space-y-1">
        {title && <h5 className="font-semibold leading-none tracking-tight">{title}</h5>}
        <div className="text-sm opacity-90 leading-relaxed">{children}</div>
        {action && <div className="pt-2">{action}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss alert"
          className="ml-auto -mr-1 -mt-1 p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-black/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default Alert;
