import type { Memory } from '../types.ts';

const stopWords = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'could', 'from', 'have', 'into', 'just', 'like', 'more', 'most', 'other', 'over', 'should', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'through', 'under', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your']);

function terms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,48}/gu) ?? [];
  const meaningful = words.filter((word) => !stopWords.has(word));
  return [...meaningful, ...meaningful.slice(1).map((word, index) => `${meaningful[index]}_${word}`)];
}

function similarity(query: string, content: string): number {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length) return 0;
  const contentTerms = new Set(terms(content));
  const contentText = ` ${content.toLowerCase()} `;
  const coverage = queryTerms.filter((term) => contentTerms.has(term)).length / queryTerms.length;
  const exactPhrase = query.trim().length > 3 && contentText.includes(query.trim().toLowerCase()) ? 0.5 : 0;
  return coverage + exactPhrase;
}

export function rankMemories(memories: Memory[], query: string, limit = 12): Memory[] {
  const trimmed = query.trim();
  if (!trimmed) return memories.slice(0, limit);
  return memories.map((memory, index) => {
    const score = similarity(trimmed, memory.content);
    const categoryBoost = memory.category === 'rule' ? 0.025 : memory.category === 'preference' ? 0.01 : 0;
    const recencyBoost = Math.max(0, 0.005 - index * 0.00005);
    return { memory, score: score + categoryBoost + recencyBoost };
  }).filter((item) => item.score > 0.04).sort((left, right) => right.score - left.score).slice(0, limit).map((item) => item.memory);
}

export function contextMemories(memories: Memory[], query: string): Memory[] {
  const pinned = memories.filter((memory) => memory.category === 'rule' || memory.category === 'preference').slice(0, 12);
  const relevant = rankMemories(memories, query, 12);
  const recent = memories.filter((memory) => memory.category !== 'work_log').slice(0, 4);
  return [...new Map([...pinned, ...relevant, ...recent].map((memory) => [memory.id, memory])).values()].slice(0, 25);
}
