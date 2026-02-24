export const calculateFinancials = (cost: number, sale: number, shipping = 10, cutPercent = 24) => {
  if (sale === 0) {
    return { fee: 0, shipping: 0, profit: 0, margin: 0 };
  }

  const fee = sale * (cutPercent / 100);
  const profit = sale - (cost + fee + shipping);
  const margin = (profit / sale) * 100;

  return { fee, shipping, profit, margin };
};
