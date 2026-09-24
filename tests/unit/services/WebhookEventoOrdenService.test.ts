import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { firmarWebhook } from "@/lib/crypto/webhook-firma";
import type { WebhookConfig } from "@/lib/config/webhook";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { DatosEntregaEvento } from "@/lib/interfaces/repositories/IWebhookEventoReader";
import type { WebhookSuscripcionPausadaContexto } from "@/lib/notificaciones/emitir";
import { WebhookEntregaFallidaError } from "@/lib/services/WebhookEstadoService";
import { EVENTO_PUBLICO_POR_TIPO, WebhookEventoOrdenService } from "@/lib/services/WebhookEventoOrdenService";
import { ORDEN_EVENTO_TIPO_SEED } from "@/lib/types/orden-evento";

// FICHA 454 (T1.5, design §12.1; R33) — el servicio de entrega de `webhook_evento`, con dobles.
// Cuerpo por tipo, firma, idempotencia, reintento y pausa (403). Sin red ni base.

const CLAVE = randomBytes(32).toString("base64");
const SECRETO = "ordx_whsec_secreto-454";
const SECRET_ENC = cifrarSecreto(CLAVE, SECRETO);
const AHORA = new Date("2026-09-23T18:00:05.000Z");
const OCURRIDO = new Date("2026-09-23T18:00:00.000Z");

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: "https://app.ordenex.co",
  WEBHOOK_PAUSA_FALLOS_MINIMOS: 3,
  WEBHOOK_PAUSA_VENTANA_MS: 30 * 60_000,
  WEBHOOK_PAUSA_INTERVALO_MS: 3_600_000,
};

const MENSAJERO = { id: "u-mensajero", nombre: "Carlos Jimenez Mora" };

function datos(p: Partial<DatosEntregaEvento> = {}): DatosEntregaEvento {
  return {
    ordenEventoId: "ev-1",
    tipo: "gestion_registrada",
    createdAt: OCURRIDO,
    actorRol: "mensajero",
    resultado: "novedad",
    resultadoAnterior: null,
    gestionId: "g-1",
    causa: "wrong_address",
    mensajero: MENSAJERO,
    orden: { tiendaId: "owner-A", numGuia: 12345, numRemision: "REM-1", deletedAt: null },
    ...p,
  };
}

