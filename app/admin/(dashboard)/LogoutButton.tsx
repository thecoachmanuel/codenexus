"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  };

  return (
    <button
      onClick={handleLogout}
      title="Sign out"
      className="text-white/40 hover:text-red-400 transition-colors"
    >
      <LogOut className="w-4 h-4" />
    </button>
  );
}
