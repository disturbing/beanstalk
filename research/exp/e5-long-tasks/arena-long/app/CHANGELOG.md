# Changelog

All notable changes to Beanstalk Shop are recorded here.

## Unreleased

### Added

- Order confirmation emails list every line item.
- `GET /inventory/low-stock` for admins.

### Changed

- Product search ignores letter case.

### Fixed

- Cart totals no longer double count quantities after a line is edited.
- Session cleanup runs when a user logs out.

## 0.4.0 - 2026-09-12

### Added

- Coupons (`percent` and `fixed`) at checkout.
- Express shipping.

### Fixed

- Invoice due dates respect the order date rather than the payment date.
