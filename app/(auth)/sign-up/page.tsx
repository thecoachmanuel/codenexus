import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SignUpClient from "./SignUpClient";

export default async function SignUpPage() {
  const session = await getSession();

  // If user is already logged in, redirect to home/dashboard
  if (session) {
    redirect("/");
  }

  return <SignUpClient />;
}
