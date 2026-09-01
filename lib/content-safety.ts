/**
 * Content Safety Service
 * Checks retrieved content for unsafe/inappropriate material
 */

interface ContentCheckResult {
  safe: boolean;
  reason?: string;
  blockedCategories?: string[];
}

// Patterns for detecting unsafe content
const UNSAFE_CONTENT_PATTERNS = {
  // Sexual/Adult content
  explicit: {
    patterns: [
      /porn(o|ographic)?|adult content|sexually explicit|nude|xxx|sex video|sexual content|erotic/i,
      /\b(xxx|nsfw|adult only|18\+|pornographic)\b/i,
    ],
    category: "Sexual or adult content",
  },
  
  // Violence & Gore
  violence: {
    patterns: [
      /graphic violence|gore|extreme violence|mutilation|decapitation|dismember/i,
      /extreme brutality|graphic content warning|viewer discretion advised.*violence/i,
    ],
    category: "Extreme violence or gore",
  },
  
  // Hate & Extremism
  hate: {
    patterns: [
      /white supremacist|neo-nazi|terrorism|extremist propaganda|jihadist|hate speech|hateful rhetoric/i,
      /\b(isis|terrorist|extremist)\s+(?:content|video|propaganda)\b/i,
    ],
    category: "Hate speech or extremist content",
  },
  
  // Child Safety
  childSafety: {
    patterns: [
      /child exploitation|child abuse|child sexual|pedophilia|child endangerment/i,
      /minor abuse|underage content|childp(?:orn|ics?)/i,
    ],
    category: "Child exploitation or abuse",
  },
  
  // Illegal Activity
  illegal: {
    patterns: [
      /illegal drugs|how to make|bomb|weapon construction|cocaine|methamphetamine|heroin/i,
      /counterfeit|human trafficking|money laundering|fraud tutorial/i,
    ],
    category: "Illegal activity or dangerous content",
  },
  
  // Self-Harm
  selfHarm: {
    patterns: [
      /suicide|self-harm|self-injury|eating disorder|cutting|suicidal/i,
      /how to harm yourself|self-mutilation/i,
    ],
    category: "Self-harm content",
  },
  
  // Harassment
  harassment: {
    patterns: [
      /doxxing|harassment campaign|targeted abuse|cyberbullying guide|how to harass/i,
      /cancel culture|witch hunt tactics/i,
    ],
    category: "Harassment or abusive content",
  },
};

/**
 * Checks text content for unsafe patterns
 */
export function checkContentForUnsafePatterns(content: string): ContentCheckResult {
  if (!content || typeof content !== 'string') {
    return { safe: true }; // No content to check
  }
  
  const blockedCategories: string[] = [];
  const lowerContent = content.toLowerCase();
  
  // Check each category
  for (const [key, config] of Object.entries(UNSAFE_CONTENT_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(lowerContent)) {
        blockedCategories.push(config.category);
        break; // Found in this category, move to next
      }
    }
  }
  
  if (blockedCategories.length > 0) {
    return {
      safe: false,
      reason: `Content contains blocked material: ${blockedCategories.join(', ')}`,
      blockedCategories,
    };
  }
  
  return { safe: true };
}

/**
 * Checks YouTube metadata (title + description) for safety
 */
export function checkYouTubeMetadataForSafety(
  title: string,
  description?: string
): ContentCheckResult {
  const combinedText = `${title || ''} ${description || ''}`;
  return checkContentForUnsafePatterns(combinedText);
}

/**
 * Checks website metadata (title + meta description) for safety
 */
export function checkWebsiteMetadataForSafety(
  title: string,
  metaDescription?: string
): ContentCheckResult {
  const combinedText = `${title || ''} ${metaDescription || ''}`;
  return checkContentForUnsafePatterns(combinedText);
}

/**
 * Performs a comprehensive safety check on full content
 * (Use this sparingly as it checks the full extracted content)
 */
export function checkFullContentForSafety(
  content: string,
  title?: string,
  description?: string
): ContentCheckResult {
  // First check title and description
  if (title || description) {
    const metadataCheck = checkContentForUnsafePatterns(
      `${title || ''} ${description || ''}`
    );
    if (!metadataCheck.safe) {
      return metadataCheck;
    }
  }
  
  // Then check full content (only if metadata passes)
  // Sample the content if it's very long (check first 5000 chars and last 2000 chars)
  let contentToCheck = content;
  if (content.length > 10000) {
    contentToCheck = content.slice(0, 5000) + ' ... ' + content.slice(-2000);
  }
  
  return checkContentForUnsafePatterns(contentToCheck);
}

/**
 * Determines if a content safety issue should block the entire analysis
 */
export function shouldBlockContent(result: ContentCheckResult): boolean {
  if (!result.safe) {
    // These categories always block
    const blockingCategories = [
      'Child exploitation or abuse',
      'Sexual or adult content',
      'Hate speech or extremist content',
    ];
    
    return (result.blockedCategories || []).some(cat =>
      blockingCategories.some(blocked => cat.includes(blocked))
    );
  }
  return false;
}
