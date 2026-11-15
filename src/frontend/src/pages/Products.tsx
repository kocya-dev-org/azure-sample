import { useState, type FormEvent } from 'react';
import { api, errorMessage, type Product } from '../api/client';
import { ErrorMessage, formatDate } from '../components/common';
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
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  async function remove() {
    if (!product) return;
    const ok = window.confirm(
      `「${product.name}」を削除します。紐づく提案・スコア・バックログもすべて削除されます。よろしいですか？`,
    );
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteProduct(product.id);
      await onSaved(product.id);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog title={product ? 'プロダクトの編集' : 'プロダクトの新規登録'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>名前</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </label>
        <label className="field">
          <span>戦略</span>
          <textarea
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            maxLength={4000}
            placeholder="プロダクトの狙い、開発戦略、将来像など"
            required
          />
        </label>
        <div className="field">
          <label htmlFor="product-repository">リポジトリ（任意）</label>
          <input
            id="product-repository"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="org/repository"
            aria-describedby="product-repository-hint"
          />
          <small id="product-repository-hint">
            GitHub の org/repository 形式で入力します。Issue 起票に使います。
          </small>
        </div>
        <ErrorMessage>{error}</ErrorMessage>
        <div className="actions">
          {product && (
            <button type="button" className="danger" onClick={remove} disabled={saving}>
              削除
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {product ? '保存' : '登録'}
          </button>
        </div>
      </form>
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
      <h1>プロダクト情報</h1>
      <div className="toolbar">
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          新規登録
        </button>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {loading ? (
        <p className="muted">読み込み中…</p>
      ) : products.length === 0 ? (
        <p className="empty">プロダクトがまだありません。「新規登録」から登録してください。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名前</th>
              <th>リポジトリ</th>
              <th>更新日</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="clickable" onClick={() => setEditing(product)}>
                <td>
                  <button type="button" className="link" onClick={() => setEditing(product)}>
                    {product.name}
                  </button>
                </td>
                <td>{product.repository ?? <span className="muted">—</span>}</td>
                <td>{formatDate(product.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
