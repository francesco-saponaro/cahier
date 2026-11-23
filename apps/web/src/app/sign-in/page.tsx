import type { Metadata } from "next";
import { SignInScreen } from "../../screens/sign-in/SignInScreen";

export const metadata: Metadata = { title: "Sign in · Cahier" };

export default function SignInPage() {
  return <SignInScreen />;
}
