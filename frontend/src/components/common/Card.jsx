import React from 'react';
import { cn } from '../../utils/cn';

/**
 * Base Card component following clean elevation principles (border or subtle shadow, not both).
 */
export function Card({ className, children, elevated = false, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white text-slate-900 transition-colors',
        elevated ? 'shadow-md border-0' : 'border border-slate-200/90 shadow-none',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 p-5 pb-4 border-b border-slate-100', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children, as: Tag = 'h3', ...props }) {
  return (
    <Tag
      className={cn('text-lg font-semibold leading-tight tracking-tight text-slate-900', className)}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function CardDescription({ className, children, ...props }) {
  return (
    <p className={cn('text-sm text-slate-500 leading-normal', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={cn('p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }) {
  return (
    <div
      className={cn('flex items-center p-5 pt-3 border-t border-slate-100 gap-3', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
