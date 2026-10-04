import type { Config } from './config.ts';
import type { Store } from './db/store.ts';
import type { Clock } from './lib/clock.ts';

// --- core

/** Integer minor units (cents). Never a float. */
export type Cents = number;
export type Currency = 'USD' | 'CAD' | 'EUR' | 'GBP';

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(message: MailMessage): void;
}

export interface AppContext {
  config: Config;
  store: Store;
  clock: Clock;
  mailer: Mailer;
}

// --- users & auth

export type Role = 'customer' | 'admin';

export interface Address {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  passwordSalt: string;
  addresses: Address[];
  createdAt: string;
}

export interface Session {
  /** The bearer token itself. */
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

// --- catalog

export type TaxClass = 'standard' | 'reduced' | 'exempt';

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  /** Unit price, tax exclusive. */
  price: Cents;
  category: string;
  taxClass: TaxClass;
  weightKg: number;
  active: boolean;
  createdAt: string;
}

// --- cart

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface Cart {
  /** Same as the owning user's id. */
  id: string;
  lines: CartLine[];
  updatedAt: string;
}

// --- billing

export type CouponKind = 'percent' | 'fixed';

export interface Coupon {
  /** The coupon code, upper case. */
  id: string;
  kind: CouponKind;
  /** Percent (0-100) for `percent`, cents for `fixed`. */
  value: number;
  minSubtotal: Cents;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptions: number;
}

export interface InvoiceLine {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: Cents;
  /** quantity * unitPrice, before tax and discount. */
  net: Cents;
  /** This line's share of the invoice-level discount. */
  discount: Cents;
  taxRate: number;
  tax: Cents;
}

export type InvoiceStatus = 'open' | 'paid' | 'void';

export interface Invoice {
  id: string;
  number: string;
  orderId: string;
  userId: string;
  currency: Currency;
  lines: InvoiceLine[];
  subtotal: Cents;
  discount: Cents;
  couponCode: string | null;
  tax: Cents;
  total: Cents;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
}

// --- inventory

export interface StockLevel {
  /** Same as the product id. */
  id: string;
  onHand: number;
  reserved: number;
}

// --- shipping

export type ShippingMethod = 'standard' | 'express';

export interface ShippingQuote {
  method: ShippingMethod;
  cost: Cents;
  etaDays: number;
}

export type ShipmentStatus = 'pending' | 'shipped' | 'delivered';

export interface Shipment {
  id: string;
  orderId: string;
  method: ShippingMethod;
  cost: Cents;
  status: ShipmentStatus;
  shippedAt: string | null;
}

// --- orders

export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: Cents;
}

export interface Order {
  id: string;
  number: string;
  userId: string;
  status: OrderStatus;
  lines: OrderLine[];
  subtotal: Cents;
  discount: Cents;
  tax: Cents;
  shippingCost: Cents;
  /** Goods after discount, plus tax. Shipping is tracked separately in `shippingCost`. */
  total: Cents;
  couponCode: string | null;
  shippingAddress: Address;
  invoiceId: string | null;
  trackingNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- notifications

export type NotificationKind = 'order_confirmed' | 'order_shipped' | 'order_cancelled';

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  status: 'queued' | 'sent';
  createdAt: string;
  sentAt: string | null;
}
