import { badRequest } from '../lib/errors.ts';
import type { Address, ShippingMethod, ShippingQuote } from '../types.ts';

/** Base charge in cents by destination zone. */
const ZONE_BASE: Record<string, number> = {
  domestic: 500,
  neighbour: 1200,
  international: 2500,
};

const NEIGHBOURS: Record<string, string> = { US: 'CA', CA: 'US' };

/** Extra cents charged per started kilogram above the first. */
const PER_KG = 150;

const EXPRESS_MULTIPLIER = 2;

export function zoneFor(address: Address, homeCountry: string): 'domestic' | 'neighbour' | 'international' {
  const country = address.country.toUpperCase();
  if (country === homeCountry.toUpperCase()) return 'domestic';
  if (NEIGHBOURS[homeCountry.toUpperCase()] === country) return 'neighbour';
  return 'international';
}

export function quoteShipping(
  address: Address,
  weightKg: number,
  method: ShippingMethod,
  homeCountry: string,
): ShippingQuote {
  if (weightKg <= 0) throw badRequest('nothing to ship');
  const zone = zoneFor(address, homeCountry);
  const extraKg = Math.max(Math.ceil(weightKg) - 1, 0);
  const standard = ZONE_BASE[zone] + extraKg * PER_KG;
  const etaDays = zone === 'domestic' ? 4 : zone === 'neighbour' ? 7 : 14;
  if (method === 'express') {
    return { method, cost: standard * EXPRESS_MULTIPLIER, etaDays: Math.ceil(etaDays / 2) };
  }
  return { method, cost: standard, etaDays };
}
