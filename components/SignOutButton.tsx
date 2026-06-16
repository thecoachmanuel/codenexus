"use client";

import { LogOut } from "lucide-react";
import { useAuthContext } from "@/components/AuthProvider";

export default function SignOutButton() {
  const { signOut } = useAuthContext();

  return (
    <button
      onClick={signOut}
      title="Sign out"
      className="flex h-7 w-7 items-center justify-center rounded-lg text-white/25 transition-colors hover:bg-white/8 hover:text-white/60"
    >
      <LogOut className="h-3.5 w-3.5" />
    </button>
  );
}
