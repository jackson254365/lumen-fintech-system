// ============================================================================
// Multi-Currency Reference Engine
// Supports standard fiat currencies with cross-rate matrix calculation
// ============================================================================

// Standard reference rates against USD base (can be updated or overridden)
const BASE_RATES_USD = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154.2,
  CAD: 1.36,
  AUD: 1.52,
  CHF: 0.90
};

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'AU$',
  CHF: 'CHF '
};

function getExchangeRate(fromCurrency, toCurrency) {
  const from = (fromCurrency || 'USD').toUpperCase();
  const to = (toCurrency || 'USD').toUpperCase();

  const rateFrom = BASE_RATES_USD[from] || 1.0;
  const rateTo = BASE_RATES_USD[to] || 1.0;

  // Cross rate: (USD -> to) / (USD -> from)
  return rateTo / rateFrom;
}

function convertAmount(amount, fromCurrency, toCurrency) {
  const rate = getExchangeRate(fromCurrency, toCurrency);
  return Number((amount * rate).toFixed(2));
}

function formatCurrency(amount, currency = 'USD', signed = false) {
  const symbol = CURRENCY_SYMBOLS[currency] || '$';
  const numeric = Number(amount);
  const sign = signed ? (numeric >= 0 ? '+' : '−') : (numeric < 0 ? '−' : '');
  const abs = Math.abs(numeric);
  return `${sign}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = {
  BASE_RATES_USD,
  CURRENCY_SYMBOLS,
  getExchangeRate,
  convertAmount,
  formatCurrency
};
