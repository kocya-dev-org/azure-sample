import { Fragment, useEffect, useState } from 'react';
import {
  api,
  errorMessage,
  type BacklogDetail,
  type BacklogDetailEntry,
  type ItemStatus,
} from '../api/client';
import { ErrorMessage, formatDate, formatScore, NoProductSelected } from '../components/common';
import { useProducts } from '../context/ProductContext';
import { Link } from '../router';

function Rationale({ entry }: { entry: BacklogDetailEntry }) {
  if (entry.deleted || !entry.rice || !entry.strategyFit) {
    return <p className="muted">元の提案は削除されています。</p>;
  }
  const { rice, strategyFit } = entry;
  return (
    <dl>
      <dt>RICE（現在の評価）</dt>
      <dd>
        Reach {formatScore(rice.reach)} × Impact {formatScore(rice.impact)} × Confidence{' '}
        {formatScore(rice.confidence)} ÷ Effort {formatScore(rice.effort)} ={' '}
        {formatScore(rice.score)}
        <br />
        {rice.rationale}
      </dd>
      <dt>戦略合致度（現在の評価）: {strategyFit.score}</dt>
      <dd>{strategyFit.rationale}</dd>
    </dl>
  );
}

export function BacklogDetailPage({ backlogId }: { backlogId: string }) {
  const { selectedProduct } = useProducts();
  const productId = selectedProduct?.id;
  const [backlog, setBacklog] = useState<BacklogDetail | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
        <h1>バックログ詳細</h1>
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
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section>
      <p>
        <Link to="/backlogs">← バックログ一覧</Link>
      </p>
      <h1>バックログ詳細</h1>
      <ErrorMessage>{error}</ErrorMessage>
      {!backlog ? (
        !error && <p className="muted">読み込み中…</p>
      ) : (
        <>
          <p className="muted">
            期間: {backlog.from} 〜 {backlog.to} ／ 作成日: {formatDate(backlog.createdAt)} ／
            作成者: {backlog.createdBy.name}
          </p>
          {backlog.items.length === 0 ? (
            <p className="empty">期間内にスコアリング済みの提案がありませんでした。</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="number">順位</th>
                  <th>項目名</th>
                  <th className="number">RICE スコア</th>
                  <th className="number">戦略合致度</th>
                  <th>実装状況</th>
                  <th>根拠</th>
                </tr>
              </thead>
              <tbody>
                {backlog.items.map((entry) => {
                  const open = expanded.has(entry.scoredItemId);
                  return (
                    <Fragment key={entry.scoredItemId}>
                      <tr>
                        <td className="number">{entry.rank}</td>
                        <td>
                          {entry.title}
                          {entry.deleted && <span className="muted">（削除済み）</span>}
                        </td>
                        <td className="number">{formatScore(entry.riceScore)}</td>
                        <td className="number">{formatScore(entry.strategyFitScore)}</td>
                        <td>
                          {entry.deleted ? (
                            <span className="muted">—</span>
                          ) : (
                            <select
                              aria-label={`${entry.title} の実装状況`}
                              value={entry.status ?? 'open'}
                              onChange={(e) => changeStatus(entry, e.target.value as ItemStatus)}
                            >
                              <option value="open">未対応</option>
                              <option value="done">実装済み</option>
                            </select>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="link"
                            aria-expanded={open}
                            onClick={() => toggle(entry.scoredItemId)}
                          >
                            {open ? '閉じる' : '表示'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="detail-row">
                          <td colSpan={6}>
                            <Rationale entry={entry} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted">順位とスコアは作成時点の値です。根拠には現在の評価を表示します。</p>
        </>
      )}
    </section>
  );
}
