// サインイン中の利用者の情報。画面はこの結果で、操作できる状態かを決める。
// このエンドポイントだけは withAuth で包まず、未登録の利用者にも結果を返す。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { checkUser } from '../lib/auth';
import { getPrincipal, jsonError, logError } from '../lib/http';

export async function meHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const authorized = (await checkUser(request)) === 'authorized';
    // メールアドレスは返さない（表示名は getPrincipal と同じ規則で作る）
    return { jsonBody: { authorized, name: getPrincipal(request).name } };
  } catch (error) {
    logError(context, 'User authorization failed', error);
    return jsonError(503, '利用権限を確認できませんでした。');
  }
}

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: meHandler,
});
