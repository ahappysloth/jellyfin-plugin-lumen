/** How long a view waits for its data before handing the page back to the stock UI. */
export const VIEW_TIMEOUT_MS = 10_000;

/** Rejects if the promise has not settled within `ms`. The original promise is left to finish and is ignored. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
