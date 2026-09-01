/**
 * Research History Service
 * Manages storage and retrieval of previous research analyses
 */

export interface ResearchHistoryItem {
  id: string;
  url: string;
  sourceType: 'Website' | 'YouTube' | 'Multiple';
  title: string;
  timestamp: number; // Unix timestamp
  dateString: string; // Human-readable date
  extractedContent: string; // For chat context
  research: string; // The research report
  pipeline?: 'website' | 'youtube';
  sourceLevel?: 'FULL' | 'LIMITED' | 'AUTH_REQUIRED' | 'NONE';
  urls?: string[]; // For multi-source
  isSafe: boolean;
}

export interface ResearchHistoryResponse {
  id: string;
  url: string;
  sourceType: string;
  title: string;
  dateString: string;
  timestamp: number;
}

/**
 * Generates unique ID for a research item
 */
function generateId(): string {
  return `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Formats a date for display
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Creates a research history item
 */
export function createHistoryItem(
  url: string,
  sourceType: string,
  title: string,
  extractedContent: string,
  research: string,
  options?: {
    pipeline?: 'website' | 'youtube';
    sourceLevel?: 'FULL' | 'LIMITED' | 'AUTH_REQUIRED' | 'NONE';
    urls?: string[];
    isSafe?: boolean;
  }
): ResearchHistoryItem {
  const timestamp = Date.now();
  
  return {
    id: generateId(),
    url,
    sourceType: sourceType as 'Website' | 'YouTube' | 'Multiple',
    title,
    timestamp,
    dateString: formatDate(timestamp),
    extractedContent,
    research,
    pipeline: options?.pipeline,
    sourceLevel: options?.sourceLevel,
    urls: options?.urls,
    isSafe: options?.isSafe !== false,
  };
}

/**
 * Formats a history item for API responses (without sensitive data)
 */
export function formatHistoryForResponse(item: ResearchHistoryItem): ResearchHistoryResponse {
  return {
    id: item.id,
    url: item.url,
    sourceType: item.sourceType,
    title: item.title,
    dateString: item.dateString,
    timestamp: item.timestamp,
  };
}

/**
 * Saves history to localStorage (client-side)
 */
export function saveHistoryToLocalStorage(item: ResearchHistoryItem): void {
  if (typeof window === 'undefined') return; // Skip on server
  
  try {
    const existing = localStorage.getItem('research_history');
    const history = existing ? JSON.parse(existing) : [];
    
    // Keep only the last 100 items
    history.push(item);
    const limited = history.slice(-100);
    
    localStorage.setItem('research_history', JSON.stringify(limited));
  } catch (error) {
    console.error('Failed to save research history:', error);
  }
}

/**
 * Loads history from localStorage (client-side)
 */
export function loadHistoryFromLocalStorage(): ResearchHistoryItem[] {
  if (typeof window === 'undefined') return []; // Skip on server
  
  try {
    const existing = localStorage.getItem('research_history');
    if (!existing) return [];
    
    const history = JSON.parse(existing) as ResearchHistoryItem[];
    return history.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Failed to load research history:', error);
    return [];
  }
}

/**
 * Gets a specific research item by ID
 */
export function getHistoryItemById(id: string): ResearchHistoryItem | null {
  if (typeof window === 'undefined') return null; // Skip on server
  
  try {
    const existing = localStorage.getItem('research_history');
    if (!existing) return null;
    
    const history = JSON.parse(existing) as ResearchHistoryItem[];
    return history.find(item => item.id === id) || null;
  } catch (error) {
    console.error('Failed to retrieve history item:', error);
    return null;
  }
}

/**
 * Deletes a history item by ID
 */
export function deleteHistoryItem(id: string): boolean {
  if (typeof window === 'undefined') return false; // Skip on server
  
  try {
    const existing = localStorage.getItem('research_history');
    if (!existing) return false;
    
    const history = JSON.parse(existing) as ResearchHistoryItem[];
    const filtered = history.filter(item => item.id !== id);
    
    if (filtered.length === history.length) {
      return false; // Item not found
    }
    
    localStorage.setItem('research_history', JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Failed to delete history item:', error);
    return false;
  }
}

/**
 * Clears all research history
 */
export function clearAllHistory(): void {
  if (typeof window === 'undefined') return; // Skip on server
  
  try {
    localStorage.removeItem('research_history');
  } catch (error) {
    console.error('Failed to clear history:', error);
  }
}

/**
 * Gets history summary for API (list view)
 */
export function getHistorySummary(): ResearchHistoryResponse[] {
  if (typeof window === 'undefined') return []; // Skip on server
  
  try {
    const history = loadHistoryFromLocalStorage();
    return history.map(formatHistoryForResponse);
  } catch (error) {
    console.error('Failed to get history summary:', error);
    return [];
  }
}
