import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import Link from "next/link";
import { LayoutDashboard, Users, Folder } from "lucide-react";
import { LogoutButton } from "./LogoutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-white">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 bg-[#111] flex flex-col">
        <div className="p-6">
          <Link href="/admin" className="flex items-center gap-2 font-bold text-lg tracking-tight select-none">
            <div className="h-8 w-8 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              A
            </div>
            Crevo Admin
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          <Link href="/admin" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors">
            <LayoutDashboard className="w-4 h-4" />
            Overview
          </Link>
          <Link href="/admin/users" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors">
            <Users className="w-4 h-4" />
            Users
          </Link>
          <Link href="/admin/projects" className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors">
            <Folder className="w-4 h-4" />
            Projects
          </Link>
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/40 border border-white/5">
            <span className="text-xs text-white/50 truncate max-w-[120px]">
              {session.email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-white/10 flex items-center px-8 shrink-0">
          <h2 className="text-lg font-semibold text-white/90">Dashboard</h2>
        </header>
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
