import { badRequest, conflict, notFound } from '../lib/errors.ts';
import type { AppContext, Coupon, Invoice } from '../types.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceInput } from './invoice.ts';

export function findCoupon(ctx: AppContext, code: string): Coupon | undefined {
  return ctx.store.coupons.get(code.trim().toUpperCase());
}

export type InvoiceRequest = Omit<InvoiceInput, 'coupon'> & { couponCode?: string };

/** Price an order, persist the invoice and count the coupon redemption. */
export function issueInvoice(ctx: AppContext, request: InvoiceRequest): Invoice {
  const { couponCode, ...rest } = request;
  const coupon = couponCode ? findCoupon(ctx, couponCode) : undefined;
  if (couponCode && !coupon) throw badRequest('unknown coupon code');
  const draft = buildInvoice(ctx, { ...rest, coupon });
  const id = ctx.store.nextId('inv');
  const invoice = ctx.store.invoices.insert({ ...draft, id, number: `INV-${id.slice(4)}` });
  if (coupon) ctx.store.coupons.update(coupon.id, { redemptions: coupon.redemptions + 1 });
  return invoice;
}

export function getInvoice(ctx: AppContext, id: string): Invoice {
  return ctx.store.invoices.require(id);
}

export function invoiceForOrder(ctx: AppContext, orderId: string): Invoice {
  const invoice = ctx.store.invoices.findOne((i) => i.orderId === orderId);
  if (!invoice) throw notFound('invoice');
  return invoice;
}

export function markPaid(ctx: AppContext, id: string): Invoice {
  const invoice = getInvoice(ctx, id);
  if (invoice.status !== 'open') throw conflict(`invoice ${invoice.number} is ${invoice.status}`);
  return ctx.store.invoices.update(id, { status: 'paid', paidAt: ctx.clock.now().toISOString() });
}

export function voidInvoice(ctx: AppContext, id: string): Invoice {
  const invoice = getInvoice(ctx, id);
  if (invoice.status === 'paid') throw conflict(`invoice ${invoice.number} is already paid`);
  return ctx.store.invoices.update(id, { status: 'void' });
}
