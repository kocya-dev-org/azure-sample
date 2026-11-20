import { ArrowLeftIcon, Loader2Icon, PencilLineIcon, SendIcon, SparklesIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, streamReview } from '../api/client';
import { ErrorMessage, NoProductSelected, PageHeader } from '../components/common';
import { VoiceInput } from '../components/VoiceInput';
import { useProducts } from '../context/ProductContext';
import { Link, useRouter } from '../router';

// input: 入力中 / reviewing: 判定中 / reviewed: 判定済み（送信か追記かを選ぶ） / submitting: 送信中
type Phase = 'loading' | 'input' | 'reviewing' | 'reviewed' | 'submitting';

/** 内容の上限（API の検証と同じ）。 */
const BODY_MAX_LENGTH = 8000;

export function ProposalFormPage({ proposalId }: { proposalId?: string }) {
  const { selectedProduct } = useProducts();
  const { navigate } = useRouter();
  const productId = selectedProduct?.id;
  const [phase, setPhase] = useState<Phase>(proposalId ? 'loading' : 'input');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  // 録音中・文字起こし中は判定させない
  const [voiceBusy, setVoiceBusy] = useState(false);
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
        <PageHeader title={heading} />
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
      toast.success(proposalId ? '提案を更新しました。' : '提案を登録しました。');
      navigate('/proposals');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('reviewed');
    }
  }

  /** 文字起こしの結果を内容の末尾に追記する。 */
  function appendTranscript(text: string) {
    setBody((current) =>
      (current.trimEnd() ? `${current.trimEnd()}\n${text}` : text).slice(0, BODY_MAX_LENGTH),
    );
  }

  const editable = phase === 'input';
  const canReview = editable && !voiceBusy && title.trim() !== '' && body.trim() !== '';

  return (
    <section className="mx-auto max-w-3xl">
      <PageHeader
        title={heading}
        description={
          <>
            対象プロダクト: {selectedProduct?.name}。入力後に「判定」を押すと、RICE
            の評価に足りない情報を生成 AI がコメントします。
          </>
        }
      >
        <Link
          to="/proposals"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          提案一覧
        </Link>
      </PageHeader>
      <Card>
        <form onSubmit={review} className="flex flex-col gap-6">
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="proposal-title">タイトル</Label>
              <Input
                id="proposal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                readOnly={!editable}
                required
              />
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="proposal-body">内容</Label>
                <VoiceInput
                  productId={productId}
                  disabled={!editable}
                  onText={appendTranscript}
                  onBusyChange={setVoiceBusy}
                  onError={setError}
                />
              </div>
              <Textarea
                id="proposal-body"
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={BODY_MAX_LENGTH}
                readOnly={!editable}
                className="min-h-48 read-only:bg-muted/50"
                placeholder="顧客から聞いた要望や企画の内容。対象ユーザー数、効果、確度、工数の見込みがあれば書いてください。"
                required
              />
            </div>
            {(comment || phase === 'reviewing') && (
              <div className="grid gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
                  生成 AI のコメント
                </span>
                <div
                  className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed whitespace-pre-wrap"
                  aria-live="polite"
                  data-testid="ai-comment"
                >
                  {comment || (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                      判定中…
                    </span>
                  )}
                </div>
              </div>
            )}
            <ErrorMessage>{error}</ErrorMessage>
          </CardContent>
          <CardFooter className="flex-wrap gap-2 border-t">
            <Button variant="ghost" asChild>
              <Link to="/proposals">キャンセル</Link>
            </Button>
            <span className="flex-1" />
            {phase === 'reviewed' || phase === 'submitting' ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={appendAndReview}
                  disabled={phase === 'submitting'}
                >
                  <PencilLineIcon />
                  追記して再判定
                </Button>
                <Button type="button" onClick={submit} disabled={phase === 'submitting'}>
                  {phase === 'submitting' ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  {phase === 'submitting' ? 'スコアリング中…' : 'このまま送信'}
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={!canReview}>
                {phase === 'reviewing' ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SparklesIcon />
                )}
                {phase === 'reviewing' ? '判定中…' : '判定'}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </section>
  );
}
