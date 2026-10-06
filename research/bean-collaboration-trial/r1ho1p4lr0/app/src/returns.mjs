import { estimateDelivery } from './shipping.mjs';

const RETURN_WINDOW_DAYS = 30;

export function returnPolicy(input) {
  const { deliveryDate } = estimateDelivery(input);
  const deadline = new Date(`${deliveryDate}T00:00:00.000Z`);
  deadline.setUTCDate(deadline.getUTCDate() + RETURN_WINDOW_DAYS);

  return {
    deliveryDate,
    returnBy: deadline.toISOString().slice(0, 10),
    windowDays: RETURN_WINDOW_DAYS,
  };
}
