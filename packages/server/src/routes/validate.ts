import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";

/** A failed check throws its ZodError; the app's error handler answers it with 400. */
function rethrow(result: { success: boolean; error?: unknown }) {
  if (!result.success) throw result.error;
}

/**
 * Route middleware that parses one part of the request with `schema`; the
 * handler reads the typed result through `c.req.valid(target)`. A JSON body
 * is read only when the request says it is JSON.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, rethrow);
}
