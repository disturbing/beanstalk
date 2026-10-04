import * as auth from './auth/handlers.ts';
import * as billing from './billing/handlers.ts';
import * as cart from './cart/handlers.ts';
import * as catalog from './catalog/handlers.ts';
import * as inventory from './inventory/handlers.ts';
import * as notifications from './notifications/handlers.ts';
import * as orders from './orders/handlers.ts';
import type { Router } from './router.ts';
import * as shipping from './shipping/handlers.ts';
import * as users from './users/handlers.ts';

/** The one place that knows every endpoint. Routes match in the order they appear here. */
export function registerRoutes(router: Router): void {
  // auth
  router.add('POST', '/auth/login', 'public', auth.login);
  router.add('POST', '/auth/logout', 'user', auth.logout);

  // users
  router.add('POST', '/users', 'public', users.register);
  router.add('GET', '/users/me', 'user', users.me);
  router.add('PATCH', '/users/me', 'user', users.updateMe);
  router.add('POST', '/users/me/addresses', 'user', users.addAddress);

  // catalog
  router.add('GET', '/products', 'public', catalog.list);
  router.add('GET', '/products/:id', 'public', catalog.get);
  router.add('POST', '/products', 'admin', catalog.create);
  router.add('PATCH', '/products/:id', 'admin', catalog.update);

  // cart
  router.add('GET', '/cart', 'user', cart.show);
  router.add('POST', '/cart/items', 'user', cart.addItem);
  router.add('PATCH', '/cart/items/:productId', 'user', cart.setQuantity);
  router.add('DELETE', '/cart/items/:productId', 'user', cart.removeItem);

  // orders
  router.add('POST', '/checkout', 'user', orders.checkout);
  router.add('GET', '/orders', 'user', orders.list);
  router.add('GET', '/orders/:id', 'user', orders.get);
  router.add('POST', '/orders/:id/cancel', 'user', orders.cancel);

  // billing
  router.add('GET', '/orders/:id/invoice', 'user', billing.invoiceForOrder);
  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);
  router.add('POST', '/invoices/:id/pay', 'admin', billing.payInvoice);

  // shipping
  router.add('POST', '/shipping/quote', 'user', shipping.quote);
  router.add('POST', '/orders/:id/ship', 'admin', shipping.shipOrder);
  router.add('GET', '/orders/:id/shipment', 'user', shipping.getShipment);

  // inventory
  router.add('GET', '/inventory/low-stock', 'admin', inventory.lowStock);
  router.add('GET', '/inventory/:productId', 'admin', inventory.get);
  router.add('PUT', '/inventory/:productId', 'admin', inventory.setStock);

  // notifications
  router.add('GET', '/notifications', 'user', notifications.list);
}
