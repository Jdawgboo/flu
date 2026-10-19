/* kind: quota | timeout | upstream | bad_output | not_configured. The message never holds provider text. */
export class ProviderError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}
