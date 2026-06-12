import {
  CURRENCIES, BANKS, PROPERTY_PURPOSE, INSURANCE_FREQ, INSURANCE_CATEGORIES, INVESTMENT_TYPES,
} from "./options";

export type FieldType = "text" | "number" | "date" | "select" | "textarea" | "member" | "chips" | "property_select";
export type SelectOption = string | { value: string; label: string };

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
  default?: any;
  placeholder?: string;
  money?: boolean;
  currencyFrom?: string;
  hideOnAdd?: boolean;
  section?: string;
  showIf?: (values: Record<string, any>) => boolean;
};

export type RecordConfig = {
  table: string;
  queryKey: string;
  label: string;
  fields: FieldDef[];
};

const RATE_TYPES = ["Fixed", "Floating", "SORA-pegged"];

export const recordConfigs: Record<string, RecordConfig> = {
  properties: {
    table: "properties",
    queryKey: "properties",
    label: "Property",
    fields: [
      // 📍 Property Details
      { key: "name", label: "Property name", type: "text", required: true, placeholder: "e.g. London Flat", section: "📍 Property Details" },
      { key: "address", label: "Address", type: "text", section: "📍 Property Details" },
      { key: "member_id", label: "Owner", type: "member", section: "📍 Property Details" },
      { key: "purpose", label: "Purpose", type: "select", options: PROPERTY_PURPOSE, default: "capital_growth", section: "📍 Property Details" },
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, default: "SGD", section: "📍 Property Details" },

      // 💰 Financials
      { key: "purchase_price", label: "Purchase price", type: "number", money: true, currencyFrom: "currency", section: "💰 Financials" },
      { key: "purchase_date", label: "Purchase date", type: "date", section: "💰 Financials" },
      { key: "current_value",  label: "Current estimated value",  type: "number", money: true, currencyFrom: "currency", section: "💰 Financials" },

      // 🏦 Mortgage
      { key: "mortgage_bank", label: "Mortgage bank", type: "select", options: BANKS, section: "🏦 Mortgage" },
      { key: "mortgage_balance", label: "Mortgage balance", type: "number", money: true, currencyFrom: "currency", section: "🏦 Mortgage" },
      { key: "monthly_payment", label: "Monthly mortgage payment", type: "number", money: true, currencyFrom: "currency", section: "🏦 Mortgage" },
      { key: "interest_rate", label: "Interest rate %", type: "number", section: "🏦 Mortgage" },
      { key: "rate_type", label: "Rate type", type: "select", options: RATE_TYPES, section: "🏦 Mortgage" },
      { key: "fixed_rate_end", label: "Rate ends / Next reprice date", type: "date", section: "🏦 Mortgage" },
      { key: "mortgage_end_date", label: "Mortgage end date", type: "date", section: "🏦 Mortgage" },

      // 🏠 Rental
      { key: "monthly_rent", label: "Monthly rent", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },
      { key: "market_rent", label: "Estimated market rent", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },
      { key: "cost_management", label: "Management fee (monthly)", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },
      { key: "cost_property_tax", label: "Property tax (monthly)", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },
      { key: "cost_fire_insurance", label: "Fire insurance (monthly)", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },
      { key: "cost_maintenance", label: "Maintenance / repairs (monthly)", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },
      { key: "cost_other_label", label: "Other cost label", type: "text", placeholder: "e.g. HOA fees", section: "🏠 Rental" },
      { key: "cost_other", label: "Other cost (monthly)", type: "number", money: true, currencyFrom: "currency", section: "🏠 Rental" },

      // 🎯 Strategy & Action
      { key: "strategy", label: "Investment strategy", type: "text", placeholder: "e.g. Capital appreciation at 5% p.a., sell by 2028", section: "🎯 Strategy & Action" },
      { key: "action_note", label: "Action", type: "text", placeholder: "e.g. Ask UOB for repricing rate May 2026", section: "🎯 Strategy & Action" },
    ],
  },

  loans: {
    table: "loans",
    queryKey: "loans",
    label: "Loan",
    fields: [
      { key: "bank", label: "Bank", type: "select", options: BANKS, required: true },
      { key: "purpose", label: "Purpose", type: "text", placeholder: "e.g. Personal, Car" },
      { key: "member_id", label: "Owner", type: "member" },
      { key: "original_amount", label: "Original loan amount", type: "number", money: true },
      { key: "balance", label: "Current balance", type: "number", money: true },
      { key: "start_date", label: "Loan start date", type: "date" },
      { key: "term_years", label: "Loan term (years)", type: "number" },
      { key: "rate", label: "Current interest rate %", type: "number" },
      { key: "rate_label", label: "Rate label", type: "text", placeholder: "e.g. SORA + 0.8%" },
      { key: "monthly_payment", label: "Actual monthly payment", type: "number", money: true, placeholder: "Leave blank to auto-calculate" },
      { key: "reprice_date", label: "Reprice date", type: "date" },
      { key: "property_id", label: "Linked property (mortgage)", type: "property_select" },
      { key: "loan_end_date", label: "Loan end date", type: "date" },
      { key: "action", label: "Action", type: "text", placeholder: "e.g. Ask UOB for repricing rate by May 2026" },
    ],
  },

  insurance_policies: {
    table: "insurance_policies",
    queryKey: "insurance",
    label: "Insurance Policy",
    fields: [
      // 📋 Policy Details
      { key: "name", label: "Policy name", type: "text", required: true, section: "📋 Policy Details" },
      { key: "category", label: "Category", type: "select", options: INSURANCE_CATEGORIES, required: true, section: "📋 Policy Details" },
      { key: "provider", label: "Provider", type: "text", section: "📋 Policy Details" },
      { key: "member_id", label: "Insured", type: "member", section: "📋 Policy Details" },
      { key: "policy_number", label: "Policy number", type: "text", section: "📋 Policy Details" },
      { key: "coverage", label: "Coverage", type: "text", placeholder: "e.g. Hospitalisation & Surgical, Critical Illness", section: "📋 Policy Details" },
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, default: "SGD", section: "📋 Policy Details" },

      // 💳 Premium
      { key: "premium", label: "Premium amount", type: "number", money: true, section: "💳 Premium" },
      { key: "frequency", label: "Premium frequency", type: "select", options: INSURANCE_FREQ, default: "annual", section: "💳 Premium" },
      { key: "start_date", label: "Premium start date", type: "date", section: "💳 Premium" },
      { key: "end_date", label: "Premium end date", type: "date", section: "💳 Premium" },
      { key: "next_due_date", label: "Next premium due", type: "date", section: "💳 Premium" },

      // 💰 Payout
      { key: "sum_assured", label: "Sum assured", type: "number", money: true, section: "💰 Payout" },
      { key: "payout_amount", label: "Payout amount (est.)", type: "number", money: true, section: "💰 Payout" },
      { key: "payout_start_date", label: "Payout start date", type: "date", section: "💰 Payout" },
      { key: "payout_frequency", label: "Payout frequency", type: "select", options: INSURANCE_FREQ, section: "💰 Payout" },
      { key: "payout_end_date", label: "Payout end date", type: "date", section: "💰 Payout" },

      // 🎯 Action
      { key: "action", label: "Action", type: "text", placeholder: "e.g. Renew before Mar 2027", section: "🎯 Action" },
    ],
  },

  investments: {
    table: "investments",
    queryKey: "investments",
    label: "Investment",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "group_name", label: "Investment type", type: "select", options: INVESTMENT_TYPES, required: true },
      { key: "member_id", label: "Owner", type: "member" },
      { key: "cost_basis", label: "Amount invested", type: "number", money: true },
      { key: "current_value", label: "Current value (est.)", type: "number", money: true },
      { key: "projected_return_pct", label: "Projected return %", type: "number" },
      { key: "premium_start_date", label: "Premium start date", type: "date", showIf: (v) => v.group_name === "ILP (Investment-Linked Policy)" || v.group_name === "Endowment" },
      { key: "premium_frequency", label: "Premium frequency", type: "select", options: INSURANCE_FREQ, showIf: (v) => v.group_name === "ILP (Investment-Linked Policy)" || v.group_name === "Endowment" },
      { key: "premium_end_date", label: "Premium end date", type: "date", showIf: (v) => v.group_name === "ILP (Investment-Linked Policy)" || v.group_name === "Endowment" },
      { key: "coverage", label: "Coverage", type: "text", placeholder: "e.g. 101% on death or TPD", showIf: (v) => v.group_name === "ILP (Investment-Linked Policy)" || v.group_name === "Endowment" },
      { key: "strategy", label: "Strategy / notes", type: "textarea" },
    ],
  },

  savings_accounts: {
    table: "savings_accounts",
    queryKey: "savings",
    label: "Savings Account",
    fields: [
      { key: "institution", label: "Institution", type: "text", required: true, placeholder: "e.g. DBS, OCBC" },
      { key: "member_id", label: "Owner", type: "member" },
      { key: "account_type", label: "Account type", type: "text", placeholder: "e.g. eSavers, FD, SRS, CPF" },
      { key: "account_number", label: "Account number", type: "text" },
      { key: "balance", label: "Balance", type: "number", money: true },
      { key: "interest_rate", label: "Interest rate %", type: "number" },
      { key: "maturity_date", label: "Maturity date (for FDs)", type: "date" },
      { key: "last_updated", label: "Balance as of", type: "date" },
      { key: "note", label: "Notes", type: "textarea" },
    ],
  },

  health_conditions: {
    table: "health_conditions",
    queryKey: "health",
    label: "Health Item",
    fields: [
      { key: "name", label: "Condition name", type: "text", required: true },
      { key: "member_id", label: "Person", type: "member", required: true },
      { key: "supplements", label: "Take (supplements)", type: "chips", placeholder: "Type and press Enter…", default: [] },
      { key: "actions", label: "Do (actions)", type: "chips", placeholder: "Type and press Enter…", default: [] },
      { key: "details", label: "Details", type: "textarea" },
    ],
  },

    gobag_items: {
    table: "gobag_items",
    queryKey: "gobag",
    label: "Go-Bag Item",
    fields: [
      { key: "label", label: "Item", type: "text", required: true, placeholder: "e.g. Passports" },
    ],
  },

  other_assets: {
    table: "other_assets",
    queryKey: "other_assets",
    label: "Asset",
    fields: [
      { key: "name", label: "Asset name", type: "text", required: true, placeholder: "e.g. Steinway Piano" },
      { key: "category", label: "Category", type: "select", options: ["Vehicle", "Jewellery", "Instrument", "Art", "Collectible", "Other"], required: true, default: "Other" },
      { key: "member_id", label: "Owner", type: "member" },
      { key: "estimated_value", label: "Estimated value (SGD)", type: "number", money: true },
      { key: "last_updated", label: "Value as of", type: "date" },
      { key: "action", label: "Action / notes", type: "text", placeholder: "e.g. Get revalued in 2027" },
    ],
  },
};

