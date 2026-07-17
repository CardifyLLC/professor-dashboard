import { adminAuthError, requireAdmin } from '../_shared/requireAdmin.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Prompt builder ─────────────────────────────────────────────────────────────
const buildPrompt = (data: unknown) => `
You are a senior business analyst for TCGPlaytest, a card printing platform for trading card game designers.

Analyze the following analytics data and provide a structured report with these exact sections:

## Key Insights
3-5 bullet points on what stands out most from the data.

## Problem Areas
Specific issues that need immediate attention (refund rate, funnel drop-offs, errors, etc).

## Recommendations
Concrete, actionable steps the team can take this week. Be specific — name the metric and what to do.

## Trends to Watch
Patterns in the data worth monitoring over the next 30 days.

Be concise, direct, and practical. Avoid generic advice. Reference actual numbers from the data.

---
Analytics Data:
${JSON.stringify(data, null, 2)}
`.trim();

// ── Claude (Anthropic) ─────────────────────────────────────────────────────────
const callClaude = async (prompt: string, providedKey?: string): Promise<string> => {
  const apiKey = providedKey || Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("No Anthropic API key provided. Add one in the dashboard or set ANTHROPIC_API_KEY in Supabase secrets.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic error ${res.status}`);
  return data.content?.[0]?.text ?? "";
};

// ── OpenAI ─────────────────────────────────────────────────────────────────────
const callOpenAI = async (prompt: string, providedKey?: string): Promise<string> => {
  const apiKey = providedKey || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("No OpenAI API key provided. Add one in the dashboard or set OPENAI_API_KEY in Supabase secrets.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      max_completion_tokens: 1500,
      messages: [
        { role: "system", content: "You are a senior business analyst for a card printing platform." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
  return data.choices?.[0]?.message?.content ?? "";
};

// ── Gemini ─────────────────────────────────────────────────────────────────────
const callGemini = async (prompt: string, providedKey?: string): Promise<string> => {
  const apiKey = providedKey || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("No Gemini API key provided. Add one in the dashboard or set GEMINI_API_KEY in Supabase secrets.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.4 },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
};

// ── Handler ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  try {
    await requireAdmin(req);
  } catch (error) {
    return adminAuthError(error) || Response.json({ error: 'Admin authentication failed.' }, { status: 500 });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  let body: { model?: string; analyticsData?: unknown; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON." });
  }

  const { model, analyticsData, apiKey } = body;

  if (!model) return json(400, { error: "model is required. Use: claude | openai | gemini" });
  if (!analyticsData) return json(400, { error: "analyticsData is required." });

  const prompt = buildPrompt(analyticsData);

  try {
    let result = "";

    if (model === "claude") result = await callClaude(prompt, apiKey);
    else if (model === "openai") result = await callOpenAI(prompt, apiKey);
    else if (model === "gemini") result = await callGemini(prompt, apiKey);
    else return json(400, { error: `Unknown model: ${model}. Use: claude | openai | gemini` });

    return json(200, { result, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return json(500, { error: message });
  }
});
