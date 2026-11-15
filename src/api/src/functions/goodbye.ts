import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

export async function goodbye(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const response = {
    message: 'goodbye',
  };

  context.info('Goodbye API invocation:', {
    invocationId: context.invocationId,
    functionName: context.functionName,
    method: request.method,
    url: request.url.split('?')[0],
  });
  context.info('Goodbye API response:', response);

  return { jsonBody: response };
}

app.http('goodbye', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'goodbye',
  handler: goodbye,
});
