const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const LAST_SUPPORTED_DATE = Date.parse('9999-12-31T00:00:00.000Z');

function parseCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Dates must use YYYY-MM-DD.');
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return date;
}

export function estimateDelivery({ shippedOn, businessDays, holidays = [] }) {
  const delivery = parseCalendarDate(shippedOn);
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) {
    throw new RangeError('businessDays must be a nonnegative safe integer.');
  }
  if (!Array.isArray(holidays)) {
    throw new TypeError('holidays must be an array of calendar dates.');
  }

  const excludedDates = new Set(holidays.map((holiday) => {
    parseCalendarDate(holiday);
    return holiday;
  }));
  const remainingCalendarDays = (LAST_SUPPORTED_DATE - delivery.getTime()) / MILLISECONDS_PER_DAY;
  if (businessDays > remainingCalendarDays) {
    throw new RangeError('Delivery exceeds the supported four-digit year range.');
  }

  let days = 0;
  let countedBusinessDays = 0;
  while (countedBusinessDays < businessDays) {
    delivery.setTime(delivery.getTime() + MILLISECONDS_PER_DAY);
    if (delivery.getTime() > LAST_SUPPORTED_DATE) {
      throw new RangeError('Delivery exceeds the supported four-digit year range.');
    }
    days += 1;

    const weekday = delivery.getUTCDay();
    const calendarDate = delivery.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && !excludedDates.has(calendarDate)) {
      countedBusinessDays += 1;
    }
  }

  return { days, businessDays, deliveryDate: delivery.toISOString().slice(0, 10) };
}
