import { Fragment, useEffect, useState } from 'react';
import {
  api,
  errorMessage,
  type BacklogDetail,
  type BacklogDetailEntry,
  type IssueResult,
  type ItemStatus,
  MAX_ISSUES_PER_REQUEST,
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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
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
      setNotice(
        `起票 ${count('created')} 件、起票済みのためスキップ ${count('skipped')} 件、失敗 ${count('failed') + count('not_found')} 件`,
      );
      setChecked(new Set());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIssuing(false);
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
      ? 'GitHub 連携が未設定のため、Issue を起票できません。'
      : !backlog.hasRepository
        ? 'プロダクト情報にリポジトリが登録されていないため、Issue を起票できません。'
        : '';
  const canIssue = !!backlog && !issueDisabledReason;

  return (
    <section>
      <p>
        <Link to="/backlogs">← バックログ一覧</Link>
      </p>
      <h1>バックログ詳細</h1>
      {backlog && (
        <div className="toolbar">
          <button
            type="button"
            className="primary"
            onClick={createIssues}
            disabled={
              !canIssue || checked.size === 0 || checked.size > MAX_ISSUES_PER_REQUEST || issuing
            }
          >
            {issuing ? '起票中…' : 'Issue 起票'}
          </button>
          {issueDisabledReason && <span className="muted">{issueDisabledReason}</span>}
        </div>
      )}
      <ErrorMessage>{error}</ErrorMessage>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
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
                  <th>
                    <span className="visually-hidden">選択</span>
                  </th>
                  <th className="number">順位</th>
                  <th>項目名</th>
                  <th className="number">RICE スコア</th>
                  <th className="number">戦略合致度</th>
                  <th>実装状況</th>
                  <th>Issue</th>
                  <th>根拠</th>
                </tr>
              </thead>
              <tbody>
                {backlog.items.map((entry) => {
                  const open = expanded.has(entry.scoredItemId);
                  return (
                    <Fragment key={entry.scoredItemId}>
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${entry.title} を選択`}
                            checked={checked.has(entry.scoredItemId)}
                            disabled={!canIssue || entry.deleted || !!entry.issue}
                            onChange={() => toggleChecked(entry.scoredItemId)}
                          />
                        </td>
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
                          {entry.issue ? (
                            <a href={entry.issue.url} target="_blank" rel="noreferrer">
                              #{entry.issue.number}
                            </a>
                          ) : (
                            <span className="muted">—</span>
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
                          <td colSpan={8}>
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
