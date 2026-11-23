import type { z } from "zod";

/*
 * Field errors from the shared zod schemas (decision 0005): the first problem per field, with
 * zod's wording replaced by the limit in plain words where the issue is a length or a range.
 */

export type FieldErrors = Record<string, string>;

function wording(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_big":
      return issue.origin === "string" ? `At most ${issue.maximum} characters` : `At most ${issue.maximum}`;
    case "too_small":
      if (issue.origin === "string") return issue.minimum === 1 ? "Required" : `At least ${issue.minimum} characters`;
      return `At least ${issue.minimum}`;
    case "invalid_format":
      return issue.format === "email" ? "Enter an email address" : issue.message;
    default:
      return issue.message;
  }
}

export function fieldErrors(schema: z.ZodType, values: unknown): FieldErrors {
  const result = schema.safeParse(values);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!(key in errors)) errors[key] = wording(issue);
  }
  return errors;
}
