const whole = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole koruna the Czech way: "1 249 Kč", with non-breaking spaces. */
export const czk = (amount: number) => whole.format(amount);

/** What one credit of a pack costs: "4,98 Kč". */
export const czkPerCredit = (priceCzk: number, credits: number) => exact.format(priceCzk / credits);
