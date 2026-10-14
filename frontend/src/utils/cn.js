import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines class names with Tailwind CSS class collision resolution
 * @param  {...any} inputs - Class names, objects, or arrays
 * @returns {string} - Merged class name string
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default cn;
