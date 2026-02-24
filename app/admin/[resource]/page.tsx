import { notFound } from "next/navigation";
import AdminResourceClient from "@/components/admin/AdminResourceClient";
import AdminCategoriesClient from "@/components/admin/AdminCategoriesClient";

const ALLOWED_RESOURCES = [
  "categories",
  "users",
  "stores",
  "payments",
  "subscriptions",
  "stripe-events",
] as const;

export default async function AdminResourcePage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;

  if (!ALLOWED_RESOURCES.includes(resource as (typeof ALLOWED_RESOURCES)[number])) {
    notFound();
  }

  if (resource === "categories") {
    return <AdminCategoriesClient />;
  }

  return <AdminResourceClient resource={resource} />;
}
