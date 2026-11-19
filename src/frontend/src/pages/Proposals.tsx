import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { api, errorMessage, type Proposal } from '../api/client';
import {
  EmptyState,
  ErrorMessage,
  formatDate,
  formatScore,
  NoProductSelected,
  PageHeader,
} from '../components/common';
import { useConfirm } from '../components/ConfirmDialog';
import { useProducts } from '../context/ProductContext';
import { useRouter } from '../router';

/** カードの幅は固定し、画面が広いほど横に並ぶ枚数を増やす。狭い画面では 1 列で縮む。 */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(0,20rem))] gap-4';

/** 本文の冒頭を、改行と連続する空白をまとめたうえで最大 length 文字（コードポイント単位）で返す。 */
function excerpt(body: string, length = 50): string {
  const chars = Array.from(body.replace(/\s+/g, ' ').trim());
  return chars.length > length ? `${chars.slice(0, length).join('')}…` : chars.join('');
}

function ScoreBadge({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | null | undefined;
  variant: 'secondary' | 'outline';
}) {
  return (
    <Badge variant={variant} className="gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatScore(value)}</span>
    </Badge>
  );
}

function CardsLoading() {
  return (
    <div className={GRID} aria-busy="true">
      <span className="sr-only">読み込み中…</span>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}

export function ProposalsPage() {
  const { selectedProduct } = useProducts();
  const { navigate } = useRouter();
  const productId = selectedProduct?.id;
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(
    (id: string, isActive: () => boolean = () => true) =>
      api
        .listProposals(id)
        .then((list) => {
          if (!isActive()) return;
          setProposals(list);
          setSelected(new Set());
          setError('');
        })
        .catch((e: unknown) => {
          if (isActive()) setError(errorMessage(e));
        }),
    [],
  );

  useEffect(() => {
    if (!productId) return;
    let active = true;
    void load(productId, () => active);
    return () => {
      active = false;
    };
  }, [productId, load]);

  if (!selectedProduct || !productId) {
    return (
      <section>
        <PageHeader title="提案" />
        <NoProductSelected />
      </section>
    );
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected =
    proposals !== null && proposals.length > 0 && selected.size === proposals.length;
  const toggleAll = () =>
    setSelected(allSelected || !proposals ? new Set() : new Set(proposals.map((p) => p.id)));

  async function deleteProposals(ids: string[], description: string) {
    if (!productId) return;
    const ok = await confirm({
      title: '提案の削除',
      description,
      confirmLabel: '削除',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      for (const id of ids) await api.deleteProposal(productId, id);
      toast.success(`${ids.length} 件の提案を削除しました。`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await load(productId);
    }
  }

  const removeSelected = () =>
    deleteProposals(
      [...selected],
      `選択した ${selected.size} 件の提案を削除します。よろしいですか？`,
    );

  const removeOne = (proposal: Proposal) =>
    deleteProposals([proposal.id], `「${proposal.title}」を削除します。よろしいですか？`);

  return (
    <section>
      <PageHeader
        title="提案"
        description={`${selectedProduct.name} への要望・提案と、生成 AI による評価です。`}
        actions={
          <>
            {proposals !== null && proposals.length > 0 && (
              <div className="flex items-center gap-2 pr-2">
                <Checkbox id="select-all" checked={allSelected} onCheckedChange={toggleAll} />
                <Label htmlFor="select-all">すべて選択</Label>
              </div>
            )}
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={selected.size === 0 || busy}
              onClick={removeSelected}
            >
              <Trash2Icon />
              削除
            </Button>
            <Button onClick={() => navigate('/proposals/new')}>
              <PlusIcon />
              新規登録
            </Button>
          </>
        }
      />
      <ErrorMessage>{error}</ErrorMessage>
      {proposals === null ? (
        !error && <CardsLoading />
      ) : proposals.length === 0 ? (
        <EmptyState>提案がまだありません。「新規登録」から入力してください。</EmptyState>
      ) : (
        <ul className={GRID} aria-label="提案の一覧">
          {proposals.map((proposal) => {
            const isSelected = selected.has(proposal.id);
            return (
              <li key={proposal.id} className="min-w-0">
                <Card
                  data-state={isSelected ? 'selected' : undefined}
                  className={cn(
                    'h-full gap-3 py-4 transition-shadow',
                    isSelected && 'ring-2 ring-primary',
                  )}
                >
                  <CardHeader className="gap-1 px-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        aria-label={`${proposal.title} を選択`}
                        checked={isSelected}
                        onCheckedChange={() => toggle(proposal.id)}
                      />
                      <CardTitle className="line-clamp-1 leading-normal" title={proposal.title}>
                        {proposal.title}
                      </CardTitle>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {proposal.author.name}
                      <span aria-hidden="true"> · </span>
                      <span className="tabular-nums">{formatDate(proposal.createdAt)}</span>
                    </p>
                  </CardHeader>
                  <CardContent className="px-4">
                    <p className="line-clamp-2 text-sm break-words text-muted-foreground">
                      {excerpt(proposal.body)}
                    </p>
                  </CardContent>
                  <CardFooter className="mt-auto flex-wrap gap-2 px-4">
                    <ScoreBadge label="RICE" value={proposal.rice?.score} variant="secondary" />
                    <ScoreBadge
                      label="合致度"
                      value={proposal.strategyFit?.score}
                      variant="outline"
                    />
                    <div className="ml-auto flex items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${proposal.title} を編集`}
                        disabled={busy}
                        onClick={() =>
                          navigate(`/proposals/${encodeURIComponent(proposal.id)}/edit`)
                        }
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        aria-label={`${proposal.title} を削除`}
                        disabled={busy}
                        onClick={() => removeOne(proposal)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
