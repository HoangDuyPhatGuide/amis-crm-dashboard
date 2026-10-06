/**
 * AMIS CRM proxy for the static GitHub Pages dashboard.
 *
 * Required Worker secrets:
 *   AMIS_CLIENT_ID      AppID configured in AMIS CRM API connection
 *   AMIS_BEARER_TOKEN  Bearer token issued for that application
 * Optional Worker variables:
 *   ALLOWED_ORIGIN     e.g. https://your-account.github.io
 *   QUOTE_API_URL      a permitted AMIS/internal endpoint returning quotations
 *   QUOTE_API_TOKEN    token for QUOTE_API_URL when it differs from AMIS token
 *
 * Never add either secret to the GitHub Pages repository or browser storage.
 */
const AMIS_BASE = "https://crmconnect.misa.vn";
const PAGE_SIZE = 100;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";
    const corsOrigin = allowedOrigin && origin === allowedOrigin ? origin : allowedOrigin || "*";
    const cors = { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, cors);
    const url = new URL(request.url);
    if (url.pathname !== "/api/dashboard") return json({ error: "Not found" }, 404, cors);
    if (!env.AMIS_CLIENT_ID || !env.AMIS_BEARER_TOKEN) return json({ error: "AMIS credentials are not configured on the proxy." }, 500, cors);

    try {
      const [orders, customers, quoteResult] = await Promise.all([
        getAllPages("/api/v2/SaleOrders", env),
        getAllPages("/api/v2/Customers", env),
        getQuotes(env)
      ]);
      // The API's documented listing endpoints have no date filter. We return normalized
      // records and let the page apply the selected from/to dates consistently.
      return json({ orders, customers, quotes: quoteResult.quotes, quoteSourceConfigured: quoteResult.configured, fetchedAt: new Date().toISOString() }, 200, { ...cors, "Cache-Control": "no-store" });
    } catch (error) {
      return json({ error: "Unable to read AMIS CRM", detail: String(error.message || error) }, 502, cors);
    }
  }
};

async function getAllPages(path, env) {
  const first = await amisGet(`${path}?page=0&pageSize=${PAGE_SIZE}&orderBy=modified_date&isDescending=true`, env);
  const items = unwrapItems(first);
  const total = Number(first?.total_records ?? first?.totalRecords ?? first?.data?.total_records ?? first?.data?.totalRecords ?? items.length);
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return items;
  const rest = await Promise.all(Array.from({ length: Math.min(pages - 1, 49) }, (_, index) => amisGet(`${path}?page=${index + 1}&pageSize=${PAGE_SIZE}&orderBy=modified_date&isDescending=true`, env)));
  return items.concat(rest.flatMap(unwrapItems));
}

async function amisGet(path, env) {
  const response = await fetch(`${AMIS_BASE}${path}`, { headers: { Authorization: `Bearer ${env.AMIS_BEARER_TOKEN}`, Clientid: env.AMIS_CLIENT_ID, Accept: "application/json" } });
  if (!response.ok) throw new Error(`AMIS API ${response.status}`);
  const body = await response.json();
  if (body?.success === false) throw new Error(body.error_message || body.user_msg || "AMIS returned unsuccessful response");
  return body;
}

function unwrapItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data?.items)) return body.data.items;
  if (Array.isArray(body?.data?.data)) return body.data.data;
  return [];
}

async function getQuotes(env) {
  // AMIS public v2 Swagger lists SaleOrders, Customers and Contacts but no quotation
  // list endpoint. A tenant-approved quote source must be supplied explicitly.
  if (!env.QUOTE_API_URL) return { quotes: [], configured: false };
  const headers = { Accept: "application/json" };
  if (env.QUOTE_API_TOKEN) headers.Authorization = `Bearer ${env.QUOTE_API_TOKEN}`;
  const response = await fetch(env.QUOTE_API_URL, { headers });
  if (!response.ok) throw new Error(`Quote source ${response.status}`);
  return { quotes: unwrapItems(await response.json()), configured: true };
}

function json(body, status, headers) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } }); }
