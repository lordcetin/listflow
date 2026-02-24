import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PLAN_TO_MONTHLY_CENTS, type BillingPlan } from "@/lib/stripe/client";

type SubscriptionRow = {
  user_id: string | null;
  status: string | null;
  plan: string | null;
  created_at?: string | null;
};

type PaymentRow = {
  amount_cents: number | null;
  status?: string | null;
  created_at?: string | null;
};

type WinnerInfo = {
  userId: string;
  fullName: string | null;
  email: string | null;
  subscriptionCount: number;
};

const ACTIVE_SUB_STATUSES = new Set(["active", "trialing"]);
const PAID_PAYMENT_STATUSES = new Set(["paid", "succeeded", "complete", "completed"]);
const PLAN_LABELS: Record<string, string> = {
  standard: "Standard",
  pro: "Pro",
  turbo: "Turbo",
};
const TR_TIMEZONE = "Europe/Istanbul";

const isBillingPlan = (value: string | null | undefined): value is BillingPlan => {
  return value === "standard" || value === "pro" || value === "turbo";
};

const toDateKey = (date: Date) => {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const formatNumber = (value: number | null) => {
  if (value === null) {
    return "-";
  }
  return new Intl.NumberFormat("tr-TR").format(value);
};

const formatPercent = (value: number | null) => {
  if (value === null) {
    return "-";
  }
  return `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value)}`;
};

const formatUsd = (cents: number | null) => {
  if (cents === null) {
    return "-";
  }

  const amount = cents / 100;
  const hasFraction = Math.abs(cents % 100) > 0;

  return `$${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)}`;
};

const countRows = async (table: string, selectCandidates: readonly string[] = ["id", "*"]) => {
  for (const select of selectCandidates) {
    const { count, error } = await supabaseAdmin.from(table).select(select, { count: "exact", head: true });
    if (!error) {
      return count ?? 0;
    }
  }

  return null;
};

const loadSubscriptions = async () => {
  const primary = await supabaseAdmin.from("subscriptions").select("user_id,status,plan,created_at").limit(10000);
  if (!primary.error) {
    return (primary.data ?? []) as SubscriptionRow[];
  }

  const fallback = await supabaseAdmin.from("subscriptions").select("user_id,created_at").limit(10000);
  if (fallback.error) {
    return null;
  }

  return ((fallback.data ?? []) as Array<{ user_id: string | null; created_at?: string | null }>).map((item) => ({
    user_id: item.user_id,
    status: null,
    plan: null,
    created_at: item.created_at ?? null,
  }));
};

const loadPayments = async () => {
  const primary = await supabaseAdmin.from("payments").select("amount_cents,status,created_at").limit(10000);
  if (!primary.error) {
    return (primary.data ?? []) as PaymentRow[];
  }

  const fallback = await supabaseAdmin.from("payments").select("amount_cents,created_at").limit(10000);
  if (fallback.error) {
    return null;
  }

  return ((fallback.data ?? []) as Array<{ amount_cents: number | null; created_at?: string | null }>).map((item) => ({
    amount_cents: item.amount_cents,
    status: null,
    created_at: item.created_at ?? null,
  }));
};

const loadWinner = async (rows: SubscriptionRow[]) => {
  const activeRows = rows.filter((row) => ACTIVE_SUB_STATUSES.has((row.status ?? "").toLowerCase()) && row.user_id);
  const sourceRows = activeRows.length > 0 ? activeRows : rows.filter((row) => row.user_id);

  if (!sourceRows.length) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const row of sourceRows) {
    if (!row.user_id) continue;
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }

  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner) {
    return null;
  }

  const [winnerUserId, subscriptionCount] = winner;
  const profile = await supabaseAdmin
    .from("profiles")
    .select("full_name,email")
    .eq("user_id", winnerUserId)
    .maybeSingle<{ full_name: string | null; email: string | null }>();

  return {
    userId: winnerUserId,
    fullName: profile.data?.full_name ?? null,
    email: profile.data?.email ?? null,
    subscriptionCount,
  } satisfies WinnerInfo;
};

