import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { generateText } from './foundry';

app.http('hello', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'hello',
  handler: async (_request, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const message = await generateText('日本語で短く、親しみやすい挨拶をしてください。');
      return { jsonBody: { message, service: 'flyingfish-api' } };
    } catch (error) {
      context.error('Foundry hello generation failed', error);
      return { status: 502, jsonBody: { error: 'Microsoft Foundry の呼び出しに失敗しました。' } };
    }
  },
});
