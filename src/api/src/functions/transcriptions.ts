// 提案の音声入力。録音した音声（生のバイナリ）を受け取り、文字起こしの結果を返す。
// 音声は保存しない（ADR 0011）。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { withAuth } from '../lib/auth';
import { jsonError, logError } from '../lib/http';
import { getProduct } from '../lib/store';
import { transcribe } from '../lib/transcription';

/** 受け付ける音声の上限。録音の上限（90 秒）に余裕を持たせた値。 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** 受け付ける Content-Type と、文字起こしに渡すファイル名の対応。 */
const AUDIO_FILE_NAMES: Record<string, string> = {
  'audio/webm': 'audio.webm',
  'audio/mp4': 'audio.mp4',
};

/** Content-Type から、文字起こしに渡すファイル名を決める。対象外なら undefined。 */
export function audioFileName(contentType: string | null): string | undefined {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  return type ? AUDIO_FILE_NAMES[type] : undefined;
}

export async function transcribeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId } = request.params;
  const fileName = audioFileName(request.headers.get('content-type'));
  if (!fileName) {
    return jsonError(415, '音声の形式に対応していません（audio/webm または audio/mp4）。');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > MAX_AUDIO_BYTES) return jsonError(413, '録音が長すぎます。');

  let audio: Buffer;
  try {
    audio = Buffer.from(await request.arrayBuffer());
  } catch {
    return jsonError(400, '音声を読み込めませんでした。');
  }
  if (audio.length === 0) return jsonError(400, '音声が空です。');
  if (audio.length > MAX_AUDIO_BYTES) return jsonError(413, '録音が長すぎます。');

  try {
    if (!(await getProduct(productId))) return jsonError(404, 'プロダクトが見つかりません。');
  } catch (error) {
    logError(context, 'Product read failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }

  try {
    const text = (await transcribe(audio, fileName)).trim();
    return { jsonBody: { text } };
  } catch (error) {
    logError(context, 'Transcription failed', error);
    return jsonError(502, '音声の文字起こしに失敗しました。もう一度お試しください。');
  }
}

app.http('transcribeProposalAudio', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/transcriptions',
  handler: withAuth(transcribeHandler),
});
