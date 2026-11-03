const { app } = require('@azure/functions');

app.http('hello', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'hello',
  handler: async () => ({
    jsonBody: {
      message: 'Functions API から応答しています。',
      service: 'flyingfish-api',
    },
  }),
});
