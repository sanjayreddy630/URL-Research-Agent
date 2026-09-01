/**
 * Source Comparison Service
 * Compares multiple analyzed sources to identify common findings and differences
 */

export interface SourceComparison {
  sourceCount: number;
  commonFindings: string[];
  differences: {
    source: string;
    finding: string;
  }[];
  conflicts: {
    topic: string;
    sources: {
      source: string;
      position: string;
    }[];
  }[];
  summary: string;
}

/**
 * Extracts key findings from research text
 * Looks for sentences/sections that contain substantive information
 */
function extractKeyFindings(text: string, limit: number = 10): string[] {
  if (!text) return [];
  
  const findings: string[] = [];
  
  // Split by common finding markers
  const sections = text.split(/^###\s+|^##\s+|^\d+\.\s+/gm).filter(Boolean);
  
  for (const section of sections) {
    const lines = section.split('\n').filter(line => line.trim().length > 20);
    for (const line of lines) {
      const cleaned = line.replace(/^[\d\-\*\.\s]+/, '').trim();
      if (cleaned.length > 30 && cleaned.length < 500) {
        findings.push(cleaned);
        if (findings.length >= limit) break;
      }
    }
    if (findings.length >= limit) break;
  }
  
  return findings;
}

/**
 * Normalizes text for comparison (lowercase, remove punctuation)
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Calculates similarity between two strings (simple Levenshtein-like)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeForComparison(str1);
  const norm2 = normalizeForComparison(str2);
  
  if (norm1 === norm2) return 1;
  
  const len1 = norm1.length;
  const len2 = norm2.length;
  if (len1 === 0 || len2 === 0) return 0;
  
  // Simple: count common words
  const words1 = new Set(norm1.split(' '));
  const words2 = new Set(norm2.split(' '));
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  return matches / Math.max(words1.size, words2.size);
}

/**
 * Finds common findings across multiple sources
 */
function findCommonFindings(
  findings: { source: string; findings: string[] }[]
): string[] {
  if (findings.length < 2) return [];
  
  const common: string[] = [];
  const firstSource = findings[0];
  
  for (const finding of firstSource.findings) {
    let foundInAll = true;
    
    for (let i = 1; i < findings.length; i++) {
      const hasMatch = findings[i].findings.some(
        f => calculateSimilarity(finding, f) > 0.6
      );
      if (!hasMatch) {
        foundInAll = false;
        break;
      }
    }
    
    if (foundInAll) {
      common.push(finding);
    }
  }
  
  return common;
}

/**
 * Finds differences between sources
 */
function findDifferences(
  findings: { source: string; findings: string[] }[]
): { source: string; finding: string }[] {
  const differences: { source: string; finding: string }[] = [];
  const commonFindings = findCommonFindings(findings);
  
  for (const { source, findings: sourceFindings } of findings) {
    for (const finding of sourceFindings) {
      const isCommon = commonFindings.some(
        f => calculateSimilarity(finding, f) > 0.6
      );
      
      if (!isCommon) {
        differences.push({ source, finding });
      }
    }
  }
  
  return differences;
}

/**
 * Detects conflicting information between sources
 */
function detectConflicts(
  findings: { source: string; findings: string[] }[]
): SourceComparison['conflicts'] {
  const conflicts: SourceComparison['conflicts'] = [];
  
  // Look for conflicting indicators
  const conflictPatterns = [
    { patterns: [/increase|growth|rise/i, /decrease|decline|fall/i], topic: 'Trends' },
    { patterns: [/support|agree|positive/i, /oppose|disagree|negative/i], topic: 'Positions' },
    { patterns: [/improve|better|enhanced/i, /worsen|worse|degraded/i], topic: 'Quality Changes' },
  ];
  
  for (const { patterns: [pattern1, pattern2], topic } of conflictPatterns) {
    const sourcesWithFirst: { source: string; position: string }[] = [];
    const sourcesWithSecond: { source: string; position: string }[] = [];
    
    for (const { source, findings: sourceFindings } of findings) {
      const hasFirst = sourceFindings.some(f => pattern1.test(f));
      const hasSecond = sourceFindings.some(f => pattern2.test(f));
      
      if (hasFirst && hasSecond) {
        // Mixed signals in one source, skip
        continue;
      } else if (hasFirst) {
        sourcesWithFirst.push({ source, position: pattern1.source });
      } else if (hasSecond) {
        sourcesWithSecond.push({ source, position: pattern2.source });
      }
    }
    
    if (sourcesWithFirst.length > 0 && sourcesWithSecond.length > 0) {
      conflicts.push({
        topic,
        sources: [...sourcesWithFirst, ...sourcesWithSecond],
      });
    }
  }
  
  return conflicts;
}

/**
 * Compares multiple research results
 */
export function compareMultipleSources(
  sources: {
    title: string;
    research: string;
  }[]
): SourceComparison {
  const sourceFindings = sources.map((source, index) => ({
    source: source.title || `Source ${index + 1}`,
    findings: extractKeyFindings(source.research),
  }));
  
  const commonFindings = findCommonFindings(sourceFindings);
  const differences = findDifferences(sourceFindings);
  const conflicts = detectConflicts(sourceFindings);
  
  // Generate summary
  let summary = `Comparison of ${sources.length} sources:\n`;
  summary += `- Common findings: ${commonFindings.length}\n`;
  summary += `- Unique differences: ${differences.length}\n`;
  summary += `- Conflicting information: ${conflicts.length}`;
  
  return {
    sourceCount: sources.length,
    commonFindings,
    differences,
    conflicts,
    summary,
  };
}

/**
 * Formats comparison for display
 */
export function formatComparisonForDisplay(comparison: SourceComparison): string {
  let output = '# Source Comparison Analysis\n\n';
  
  output += `## Overview\n`;
  output += `Analyzed ${comparison.sourceCount} sources\n\n`;
  
  output += `## Common Findings (${comparison.commonFindings.length})\n`;
  if (comparison.commonFindings.length > 0) {
    comparison.commonFindings.forEach((finding, i) => {
      output += `${i + 1}. ${finding}\n`;
    });
  } else {
    output += 'No common findings across all sources.\n';
  }
  output += '\n';
  
  output += `## Unique Findings by Source\n`;
  if (comparison.differences.length > 0) {
    comparison.differences.forEach(({ source, finding }) => {
      output += `- **${source}**: ${finding}\n`;
    });
  } else {
    output += 'No unique findings detected.\n';
  }
  output += '\n';
  
  if (comparison.conflicts.length > 0) {
    output += `## Conflicting Information\n`;
    comparison.conflicts.forEach(({ topic, sources: conflictSources }) => {
      output += `### ${topic}\n`;
      conflictSources.forEach(({ source, position }) => {
        output += `- **${source}**: ${position}\n`;
      });
    });
    output += '\n';
  }
  
  output += `## Key Insights\n`;
  output += `- Total sources analyzed: ${comparison.sourceCount}\n`;
  output += `- Consensus areas: ${comparison.commonFindings.length} finding(s) supported by all sources\n`;
  output += `- Points of divergence: ${comparison.differences.length} unique perspective(s)\n`;
  output += `- Conflicting perspectives: ${comparison.conflicts.length} area(s)\n`;
  
  return output;
}