export default async function AdminHomePage() {
  const [totalStores, totalUsers, subscriptions, payments] = await Promise.all([
    countRows("stores"),
    countRows("profiles", ["user_id", "id", "*"]),
    loadSubscriptions(),
    loadPayments(),
  ]);

  const activeSubscriptions = subscriptions
    ? subscriptions.filter((row) => ACTIVE_SUB_STATUSES.has((row.status ?? "").toLowerCase())).length
    : null;

  const planCounts = new Map<string, number>();
  if (subscriptions) {
    for (const row of subscriptions) {
      const status = (row.status ?? "").toLowerCase();
      if (ACTIVE_SUB_STATUSES.size > 0 && row.status && !ACTIVE_SUB_STATUSES.has(status)) {
        continue;
      }
      const plan = (row.plan ?? "").toLowerCase();
      if (!plan) continue;
      planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
    }
  }

  const topPlanEntry = [...planCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPlanLabel = topPlanEntry ? PLAN_LABELS[topPlanEntry[0]] ?? topPlanEntry[0] : null;
  const topPlanCount = topPlanEntry ? topPlanEntry[1] : null;

  const todayKey = toDateKey(new Date());
  const paymentsTodayCents = payments
    ? payments.reduce((total, row) => {
        const amount = Number(row.amount_cents ?? 0);
        if (amount <= 0 || !row.created_at) {
          return total;
        }

        if (row.status && !PAID_PAYMENT_STATUSES.has((row.status ?? "").toLowerCase())) {
          return total;
        }

        const rowDate = new Date(row.created_at);
        if (Number.isNaN(rowDate.getTime())) {
          return total;
        }

        if (toDateKey(rowDate) !== todayKey) {
          return total;
        }

        return total + amount;
      }, 0)
    : null;

  const subscriptionsTodayCents = subscriptions
    ? subscriptions.reduce((total, row) => {
        if (!ACTIVE_SUB_STATUSES.has((row.status ?? "").toLowerCase())) {
          return total;
        }

        if (!isBillingPlan(row.plan) || !row.created_at) {
          return total;
        }

        const rowDate = new Date(row.created_at);
        if (Number.isNaN(rowDate.getTime())) {
          return total;
        }

        if (toDateKey(rowDate) !== todayKey) {
          return total;
        }

        return total + PLAN_TO_MONTHLY_CENTS[row.plan];
      }, 0)
    : null;

  const todayClosingCents =
    paymentsTodayCents === null && subscriptionsTodayCents === null
      ? null
      : (paymentsTodayCents ?? 0) + (subscriptionsTodayCents ?? 0);

  const winner = subscriptions ? await loadWinner(subscriptions) : null;

  const subscriptionPenetration =
    typeof totalStores === "number" && totalStores > 0 && typeof activeSubscriptions === "number"
      ? (activeSubscriptions / totalStores) * 100
      : null;

  const cards = [
    {
      title: "Toplam Mağaza",
      value: formatNumber(totalStores),
      description: "Sistemde kayıtlı mağaza sayısı.",
    },
    {
      title: "Toplam Kullanıcı",
      value: formatNumber(totalUsers),
      description: "Profiles tablosundaki toplam kullanıcı.",
    },
    {
      title: "Aktif Abonelik",
      value: formatNumber(activeSubscriptions),
      description: "Status: active/trialing olan abonelikler.",
    },
    {
      title: "Bugün Kapanış",
      value: formatUsd(todayClosingCents),
      description: `Bugün Payments: ${formatUsd(paymentsTodayCents)} + Subscriptions: ${formatUsd(subscriptionsTodayCents)}`,
    },
    {
      title: "Winner Kullanıcı",
      value: winner?.fullName || winner?.email || (winner ? winner.userId : "-"),
      description: winner ? `Aktif abonelik adedi: ${formatNumber(winner.subscriptionCount)}` : "Henüz karşılaştırma verisi yok.",
    },
    {
      title: "En Güçlü Plan",
      value: topPlanLabel || "-",
      description: topPlanCount ? `${formatNumber(topPlanCount)} aktif abonelik` : "Plan dağılımı verisi yok.",
    },
    {
      title: "Abonelik Penetrasyonu",
      value: formatPercent(subscriptionPenetration),
      description: "Aktif abonelik / toplam mağaza oranı.",
    },
  ];

  return (
    <Card className="glass-card-pro rounded-[32px]">
      <CardHeader>
        <Badge variant="secondary" className="w-fit">
          Admin
        </Badge>
        <CardTitle className="text-3xl">Yönetim Merkezi</CardTitle>
        <CardDescription>Bu alan yalnızca admin rolüne açıktır ve tüm işlemler loglanır.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((card) => (
            <Card key={card.title} className="rounded-2xl">
              <CardHeader className="p-5">
                <CardTitle className="text-xs uppercase tracking-widest text-indigo-300">{card.title}</CardTitle>
                <p className="text-xl font-black text-white break-words">{card.value}</p>
                <CardDescription className="text-sm text-slate-300">{card.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
