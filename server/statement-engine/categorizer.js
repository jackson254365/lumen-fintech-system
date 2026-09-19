// ============================================================================
// Intelligent Payee Categorization Engine
// Combines user-defined rules and standard commercial merchant patterns
// ============================================================================
const db = require('../db');

const DEFAULT_MERCHANT_PATTERNS = [
  // Income / Salary
  { regex: /salary|payroll|direct dep|wages|upwork|fiverr|stripe payout|employer|stipend/i, category: 'Income', type: 'income', icon: 'arrow-down-left', tone: 'teal' },
  { regex: /dividend|interest paid|yield|capital gain/i, category: 'Investments', type: 'income', icon: 'trending-up', tone: 'teal' },

  // Food & Dining
  { regex: /starbucks|costa|bluebird|cafe|coffee|dunkin|espresso|roasters/i, category: 'Food & drink', type: 'spending', icon: 'coffee', tone: 'orange' },
  { regex: /mcdonald|burger|subway|chipotle|pizza|taco|kfc|wendy|shake shack|five guys/i, category: 'Food & drink', type: 'spending', icon: 'utensils', tone: 'orange' },
  { regex: /uber eats|doordash|deliveroo|grubhub|just eat|postmates/i, category: 'Food & drink', type: 'spending', icon: 'utensils', tone: 'orange' },
  { regex: /whole foods|trader joe|market|grocery|supermarket|kroger|safeway|tesco|sainsbury|aldi|lidl|asda|walmart grocery/i, category: 'Food & drink', type: 'spending', icon: 'shopping-basket', tone: 'orange' },

  // Transport
  { regex: /uber(?! eats)|lyft|bolt|freenow|taxi|\bcab\b/i, category: 'Transport', type: 'spending', icon: 'car', tone: 'blue' },
  { regex: /shell|chevron|\bbp\b|exxon|mobil|total|petrol|gas station|texaco|esso/i, category: 'Transport', type: 'spending', icon: 'fuel', tone: 'blue' },
  { regex: /metro|transit|subway train|amtrak|\btfl\b|oyster|trainline|rail|\bbus\b/i, category: 'Transport', type: 'spending', icon: 'train', tone: 'blue' },
  { regex: /delta|airline|british airways|ryanair|easyjet|lufthansa|united air|american air/i, category: 'Transport', type: 'spending', icon: 'plane', tone: 'blue' },

  // Home & Utilities
  { regex: /rent|lease|landlord|mortgage|property|hoa/i, category: 'Home', type: 'spending', icon: 'home', tone: 'red' },
  { regex: /electric|energy|water|gas bill|utility|pg&e|coned|national grid|edf/i, category: 'Home', type: 'spending', icon: 'zap', tone: 'red' },
  { regex: /verizon|at&t|t-mobile|vodafone|comcast|xfinity|broadband|internet|spectrum/i, category: 'Home', type: 'spending', icon: 'wifi', tone: 'red' },
  { regex: /insurance|geico|progressive|state farm|allstate|bupa|axa|horizon/i, category: 'Home', type: 'spending', icon: 'shield-check', tone: 'red' },
  { regex: /ikea|cedar & stone|wayfair|home depot|lowes|furnish/i, category: 'Home', type: 'spending', icon: 'armchair', tone: 'red' },

  // Entertainment & Subscriptions
  { regex: /netflix|spotify|apple\.com\/bill|disney\+|hulu|hbo|paramount|prime video|youtube/i, category: 'Fun money', type: 'spending', icon: 'tv', tone: 'orange' },
  { regex: /steam|playstation|xbox|nintendo|epic games|twitch/i, category: 'Fun money', type: 'spending', icon: 'gamepad-2', tone: 'orange' },
  { regex: /gym|fitness|equinox|planet fitness|puregym|crossfit|yoga/i, category: 'Fun money', type: 'spending', icon: 'dumbbell', tone: 'orange' },
  { regex: /cinema|theatre|amc|cineworld|ticketmaster|eventbrite/i, category: 'Fun money', type: 'spending', icon: 'ticket', tone: 'orange' },

  // Shopping & General
  { regex: /amazon|target|walmart|best buy|ebay|aliexpress/i, category: 'Shopping', type: 'spending', icon: 'shopping-bag', tone: 'blue' },
  { regex: /apple store|microsoft|google|adobe|openai|anthropic|github/i, category: 'Software & Tech', type: 'spending', icon: 'laptop', tone: 'blue' },
  { regex: /pharmacy|cvs|walgreens|boots|clinic|hospital|doctor/i, category: 'Health', type: 'spending', icon: 'heart-pulse', tone: 'red' }
];

/**
 * Classifies a payee description into category, type, icon, and tone
 */
function categorizeTransaction(userId, description, amount) {
  const cleanDesc = (description || '').trim();

  // 1. Check user-defined rules in DB
  if (userId) {
    const userRules = db.query(
      'SELECT pattern, category FROM categorization_rules WHERE user_id = ? ORDER BY priority DESC',
      [userId]
    );

    for (const rule of userRules) {
      try {
        const rx = new RegExp(rule.pattern, 'i');
        if (rx.test(cleanDesc)) {
          const isIncome = amount > 0;
          return {
            category: rule.category,
            type: isIncome ? 'income' : 'spending',
            icon: isIncome ? 'arrow-down-left' : 'receipt-text',
            tone: isIncome ? 'teal' : 'orange',
            matchedBy: 'user_rule'
          };
        }
      } catch (e) {
        // Ignore invalid regex
      }
    }
  }

  // 2. Check built-in merchant dictionary
  for (const item of DEFAULT_MERCHANT_PATTERNS) {
    if (item.regex.test(cleanDesc)) {
      return {
        category: item.category,
        type: amount > 0 ? 'income' : item.type,
        icon: item.icon,
        tone: item.tone,
        matchedBy: 'heuristic_pattern'
      };
    }
  }

  // 3. Fallback
  if (amount > 0) {
    return {
      category: 'Income',
      type: 'income',
      icon: 'arrow-down-left',
      tone: 'teal',
      matchedBy: 'fallback'
    };
  } else {
    return {
      category: 'Other spending',
      type: 'spending',
      icon: 'receipt-text',
      tone: 'orange',
      matchedBy: 'fallback'
    };
  }
}

module.exports = {
  categorizeTransaction,
  DEFAULT_MERCHANT_PATTERNS
};
