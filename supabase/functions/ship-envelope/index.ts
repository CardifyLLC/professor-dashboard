import { requireAdmin } from '../_shared/requireAdmin.ts';
import { createEnvelopeShippingHandler } from '../_shared/envelope-shipping-handler.mjs';
import { createEnvelopeRepository } from '../_shared/envelope-shipping-repository.mjs';
import { createEnvelopeMailer } from '../_shared/envelope-mailer.mjs';

Deno.serve(createEnvelopeShippingHandler({
  requireAdmin,
  repository: createEnvelopeRepository({ url: Deno.env.get('SUPABASE_URL'), serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') }),
  mailer: createEnvelopeMailer({ env: name => Deno.env.get(name) }),
}));
