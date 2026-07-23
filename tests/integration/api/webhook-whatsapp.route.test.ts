import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { handleGet, handlePost } from "@/app/api/webhooks/whatsapp/route";
import type { WhatsappWebhookConfig } from "@/lib/config/whatsapp";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";

// Feature 109 — E1.T/E2.T (R1/R2/R3/R4/R9/R11). Controller del webhook: handshake GET,
// verificacion de firma HMAC sobre el cuerpo crudo ANTES de procesar, y respuesta 200 aunque
// un evento no mapee a hilo. Se inyecta config y service (sin DB ni red).

const CONFIG: WhatsappWebhookConfig = {
  verifyToken: "token-verificacion",
  appSecret: "app-secret-abc",
};
const NUMERO_CLIENTE = "573001112233";

function getConfig(): WhatsappWebhookConfig {
  return CONFIG;
}

function firmar(raw: string, secret = CONFIG.appSecret): string {
  return "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

function fakeService(ingerir = vi.fn(async () => ({ mensajesRegistrados: 1, statusesAplicados: 0, sinResolver: 0 }))) {
  return { service: { ingerirEventos: ingerir } as unknown as ChatWhatsappService, ingerir };
}

const bodyEntrante = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              { from: NUMERO_CLIENTE, id: "wamid.IN1", timestamp: "1700000000", type: "text", text: { body: "hola" } },
            ],
          },
        },
      ],
    },
  ],
});

describe("GET handshake (R1/R2)", () => {
  it("R1: responde 200 con el challenge en texto plano cuando mode=subscribe y token valido", async () => {
    const req = new Request(
      "https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-verificacion&hub.challenge=CHALLENGE123",
    );
    const res = await handleGet(req, { getConfig });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("CHALLENGE123");
  });

  it("R2: responde 403 y NO devuelve challenge cuando el token no coincide", async () => {
    const req = new Request(
      "https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=MALO&hub.challenge=CHALLENGE123",
    );
    const res = await handleGet(req, { getConfig });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("CHALLENGE123");
  });

  it("R2: responde 403 cuando falta hub.mode", async () => {
    const req = new Request(
      "https://x/api/webhooks/whatsapp?hub.verify_token=token-verificacion&hub.challenge=C",
    );
    const res = await handleGet(req, { getConfig });
    expect(res.status).toBe(403);
  });
});

describe("POST firma e ingesta (R3/R4/R9)", () => {
  it("R3: con firma valida delega en el service y responde 200", async () => {
    const { service, ingerir } = fakeService();
    const req = new Request("https://x/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": firmar(bodyEntrante) },
      body: bodyEntrante,
    });

    const res = await handlePost(req, { getConfig, buildService: () => service });

    expect(res.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
  });

  it("R4: firma invalida -> 401 y NO se procesa (service intacto)", async () => {
    const { service, ingerir } = fakeService();
    const req = new Request("https://x/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": firmar(bodyEntrante, "otro-secreto") },
      body: bodyEntrante,
    });

    const res = await handlePost(req, { getConfig, buildService: () => service });

    expect(res.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled(); // R4: sin efectos secundarios
  });

  it("R4: firma ausente -> 401 sin procesar", async () => {
    const { service, ingerir } = fakeService();
    const req = new Request("https://x/api/webhooks/whatsapp", {
      method: "POST",
      body: bodyEntrante,
    });

    const res = await handlePost(req, { getConfig, buildService: () => service });

    expect(res.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("R9: responde 200 aunque un evento no mapee a hilo (sinResolver)", async () => {
    const { service } = fakeService(
      vi.fn(async () => ({ mensajesRegistrados: 0, statusesAplicados: 0, sinResolver: 1 })),
    );
    const req = new Request("https://x/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": firmar(bodyEntrante) },
      body: bodyEntrante,
    });

    const res = await handlePost(req, { getConfig, buildService: () => service });
    expect(res.status).toBe(200);
  });

  it("R9: cuerpo con firma valida pero forma no-Meta -> 200 sin romper", async () => {
    const cuerpo = JSON.stringify({ foo: "bar" });
    const { service, ingerir } = fakeService();
    const req = new Request("https://x/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": firmar(cuerpo) },
      body: cuerpo,
    });

    const res = await handlePost(req, { getConfig, buildService: () => service });
    expect(res.status).toBe(200);
    expect(ingerir).not.toHaveBeenCalled(); // no accionable
  });
});

describe("R11 — no loguea secretos ni PII", () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    spies.push(vi.spyOn(console, "log").mockImplementation(() => {}));
    spies.push(vi.spyOn(console, "error").mockImplementation(() => {}));
    spies.push(vi.spyOn(console, "warn").mockImplementation(() => {}));
  });
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
  });

  it("ni en exito ni en fallo aparecen el secreto, el token ni el numero del cliente", async () => {
    const { service } = fakeService();
    // Exito
    await handlePost(
      new Request("https://x/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": firmar(bodyEntrante) },
        body: bodyEntrante,
      }),
      { getConfig, buildService: () => service },
    );
    // Fallo de firma
    await handlePost(
      new Request("https://x/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body: bodyEntrante,
      }),
      { getConfig, buildService: () => service },
    );

    const todo = spies
      .flatMap((s) => s.mock.calls)
      .flat()
      .map(String)
      .join(" | ");
    expect(todo).not.toContain(CONFIG.appSecret);
    expect(todo).not.toContain(CONFIG.verifyToken);
    expect(todo).not.toContain(NUMERO_CLIENTE);
  });
});
