import {
  ArrowLeftIcon,
  CalendarRangeIcon,
  ChevronDownIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  UserIcon,
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  api,
  errorMessage,
  type BacklogDetail,
  type BacklogDetailEntry,
  type IssueResult,
  type ItemStatus,
  MAX_ISSUES_PER_REQUEST,
} from '../api/client';
import {
  EmptyState,
  ErrorMessage,
  formatDate,
  formatScore,
  LoadingState,
  NoProductSelected,
  PageHeader,
} from '../components/common';
import { useProducts } from '../context/ProductContext';
import { Link } from '../router';

function Rationale({ entry }: { entry: BacklogDetailEntry }) {
  if (entry.deleted || !entry.rice || !entry.strategyFit) {
    return <p className="text-sm text-muted-foreground">元の提案は削除されています。</p>;
  }
  const { rice, strategyFit } = entry;
  return (
    <dl className="grid gap-4 text-sm md:grid-cols-2">
      <div className="space-y-1 rounded-lg border bg-card p-4">
        <dt className="font-medium">RICE（現在の評価）</dt>
        <dd className="text-xs text-muted-foreground tabular-nums">
          Reach {formatScore(rice.reach)} × Impact {formatScore(rice.impact)} × Confidence{' '}
          {formatScore(rice.confidence)} ÷ Effort {formatScore(rice.effort)} ={' '}
          {formatScore(rice.score)}
        </dd>
        <dd className="leading-relaxed whitespace-pre-wrap">{rice.rationale}</dd>
      </div>
      <div className="space-y-1 rounded-lg border bg-card p-4">
        <dt className="font-medium">戦略合致度（現在の評価）: {strategyFit.score}</dt>
        <dd className="leading-relaxed whitespace-pre-wrap">{strategyFit.rationale}</dd>
      </div>
    </dl>
  );
}

const BACK_LINK_CLASS =
  'inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground';

