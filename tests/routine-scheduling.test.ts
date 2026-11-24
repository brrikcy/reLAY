import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleAtLocalTime } from '../server/runtime/routine-execution.ts';

test('Daily routines use the selected timezone and next future local time', () => {
  const utc = scheduleAtLocalTime('09:00', 'UTC', new Date('2026-11-20T08:00:00Z'));
  assert.equal(utc.toISOString(), '2026-11-20T09:00:00.000Z');
  const singapore = scheduleAtLocalTime('09:00', 'Asia/Singapore', new Date('2026-11-20T00:00:00Z'));
  assert.equal(singapore.toISOString(), '2026-11-20T01:00:00.000Z');
  const nextDay = scheduleAtLocalTime('09:00', 'America/New_York', new Date('2026-11-20T15:00:00Z'));
  assert.equal(nextDay.toISOString(), '2026-11-21T14:00:00.000Z');
  const followingDay = scheduleAtLocalTime('08:00', 'America/New_York', new Date('2026-11-20T15:00:00Z'));
  assert.equal(followingDay.toISOString(), '2026-11-21T13:00:00.000Z');
});

test('Invalid local times and timezones are rejected', () => {
  assert.throws(() => scheduleAtLocalTime('25:00', 'UTC'), /valid daily time/);
  assert.throws(() => scheduleAtLocalTime('09:00', 'Not/AZone'), /valid IANA timezone/);
});
