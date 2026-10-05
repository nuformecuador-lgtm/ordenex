import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { handlePost } from "@/app/api/webhooks/whatsapp/route";
import type { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";

// Ficha 474 (T8.3, R38) — el webhook aplica los estados a las ENTREGAS de los envios DESPUES de la
// ingesta del chat; un fallo suyo NO cambia el 200 ni la ingesta.

const CONFIG = { verifyToken: "v", appSecret: "secreto" };

function firmar(raw: string): string {
  return "sha256=" + createHmac("sha256", CONFIG.appSecret).update(raw, "utf8").digest("hex");
}

const CUERPO = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "2" },
            statuses: [{ id: "wamid.474", status: "delivered", timestamp: "1759662000", recipient_id: "50688887777" }],
          },
        },
      ],
    },
  ],
});

function req(): Request {
  return new Request("https://x/api/webhooks/whatsapp", {
    method: "POST",
    body: CUERPO,
    headers: { "x-hub-signature-256": firmar(CUERPO) },
  });
}

function servicio() {
  const ingerirEventos = vi.fn(async () => ({ mensajes: 0, statuses: 1 }));
  return { ingerirEventos, service: { ingerirEventos } as unknown as ChatWhatsappService };
}

describe("474/R38 — webhook -> entregas", () => {
  it("aplica los statuses a las entregas DESPUES de la ingesta del chat", async () => {
    const { service, ingerirEventos } = servicio();
    const aplicar = vi.fn(async () => 1);
    const res = await handlePost(req(), {
      getConfig: () => CONFIG,
      buildService: () => service,
      logger: { warn: () => {} },
      buildEntregaEstado: () => ({ aplicar }),
    });
    expect(res.status).toBe(200);
    expect(aplicar).toHaveBeenCalledTimes(1);
    const statuses = (aplicar.mock.calls[0] as unknown as [{ waMessageId: string; estado: string }[]])[0];
    expect(statuses.map((s) => [s.waMessageId, s.estado])).toEqual([["wamid.474", "delivered"]]);
    expect(ingerirEventos.mock.invocationCallOrder[0]).toBeLessThan(aplicar.mock.invocationCallOrder[0]);
  });

  it("⭑ un fallo al construir o aplicar NO cambia el 200 ni la ingesta", async () => {
    const { service, ingerirEventos } = servicio();
    const res = await handlePost(req(), {
      getConfig: () => CONFIG,
      buildService: () => service,
      logger: { warn: () => {} },
      buildEntregaEstado: () => {
        throw new Error("sin base");
      },
    });
    expect(res.status).toBe(200);
    expect(ingerirEventos).toHaveBeenCalledTimes(1);
  });
});
