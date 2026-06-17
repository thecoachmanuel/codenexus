import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SignInClient from "./SignInClient";

export default async function SignInPage() {
  const session = await getSession();

  // If user is already logged in, redirect to home/dashboard
  if (session) {
    redirect("/");
  }

  return <SignInClient />;
}
