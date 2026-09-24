// Contexto AI - Intent Classifier
// Determines whether user input is a QUERY (asking something) or a SAVE (storing something).
// Pure function — no side effects, no dependencies.

// Strong query signals — these patterns almost always mean the user is asking
var QUERY_PATTERNS = [
  /^what\s+(is|are|was|were|the)\b/i,
  /^(find|search|show|get|tell me|give me|look up|where is|where are)\b/i,
  /^(do you|can you|could you)\s+(find|show|remember|recall|tell)\b/i,
  /^(how|why|when|who|which|where)\b/i,
  /\?$/,                                  // ends with question mark
  /^(remind me|recall|retrieve)\b/i,
];

// Strong save signals — these patterns almost always mean the user wants to store something
var SAVE_PATTERNS = [
  /\b(remember|save|store|note|keep|record)\s+(this|that|it|my|the)\b/i,
  /\bmy\s+\w+\s+(is|are|=)\s+\S/i,       // "my X is Y"
  /\b(password|passwd|pin|api[\s_-]?key|token|secret|key|credential|login|username|email|address|phone|ssn|dob|birthday)\s*(is|:|\=)\s*\S/i,
  /^(note:|save:|remember:)/i,            // explicit prefix
  /\b(don'?t forget|keep in mind|store this)\b/i,
];

/**
 * Classify user input as 'query' or 'save'.
 * Returns { intent: 'query'|'save', confidence: 'high'|'low' }
 */
function classifyIntent(text) {
  var t = text.trim();

  // Check save patterns first (higher specificity)
  for (var i = 0; i < SAVE_PATTERNS.length; i++) {
    if (SAVE_PATTERNS[i].test(t)) {
      return { intent: 'save', confidence: 'high' };
    }
  }

  // Check query patterns
  for (var j = 0; j < QUERY_PATTERNS.length; j++) {
    if (QUERY_PATTERNS[j].test(t)) {
      return { intent: 'query', confidence: 'high' };
    }
  }

  // Heuristic tiebreakers
  var wordCount = t.split(/\s+/).length;

  // Short inputs with no verb are usually queries ("my api key", "wifi password")
  // But if they have an equals sign or colon they're saves
  if (/[:=]/.test(t)) return { intent: 'save', confidence: 'low' };

  // Very short (1-4 words) with no question word = likely a query/lookup
  if (wordCount <= 4) return { intent: 'query', confidence: 'low' };

  // Longer inputs default to save
  return { intent: 'save', confidence: 'low' };
}

if (typeof module !== 'undefined') module.exports = { classifyIntent };
