import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10 py-12 max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between text-white/50 text-sm bg-transparent">
      <div>Developed by Coach Manuel</div>
      <div className="flex gap-6 mt-4 md:mt-0">
        <Link href="/docs" className="hover:text-white transition-colors">Documentation</Link>
        <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
      </div>
    </footer>
  );
}
