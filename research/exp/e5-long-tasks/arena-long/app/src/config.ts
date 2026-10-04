import type { Currency } from './types.ts';

export interface Config {
  storeName: string;
  currency: Currency;
  /** Country assumed when an address has none. */
  defaultCountry: string;
  /** Tax rate used when nothing more specific matches an address. */
  fallbackTaxRate: number;
  sessionTtlSeconds: number;
  /** scrypt cost parameter (N). Kept low so the test suite stays fast. */
  passwordCost: number;
  maxCartLines: number;
  lowStockThreshold: number;
  orderNumberPrefix: string;
  pageSize: number;
}

export const defaultConfig: Config = {
  storeName: 'Beanstalk Shop',
  currency: 'USD',
  defaultCountry: 'US',
  fallbackTaxRate: 0.07,
  sessionTtlSeconds: 3600,
  passwordCost: 1024,
  maxCartLines: 50,
  lowStockThreshold: 5,
  orderNumberPrefix: 'BS',
  pageSize: 20,
};

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'];

function intFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`invalid integer in config: ${value}`);
  return n;
}

/** Build a config from environment-style overrides. Unset keys keep their defaults. */
export function loadConfig(env: Record<string, string | undefined> = {}): Config {
  const currency = env.SHOP_CURRENCY ?? defaultConfig.currency;
  if (!CURRENCIES.includes(currency)) throw new Error(`unsupported currency: ${currency}`);
  return {
    ...defaultConfig,
    storeName: env.SHOP_NAME ?? defaultConfig.storeName,
    currency: currency as Currency,
    defaultCountry: env.SHOP_COUNTRY ?? defaultConfig.defaultCountry,
    sessionTtlSeconds: intFrom(env.SESSION_TTL_SECONDS, defaultConfig.sessionTtlSeconds),
    passwordCost: intFrom(env.PASSWORD_COST, defaultConfig.passwordCost),
    maxCartLines: intFrom(env.MAX_CART_LINES, defaultConfig.maxCartLines),
    lowStockThreshold: intFrom(env.LOW_STOCK_THRESHOLD, defaultConfig.lowStockThreshold),
  };
}
