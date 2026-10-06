import { describe, expect, it, vi } from "vitest";
import { EntregaEstadoService } from "@/lib/services/EntregaEstadoService";
import type { WebhookStatus } from "@/lib/types/whatsapp-webhook";

// Ficha 474 (T7.4, R38/R45) — traduccion de los estados de Meta y aislamiento de fallos. El «no
// retroceder» lo prueba la integracion contra Postgres.

function status(estado: WebhookStatus["estado"], codigo?: number): WebhookStatus {
  return {
    waMessageId: `wamid.${estado}`,
    estado,
    ocurridoAt: new Date(),
    error: codigo === undefined ? null : { codigo, titulo: "t", detalle: "detalle crudo con 50688887777" },
  };
}

describe("474/R38 — EntregaEstadoService", () => {
  it("sent/delivered/read/failed -> enviada/recibida/leida/fallida; failed con motivo FIJO", async () => {
    const aplicar = vi.fn(async () => 1);
    const s = new EntregaEstadoService({ aplicarEstadoWebhook: aplicar });
    const n = await s.aplicar([status("sent"), status("delivered"), status("read"), status("failed", 131026)]);
    expect(n).toBe(4);
    expect(aplicar.mock.calls).toEqual([
      ["wamid.sent", "enviada", null],
      ["wamid.delivered", "recibida", null],
      ["wamid.read", "leida", null],
      ["wamid.failed", "fallida", "El número no tiene WhatsApp o no puede recibir mensajes."],
    ]);
    expect(JSON.stringify(aplicar.mock.calls)).not.toContain("50688887777");
  });

  it("un fallo del repo no lanza y sigue con los demas", async () => {
    const aplicar = vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(1);
    const logs: string[] = [];
    const s = new EntregaEstadoService({ aplicarEstadoWebhook: aplicar }, { warn: (m) => logs.push(m) });
    expect(await s.aplicar([status("sent"), status("read")])).toBe(1);
    expect(logs).toHaveLength(1);
  });

  it("queued u otro estado sin traduccion se ignora", async () => {
    const aplicar = vi.fn(async () => 1);
    await new EntregaEstadoService({ aplicarEstadoWebhook: aplicar }).aplicar([status("queued")]);
    expect(aplicar).not.toHaveBeenCalled();
  });
});
