import { LayoutGridIcon, ListIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

// --- 表示レイアウト（カード / リスト） ---

export type ProposalLayout = 'cards' | 'list';

export const LAYOUT_STORAGE_KEY = 'flyingfish.proposalsLayout';

function readStoredLayout(): ProposalLayout {
  try {
    const value = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (value === 'cards' || value === 'list') return value;
  } catch {
    // プライベートウィンドウなどで localStorage を使えない場合は既定値にする
  }
  return 'cards';
}

/** 表示レイアウトを、ブラウザーごとに覚えておく。既定はカード。 */
function useProposalLayout(): [ProposalLayout, (layout: ProposalLayout) => void] {
  const [layout, setLayoutState] = useState<ProposalLayout>(readStoredLayout);
  const setLayout = useCallback((next: ProposalLayout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      // 保存できなくても、表示中のレイアウトは切り替える
    }
  }, []);
  return [layout, setLayout];
}

const LAYOUT_OPTIONS: { value: ProposalLayout; label: string; icon: typeof ListIcon }[] = [
  { value: 'cards', label: 'カード表示', icon: LayoutGridIcon },
  { value: 'list', label: 'リスト表示', icon: ListIcon },
];

function LayoutToggle({
  value,
  onChange,
}: {
  value: ProposalLayout;
  onChange: (layout: ProposalLayout) => void;
}) {
  return (
    <div
      role="group"
      aria-label="表示の切り替え"
      className="flex rounded-md border p-0.5 shadow-xs"
    >
      {LAYOUT_OPTIONS.map(({ value: option, label, icon: Icon }) => (
        <Button
          key={option}
          variant={value === option ? 'secondary' : 'ghost'}
          size="icon"
          className="size-8"
          aria-label={label}
          aria-pressed={value === option}
          title={label}
          onClick={() => onChange(option)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}

// --- 共通の部品 ---

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
  label?: string;
  value: number | null | undefined;
  variant: 'secondary' | 'outline';
}) {
  return (
    <Badge variant={variant} className="gap-1.5">
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className="tabular-nums">{formatScore(value)}</span>
    </Badge>
  );
}

/** カードとリストで共有する、1 件分の表示と操作。 */
interface ItemProps {
  proposal: Proposal;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function SelectCheckbox({ proposal, selected, onToggle }: ItemProps) {
  return (
    <Checkbox
      aria-label={`${proposal.title} を選択`}
      checked={selected}
      onCheckedChange={onToggle}
    />
  );
}

function ItemActions({ proposal, busy, onEdit, onRemove }: ItemProps) {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${proposal.title} を編集`}
        disabled={busy}
        onClick={onEdit}
      >
        <PencilIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive"
        aria-label={`${proposal.title} を削除`}
        disabled={busy}
        onClick={onRemove}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

// --- カード表示 ---

function ProposalCard(props: ItemProps) {
  const { proposal, selected } = props;
  return (
    <li className="min-w-0">
      <Card
        data-state={selected ? 'selected' : undefined}
        className={cn('h-full gap-3 py-4 transition-shadow', selected && 'ring-2 ring-primary')}
      >
        <CardHeader className="gap-1 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <SelectCheckbox {...props} />
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
          <ScoreBadge label="合致度" value={proposal.strategyFit?.score} variant="outline" />
          <div className="ml-auto">
            <ItemActions {...props} />
          </div>
        </CardFooter>
      </Card>
    </li>
  );
}

// --- リスト表示 ---

function ProposalRow(props: ItemProps) {
  const { proposal, selected } = props;
  return (
    <TableRow data-state={selected ? 'selected' : undefined}>
      <TableCell className="pl-4">
        <SelectCheckbox {...props} />
      </TableCell>
      <TableCell className="max-w-80">
        <p className="truncate font-medium" title={proposal.title}>
          {proposal.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">{excerpt(proposal.body)}</p>
      </TableCell>
      <TableCell className="text-muted-foreground">{proposal.author.name}</TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {formatDate(proposal.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <ScoreBadge value={proposal.rice?.score} variant="secondary" />
      </TableCell>
      <TableCell className="text-right">
        <ScoreBadge value={proposal.strategyFit?.score} variant="outline" />
      </TableCell>
      <TableCell className="w-24 pr-2">
        <ItemActions {...props} />
      </TableCell>
    </TableRow>
  );
}

function ProposalTable({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-label="提案の一覧">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-10 pl-4">
              <span className="sr-only">選択</span>
            </TableHead>
            <TableHead>タイトル</TableHead>
            <TableHead>投稿者</TableHead>
            <TableHead>登録日</TableHead>
            <TableHead className="text-right">RICE</TableHead>
            <TableHead className="text-right">合致度</TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </Card>
  );
}

function ProposalsLoading({ layout }: { layout: ProposalLayout }) {
  return (
    <div className={layout === 'cards' ? GRID : 'space-y-2'} aria-busy="true">
      <span className="sr-only">読み込み中…</span>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton
          key={index}
          className={layout === 'cards' ? 'h-44 rounded-xl' : 'h-12 rounded-md'}
        />
      ))}
    </div>
  );
}

// --- ページ ---

export function ProposalsPage() {
  const { selectedProduct } = useProducts();
  const { navigate } = useRouter();
  const productId = selectedProduct?.id;
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useProposalLayout();
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

  const itemProps = (proposal: Proposal): ItemProps => ({
    proposal,
    selected: selected.has(proposal.id),
    busy,
    onToggle: () => toggle(proposal.id),
    onEdit: () => navigate(`/proposals/${encodeURIComponent(proposal.id)}/edit`),
    onRemove: () =>
      deleteProposals([proposal.id], `「${proposal.title}」を削除します。よろしいですか？`),
  });

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
            <LayoutToggle value={layout} onChange={setLayout} />
          </>
        }
      />
      <ErrorMessage>{error}</ErrorMessage>
      {proposals === null ? (
        !error && <ProposalsLoading layout={layout} />
      ) : proposals.length === 0 ? (
        <EmptyState>提案がまだありません。「新規登録」から入力してください。</EmptyState>
      ) : layout === 'cards' ? (
        <ul className={GRID} aria-label="提案の一覧">
          {proposals.map((proposal) => (
            <ProposalCard key={proposal.id} {...itemProps(proposal)} />
          ))}
        </ul>
      ) : (
        <ProposalTable>
          {proposals.map((proposal) => (
            <ProposalRow key={proposal.id} {...itemProps(proposal)} />
          ))}
        </ProposalTable>
      )}
      {confirmDialog}
    </section>
  );
}
