import { describe, expect, test } from "vitest";
import { inputs } from "@cahier/api";
import { fieldErrors } from "../src/lib/validate";

/* A form's errors come from the same zod schema the API parses with: the first problem per field, in plain words. */
describe("fieldErrors", () => {
  test("an empty object means the values pass", () => {
    expect(fieldErrors(inputs.signIn, { email: "lea@example.com", password: "cahier-demo" })).toEqual({});
  });

  test("one message per field that fails, keyed by the field", () => {
    const errors = fieldErrors(inputs.signIn, { email: "not-an-email", password: "" });
    expect(Object.keys(errors).sort()).toEqual(["email", "password"]);
    expect(errors["email"]).toMatch(/email/i);
  });

  test("limits read as the limit, not as zod's wording", () => {
    const errors = fieldErrors(inputs.versionFields, { name: "x".repeat(81), description: "", instructions: "", modelId: "small-4", maxContextTokens: 100, libraryIds: [] });
    expect(errors["name"]).toBe("At most 80 characters");
    expect(errors["maxContextTokens"]).toBe("At least 512");
  });
});
