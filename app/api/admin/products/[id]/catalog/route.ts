import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest, notFoundResponse } from "@/lib/auth/admin-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeCatalogFallback } from "@/lib/catalog/fallback";

type CatalogPatchBody = {
  catalog_description?: unknown;
  catalog_youtube_url?: unknown;
};

const isMissingColumnError = (error: { message?: string } | null | undefined, columnName: string) => {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(columnName.toLowerCase());
};

const normalizeYoutubeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const [id] = url.pathname.split("/").filter(Boolean);
      return id ? normalized : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch" && url.searchParams.get("v")) {
        return normalized;
      }

      if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) {
        const [, , id] = url.pathname.split("/");
        return id ? normalized : null;
      }
    }
  } catch {
    return null;
  }

  return null;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return notFoundResponse();
  }

  const { id } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as CatalogPatchBody;
    const payload: Record<string, string | null> = {};

    if (body.catalog_description !== undefined) {
      payload.catalog_description =
        typeof body.catalog_description === "string" ? body.catalog_description.trim() || null : null;
    }

    if (body.catalog_youtube_url !== undefined) {
      const rawYoutube = typeof body.catalog_youtube_url === "string" ? body.catalog_youtube_url : "";
      const normalizedYoutube = normalizeYoutubeUrl(rawYoutube);

      if (rawYoutube.trim() && !normalizedYoutube) {
        return NextResponse.json(
          {
            code: "INVALID_YOUTUBE_URL",
            message: "Geçerli bir YouTube linki girin (youtube.com veya youtu.be).",
          },
          { status: 400 }
        );
      }

      payload.catalog_youtube_url = normalizedYoutube;
    }

    if (!Object.keys(payload).length) {
      return NextResponse.json({ code: "EMPTY_PAYLOAD", message: "Güncellenecek alan bulunamadı." }, { status: 400 });
    }

    const update = await supabaseAdmin
      .from("products")
      .update(payload)
      .eq("id", id)
      .select("id,catalog_description,catalog_youtube_url")
      .maybeSingle();

    if (update.error) {
      if (
        isMissingColumnError(update.error, "catalog_description") ||
        isMissingColumnError(update.error, "catalog_youtube_url")
      ) {
        const fallbackWrite = await writeCatalogFallback({
          productId: id,
          catalogDescription: payload.catalog_description ?? null,
          catalogYoutubeUrl: payload.catalog_youtube_url ?? null,
          createdBy: admin.user.id,
        });

        if (!fallbackWrite.ok) {
          return NextResponse.json(
            {
              code: "CATALOG_FALLBACK_FAILED",
              message: fallbackWrite.error,
            },
            { status: 500 }
          );
        }

        return NextResponse.json({
          row: {
            id,
            catalog_description: payload.catalog_description ?? null,
            catalog_youtube_url: payload.catalog_youtube_url ?? null,
          },
          source: "webhook_logs_fallback",
        });
      }

      return NextResponse.json({ code: "CATALOG_UPDATE_FAILED", message: update.error.message }, { status: 500 });
    }

    if (!update.data) {
      return notFoundResponse();
    }

    return NextResponse.json({ row: update.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Katalog bilgileri güncellenemedi.";
    return NextResponse.json({ code: "CATALOG_UPDATE_FAILED", message }, { status: 400 });
  }
}