export function BacklogDetailPage({ backlogId }: { backlogId: string }) {
  const { selectedProduct } = useProducts();
  const productId = selectedProduct?.id;
  const [backlog, setBacklog] = useState<BacklogDetail | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!productId) return;
    let active = true;
    api
      .getBacklog(productId, backlogId)
      .then((detail) => {
        if (active) setBacklog(detail);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [productId, backlogId]);

  if (!productId) {
    return (
      <section>
        <PageHeader title="バックログ詳細" />
        <NoProductSelected />
      </section>
    );
  }

  async function changeStatus(entry: BacklogDetailEntry, status: ItemStatus) {
    if (!productId) return;
    setError('');
    try {
      const updated = await api.updateItemStatus(productId, entry.scoredItemId, status);
      setBacklog(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              item.scoredItemId === entry.scoredItemId ? { ...item, status: updated.status } : item,
            ),
          },
      );
      toast.success(
        `「${entry.title}」を${updated.status === 'done' ? '実装済み' : '未対応'}にしました。`,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function createIssues() {
    if (!productId) return;
    setIssuing(true);
    setError('');
    setNotice('');
    try {
      const { results } = await api.createIssues(productId, [...checked]);
      const issues = new Map(
        results.flatMap((r) =>
          r.result === 'created' || r.result === 'skipped' ? [[r.itemId, r.issue]] : [],
        ),
      );
      setBacklog(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              issues.has(item.scoredItemId)
                ? { ...item, issue: issues.get(item.scoredItemId) ?? null }
                : item,
            ),
          },
      );
      const count = (kind: IssueResult['result']) =>
        results.filter((r) => r.result === kind).length;
      const failed = count('failed') + count('not_found');
      const summary = `起票 ${count('created')} 件、起票済みのためスキップ ${count('skipped')} 件、失敗 ${failed} 件`;
      setNotice(summary);
      if (failed > 0) toast.warning(summary);
      else toast.success(summary);
      setChecked(new Set());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIssuing(false);
    }
  }

  async function syncIssueStatus() {
    if (!productId) return;
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const result = await api.syncIssueStatus(productId);
      const done = new Set(result.updated.map((u) => u.id));
      setBacklog(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              done.has(item.scoredItemId) ? { ...item, status: 'done' } : item,
            ),
          },
      );
      const summary = `Issue ${result.checked} 件を確認し、${result.updated.length} 件を実装済みにしました（失敗 ${result.failed} 件）。`;
      setNotice(summary);
      if (result.failed > 0) toast.warning(summary);
      else toast.success(summary);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  const toggleIn = (setter: typeof setExpanded) => (id: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggle = toggleIn(setExpanded);
  const toggleChecked = toggleIn(setChecked);

  const issueDisabledReason = !backlog
    ? ''
    : !backlog.githubEnabled
      ? 'GitHub 連携が未設定のため、Issue の起票と状態の更新はできません。'
      : !backlog.hasRepository
        ? 'プロダクト情報にリポジトリが登録されていないため、Issue の起票と状態の更新はできません。'
        : '';
  const canIssue = !!backlog && !issueDisabledReason;

  return (
    <section>
      <PageHeader
        title="バックログ詳細"
        description={
          backlog && (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <CalendarRangeIcon className="size-4" aria-hidden="true" />
                期間: {backlog.from} 〜 {backlog.to}
              </span>
              <span className="tabular-nums">作成日: {formatDate(backlog.createdAt)}</span>
              <span className="inline-flex items-center gap-1">
                <UserIcon className="size-4" aria-hidden="true" />
                作成者: {backlog.createdBy.name}
              </span>
            </span>
          )
        }
        actions={
          backlog && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={syncIssueStatus}
                disabled={!canIssue || syncing}
                title="起票済みの Issue が完了（completed）で閉じられていれば、項目を実装済みにします"
              >
                {syncing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                {syncing ? '更新中…' : 'Issue 状態を更新'}
              </Button>
              <Button
                onClick={createIssues}
                disabled={
                  !canIssue ||
                  checked.size === 0 ||
                  checked.size > MAX_ISSUES_PER_REQUEST ||
                  issuing
                }
              >
                {issuing ? <Loader2Icon className="animate-spin" /> : <CircleDotIcon />}
                {issuing ? '起票中…' : 'Issue 起票'}
              </Button>
            </div>
          )
        }
      >
        <Link to="/backlogs" className={BACK_LINK_CLASS}>
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          バックログ一覧
        </Link>
      </PageHeader>
      {issueDisabledReason && (
        <p className="mb-4 text-sm text-muted-foreground">{issueDisabledReason}</p>
      )}
      <ErrorMessage>{error}</ErrorMessage>
      {/* 起票結果はトーストでも出すが、スクリーンリーダー向けに status でも伝える */}
      {notice && (
        <p className="sr-only" role="status">
          {notice}
        </p>
      )}
      {!backlog ? (
        !error && <LoadingState rows={5} />
      ) : backlog.items.length === 0 ? (
        <EmptyState>期間内にスコアリング済みの提案がありませんでした。</EmptyState>
      ) : (
        <>
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <span className="sr-only">選択</span>
                  </TableHead>
                  <TableHead className="w-14 text-right">順位</TableHead>
                  <TableHead>項目名</TableHead>
                  <TableHead className="text-right">RICE スコア</TableHead>
                  <TableHead className="text-right">戦略合致度</TableHead>
                  <TableHead>実装状況</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="pr-4">根拠</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backlog.items.map((entry) => {
                  const open = expanded.has(entry.scoredItemId);
                  return (
                    <Fragment key={entry.scoredItemId}>
                      <TableRow
                        data-state={checked.has(entry.scoredItemId) ? 'selected' : undefined}
                        className={cn(open && 'border-b-0')}
                      >
                        <TableCell className="pl-4">
                          <Checkbox
                            aria-label={`${entry.title} を選択`}
                            checked={checked.has(entry.scoredItemId)}
                            disabled={!canIssue || entry.deleted || !!entry.issue}
                            onCheckedChange={() => toggleChecked(entry.scoredItemId)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              'inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                              entry.rank <= 3
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {entry.rank}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-72 min-w-40 font-medium whitespace-normal">
                          {entry.title}
                          {entry.deleted && (
                            <Badge variant="outline" className="ml-2 text-muted-foreground">
                              削除済み
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(entry.riceScore)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScore(entry.strategyFitScore)}
                        </TableCell>
                        <TableCell>
                          {entry.deleted ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <NativeSelect
                              aria-label={`${entry.title} の実装状況`}
                              className="w-32"
                              value={entry.status ?? 'open'}
                              onChange={(e) => changeStatus(entry, e.target.value as ItemStatus)}
                            >
                              <option value="open">未対応</option>
                              <option value="done">実装済み</option>
                            </NativeSelect>
                          )}
                        </TableCell>
                        <TableCell>
                          {entry.issue ? (
                            <Badge variant="outline" asChild>
                              <a href={entry.issue.url} target="_blank" rel="noreferrer">
                                #{entry.issue.number}
                                <ExternalLinkIcon aria-hidden="true" />
                              </a>
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={open}
                            onClick={() => toggle(entry.scoredItemId)}
                          >
                            {open ? '閉じる' : '表示'}
                            <ChevronDownIcon
                              aria-hidden="true"
                              className={cn('transition-transform', open && 'rotate-180')}
                            />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={8} className="p-4 whitespace-normal">
                            <Rationale entry={entry} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            順位とスコアは作成時点の値です。根拠には現在の評価を表示します。
          </p>
        </>
      )}
    </section>
  );
}
