import { estimateDelivery } from './shipping.mjs';

export function quoteCheckout(input) {
  const { days, businessDays, deliveryDate } = estimateDelivery(input);

  return {
    estimatedDeliveryDays: days,
    estimatedBusinessDays: businessDays,
    estimatedDeliveryDate: deliveryDate,
  };
}
