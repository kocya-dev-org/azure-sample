import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type Proposal } from '../api/client';
import { ErrorMessage, formatDate, formatScore, NoProductSelected } from '../components/common';
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
        <h1>提案</h1>
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
    if (!window.confirm(`選択した ${selected.size} 件の提案を削除します。よろしいですか？`)) return;
    setBusy(true);
    try {
      for (const id of selected) await api.deleteProposal(productId, id);
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
      <h1>提案</h1>
      <div className="toolbar">
        <button type="button" className="primary" onClick={() => navigate('/proposals/new')}>
          新規登録
        </button>
        <button
          type="button"
          disabled={selected.size !== 1 || busy}
          onClick={() => navigate(`/proposals/${encodeURIComponent(onlySelected)}/edit`)}
        >
          編集
        </button>
        <button
          type="button"
          className="danger"
          disabled={selected.size === 0 || busy}
          onClick={removeSelected}
        >
          削除
        </button>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {proposals === null ? (
        <p className="muted">読み込み中…</p>
      ) : proposals.length === 0 ? (
        <p className="empty">提案がまだありません。「新規登録」から入力してください。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
              <th>タイトル</th>
              <th>投稿者</th>
              <th>登録日</th>
              <th className="number">RICE</th>
              <th className="number">合致度</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${proposal.title} を選択`}
                    checked={selected.has(proposal.id)}
                    onChange={() => toggle(proposal.id)}
                  />
                </td>
                <td>{proposal.title}</td>
                <td>{proposal.author.name}</td>
                <td>{formatDate(proposal.createdAt)}</td>
                <td className="number">{formatScore(proposal.rice?.score)}</td>
                <td className="number">{formatScore(proposal.strategyFit?.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
