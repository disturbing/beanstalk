import { applyRate, sumCents } from '../lib/money.ts';
import type { Address, AppContext, Cents, Coupon, Invoice, InvoiceLine, TaxClass } from '../types.ts';
import { allocateDiscount, couponDiscount, validateCoupon } from './discounts.ts';
import { taxRateFor } from './tax.ts';

export interface InvoiceItem {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: Cents;
  taxClass: TaxClass;
}

export interface InvoiceInput {
  orderId: string;
  userId: string;
  address: Address;
  items: InvoiceItem[];
  coupon?: Coupon;
}

export type InvoiceDraft = Omit<Invoice, 'id' | 'number'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Price an order: line nets, the coupon, tax per line, and the due date. Pure apart from the clock. */
export function buildInvoice(ctx: AppContext, input: InvoiceInput): InvoiceDraft {
  const nets = input.items.map((item) => item.quantity * item.unitPrice);
  const subtotal = sumCents(nets);
  const coupon = input.coupon ? validateCoupon(input.coupon, subtotal, ctx.config.currency) : undefined;
  const discount = coupon ? couponDiscount(coupon, subtotal) : 0;
  const lineDiscounts = allocateDiscount(nets, discount);

  const lines: InvoiceLine[] = input.items.map((item, i) => {
    const taxRate = taxRateFor(input.address, item.taxClass, ctx.config.fallbackTaxRate);
    return {
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      net: nets[i],
      discount: lineDiscounts[i],
      taxRate,
      tax: applyRate(nets[i] - lineDiscounts[i], taxRate),
    };
  });

  const tax = sumCents(lines.map((line) => line.tax));
  const issuedAt = ctx.clock.now();
  return {
    orderId: input.orderId,
    userId: input.userId,
    currency: ctx.config.currency,
    lines,
    subtotal,
    discount,
    couponCode: coupon?.id ?? null,
    tax,
    total: subtotal - discount + tax,
    status: 'open',
    issuedAt: issuedAt.toISOString(),
    dueAt: new Date(issuedAt.getTime() + 30 * DAY_MS).toISOString(),
    paidAt: null,
  };
}
