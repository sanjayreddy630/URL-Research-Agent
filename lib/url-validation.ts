/**
 * URL Validation Service
 * Validates URLs and checks domain trustworthiness
 */

// List of trusted domains for research
const TRUSTED_DOMAINS = [
  // News & Media
  'bbc.com', 'bbc.co.uk', 'cnn.com', 'reuters.com', 'apnews.com', 'theguardian.com',
  'nytimes.com', 'washingtonpost.com', 'theinformation.com', 'medium.com',
  
  // Tech & Science
  'github.com', 'stackoverflow.com', 'arxiv.org', 'nature.com', 'science.org',
  'techcrunch.com', 'theverge.com', 'arstechnica.com', 'wired.com',
  
  // Education & Reference
  'wikipedia.org', 'coursera.org', 'udemy.com', 'edx.org', 'khan.academy',
  'mit.edu', 'stanford.edu', 'harvard.edu', 'berkeley.edu',
  
  // Documentation
  'docs.microsoft.com', 'docs.oracle.com', 'nextjs.org', 'react.dev',
  'angular.io', 'vuejs.org', 'nodejs.org', 'python.org',
  
  // Video & Media
  'youtube.com', 'youtu.be', 'vimeo.com', 'ted.com',
  
  // General trusted sites
  'wikipedia.org', 'quora.com', 'linkedin.com',
];

// Patterns to block - explicitly unsafe content indicators
const UNSAFE_URL_PATTERNS = [
  // Adult content
  /porn|xxx|adult|sex-tube|adult-video|explicit/i,
  // Hate & extremism
  /terrorism|extremist|hate-group|supremacist/i,
  // Gambling & illicit
  /casino|poker|betting|illegal-drugs|darknet|tor-only/i,
  // Malware & phishing
  /malware|phishing|trojan|ransomware|exploit-kit/i,
];

// Allow common single-domain sites (forums, blogs, etc.)
const ALLOWED_DOMAIN_PATTERNS = [
  /\.(edu|gov|org|ac\.uk)$/i, // Educational and government domains
  /\.(com|net|co\.uk|co)$/i,  // Common commercial domains
];

/**
 * Validates URL format
 */
export function isValidUrlFormat(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts domain from URL
 */
export function extractDomain(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Checks if domain is trusted or allowed
 */
export function isDomainTrusted(domain: string): boolean {
  const lowerDomain = domain.toLowerCase();
  
  // Exact match in trusted domains
  if (TRUSTED_DOMAINS.includes(lowerDomain)) {
    return true;
  }
  
  // Check if domain ends with trusted domains (subdomains)
  if (TRUSTED_DOMAINS.some(trusted => lowerDomain.endsWith('.' + trusted))) {
    return true;
  }
  
  // Check against allowed domain patterns
  if (ALLOWED_DOMAIN_PATTERNS.some(pattern => pattern.test(lowerDomain))) {
    return true;
  }
  
  return false;
}

/**
 * Checks URL for unsafe patterns (first pass)
 */
export function checkUrlForUnsafePatterns(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const fullUrl = url.toString().toLowerCase();
    
    // Check URL path and hostname
    const combinedText = `${url.hostname}${url.pathname}`;
    
    for (const pattern of UNSAFE_URL_PATTERNS) {
      if (pattern.test(combinedText)) {
        return true; // Unsafe pattern found
      }
    }
    
    return false; // No unsafe patterns
  } catch {
    return false;
  }
}

/**
 * Validates a URL for safety
 * Returns validation result with details
 */
export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  trusted?: boolean;
  domain?: string;
}

export function validateUrl(urlString: string): UrlValidationResult {
  // Step 1: Check format
  if (!isValidUrlFormat(urlString)) {
    return {
      valid: false,
      reason: "Invalid URL format",
    };
  }
  
  // Step 2: Extract domain
  const domain = extractDomain(urlString);
  if (!domain) {
    return {
      valid: false,
      reason: "Unable to extract domain",
    };
  }
  
  // Step 3: Check for unsafe patterns in URL
  if (checkUrlForUnsafePatterns(urlString)) {
    return {
      valid: false,
      reason: "URL contains blocked content indicators",
      domain,
    };
  }
  
  // Step 4: Check domain trust level
  const trusted = isDomainTrusted(domain);
  
  return {
    valid: true,
    trusted,
    domain,
  };
}

/**
 * Checks if a URL is a YouTube URL
 */
export function isYouTubeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'youtu.be'
    );
  } catch {
    return false;
  }
}
