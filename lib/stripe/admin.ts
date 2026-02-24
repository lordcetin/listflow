import { getStripeClientForMode, type StripeMode } from "@/lib/stripe/client";

export const createStripeProductAndPrice = async ({
  name,
  description,
  amount,
  currency = "usd",
  interval = "month",
  mode,
}: {
  name: string;
  description?: string;
  amount: number;
  currency?: string;
  interval?: "month" | "year";
  mode?: StripeMode;
}) => {
  const stripe = getStripeClientForMode(mode);

  const product = await stripe.products.create({
    name,
    description,
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(amount * 100),
    currency,
    recurring: { interval },
  });

  return { product, price };
};
