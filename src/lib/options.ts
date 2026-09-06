// Shared dropdown options and label helpers.

export const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: "$", USD: "$", AUD: "$", HKD: "$", CAD: "$", NZD: "$",
  GBP: "£", EUR: "€", JPY: "¥", CNY: "¥", MYR: "RM", THB: "฿",
};

export const CURRENCIES = [
  "SGD","GBP","USD","EUR","AUD","HKD","JPY","CNY","MYR","THB","CAD","NZD",
];

export const BANKS = [
  "DBS","OCBC","UOB","Standard Chartered","HSBC","Citibank",
  "Maybank","Bank of China","CIMB","RHB","Other",
];

export const CARD_NETWORKS = [
  "Visa","Mastercard","Amex","UnionPay","Diners Club","Discover","Other",
];

export const CARD_REWARD_TYPES = [
  "Cashback","Points","Miles","Rewards (other)","No rewards / everyday",
];

export const SAVINGS_ACCOUNT_TYPES = [
  "Savings Account",
  "Fixed Deposit (FD)",
  "CPF-Ordinary Account (OA)",
  "CPF-Special Account (SA)",
  "CPF-Medisave Account (MA)",
  "CPF-Retirement Account (RA)",
  "SRS (Supplementary Retirement Scheme)",
  "T-Bills / Singapore Savings Bonds",
  "Other",
];

const FD_LIKE_TYPES = new Set(["Fixed Deposit (FD)", "T-Bills / Singapore Savings Bonds"]);
export function isFdLikeAccountType(accountType: string | null | undefined): boolean {
  return FD_LIKE_TYPES.has(accountType ?? "");
}

export function isCpfAccountType(accountType: string | null | undefined): boolean {
  return (accountType ?? "").startsWith("CPF-");
}

export const INSURANCE_FREQ = [
  { value: "annual", label: "Annual" },
  { value: "semi-annual", label: "Semi-Annual" },
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
  { value: "one-off", label: "One-Off" },
];

export const FREQ_LABEL: Record<string, string> = {
  annual: "year", "semi-annual": "half-year", quarterly: "quarter", monthly: "month", "one-off": "one-off",
};

export const PROPERTY_PURPOSE = [
  { value: "capital_growth", label: "Capital Growth" },
  { value: "rental_yield",   label: "Rental Yield" },
  { value: "own_home",       label: "Own Home" },
  // Note: "holiday_other" requires enum migration. Mapping in UI only.
];

export const PROPERTY_PURPOSE_LABEL: Record<string, string> = {
  capital_growth: "Capital Growth",
  rental_yield: "Rental Yield",
  own_home: "Own Home",
};

export const INVESTMENT_TYPES = [
  "Unit Trust / Fund",
  "Exchange Traded Fund (ETF)",
  "Stocks / Shares",
  "ILP (Investment-Linked Policy)",
  "Endowment",
  "Bonds",
  "REITs",
  "Cryptocurrency",
  "Cash / Money Market",
  "SRS",
  "CPF-OA Investment",
  "Other",
];

export const INSURANCE_CATEGORIES = [
  "Life","Health","Critical Illness","Disability","Personal Accident",
  "Car","Home","Travel","Mortgage","Other",
];

export function capitalize(s: string | null | undefined) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function freqLabel(f: string | null | undefined) {
  if (!f) return "year";
  const key = f.toLowerCase();
  return FREQ_LABEL[key] ?? capitalize(f);
}
