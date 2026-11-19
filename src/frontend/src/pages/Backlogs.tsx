import { CalendarRangeIcon, ChevronRightIcon, Loader2Icon, PlusIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
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
import { api, errorMessage, type Backlog } from '../api/client';
import {
  EmptyState,
  ErrorMessage,
  formatDate,
  LoadingState,
  NoProductSelected,
  PageHeader,
} from '../components/common';
import { Dialog } from '../components/Dialog';
import { useProducts } from '../context/ProductContext';
import { useRouter } from '../router';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 日本時間の日付を YYYY-MM-DD で返す。 */
export function tokyoDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date);
}

function CreateBacklogDialog({
  productId,
  onClose,
  onCreated,
}: {
  productId: string;
  onClose: () => void;
  onCreated: (backlog: Backlog) => void;
}) {
  const [from, setFrom] = useState(() => tokyoDate(new Date(Date.now() - 30 * DAY_MS)));
  const [to, setTo] = useState(() => tokyoDate(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function create(event: FormEvent) {
    event.preventDefault();
    if (from > to) {
      setError('開始日は終了日以前にしてください。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      onCreated(await api.createBacklog(productId, { from, to }));
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="バックログの作成"
      description="指定した期間（日本時間、両端を含む）に登録された提案から、RICE スコアの高い順に上位 10 件を選びます。"
      onClose={onClose}
    >
      <form className="grid gap-4" onSubmit={create}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="backlog-from">開始日</Label>
            <Input
              id="backlog-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="backlog-to">終了日</Label>
            <Input
              id="backlog-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
        </div>
        <ErrorMessage>{error}</ErrorMessage>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2Icon className="animate-spin" />}
            {saving ? '作成中…' : '作成'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function BacklogsPage() {
  const { selectedProduct } = useProducts();
  const { navigate } = useRouter();
  const productId = selectedProduct?.id;
  const [backlogs, setBacklogs] = useState<Backlog[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!productId) return;
    let active = true;
    api
      .listBacklogs(productId)
      .then((list) => {
        if (active) setBacklogs(list);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (!productId) {
    return (
      <section>
        <PageHeader title="バックログ" />
        <NoProductSelected />
      </section>
    );
  }

  const open = (id: string) => navigate(`/backlogs/${encodeURIComponent(id)}`);

  return (
    <section>
      <PageHeader
        title="バックログ"
        description="期間内の提案から選んだ、次期開発の上位 10 件です。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            作成
          </Button>
        }
      />
      <ErrorMessage>{error}</ErrorMessage>
      {backlogs === null ? (
        !error && <LoadingState />
      ) : backlogs.length === 0 ? (
        <EmptyState>
          バックログがまだありません。「作成」から期間を指定して作成してください。
        </EmptyState>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">期間</TableHead>
                <TableHead>作成日</TableHead>
                <TableHead className="text-right">件数</TableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">開く</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backlogs.map((backlog) => (
                <TableRow
                  key={backlog.id}
                  className="cursor-pointer"
                  onClick={() => open(backlog.id)}
                >
                  <TableCell className="pl-4">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 font-medium tabular-nums hover:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        open(backlog.id);
                      }}
                    >
                      <CalendarRangeIcon
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {backlog.from} 〜 {backlog.to}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(backlog.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="tabular-nums">
                      {backlog.items.length} 件
                    </Badge>
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
      {creating && (
        <CreateBacklogDialog
          productId={productId}
          onClose={() => setCreating(false)}
          onCreated={(backlog) => open(backlog.id)}
        />
      )}
    </section>
  );
}
