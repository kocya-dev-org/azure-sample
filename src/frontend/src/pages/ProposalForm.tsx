import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, streamReview } from '../api/client';
import { ErrorMessage, NoProductSelected } from '../components/common';
import { useProducts } from '../context/ProductContext';
import { Link, useRouter } from '../router';

// input: 入力中 / reviewing: 判定中 / reviewed: 判定済み（送信か追記かを選ぶ） / submitting: 送信中
type Phase = 'loading' | 'input' | 'reviewing' | 'reviewed' | 'submitting';

export function ProposalFormPage({ proposalId }: { proposalId?: string }) {
  const { selectedProduct } = useProducts();
  const { navigate } = useRouter();
  const productId = selectedProduct?.id;
  const [phase, setPhase] = useState<Phase>(proposalId ? 'loading' : 'input');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!proposalId || !productId) return;
    let active = true;
    api
      .getProposal(productId, proposalId)
      .then((proposal) => {
        if (!active) return;
        setTitle(proposal.title);
        setBody(proposal.body);
        setPhase('input');
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [productId, proposalId]);

  // 画面を離れたら判定のストリームを止める
  useEffect(() => () => abortRef.current?.abort(), []);

  const heading = proposalId ? '提案の編集' : '提案の新規登録';
  if (!productId) {
    return (
      <section>
        <h1>{heading}</h1>
        <NoProductSelected />
      </section>
    );
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!productId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('reviewing');
    setComment('');
    setError('');
    try {
      await streamReview(
        productId,
        { title, body },
        (text) => setComment((current) => current + text),
        controller.signal,
      );
      setPhase('reviewed');
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(errorMessage(e));
      setPhase('input');
    }
  }

  function appendAndReview() {
    setPhase('input');
    // 追記しやすいよう、内容の末尾にカーソルを置く
    setTimeout(() => {
      const textarea = bodyRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);
  }

  async function submit() {
    if (!productId) return;
    setPhase('submitting');
    setError('');
    try {
      if (proposalId) await api.updateProposal(productId, proposalId, { title, body });
      else await api.createProposal(productId, { title, body });
      navigate('/proposals');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('reviewed');
    }
  }

  const editable = phase === 'input';
  const canReview = editable && title.trim() !== '' && body.trim() !== '';

  return (
    <section>
      <h1>{heading}</h1>
      <p className="muted">
        対象プロダクト: {selectedProduct?.name}。入力後に「判定」を押すと、RICE
        の評価に足りない情報を生成 AI がコメントします。
      </p>
      <form className="form" onSubmit={review}>
        <label className="field">
          <span>タイトル</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            readOnly={!editable}
            required
          />
        </label>
        <label className="field">
          <span>内容</span>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8000}
            readOnly={!editable}
            placeholder="顧客から聞いた要望や企画の内容。対象ユーザー数、効果、確度、工数の見込みがあれば書いてください。"
            required
          />
        </label>
        {(comment || phase === 'reviewing') && (
          <div className="field">
            <span>生成 AI のコメント</span>
            <div className="ai-comment" aria-live="polite" data-testid="ai-comment">
              {comment || '判定中…'}
            </div>
          </div>
        )}
        <ErrorMessage>{error}</ErrorMessage>
        <div className="actions">
          <Link to="/proposals">キャンセル</Link>
          <span className="spacer" />
          {phase === 'reviewed' || phase === 'submitting' ? (
            <>
              <button type="button" onClick={appendAndReview} disabled={phase === 'submitting'}>
                追記して再判定
              </button>
              <button
                type="button"
                className="primary"
                onClick={submit}
                disabled={phase === 'submitting'}
              >
                {phase === 'submitting' ? 'スコアリング中…' : 'このまま送信'}
              </button>
            </>
          ) : (
            <button type="submit" className="primary" disabled={!canReview}>
              {phase === 'reviewing' ? '判定中…' : '判定'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
