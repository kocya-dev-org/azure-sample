import { app, type HttpResponseInit } from '@azure/functions';

app.http('hello', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'hello',
  handler: async (): Promise<HttpResponseInit> => ({
    jsonBody: {
      message: 'Functions API から応答しています。',
      service: 'flyingfish-api',
    },
  }),
});
