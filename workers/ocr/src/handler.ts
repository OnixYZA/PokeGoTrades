import { loadConfig } from './env';
import { log } from './log';
import { processPending, type Summary } from './process';
import { createServiceClient } from './supabase';

/** The slice of the Lambda context this handler uses (avoids pulling in @types/aws-lambda). */
interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

/**
 * AWS Lambda entry point: `dist/handler.handler`. Invoke it on a schedule (EventBridge, every minute);
 * each invocation works through one batch and returns what it did. The event is ignored.
 *
 * It never throws for a proof it could not process: those are put back for the next run and logged at
 * `error` level, so a broken image or a storage hiccup cannot make Lambda retry the whole invocation.
 */
export const handler = async (_event: unknown, context: LambdaContext): Promise<Summary> => {
  const config = loadConfig();
  const summary = await processPending(createServiceClient(config), config, {
    deadline: Date.now() + context.getRemainingTimeInMillis(),
  });
  log('info', 'run finished', { ...summary });
  return summary;
};
