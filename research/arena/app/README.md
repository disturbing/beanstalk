# Beanstalk Shop

A small online shop API: catalog, cart, checkout, invoices, shipping and email
notifications. There is no HTTP server; handlers take a request-like object and
return a response-like object, and the tests call the router directly.

```
npm test        # node --test (Node 25 runs the .ts files natively)
```

Modules live in `src/<name>/`: billing, cart, catalog, orders, users, auth,
notifications, inventory and shipping. Shared plumbing is in `src/lib/`
(money helpers, errors, pagination) and `src/db/` (in-memory store and migrations).
Routes are registered in one place, `src/routes.ts`.

## Endpoints

| Method | Path | Access |
|---|---|---|
| POST | `/users`, `/auth/login` | public |
| POST | `/auth/logout` | user |
| GET, PATCH | `/users/me` | user |
| POST | `/users/me/addresses` | user |
| GET | `/products`, `/products/:id` | public |
| POST, PATCH | `/products`, `/products/:id` | admin |
| GET, POST, PATCH, DELETE | `/cart`, `/cart/items`, `/cart/items/:productId` | user |
| POST | `/checkout`, `/orders/:id/cancel` | user |
| GET | `/orders`, `/orders/:id`, `/orders/:id/invoice`, `/orders/:id/shipment` | user |
| GET | `/invoices/:id` | user |
| POST | `/invoices/:id/pay`, `/orders/:id/ship` | admin |
| POST | `/shipping/quote` | user |
| GET, PUT | `/inventory/:productId`, `/inventory/low-stock` | admin |
| GET | `/notifications` | user |

## Configuration

Settings come from environment variables (see `src/config.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `SHOP_NAME` | `Beanstalk Shop` | Store name |
| `SHOP_CURRENCY` | `USD` | Currency amounts are formatted in |
| `SHOP_COUNTRY` | `US` | Home country, used for shipping zones |
| `SESSION_TTL_SECONDS` | `3600` | How long a login lasts |
| `PASSWORD_COST` | `1024` | scrypt cost for password hashes |
| `MAX_CART_LINES` | `50` | Most distinct products in one cart |
| `LOW_STOCK_THRESHOLD` | `5` | Available quantity at or below which a product counts as low on stock |

## Behaviour

- Prices are tax exclusive; tax is worked out per invoice line from the shipping address.
- Standard shipping is charged by destination zone and weight; express costs double.
- A session lasts `SESSION_TTL_SECONDS` from login.
- Stock is reserved at checkout and released when an order is cancelled.
- Coupons take a percentage or a fixed amount off and can have a minimum subtotal.
