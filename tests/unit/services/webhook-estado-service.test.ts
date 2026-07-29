import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { WebhookEstadoService, WebhookEntregaFallidaError } from "@/lib/services/WebhookEstadoService";
import { WebhookSecretKeyError, cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { firmarWebhook } from "@/lib/crypto/webhook-firma";
import type { WebhookConfig } from "@/lib/config/webhook";
import type { IWebhookOrdenReader, DatosEntregaOrden } from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSuscripcionRepository, WebhookSuscripcionActiva } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

// Feature 99 (R17/R19-R24/R29/R30/R31/R32) — handler de entrega. DI por interfaces; sin red
// ni DB. El secreto se cifra con una clave de prueba real para ejercitar el descifrado.

const CLAVE = randomBytes(32).toString("base64");
const SECRETO = "ordx_whsec_secreto-de-firma-de-prueba";
const SECRET_ENC = cifrarSecreto(CLAVE, SECRETO);
const NUM_REMISION = "REM-DEL-OWNER-A";
const DESTINATARIO = "Juan Perez"; // PII que NUNCA debe ir al payload/log

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
};

const DATOS_BASE: DatosEntregaOrden = {
  tiendaId: "owner-A",
  numGuia: 12345,
  numRemision: NUM_REMISION,
  deletedAt: null,
  estado: "en_reparto",
};

function job(payload: Record<string, unknown> = {
  ordenId: "orden-1",
  estatusDestinoId: "s-en-reparto",
  ocurridoAt: "2026-07-21T10:00:00.000Z",
}): JobDTO {
  return {
    id: "job-1",
    tipo: "webhook_estado",
    payload,
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: new Date(),
    lockedAt: new Date(),
    lastError: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Fakes {
  datos: DatosEntregaOrden | null;
  subPorOwner: Record<string, WebhookSuscripcionActiva | null>;
  outcome: WebhookOutcome;
}

function buildService(f: Partial<Fakes> = {}) {
  const datos = f.datos === undefined ? DATOS_BASE : f.datos;
  const subPorOwner = f.subPorOwner ?? { "owner-A": { url: "https://a.example.com/hook", secret: SECRET_ENC } };
  const outcome = f.outcome ?? { status: "ok" };

  const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => datos) };
  const suscripciones = {
    findActivaByOwner: vi.fn(async (owner: string) => subPorOwner[owner] ?? null),
  } as unknown as IWebhookSuscripcionRepository;
  const entregar = vi.fn(async () => outcome);
  const sender: IWebhookSender = { entregar };
  const logs: string[] = [];
  const logger = { warn: (m: string) => logs.push(m) };
  const now = () => new Date("2026-07-21T10:00:05.000Z");

  const service = new WebhookEstadoService(ordenes, suscripciones, sender, config, now, logger);
  return { service, entregar, logs, ordenes, suscripciones };
}

describe("R17/R19 — entrega y complete", () => {
  it("con suscripcion activa hace POST a la URL del owner con el cuerpo del evento", async () => {
    const { service, entregar } = buildService();
    await service.ejecutar(job());

    expect(entregar).toHaveBeenCalledTimes(1);
    const [url, cuerpo, headers] = entregar.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, string>,
    ];
    expect(url).toBe("https://a.example.com/hook");
    const body = JSON.parse(cuerpo);
    expect(body.data).toEqual({ numGuia: 12345, numRemision: NUM_REMISION, estado: "en_reparto" });
    // R2: blindaje del breaking change — la clave vieja `orden` ya no existe en el cuerpo.
    expect(body.orden).toBeUndefined();
    expect(body.evento).toBe("orden.estado_actualizado");
    expect(body.eventoId).toContain("webhook_estado:orden-1:s-en-reparto:");
    // R18: firma valida sobre `${ts}.${cuerpo}` con el secreto descifrado.
    const ts = Number(headers["X-Ordenex-Timestamp"]);
    expect(headers["X-Ordenex-Signature"]).toBe(`sha256=${firmarWebhook(SECRETO, ts, cuerpo)}`);
  });

  it("una respuesta 2xx completa el job (no lanza)", async () => {
    const { service } = buildService({ outcome: { status: "ok" } });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
  });
});

describe("R20/R31 — transitorio -> lanza con el detalle para last_error", () => {
  it("un 5xx, un timeout y un fallo de red lanzan para reintento con el detalle en el mensaje", async () => {
    for (const detalle of ["entregar webhook: HTTP 500", "entregar webhook: fallo de red o timeout"]) {
      const { service } = buildService({ outcome: { status: "transitorio", detalle } });
      const err = await service.ejecutar(job()).catch((e) => e);
      expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
      // R31: el detalle viaja en el mensaje (aterriza en jobs.last_error) sin secreto.
      expect((err as Error).message).toBe(detalle);
      expect((err as Error).message).not.toContain(SECRETO);
    }
  });
});

