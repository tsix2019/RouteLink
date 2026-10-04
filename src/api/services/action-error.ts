/** A user-facing validation or precondition failure; `code` maps to an i18n key under errors:action.*. */
export class ActionError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ActionError';
  }
}
