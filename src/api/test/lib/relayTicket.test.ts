import { describe, expect, it } from 'vitest';
import { newTicketPayload, signTicket, TICKET_TTL_SECONDS } from '../../src/lib/relayTicket';

describe('signTicket', () => {
  it('中継（src/relay/test/lib/ticket.test.ts）と同じテストベクターを作る', () => {
    const ticket = signTicket(
      {
        v: 2,
        nonce: 'n1',
        exp: 1_900_000_300,
        productId: 'p1',
        userId: 'u1',
        instructions: '指示',
        maxSeconds: 300,
      },
      'vector-secret',
    );
    expect(ticket).toBe(
      'eyJ2IjoyLCJub25jZSI6Im4xIiwiZXhwIjoxOTAwMDAwMzAwLCJwcm9kdWN0SWQiOiJwMSIsInVzZXJJZCI6InUxIiwiaW5zdHJ1Y3Rpb25zIjoi5oyH56S6IiwibWF4U2Vjb25kcyI6MzAwfQ.b8SoszxETc_HihinISbjcTwQ0qlFBSorvrKJ7PmWKqU',
    );
  });
});

describe('newTicketPayload', () => {
  it('毎回違う nonce と、有効期限を付ける', () => {
    const fields = { productId: 'p1', userId: 'u1', instructions: '', maxSeconds: 300 };
    const a = newTicketPayload(fields, 1000);
    const b = newTicketPayload(fields, 1000);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a).toMatchObject({ v: 2, exp: 1000 + TICKET_TTL_SECONDS, productId: 'p1' });
  });
});
