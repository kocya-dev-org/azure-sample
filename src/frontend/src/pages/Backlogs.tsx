import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Backlog } from '../api/client';
import { ErrorMessage, formatDate, NoProductSelected } from '../components/common';
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
    <Dialog title="バックログの作成" onClose={onClose}>
      <form className="form" onSubmit={create}>
        <p className="muted">
          指定した期間（日本時間、両端を含む）に登録された提案から、RICE スコアの高い順に上位 10
          件を選びます。
        </p>
        <label className="field">
          <span>開始日</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="field">
          <span>終了日</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <ErrorMessage>{error}</ErrorMessage>
        <div className="actions">
          <button type="button" onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? '作成中…' : '作成'}
          </button>
        </div>
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
        <h1>バックログ</h1>
        <NoProductSelected />
      </section>
    );
  }

  const open = (id: string) => navigate(`/backlogs/${encodeURIComponent(id)}`);

  return (
    <section>
      <h1>バックログ</h1>
      <div className="toolbar">
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          作成
        </button>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {backlogs === null ? (
        !error && <p className="muted">読み込み中…</p>
      ) : backlogs.length === 0 ? (
        <p className="empty">
          バックログがまだありません。「作成」から期間を指定して作成してください。
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>期間</th>
              <th>作成日</th>
              <th className="number">件数</th>
            </tr>
          </thead>
          <tbody>
            {backlogs.map((backlog) => (
              <tr key={backlog.id} className="clickable" onClick={() => open(backlog.id)}>
                <td>
                  <button type="button" className="link" onClick={() => open(backlog.id)}>
                    {backlog.from} 〜 {backlog.to}
                  </button>
                </td>
                <td>{formatDate(backlog.createdAt)}</td>
                <td className="number">{backlog.items.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
