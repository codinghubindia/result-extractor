import React from 'react';
import { cn } from '../../utils/cn';

/**
 * Modern, accessible Badge component for status tags, metadata, and counts.
 *
 * @param {Object} props
 * @param {'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'outline'} [props.variant='default']
 * @param {'sm' | 'md'} [props.size='md']
 * @param {boolean} [props.dot=false]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  className,
  children,
  ...props
}) {
  const baseStyles = 'inline-flex items-center font-medium rounded-full tracking-wide select-none';

  const variants = {
    default: 'bg-slate-100 text-slate-800 border border-slate-200',
    primary: 'bg-blue-50 text-blue-700 border border-blue-200',
    secondary: 'bg-slate-100 text-slate-600 border border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border border-rose-200',
    info: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
    outline: 'bg-transparent text-slate-700 border border-slate-300',
  };

  const sizes = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  };

  const dotColors = {
    default: 'bg-slate-400',
    primary: 'bg-blue-500',
    secondary: 'bg-slate-400',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-cyan-500',
    outline: 'bg-slate-500',
  };

  return (
    <span className={cn(baseStyles, variants[variant], sizes[size], className)} {...props}>
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColors[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/**
 * Specialized badge for VTU / college grade letters (S, A, B, C, D, E, F)
 */
export function GradeBadge({ grade, className }) {
  if (!grade) {
    return <Badge variant="secondary" className={className}>-</Badge>;
  }

  const normalized = String(grade).trim().toUpperCase();

  let variant = 'default';
  if (['S', 'O', 'A+', '10'].includes(normalized)) {
    variant = 'success';
  } else if (['A', 'B+', '9', '8'].includes(normalized)) {
    variant = 'primary';
  } else if (['B', 'C', '7', '6'].includes(normalized)) {
    variant = 'info';
  } else if (['D', 'E', 'P', '5', '4'].includes(normalized)) {
    variant = 'warning';
  } else if (['F', 'FAIL', 'AB', 'ABSENT', 'NE'].includes(normalized)) {
    variant = 'danger';
  }

  return (
    <Badge
      variant={variant}
      className={cn('font-semibold uppercase tracking-wider', className)}
    >
      {normalized}
    </Badge>
  );
}

export default Badge;
