import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAffiliateHistory } from '../src/services/affiliateHistory.mjs';

test('purging an order preserves its count, revenue and attribution', () => {
    const live = { id: 'one', created_at: '2026-09-01', total_amount_cents: 1234, affiliate_code: 'PARTNER' };
    const archived = { order_id: 'one', order_created_at: live.created_at, total_amount_cents: 1234, affiliate_code: 'PARTNER' };
    const before = mergeAffiliateHistory([live], []);
    const after = mergeAffiliateHistory([], [archived]);
    assert.equal(after.length, before.length);
    assert.equal(after[0].total_amount_cents, before[0].total_amount_cents);
    assert.equal(after[0].affiliate_code, 'PARTNER');
    assert.equal(after[0].isArchived, true);
});
test('live and archive overlap counts only once and uses current live values', () => {
    const result = mergeAffiliateHistory([{ id: 'one', created_at: '2026-09-01', total_amount_cents: 1200 }],
        [{ order_id: 'one', order_created_at: '2026-09-01', total_amount_cents: 1000 }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].total_amount_cents, 1200);
    assert.equal(result[0].isArchived, false);
});
