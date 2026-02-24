"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
};

export default function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="grid gap-2">
      {items.map((item) => {
        const isRootItem = item.href === "/admin";
        const active = isRootItem
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-widest transition-colors",
              active
                ? "border-indigo-500/40 bg-indigo-500/20 text-white"
                : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-100"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
