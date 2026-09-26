import { createWorker, OEM, type Worker } from 'tesseract.js';

/** The image could not be read: not a decodable image, or it took too long. Retrying would fail the same way. */
export class UnreadableImageError extends Error {}

/**
 * One tesseract.js worker for the life of the process. Creating it loads the WASM core and the model
 * (a second or two), so a warm Azure Functions worker process (the timer trigger firing again a minute later,
 * or a second HTTP request while the instance is still up) reuses it across invocations rather than paying
 * that cost every time.
 */
let shared: Promise<Worker> | undefined;

function getWorker(langPath: string): Promise<Worker> {
  shared ??= createWorker('eng', OEM.LSTM_ONLY, {
    langPath,
    // The model is a local file, so there is nothing to cache (and the deployed package's own directory is
    // read-only under Azure's remote-build / Flex Consumption deployment model).
    cacheMethod: 'none',
    // Required, not cosmetic. When a job fails, tesseract.js rejects that job's promise and then, if there is no
    // errorHandler, also throws from inside its message handler: an uncaught exception that kills the whole
    // process on one unreadable image. The rejection is all we need; `recognizeText` handles it.
    errorHandler: () => undefined,
  }).catch((error: unknown) => {
    shared = undefined; // let the next call try again rather than caching the failure
    throw error;
  });
  return shared;
}

/** Drops the worker, e.g. after a failure that may have left it in a bad state. */
export async function shutdownOcr(): Promise<void> {
  const pending = shared;
  shared = undefined;
  if (pending) await (await pending.catch(() => undefined))?.terminate();
}

/**
 * Reads the text in an image (PNG, JPEG or WebP: what the proof bucket accepts).
 * A worker that cannot start throws as is, since that is a broken deployment and not a bad image.
 * A failure while reading the image becomes an `UnreadableImageError`.
 */
export async function recognizeText(image: Buffer, options: { langPath: string; timeoutMs: number }): Promise<string> {
  const worker = await getWorker(options.langPath);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${options.timeoutMs} ms`)), options.timeoutMs);
  });

  try {
    const { data } = await Promise.race([worker.recognize(image), timeout]);
    return data.text;
  } catch (cause) {
    // A job that failed or hung may have left the worker unusable, so start a fresh one next time.
    await shutdownOcr();
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new UnreadableImageError(reason, { cause });
  } finally {
    clearTimeout(timer);
  }
}
