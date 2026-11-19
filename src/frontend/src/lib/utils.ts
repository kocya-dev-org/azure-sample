import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind のクラスを結合し、競合するクラスは後勝ちにする。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
