import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Modern, accessible Button component conforming to WCAG 2.1 AA.
 *
 * @param {Object} props
 * @param {'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'} [props.variant='primary']
 * @param {'xs' | 'sm' | 'md' | 'lg'} [props.size='md']
 * @param {boolean} [props.loading=false]
 * @param {string} [props.loadingText]
 * @param {React.ReactNode} [props.icon]
 * @param {React.ReactNode} [props.iconRight]
 * @param {boolean} [props.disabled=false]
 * @param {'button' | 'submit' | 'reset'} [props.type='button']
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 * @param {React.Ref<HTMLButtonElement>} [props.ref]
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  icon,
  iconLeft,
  iconRight,
  disabled = false,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}) {
  const effectiveIcon = icon || iconLeft;
  const isDisabled = disabled || loading;

  const baseStyles =
    'inline-flex items-center justify-center font-medium select-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none active:scale-[0.98]';

  const variants = {
    primary:
      'bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-blue-500',
    secondary:
      'bg-slate-100 text-slate-800 shadow-sm hover:bg-slate-200 active:bg-slate-300 focus-visible:ring-slate-400',
    outline:
      'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 focus-visible:ring-blue-500',
    ghost:
      'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 focus-visible:ring-slate-400',
    danger:
      'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500',
    success:
      'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 focus-visible:ring-emerald-500',
  };

  const sizes = {
    xs: 'text-xs px-2.5 py-1 rounded-md gap-1.5 min-h-[28px]',
    sm: 'text-xs px-3 py-1.5 rounded-md gap-2 min-h-[32px]',
    md: 'text-sm px-4 py-2 rounded-lg gap-2 min-h-[40px]',
    lg: 'text-base px-5 py-2.5 rounded-lg gap-2.5 min-h-[46px]',
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      aria-disabled={isDisabled ? 'true' : undefined}
      onClick={isDisabled ? undefined : onClick}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-current" aria-hidden="true" />
          <span>{loadingText || children}</span>
        </>
      ) : (
        <>
          {effectiveIcon && <span className="inline-flex shrink-0 items-center">{effectiveIcon}</span>}
          {children && <span>{children}</span>}
          {iconRight && <span className="inline-flex shrink-0 items-center">{iconRight}</span>}
        </>
      )}
    </button>
  );
}

export default Button;
