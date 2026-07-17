/**
 * orders-api — REST endpoints for TCGPlaytest order data
 *
 * Authentication: set ORDERS_API_KEY secret in Supabase, then pass it as:
 *   Header:      x-api-key: your-key
 *   Query param: ?api_key=your-key
 *
 * Endpoints:
 *   GET /orders-api/stats                          — counts per status + revenue totals
 *   GET /orders-api/orders                         — paginated orders (search, status, page, pageSize)
 *   GET /orders-api/orders/:id                     — single order (all fields)
 *   GET /orders-api/orders/status/pending          — pending orders
 *   GET /orders-api/orders/status/paid             — paid orders
 *   GET /orders-api/orders/status/processing       — processing orders
 *   GET /orders-api/orders/status/shipped          — shipped orders
 *   GET /orders-api/orders/status/completed        — completed orders
 *   GET /orders-api/orders/status/cancelled        — cancelled orders
 *   GET /orders-api/customers                      — customers with order counts + spend
 *   GET /orders-api/revenue                        — revenue breakdown (daily, monthly)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VALID_STATUSES = ["pending", "paid", "processing", "shipped", "completed", "cancelled"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "Method not allowed." });

  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ordersApiKey = Deno.env.get("ORDERS_API");

  const url = new URL(req.url);
  const providedKey =
    req.headers.get("x-api-key") ??
    url.searchParams.get("api_key") ??
    "";

  if (!ordersApiKey || providedKey !== ordersApiKey) {
    return json(401, { error: "Unauthorized. Pass your API key via x-api-key header or ?api_key= query param." });
  }

  const sbHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const sb = async (path: string) => {
    const res = await fetch(`${supabaseUrl}/rest/v1${path}`, { headers: sbHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message ?? `Supabase error on ${path}`);
    return data;
  };

  // ── Routing ───────────────────────────────────────────────────────────────
  // Strip the function name prefix so we work with the path after /orders-api
  const segments = url.pathname.replace(/^\/orders-api\/?/, "").split("/").filter(Boolean);
  const qs = url.searchParams;

  try {
    // ── GET /stats ──────────────────────────────────────────────────────────
    if (segments[0] === "stats" || segments.length === 0) {
      const rows: Array<{ status: string; total_amount_cents: number }> =
        await sb("/orders?select=status,total_amount_cents");

      const stats: Record<string, { count: number; revenue_cents: number }> = {};
      for (const s of VALID_STATUSES) stats[s] = { count: 0, revenue_cents: 0 };

      let totalRevenue = 0;
      let totalOrders = 0;
      for (const r of rows) {
        const s = String(r.status ?? "").toLowerCase();
        if (stats[s]) {
          stats[s].count++;
          stats[s].revenue_cents += r.total_amount_cents ?? 0;
        }
        totalRevenue += r.total_amount_cents ?? 0;
        totalOrders++;
      }

      return json(200, {
        total_orders: totalOrders,
        total_revenue_cents: totalRevenue,
        total_revenue_usd: (totalRevenue / 100).toFixed(2),
        by_status: stats,
      });
    }

    // ── GET /orders ─────────────────────────────────────────────────────────
    if (segments[0] === "orders") {

      // GET /orders/status/:status
      if (segments[1] === "status" && segments[2]) {
        const status = segments[2].toLowerCase();
        if (!VALID_STATUSES.includes(status)) {
          return json(400, { error: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}` });
        }
        const page = Math.max(1, parseInt(qs.get("page") ?? "1"));
        const pageSize = Math.min(100, Math.max(1, parseInt(qs.get("pageSize") ?? "20")));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const data = await sb(
          `/orders?select=id,customer_name,customer_email,status,total_amount_cents,quantity,created_at,shipping_address,metadata` +
          `&status=eq.${encodeURIComponent(status)}` +
          `&order=created_at.desc` +
          `&offset=${from}&limit=${pageSize}`
        );

        return json(200, { status, page, pageSize, count: data.length, orders: data });
      }

      // GET /orders/:id
      if (segments[1] && segments[1] !== "status") {
        const orderId = segments[1];
        const data = await sb(`/orders?id=eq.${encodeURIComponent(orderId)}&select=*`);
        if (!data.length) return json(404, { error: "Order not found." });
        return json(200, { order: data[0] });
      }

      // GET /orders — paginated, filterable
      const page = Math.max(1, parseInt(qs.get("page") ?? "1"));
      const pageSize = Math.min(100, Math.max(1, parseInt(qs.get("pageSize") ?? "20")));
      const status = qs.get("status") ?? "";
      const search = qs.get("search") ?? "";
      const from = (page - 1) * pageSize;

      let path =
        `/orders?select=id,customer_name,customer_email,status,total_amount_cents,quantity,created_at,metadata` +
        `&order=created_at.desc&offset=${from}&limit=${pageSize}`;

      if (status && VALID_STATUSES.includes(status.toLowerCase())) {
        path += `&status=eq.${encodeURIComponent(status.toLowerCase())}`;
      }
      if (search) {
        path += `&or=(customer_name.ilike.%25${encodeURIComponent(search)}%25,customer_email.ilike.%25${encodeURIComponent(search)}%25)`;
      }

      const data = await sb(path);
      return json(200, { page, pageSize, count: data.length, orders: data });
    }

    // ── GET /customers ───────────────────────────────────────────────────────
    if (segments[0] === "customers") {
      const rows: Array<{
        customer_name: string;
        customer_email: string;
        status: string;
        total_amount_cents: number;
        created_at: string;
      }> = await sb("/orders?select=customer_name,customer_email,status,total_amount_cents,created_at&order=created_at.desc");

      const map = new Map<string, {
        customer_name: string;
        customer_email: string;
        order_count: number;
        total_spent_cents: number;
        first_order: string;
        last_order: string;
        statuses: Record<string, number>;
      }>();

      for (const r of rows) {
        const email = r.customer_email ?? "unknown";
        if (!map.has(email)) {
          map.set(email, {
            customer_name: r.customer_name ?? "Guest",
            customer_email: email,
            order_count: 0,
            total_spent_cents: 0,
            first_order: r.created_at,
            last_order: r.created_at,
            statuses: {},
          });
        }
        const c = map.get(email)!;
        c.order_count++;
        c.total_spent_cents += r.total_amount_cents ?? 0;
        if (r.created_at < c.first_order) c.first_order = r.created_at;
        if (r.created_at > c.last_order) c.last_order = r.created_at;
        const s = String(r.status ?? "").toLowerCase();
        c.statuses[s] = (c.statuses[s] ?? 0) + 1;
      }

      const customers = Array.from(map.values())
        .map((c) => ({ ...c, total_spent_usd: (c.total_spent_cents / 100).toFixed(2) }))
        .sort((a, b) => b.total_spent_cents - a.total_spent_cents);

      return json(200, { total_customers: customers.length, customers });
    }

    // ── GET /revenue ─────────────────────────────────────────────────────────
    if (segments[0] === "revenue") {
      const rows: Array<{ total_amount_cents: number; status: string; created_at: string }> =
        await sb("/orders?select=total_amount_cents,status,created_at&order=created_at.asc");

      const daily: Record<string, number> = {};
      const monthly: Record<string, number> = {};

      for (const r of rows) {
        const s = String(r.status ?? "").toLowerCase();
        if (!["completed", "paid", "processing", "shipped"].includes(s)) continue;
        const cents = r.total_amount_cents ?? 0;
        const date = r.created_at.slice(0, 10);
        const month = r.created_at.slice(0, 7);
        daily[date] = (daily[date] ?? 0) + cents;
        monthly[month] = (monthly[month] ?? 0) + cents;
      }

      const toUsd = (rec: Record<string, number>) =>
        Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, (v / 100).toFixed(2)]));

      return json(200, {
        daily_revenue_usd: toUsd(daily),
        monthly_revenue_usd: toUsd(monthly),
      });
    }

    return json(404, {
      error: "Unknown endpoint.",
      available: [
        "GET /orders-api/stats",
        "GET /orders-api/orders",
        "GET /orders-api/orders?status=paid&search=john&page=1&pageSize=20",
        "GET /orders-api/orders/:id",
        "GET /orders-api/orders/status/pending",
        "GET /orders-api/orders/status/paid",
        "GET /orders-api/orders/status/processing",
        "GET /orders-api/orders/status/shipped",
        "GET /orders-api/orders/status/completed",
        "GET /orders-api/orders/status/cancelled",
        "GET /orders-api/customers",
        "GET /orders-api/revenue",
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return json(500, { error: message });
  }
});
