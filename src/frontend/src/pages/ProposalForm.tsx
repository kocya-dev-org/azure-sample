import {
  ArrowLeftIcon,
  Loader2Icon,
  PackageSearchIcon,
  PencilLineIcon,
  SendIcon,
  SparklesIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  api,
  errorMessage,
  streamReview,
  type ImplementationResult,
  type ImplementationStatus,
} from '../api/client';
import { ErrorMessage, NoProductSelected, PageHeader } from '../components/common';
import {
  formatRecord,
  useVoiceConversation,
  VoiceConversationButton,
  VoiceConversationPanel,
  type ProposalRecord,
} from '../components/VoiceConversation';
import { VoiceInput } from '../components/VoiceInput';
import { useProducts } from '../context/ProductContext';
import { Link, useRouter } from '../router';

// input: 入力中 / reviewing: 判定中 / reviewed: 判定済み（送信か追記かを選ぶ） / submitting: 送信中
type Phase = 'loading' | 'input' | 'reviewing' | 'reviewed' | 'submitting';

/** 内容の上限（API の検証と同じ）。 */
const BODY_MAX_LENGTH = 8000;

const IMPLEMENTATION_LABELS: Record<
  ImplementationStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  implemented: { label: '実装済み', variant: 'default' },
  partial: { label: '一部実装済み', variant: 'secondary' },
  not_implemented: { label: '未実装', variant: 'outline' },
  unknown: { label: '確認できませんでした', variant: 'outline' },
};

export function ProposalFormPage({ proposalId }: { proposalId?: string }) {
  const { selectedProduct } = useProducts();
  const { navigate } = useRouter();
  const productId = selectedProduct?.id;
  const [phase, setPhase] = useState<Phase>(proposalId ? 'loading' : 'input');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [implementation, setImplementation] = useState<ImplementationResult | null>(null);
  const [error, setError] = useState('');
  // 録音中・文字起こし中・音声会話中は判定させない
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);
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

  const conversation = useVoiceConversation({
    productId: productId ?? '',
    getDraft: () => ({ title, body }),
    onFinish: applyConversation,
    onBusyChange: setConversationBusy,
    onError: setError,
  });

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
    setImplementation(null);
    setError('');
    try {
      await streamReview(
        productId,
        { title, body },
        (text) => setComment((current) => current + text),
        controller.signal,
        setImplementation,
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

  /** 音声会話で記録した内容を反映する。タイトルは空のときだけ設定し、内容は末尾に追記する。 */
  function applyConversation(record: ProposalRecord) {
    const recordedTitle = record.title;
    if (recordedTitle) {
      setTitle((current) => (current.trim() ? current : recordedTitle.slice(0, 200)));
    }
    const text = formatRecord(record);
    if (text) appendTranscript(text);
  }

  const editable = phase === 'input';
  const busy = voiceBusy || conversationBusy;
  const canReview = editable && !busy && title.trim() !== '' && body.trim() !== '';

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
                <div className="flex flex-wrap gap-2">
                  <VoiceConversationButton
                    conversation={conversation}
                    disabled={!editable || voiceBusy}
                  />
                  <VoiceInput
                    productId={productId}
                    disabled={!editable || conversationBusy}
                    onText={appendTranscript}
                    onBusyChange={setVoiceBusy}
                    onError={setError}
                  />
                </div>
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
            <VoiceConversationPanel conversation={conversation} />
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
            {(implementation || (comment && phase === 'reviewing')) && (
              <div className="grid gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <PackageSearchIcon className="size-4 text-primary" aria-hidden="true" />
                  実装状況
                </span>
                <div
                  className="rounded-lg border p-4 text-sm leading-relaxed"
                  aria-live="polite"
                  data-testid="implementation"
                >
                  {implementation ? (
                    <div className="flex flex-col gap-2">
                      <Badge variant={IMPLEMENTATION_LABELS[implementation.status].variant}>
                        {IMPLEMENTATION_LABELS[implementation.status].label}
                      </Badge>
                      <p className="whitespace-pre-wrap">{implementation.explanation}</p>
                    </div>
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                      いまのアプリに実装済みかを確認中…
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
