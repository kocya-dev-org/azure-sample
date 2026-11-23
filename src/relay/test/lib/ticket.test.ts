import { describe, expect, it } from 'vitest';
import { NonceStore, verifyTicket } from '../../src/lib/ticket';
import { makePayload, SECRET, signTicket } from '../helpers';

const NOW = 1_900_000_000;

/**
 * SWA API の signTicket（src/api/test/lib/relayTicket.test.ts）と同じテストベクター。
 * どちらかの形式を変えると、両方のテストが失敗する。
 */
const TICKET_VECTOR = {
  secret: 'vector-secret',
  ticket:
    'eyJ2IjoyLCJub25jZSI6Im4xIiwiZXhwIjoxOTAwMDAwMzAwLCJwcm9kdWN0SWQiOiJwMSIsInVzZXJJZCI6InUxIiwiaW5zdHJ1Y3Rpb25zIjoi5oyH56S6IiwibWF4U2Vjb25kcyI6MzAwfQ.b8SoszxETc_HihinISbjcTwQ0qlFBSorvrKJ7PmWKqU',
};

describe('verifyTicket', () => {
  it('正しいチケットの内容を返す', () => {
    const payload = makePayload();
    const result = verifyTicket(signTicket(payload), SECRET, NOW, new NonceStore());
    expect(result).toEqual({ ok: true, payload });
  });

  it('SWA API が作ったチケットを検証できる', () => {
    const result = verifyTicket(TICKET_VECTOR.ticket, TICKET_VECTOR.secret, NOW, new NonceStore());
    expect(result.ok && result.payload).toMatchObject({
      nonce: 'n1',
      productId: 'p1',
      instructions: '指示',
    });
  });

  it('署名が違えば拒否する', () => {
    const ticket = signTicket(makePayload(), 'other-secret');
    expect(verifyTicket(ticket, SECRET, NOW, new NonceStore())).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('内容を書き換えたら拒否する', () => {
    const [, signature] = signTicket(makePayload()).split('.');
    const body = Buffer.from(JSON.stringify(makePayload({ maxSeconds: 9999 }))).toString(
      'base64url',
    );
    expect(verifyTicket(`${body}.${signature}`, SECRET, NOW, new NonceStore()).ok).toBe(false);
  });

  it('期限切れなら拒否する', () => {
    const ticket = signTicket(makePayload({ exp: NOW - 1 }));
    expect(verifyTicket(ticket, SECRET, NOW, new NonceStore())).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('同じチケットの 2 回目は拒否する', () => {
    const nonces = new NonceStore();
    const ticket = signTicket(makePayload());
    expect(verifyTicket(ticket, SECRET, NOW, nonces).ok).toBe(true);
    expect(verifyTicket(ticket, SECRET, NOW, nonces)).toEqual({ ok: false, reason: 'reused' });
  });

  it('古い形式（v1）のチケットは拒否する', () => {
    const ticket = signTicket({ ...makePayload(), v: 1 } as unknown as ReturnType<
      typeof makePayload
    >);
    expect(verifyTicket(ticket, SECRET, NOW, new NonceStore())).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('形式が違えば拒否する', () => {
    expect(verifyTicket('abc', SECRET, NOW, new NonceStore())).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
