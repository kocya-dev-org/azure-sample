import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, errorMessage, type Proposal } from '../api/client';
import {
  EmptyState,
  ErrorMessage,
  formatDate,
  formatScore,
  LoadingState,
  NoProductSelected,
  PageHeader,
} from '../components/common';
import { useConfirm } from '../components/ConfirmDialog';
import { useProducts } from '../context/ProductContext';
import { useRouter } from '../router';

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

  async function removeSelected() {
    if (!productId) return;
    const count = selected.size;
    const ok = await confirm({
      title: '提案の削除',
      description: `選択した ${count} 件の提案を削除します。よろしいですか？`,
      confirmLabel: '削除',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      for (const id of selected) await api.deleteProposal(productId, id);
      toast.success(`${count} 件の提案を削除しました。`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await load(productId);
    }
  }

  const [onlySelected] = [...selected];

  return (
    <section>
      <PageHeader
        title="提案"
        description={`${selectedProduct.name} への要望・提案と、生成 AI による評価です。`}
        actions={
          <>
            <Button
              variant="outline"
              disabled={selected.size !== 1 || busy}
              onClick={() => navigate(`/proposals/${encodeURIComponent(onlySelected)}/edit`)}
            >
              <PencilIcon />
              編集
            </Button>
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
        !error && <LoadingState />
      ) : proposals.length === 0 ? (
        <EmptyState>提案がまだありません。「新規登録」から入力してください。</EmptyState>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="すべて選択"
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>タイトル</TableHead>
                <TableHead>投稿者</TableHead>
                <TableHead>登録日</TableHead>
                <TableHead className="text-right">RICE</TableHead>
                <TableHead className="pr-4 text-right">合致度</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.map((proposal) => (
                <TableRow
                  key={proposal.id}
                  data-state={selected.has(proposal.id) ? 'selected' : undefined}
                >
                  <TableCell className="pl-4">
                    <Checkbox
                      aria-label={`${proposal.title} を選択`}
                      checked={selected.has(proposal.id)}
                      onCheckedChange={() => toggle(proposal.id)}
                    />
                  </TableCell>
                  <TableCell className="max-w-80 truncate font-medium">{proposal.title}</TableCell>
                  <TableCell className="text-muted-foreground">{proposal.author.name}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(proposal.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="tabular-nums">
                      {formatScore(proposal.rice?.score)}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Badge variant="outline" className="tabular-nums">
                      {formatScore(proposal.strategyFit?.score)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {confirmDialog}
    </section>
  );
}
