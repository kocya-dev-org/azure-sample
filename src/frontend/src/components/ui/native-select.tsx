import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn の見た目に揃えた native の select。
 * Radix Select は使わず、ブラウザー標準の操作とアクセシビリティを保つ（ADR 0009）。
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className={cn('relative inline-flex w-full', className)}>
      <select
        data-slot="native-select"
        className="h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
