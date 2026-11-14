import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';

function runJob(invocationPath: 'Manual', context: InvocationContext): void {
  context.info(invocationPath);
}

app.http('runJobManually', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'jobs/run',
  handler: async (_request, context: InvocationContext): Promise<HttpResponseInit> => {
    runJob('Manual', context);
    return { jsonBody: { message: 'Function を手動実行しました。', invocationPath: 'Manual' } };
  },
});
