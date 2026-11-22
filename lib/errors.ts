/** Temporary failure (rate limit, timeout, 5xx). The job is retried with backoff. */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

/** Failure that retrying cannot fix (bad credentials, invalid number). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}
