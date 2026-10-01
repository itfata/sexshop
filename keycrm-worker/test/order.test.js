import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildKeycrmOrder } from "../src/index.js";

const validOrder = {
  firstName: "Катерина",
  lastName: "Руденко",
  phone: "097 123 45 67",
  email: "client@example.com",
  city: "Київ",
  branch: "Відділення №1",
  comment: "Зателефонуйте після 18:00",
  requestId: "web-order-test-1",
  website: "",
  marketing: { utm_source: "instagram" },
  items: [{ slug: "rose", name: "Змінена назва", price: 1, quantity: 2 }]
};

test("maps the storefront order to the current KeyCRM order schema", () => {
  const result = buildKeycrmOrder(validOrder, 7);
  assert.equal(result.source_id, 7);
  assert.equal(result.source_uuid, "web-order-test-1");
  assert.equal(result.buyer.full_name, "Катерина Руденко");
  assert.equal(result.buyer.phone, "+380971234567");
  assert.equal(result.buyer_comment, "Зателефонуйте після 18:00");
  assert.equal(result.shipping.shipping_service, "Нова Пошта");
  assert.equal(result.shipping.shipping_receive_point, "Відділення №1");
  assert.deepEqual(result.products, [{ name: "Вакуумний вібратор Rose", price: 799, quantity: 2 }]);
  assert.equal("sku" in result.products[0], false);
});

test("rejects the honeypot and malformed orders", () => {
  assert.throws(() => buildKeycrmOrder({ ...validOrder, website: "spam.example" }, 7), /відхилено/i);
  assert.throws(() => buildKeycrmOrder({ ...validOrder, items: [] }, 7), /Кошик/i);
});

test("sends a valid order to KeyCRM without exposing the API token", async () => {
  const originalFetch = globalThis.fetch;
  let keycrmRequest;
  globalThis.fetch = async (url, options) => {
    keycrmRequest = { url, options };
    return Response.json({ id: 321 }, { status: 201 });
  };
  try {
    const request = new Request("https://worker.example/orders", {
      method: "POST",
      headers: { Origin: "https://itfata.github.io", "Content-Type": "application/json" },
      body: JSON.stringify(validOrder)
    });
    const response = await worker.fetch(request, {
      KEYCRM_API_KEY: "secret-token",
      KEYCRM_SOURCE_ID: "7",
      ALLOWED_ORIGINS: "https://itfata.github.io"
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.deepEqual(result, { ok: true, orderId: 321 });
    assert.equal(keycrmRequest.url, "https://openapi.keycrm.app/v1/order");
    assert.equal(keycrmRequest.options.headers.Authorization, "Bearer secret-token");
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
