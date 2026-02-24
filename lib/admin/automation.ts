export { isUuid } from "@/lib/utils/uuid";

export const getSubscriptionMonthIndex = (createdAt: string | null | undefined, now = new Date()) => {
  if (!createdAt) {
    return 1;
  }

  const startDate = new Date(createdAt);

  if (Number.isNaN(startDate.getTime())) {
    return 1;
  }

  let months =
    (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - startDate.getUTCMonth());

  if (now.getUTCDate() < startDate.getUTCDate()) {
    months -= 1;
  }

  return Math.max(months + 1, 1);
};