describe("R21 — sin suscripcion activa", () => {
  it("sin suscripcion activa el job se completa sin hacer POST", async () => {
    const { service, entregar } = buildService({ subPorOwner: { "owner-A": null } });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(entregar).not.toHaveBeenCalled();
  });
});

describe("R22 — orden inexistente o borrada", () => {
  it("un job de una orden inexistente se completa sin error ni POST", async () => {
    const { service, entregar } = buildService({ datos: null });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(entregar).not.toHaveBeenCalled();
  });

  it("un job de una orden borrada (deletedAt) se completa sin error ni POST", async () => {
    const { service, entregar } = buildService({ datos: { ...DATOS_BASE, deletedAt: new Date() } });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(entregar).not.toHaveBeenCalled();
  });
});

describe("R23 — idempotencia", () => {
  it("reejecutar el job produce el mismo eventoId y el mismo cuerpo", async () => {
    const { service, entregar } = buildService();
    await service.ejecutar(job());
    await service.ejecutar(job());
    const cuerpo1 = (entregar.mock.calls[0] as unknown as [string, string])[1];
    const cuerpo2 = (entregar.mock.calls[1] as unknown as [string, string])[1];
    expect(cuerpo1).toBe(cuerpo2);
    expect(JSON.parse(cuerpo1).eventoId).toBe(JSON.parse(cuerpo2).eventoId);
  });
});

describe("R24 — aislamiento por owner", () => {
  it("el evento de la orden de un owner nunca se envia al callback de otro owner", async () => {
    // La orden pertenece a owner-A; existe tambien owner-B con OTRA url. El destino se deriva
    // SIEMPRE de orden.tiendaId, nunca del payload.
    const { service, entregar, suscripciones } = buildService({
      subPorOwner: {
        "owner-A": { url: "https://a.example.com/hook", secret: SECRET_ENC },
        "owner-B": { url: "https://b.example.com/hook", secret: SECRET_ENC },
      },
    });
    await service.ejecutar(job());
    expect(suscripciones.findActivaByOwner).toHaveBeenCalledWith("owner-A");
    expect((entregar.mock.calls[0] as unknown as [string])[0]).toBe("https://a.example.com/hook");
    expect((entregar.mock.calls[0] as unknown as [string])[0]).not.toContain("b.example.com");
  });
});

describe("R29 — logs sin secreto/URL/PII", () => {
  it("ningun log emitido contiene secreto, URL ni datos del destinatario", async () => {
    const { service, logs } = buildService({
      datos: { ...DATOS_BASE, numRemision: NUM_REMISION },
      subPorOwner: { "owner-A": { url: "https://secreta.example.com/hook", secret: SECRET_ENC } },
      outcome: { status: "transitorio", detalle: "entregar webhook: HTTP 503" },
    });
    await service.ejecutar(job()).catch(() => {});
    const todo = logs.join("\n");
    expect(todo).not.toContain(SECRETO);
    expect(todo).not.toContain("secreta.example.com");
    expect(todo).not.toContain(NUM_REMISION);
    expect(todo).not.toContain(DESTINATARIO);
  });
});

describe("R30 — payload invalido", () => {
  it("un payload con forma inesperada produce error de integracion sin secreto", async () => {
    const { service, ordenes } = buildService();
    const err = await service.ejecutar(job({ foo: "bar" })).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/payload invalido/i);
    expect((err as Error).message).not.toContain(SECRETO);
    // No llego a leer la orden.
    expect(ordenes.findDatosEntrega).not.toHaveBeenCalled();
  });
});

describe("R32 — clave de cifrado ausente", () => {
  it("sin clave configurada el descifrado lanza error recuperable sin filtrar el secreto", async () => {
    const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => DATOS_BASE) };
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
    } as unknown as IWebhookSuscripcionRepository;
    const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
    const service = new WebhookEstadoService(
      ordenes,
      suscripciones,
      { entregar },
      { ...config, WEBHOOK_SECRET_ENC_KEY: null }, // clave ausente
      () => new Date(),
    );
    const err = await service.ejecutar(job()).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookSecretKeyError);
    expect((err as Error).message).not.toContain(SECRETO);
    expect(entregar).not.toHaveBeenCalled(); // no se entrega sin poder firmar
  });
});
