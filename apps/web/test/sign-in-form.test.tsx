import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SignInForm } from "../src/screens/sign-in/SignInForm";

describe("the sign-in form", () => {
  test("refuses what the API would refuse before sending, field by field", async () => {
    const onSubmit = vi.fn();
    render(<SignInForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Email"), "lea");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter an email address");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Required");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("sends the trimmed values and shows the server's answer when it refuses", async () => {
    const onSubmit = vi.fn(async () => "Wrong email or password.");
    render(<SignInForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Email"), "  lea@example.com ");
    await userEvent.type(screen.getByLabelText("Password"), "cahier-demo");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Wrong email or password."));
    expect(onSubmit).toHaveBeenCalledWith({ email: "lea@example.com", password: "cahier-demo" });
  });

  test("fills the form from a demo account", async () => {
    render(<SignInForm onSubmit={vi.fn(async () => null)} />);
    await userEvent.click(screen.getByRole("button", { name: /Noor Haddad/ }));
    expect(screen.getByLabelText("Email")).toHaveValue("noor@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("cahier-demo");
  });
});
