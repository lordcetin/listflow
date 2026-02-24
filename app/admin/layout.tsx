import type { Metadata } from "next";
import Link from "next/link";
import { assertAdminPageAccess } from "@/lib/auth/admin";
import AdminNav from "@/components/admin/AdminNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Admin | listflow.pro",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

const NAV_ITEMS = [
  { href: "/admin", label: "Genel" },
  { href: "/admin/categories", label: "Kategoriler" },
  { href: "/admin/users", label: "Kullanıcılar" },
  { href: "/admin/stores", label: "Mağazalar" },
  { href: "/admin/payments", label: "Ödemeler" },
  { href: "/admin/subscriptions", label: "Abonelikler" },
  { href: "/admin/webhooks", label: "Webhook Console" },
  { href: "/admin/stripe", label: "Stripe" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdminPageAccess();

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="h-20 px-4 sm:px-6 lg:px-10 flex items-center justify-between glass-pro border-b border-indigo-500/10 z-10 shrink-0">
        <h1 className="text-xl font-black tracking-tight uppercase">Admin Paneli</h1>
        <Button asChild variant="secondary" size="sm" className="cursor-pointer">
          <Link href="/">Uygulamaya Dön</Link>
        </Button>
      </header>

      <div className="w-full mx-auto px-3 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6">
        <aside className="w-full lg:w-72 h-fit lg:sticky lg:top-4 self-start">
          <Card className="glass-card-pro rounded-[32px]">
            <CardContent className="p-4">
              <AdminNav items={NAV_ITEMS} />
            </CardContent>
          </Card>
        </aside>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