function job(payload: Record<string, unknown> = { ordenEventoId: "ev-1" }): JobDTO {
  return {
    id: "job-1",
    tipo: "webhook_evento",
    payload,
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: "webhook_evento:ev-1",
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

function montar(o: {
  d?: DatosEntregaEvento | null;
  activa?: boolean;
  outcome?: WebhookOutcome;
  estadoTrasFallo?: { fallosConsecutivos: number; sinExitoDesde: Date } | null;
} = {}) {
  const d = o.d === undefined ? datos() : o.d;
  const entregar = vi.fn(async (_u: string, _c: string, _h: Record<string, string>) => o.outcome ?? ({ status: "ok" } as WebhookOutcome));
  const registrarEntregaOk = vi.fn(async (_o: string, _a: Date) => {});
  const incrementarFalloYLeer = vi.fn(async (_o: string, _a: Date) =>
    o.estadoTrasFallo === undefined ? { fallosConsecutivos: 1, sinExitoDesde: AHORA } : o.estadoTrasFallo,
  );
  const findActivaByOwner = vi.fn(async (_o: string) =>
    o.activa === false ? null : { url: "https://a.example.com/hook", secret: SECRET_ENC },
  );
  const notificarPausa = vi.fn(async (_c: WebhookSuscripcionPausadaContexto) => {});
  const service = new WebhookEventoOrdenService(
    { findDatosEntrega: vi.fn(async () => d) },
    { findActivaByOwner, registrarEntregaOk, incrementarFalloYLeer } as unknown as IWebhookSuscripcionRepository,
    { entregar } as IWebhookSender,
    config,
    () => AHORA,
    undefined,
    notificarPausa,
  );
  return { service, entregar, registrarEntregaOk, incrementarFalloYLeer, findActivaByOwner, notificarPausa };
}

const cuerpoDe = (entregar: { mock: { calls: unknown[][] } }) =>
  JSON.parse((entregar.mock.calls[0] as [string, string])[1]) as Record<string, unknown>;

describe("454/T1.5 — WebhookEventoOrdenService", () => {
  it("cada tipo del SEED tiene nombre publico; las dos vueltas de la ayuda comparten `orden.ayuda_resuelta`", () => {
    for (const t of ORDEN_EVENTO_TIPO_SEED) expect(EVENTO_PUBLICO_POR_TIPO[t], t).toMatch(/^orden\./);
    expect(EVENTO_PUBLICO_POR_TIPO.ayuda_rescatada).toBe("orden.ayuda_resuelta");
    expect(EVENTO_PUBLICO_POR_TIPO.ayuda_habilitada_api).toBe("orden.ayuda_resuelta");
  });

  it("gestion registrada: cuerpo con evento, eventoId estable, ocurridoAt del hecho y data en orden fijo", async () => {
    const m = montar();
    await m.service.ejecutar(job());
    const c = cuerpoDe(m.entregar);
    expect(c).toEqual({
      evento: "orden.gestion_registrada",
      eventoId: "webhook_evento:ev-1",
      ocurridoAt: OCURRIDO.toISOString(),
      data: {
        numGuia: 12345,
        numRemision: "REM-1",
        gestionId: "g-1",
        resultado: "novedad",
        resultadoNombre: "Novedad", // 455 (R25)
        motivo: "wrong_address",
        mensajero: MENSAJERO,
        pendienteConfirmacion: true,
      },
    });
    // Orden de claves: es el que se firma.
    expect(Object.keys(c.data as object)).toEqual([
      "numGuia",
      "numRemision",
      "gestionId",
      "resultado",
      "resultadoNombre",
      "motivo",
      "mensajero",
      "pendienteConfirmacion",
    ]);
    expect(m.registrarEntregaOk).toHaveBeenCalledWith("owner-A", AHORA);
  });

  it("firma sobre `${timestamp}.${cuerpo}` con el secreto descifrado", async () => {
    const m = montar();
    await m.service.ejecutar(job());
    const [, cuerpo, headers] = m.entregar.mock.calls[0];
    const ts = Math.floor(AHORA.getTime() / 1000);
    expect(headers["X-Ordenex-Timestamp"]).toBe(String(ts));
    expect(headers["X-Ordenex-Signature"]).toContain(firmarWebhook(SECRETO, ts, cuerpo));
  });

  it("idempotente: reejecutar el mismo job produce el MISMO cuerpo", async () => {
    const a = montar();
    await a.service.ejecutar(job());
    const b = montar();
    await b.service.ejecutar(job());
    expect(a.entregar.mock.calls[0][1]).toBe(b.entregar.mock.calls[0][1]);
  });

  it("gestion corregida: resultado nuevo y anterior, pendiente de confirmacion", async () => {
    const m = montar({ d: datos({ tipo: "gestion_corregida", resultado: "devolucion_a_origen_por_rechazo", resultadoAnterior: "entregado", causa: null }) });
    await m.service.ejecutar(job());
    const c = cuerpoDe(m.entregar);
    expect(c.evento).toBe("orden.gestion_corregida");
    expect(c.data).toMatchObject({ resultado: "devolucion_a_origen_por_rechazo", resultadoNombre: "Devolución a origen por rechazo", resultadoAnterior: "entregado", resultadoAnteriorNombre: "Entregado", pendienteConfirmacion: true });
  });

  it("gestion anulada: sin `pendienteConfirmacion` ni `resultadoAnterior`", async () => {
    const m = montar({ d: datos({ tipo: "gestion_anulada", resultado: null, causa: null }) });
    await m.service.ejecutar(job());
    const data = cuerpoDe(m.entregar).data as Record<string, unknown>;
    expect(cuerpoDe(m.entregar).evento).toBe("orden.gestion_anulada");
    expect(data).not.toHaveProperty("pendienteConfirmacion");
    expect(data).not.toHaveProperty("resultadoAnterior");
    expect(data.gestionId).toBe("g-1");
  });

  it("ayuda: solicitada sin gestion ni motivo; resuelta con `via` segun quien y por donde", async () => {
    const sol = montar({ d: datos({ tipo: "ayuda_solicitada", gestionId: null, resultado: null, causa: null }) });
    await sol.service.ejecutar(job());
    expect(cuerpoDe(sol.entregar)).toMatchObject({
      evento: "orden.ayuda_solicitada",
      data: { numGuia: 12345, numRemision: "REM-1", motivo: null, mensajero: MENSAJERO },
    });
    expect(cuerpoDe(sol.entregar).data).not.toHaveProperty("gestionId");

    const via = async (tipo: DatosEntregaEvento["tipo"], actorRol: DatosEntregaEvento["actorRol"]) => {
      const m = montar({ d: datos({ tipo, actorRol, gestionId: null, resultado: null, causa: null }) });
      await m.service.ejecutar(job());
      const c = cuerpoDe(m.entregar);
      return `${c.evento}:${(c.data as { via?: string }).via}`;
    };
    expect(await via("ayuda_rescatada", "mensajero")).toBe("orden.ayuda_resuelta:mensajero");
    expect(await via("ayuda_rescatada", "adminTienda")).toBe("orden.ayuda_resuelta:tienda");
    expect(await via("ayuda_habilitada_api", "adminTienda")).toBe("orden.ayuda_resuelta:api");
  });

  it("sin suscripcion activa, evento inexistente u orden borrada: completa SIN entregar", async () => {
    for (const m of [
      montar({ activa: false }),
      montar({ d: null }),
      montar({ d: datos({ orden: { tiendaId: "owner-A", numGuia: 1, numRemision: "R", deletedAt: new Date() } }) }),
    ]) {
      await expect(m.service.ejecutar(job())).resolves.toBeUndefined();
      expect(m.entregar).not.toHaveBeenCalled();
    }
  });

  it("payload invalido: lanza (error de integracion)", async () => {
    await expect(montar().service.ejecutar(job({ otra: 1 }))).rejects.toThrow(/payload invalido/);
  });

  it("fallo transitorio: lanza `WebhookEntregaFallidaError` con el detalle y el Retry-After del 429", async () => {
    const m = montar({ outcome: { status: "transitorio", detalle: "HTTP 429", retryAfterMs: 5_000 } });
    const err = await m.service.ejecutar(job()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
    expect((err as WebhookEntregaFallidaError).message).toBe("HTTP 429");
    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBe(5_000);
    expect(m.incrementarFalloYLeer).toHaveBeenCalledWith("owner-A", AHORA);
    expect(m.notificarPausa).not.toHaveBeenCalled();
  });

  it("403: con la suscripcion en pausa, avisa y espacia al intervalo de pausa", async () => {
    const m = montar({
      outcome: { status: "transitorio", detalle: "HTTP 500" },
      estadoTrasFallo: { fallosConsecutivos: 5, sinExitoDesde: new Date(AHORA.getTime() - 60 * 60_000) },
    });
    const err = await m.service.ejecutar(job()).catch((e: unknown) => e);
    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBe(config.WEBHOOK_PAUSA_INTERVALO_MS);
    expect(m.notificarPausa).toHaveBeenCalledTimes(1);
  });
});
