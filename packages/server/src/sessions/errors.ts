/**
 * What can go wrong with a session request, by what the caller did wrong.
 * The app maps each to one HTTP status (see `app.ts`).
 */

/** No session has this id. → 404 */
export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session not found: ${id}`);
  }
}

/** The request itself is invalid: a bad file, path, scope or option. → 400 */
export class SessionInputError extends Error {}

/** The session cannot do this now: it is running, read-only, or busy. → 409 */
export class SessionConflictError extends Error {}
