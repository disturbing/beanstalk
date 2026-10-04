import { notFound } from '../lib/errors.ts';
import { ok } from '../router.ts';
import type { Handler } from '../router.ts';
import type { Invoice, User } from '../types.ts';
import { getInvoice as loadInvoice, invoiceForOrder as loadInvoiceForOrder, markPaid } from './service.ts';

/** Customers only see their own invoices; admins see all. Anything else looks like a 404. */
function visibleTo(user: User, invoice: Invoice): Invoice {
  if (invoice.userId !== user.id && user.role !== 'admin') throw notFound('invoice');
  return invoice;
}

export const getInvoice: Handler = (req, ctx) => ok(visibleTo(req.user!, loadInvoice(ctx, req.params.id)));

export const invoiceForOrder: Handler = (req, ctx) =>
  ok(visibleTo(req.user!, loadInvoiceForOrder(ctx, req.params.id)));

export const payInvoice: Handler = (req, ctx) => ok(markPaid(ctx, req.params.id));
