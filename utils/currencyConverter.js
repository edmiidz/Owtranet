/**
 * Currency conversion utilities for the investment tracker
 * Uses fixed exchange rates for now, but can be extended to use live rates
 */

// Fixed exchange rates (as of example - should be updated or made dynamic)
const EXCHANGE_RATES = {
  'CAD': 1.38, // CAD to USD
  'USD': 1.00, // USD to USD (base)
  'EUR': 0.85, // EUR to USD
  'GBP': 0.73, // GBP to USD
  'JPY': 150.0  // JPY to USD
};

/**
 * Get exchange rate for a currency to USD
 * @param {string} currency - Currency code (CAD, EUR, etc.)
 * @returns {number} Exchange rate to USD
 */
function getExchangeRate(currency) {
  if (!currency || currency === 'USD') return 1.0;
  return EXCHANGE_RATES[currency.toUpperCase()] || 1.0;
}

/**
 * Calculate theoretical investment value
 * @param {number} originalAmount - Original amount in foreign currency
 * @param {string} currency - Currency code
 * @param {number} riskMultiplier - Risk assessment multiplier
 * @returns {object} Calculation breakdown
 */
function calculateTheoreticalValue(originalAmount, currency = 'USD', riskMultiplier = 1.0) {
  const exchangeRate = getExchangeRate(currency);
  const usdAmount = originalAmount * exchangeRate;
  const theoreticalValue = usdAmount * riskMultiplier;
  
  return {
    originalAmount,
    currency,
    exchangeRate,
    usdAmount: Math.round(usdAmount * 100) / 100,
    riskMultiplier,
    theoreticalValue: Math.round(theoreticalValue * 100) / 100
  };
}

/**
 * Get currency symbol for display
 * @param {string} currency - Currency code
 * @returns {string} Currency symbol
 */
function getCurrencySymbol(currency) {
  const symbols = {
    'USD': '$',
    'CAD': 'C$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥'
  };
  return symbols[currency?.toUpperCase()] || '$';
}

/**
 * Format amount with currency symbol
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code
 * @returns {string} Formatted amount
 */
function formatCurrency(amount, currency = 'USD') {
  if (!amount) return '';
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Get available currencies for the investment tracker
 * @returns {Array} Array of currency objects
 */
function getAvailableCurrencies() {
  return [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' }
  ];
}

module.exports = {
  getExchangeRate,
  calculateTheoreticalValue,
  getCurrencySymbol,
  formatCurrency,
  getAvailableCurrencies,
  EXCHANGE_RATES
};