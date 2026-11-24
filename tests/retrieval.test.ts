import test from 'node:test';
import assert from 'node:assert/strict';
import { contextMemories, rankMemories } from '../server/runtime/retrieval.ts';
import type { Memory } from '../server/types.ts';

function memory(id: string, content: string, category: Memory['category'] = 'fact'): Memory {
  return { id, botId: 'bot_test', content, category, source: 'manual', createdAt: `2026-11-${String(Number(id.replace(/\D/g, '')) || 1).padStart(2, '0')}T00:00:00.000Z`, updatedAt: '2026-11-20T00:00:00.000Z' };
}

test('Local relevance ranking recalls an older matching fact without cloud embeddings', () => {
  const memories = [memory('1', 'Daily weather summaries were generated.'), memory('2', 'The release codename is Juniper.'), memory('3', 'Routine meeting notes are archived.')];
  const ranked = rankMemories(memories, 'What is the release codename?');
  assert.equal(ranked[0].id, '2');
  assert.equal(ranked.some((memory) => memory.id === '1'), false);
});

test('Pinned preferences survive relevance selection and result context is bounded', () => {
  const memories = [memory('1', 'Always use metric units.', 'preference'), ...Array.from({ length: 60 }, (_, index) => memory(String(index + 2), `Archived project note ${index}`))];
  memories.push(memory('100', 'Juniper is the selected release codename.'));
  const selected = contextMemories(memories, 'release codename');
  assert.ok(selected.length <= 25);
  assert.equal(selected[0].category, 'preference');
  assert.ok(selected.some((memory) => memory.id === '100'));
});
