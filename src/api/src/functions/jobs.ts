import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';

function runJob(invocationPath: 'sceduled' | 'Manual', context: InvocationContext): void {
  context.info(invocationPath);
}

app.timer('scheduledJob', {
  schedule: '0 */5 * * * *',
  runOnStartup: false,
  handler: async (_timer, context: InvocationContext): Promise<void> => {
    runJob('sceduled', context);
  },
});

app.http('runJobManually', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'jobs/run',
  handler: async (_request, context: InvocationContext): Promise<HttpResponseInit> => {
    runJob('Manual', context);
    return { jsonBody: { message: 'Function を手動実行しました。', invocationPath: 'Manual' } };
  },
});
