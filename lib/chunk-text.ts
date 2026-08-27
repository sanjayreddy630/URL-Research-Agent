export function chunkText(text: string, maxCharacters = 4000): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    const normalizedSentence = sentence.trim();

    if (!normalizedSentence) continue;

    if (
      currentChunk &&
      currentChunk.length + normalizedSentence.length + 1 > maxCharacters
    ) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    if (normalizedSentence.length > maxCharacters) {
      for (let start = 0; start < normalizedSentence.length; start += maxCharacters) {
        const part = normalizedSentence.slice(start, start + maxCharacters).trim();
        if (part) chunks.push(part);
      }
    } else {
      currentChunk = currentChunk
        ? `${currentChunk} ${normalizedSentence}`
        : normalizedSentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}
