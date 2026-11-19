import { CircleAlertIcon, InboxIcon, PackageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Link } from '../router';

/** 画面の見出し。右側に主要な操作ボタンを置ける。 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        {children}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <CircleAlertIcon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function NoProductSelected() {
  return (
    <Alert>
      <PackageIcon />
      <AlertTitle>プロダクトが選択されていません</AlertTitle>
      <AlertDescription>
        <p>
          ヘッダーのプロダクト選択リストから、操作するプロダクトを選んでください。プロダクトがない場合は
          <Link to="/products" className="font-medium text-primary underline underline-offset-4">
            プロダクト情報
          </Link>
          で登録してください。
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** データがないときの表示。 */
export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      <InboxIcon className="size-8 opacity-60" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

/** 読み込み中の表示。スクリーンリーダーには文言で伝える。 */
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">読み込み中…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}
