import { catalog } from "./catalog.generated.js";

const KEYCRM_ORDER_URL = "https://openapi.keycrm.app/v1/order";
const DEFAULT_ORIGINS = ["https://itfata.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  const allowed = allowedOrigins(env);
  const acceptedOrigin = allowed.includes(origin) ? origin : "";
  return {
    ...(acceptedOrigin ? { "Access-Control-Allow-Origin": acceptedOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(data, status, origin, env) {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(origin, env), "Cache-Control": "no-store" }
  });
}

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePhone(value) {
  const raw = text(value, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `+38${digits}`;
  return digits ? `+${digits}` : "";
}

function validateOrder(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Некоректні дані замовлення.");
  if (text(input.website, 200)) throw new Error("Замовлення відхилено.");

  const firstName = text(input.firstName, 80);
  const lastName = text(input.lastName, 80);
  const phone = normalizePhone(input.phone);
  const email = text(input.email, 160).toLowerCase();
  const city = text(input.city, 120);
  const branch = text(input.branch, 200);
  const comment = text(input.comment, 500);
  const requestId = text(input.requestId, 80);

  if (firstName.length < 2 || lastName.length < 2) throw new Error("Перевірте ім'я та прізвище.");
  if (phone.replace(/\D/g, "").length < 10) throw new Error("Перевірте номер телефону.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Перевірте електронну пошту.");
  if (city.length < 2 || branch.length < 2) throw new Error("Перевірте місто та відділення Нової пошти.");
  if (!requestId) throw new Error("Не вдалося визначити номер запиту. Оновіть сторінку та спробуйте ще раз.");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new Error("Кошик порожній або містить забагато позицій.");

  const items = input.items.map((item) => {
    const slug = text(item?.slug, 160);
    const product = catalog[slug];
    const quantity = Number(item?.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error("Перевірте товари в кошику.");
    }
    return { name: product.name, price: product.price, quantity };
  });

  const marketing = Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]
      .map((key) => [key, text(input.marketing?.[key], 255)])
      .filter(([, value]) => value)
  );

  return { firstName, lastName, phone, email, city, branch, comment, requestId, items, marketing };
}

export function buildKeycrmOrder(input, sourceId) {
  const order = validateOrder(input);
  return {
    source_id: sourceId,
    source_uuid: order.requestId,
    buyer_comment: order.comment || null,
    manager_comment: "Замовлення з сайту itfata.github.io/sexshop/",
    buyer: {
      full_name: `${order.firstName} ${order.lastName}`,
      email: order.email,
      phone: order.phone
    },
    shipping: {
      shipping_service: "Нова Пошта",
      shipping_address_city: order.city,
      shipping_receive_point: order.branch,
      recipient_full_name: `${order.firstName} ${order.lastName}`,
      recipient_phone: order.phone
    },
    ...(Object.keys(order.marketing).length ? { marketing: order.marketing } : {}),
    products: order.items
  };
}

async function handleOrder(request, env, origin) {
  if (!env.KEYCRM_API_KEY || !env.KEYCRM_SOURCE_ID) {
    console.error("KeyCRM Worker is missing KEYCRM_API_KEY or KEYCRM_SOURCE_ID");
    return json({ ok: false, message: "Інтеграцію тимчасово не налаштовано." }, 503, origin, env);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 50000) return json({ ok: false, message: "Запит завеликий." }, 413, origin, env);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, message: "Некоректний формат замовлення." }, 400, origin, env);
  }

  let order;
  try {
    const sourceId = Number(env.KEYCRM_SOURCE_ID);
    if (!Number.isInteger(sourceId) || sourceId < 1) throw new Error("Некоректний ID джерела KeyCRM.");
    order = buildKeycrmOrder(input, sourceId);
  } catch (error) {
    return json({ ok: false, message: error.message }, 422, origin, env);
  }

  let response;
  try {
    response = await fetch(KEYCRM_ORDER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.KEYCRM_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    console.error("KeyCRM request failed", error);
    return json({ ok: false, message: "KeyCRM тимчасово недоступна. Спробуйте ще раз." }, 502, origin, env);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("KeyCRM rejected order", response.status, result);
    const retryable = response.status === 429 || response.status >= 500;
    return json({ ok: false, message: retryable ? "KeyCRM тимчасово зайнята. Спробуйте ще раз за хвилину." : "Не вдалося створити замовлення. Перевірте дані або зверніться до магазину." }, 502, origin, env);
  }

  return json({ ok: true, orderId: result.id || result.data?.id || null }, 201, origin, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = allowedOrigins(env);

    if (request.method === "OPTIONS") {
      if (!allowed.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, configured: Boolean(env.KEYCRM_API_KEY && env.KEYCRM_SOURCE_ID) }, 200, origin, env);
    }

    if (url.pathname !== "/orders" || request.method !== "POST") return json({ ok: false, message: "Not found" }, 404, origin, env);
    if (!allowed.includes(origin)) return json({ ok: false, message: "Origin is not allowed" }, 403, origin, env);
    return handleOrder(request, env, origin);
  }
};
