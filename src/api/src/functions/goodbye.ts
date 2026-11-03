import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';

app.http('goodbye', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'goodbye',
  handler: async (request, context: InvocationContext): Promise<HttpResponseInit> => {
    const response = {
      message: 'goodbye',
    };

    context.info('Goodbye API invocation context:', {
      invocationId: context.invocationId,
      functionName: context.functionName,
      triggerMetadata: context.triggerMetadata,
      request: {
        method: request.method,
        url: request.url,
      },
    });
    context.info('Goodbye API response:', response);

    return { jsonBody: response };
  },
});
