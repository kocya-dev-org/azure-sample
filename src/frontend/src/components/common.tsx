import type { ReactNode } from 'react';
import { Link } from '../router';

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" role="alert">
      {children}
    </p>
  );
}

export function NoProductSelected() {
  return (
    <p className="notice">
      ヘッダーのプロダクト選択リストから、操作するプロダクトを選んでください。プロダクトがない場合は
      <Link to="/products">プロダクト情報</Link>で登録してください。
    </p>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}
