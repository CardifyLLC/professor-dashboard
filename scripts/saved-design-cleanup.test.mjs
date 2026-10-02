import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePaths } from '../supabase/functions/cleanup-saved-designs/images.mjs';
const origin='https://project.supabase.co';
test('nested serialized refs normalize and deduplicate',()=>{
 const url=origin+'/storage/v1/object/public/order-images/user/front%20one.png';
 assert.deepEqual([...imagePaths({card_data:JSON.stringify([{front:url}]),preview:url},origin)],['user/front one.png']);
});
test('signed URLs exclude query tokens',()=>{
 assert.deepEqual([...imagePaths(origin+'/storage/v1/object/sign/order-images/back.png?token=abc',origin)],['back.png']);
});
test('ignores other projects, buckets and inline images',()=>{
 assert.equal(imagePaths(['https://other.supabase.co/storage/v1/object/public/order-images/test.png',origin+'/storage/v1/object/public/avatars/a.png','data:image/png;base64,abc'],origin).size,0);
});
test('reference comparison preserves shared files',()=>{
 const url=origin+'/storage/v1/object/public/order-images/shared.png';
 const refs=imagePaths({card_data:[{front:url}]},origin);
 assert.equal([...imagePaths({front:url},origin)].filter(p=>!refs.has(p)).length,0);
});
