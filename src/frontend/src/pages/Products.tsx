import { ChevronRightIcon, FolderGit2Icon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, type Product } from '../api/client';
import {
  EmptyState,
  ErrorMessage,
  formatDate,
  LoadingState,
  PageHeader,
} from '../components/common';
import { useConfirm } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { useProducts } from '../context/ProductContext';

const REPOSITORY_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

function ProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product | undefined;
  onClose: () => void;
  onSaved: (deletedId?: string) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [strategy, setStrategy] = useState(product?.strategy ?? '');
  const [repository, setRepository] = useState(product?.repository ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  async function save(event: FormEvent) {
    event.preventDefault();
    const repo = repository.trim();
    if (repo && !REPOSITORY_PATTERN.test(repo)) {
      setError('リポジトリは org/repository の形式で入力してください。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const input = { name, strategy, repository: repo || undefined };
      if (product) await api.updateProduct(product.id, input);
      else await api.createProduct(input);
      toast.success(product ? `「${name}」を保存しました。` : `「${name}」を登録しました。`);
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  async function remove() {
    if (!product) return;
    const ok = await confirm({
      title: 'プロダクトの削除',
      description: `「${product.name}」を削除します。紐づく提案・スコア・バックログもすべて削除されます。よろしいですか？`,
      confirmLabel: '削除',
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteProduct(product.id);
      toast.success(`「${product.name}」を削除しました。`);
      await onSaved(product.id);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog title={product ? 'プロダクトの編集' : 'プロダクトの新規登録'} onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="grid gap-2">
          <Label htmlFor="product-name">名前</Label>
          <Input
            id="product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="product-strategy">戦略</Label>
          <Textarea
            id="product-strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            maxLength={4000}
            className="min-h-32"
            placeholder="プロダクトの狙い、開発戦略、将来像など"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="product-repository">リポジトリ（任意）</Label>
          <Input
            id="product-repository"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="org/repository"
            aria-describedby="product-repository-hint"
          />
          <p id="product-repository-hint" className="text-xs text-muted-foreground">
            GitHub の org/repository 形式で入力します。Issue 起票に使います。
          </p>
        </div>
        <ErrorMessage>{error}</ErrorMessage>
        <DialogFooter className="sm:justify-between">
          {product ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={remove}
              disabled={saving}
            >
              <Trash2Icon />
              削除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              キャンセル
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2Icon className="animate-spin" />}
              {product ? '保存' : '登録'}
            </Button>
          </div>
        </DialogFooter>
      </form>
      {confirmDialog}
    </Dialog>
  );
}

export function ProductsPage() {
  const { products, loading, error, reload, selectedProduct, selectProduct } = useProducts();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  async function onSaved(deletedId?: string) {
    if (deletedId && selectedProduct?.id === deletedId) selectProduct('');
    setEditing(null);
    await reload();
  }

  return (
    <section>
      <PageHeader
        title="プロダクト情報"
        description="プロダクトの戦略は、提案の戦略合致度の評価に使います。"
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon />
            新規登録
          </Button>
        }
      />
      <ErrorMessage>{error}</ErrorMessage>
      {loading ? (
        <LoadingState />
      ) : products.length === 0 ? (
        <EmptyState>プロダクトがまだありません。「新規登録」から登録してください。</EmptyState>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">名前</TableHead>
                <TableHead>リポジトリ</TableHead>
                <TableHead>更新日</TableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">開く</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow
                  key={product.id}
                  className="cursor-pointer"
                  onClick={() => setEditing(product)}
                >
                  <TableCell className="pl-4">
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditing(product);
                      }}
                    >
                      {product.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    {product.repository ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                        <FolderGit2Icon className="size-3.5" aria-hidden="true" />
                        {product.repository}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(product.updatedAt)}
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">
                    <ChevronRightIcon className="size-4" aria-hidden="true" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing && (
        <ProductDialog
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
