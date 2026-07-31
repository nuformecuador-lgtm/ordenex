import { describe, it, expect, vi } from "vitest";
import { ForbiddenError } from "@/lib/errors/app-error";
import { normalizeError } from "@/lib/errors/normalize";
import type { ErrorLogger } from "@/lib/errors/logger";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import { describirDenegado } from "@/lib/analytics/auditoria";
import type { ActorAnalitica } from "@/lib/analytics/alcance";

// Feature 122 / T4.5 + T4.6(c) — GUARDIA DE BORDES (R41 y la parte de borde de R40).
//
// La 122 no expone ruta: es contrato. Quien lo consume son los bordes de 126, 127 y 134, y
// la puerta F1.4 les impone TRES pasos en este orden ante un `forbidden`:
//   1. auditar con una llamada EXPLICITA al `ErrorLogger` (R40);
//   2. responder 403 — nunca 200 con lista vacia (R41, D7);
//   3. (si la politica es seudonima) seudonimizar antes de serializar (R38/R39).
//
// ⚠ Esos bordes AUN NO EXISTEN. Un guardia que solo censara el repo estaria verde por vacio
// y no probaria nada. Por eso el criterio se aplica a bordes SINTETICOS: uno correcto (debe
// pasar) y tres infractores, cada uno con una forma distinta de romperlo — el que devuelve
// `{data: []}`, el que devuelve 200 con ceros y el que confia en `withErrorHandler`.
//
// Si esto se pone rojo cuando la 126 aterrice, el guardia esta haciendo su trabajo.

type Respuesta = { status: number; body?: unknown };
type Borde = (
  raw: unknown,
  actor: ActorAnalitica | null,
  metricaId: string,
  logger: ErrorLogger,
) => Respuesta | Promise<Respuesta>;

const AHORA = new Date("2026-07-31T15:00:00.000Z");
const TIENDA: ActorAnalitica = { usuarioId: "tienda-propia", rol: "adminTienda" };

/** Entrada que SIEMPRE produce `forbidden`: un adminTienda pidiendo una metrica del dinero. */
const ENTRADA_DENEGADA = { raw: { rango: "dia" as const }, actor: TIENDA, metricaId: "egresos" };

/* --------------------------- bordes sinteticos ---------------------------- */

const bordeCorrecto: Borde = (raw, actor, metricaId, logger) => {
  const r = prepararConsultaAnalitica(raw, actor, metricaId, AHORA);
  if (r.status === "forbidden") {
    logger.logError(describirDenegado({ motivo: r.motivo, actor, metricaId, filtro: raw }));
    return { status: 403, body: { code: "FORBIDDEN" } };
  }
  if (r.status === "validation_error") return { status: 400, body: r.fieldErrors };
  return { status: 200, body: { metrica: r.consulta.metrica.id } };
};

const bordeQueDevuelveListaVacia: Borde = (raw, actor, metricaId) => {
  const r = prepararConsultaAnalitica(raw, actor, metricaId, AHORA);
  if (r.status !== "ok") return { status: 200, body: { data: [] } };
  return { status: 200, body: { data: [1] } };
};

const bordeQueDevuelveCeros: Borde = (raw, actor, metricaId, logger) => {
  const r = prepararConsultaAnalitica(raw, actor, metricaId, AHORA);
  if (r.status === "forbidden") {
    logger.logError(describirDenegado({ motivo: r.motivo, actor, metricaId, filtro: raw }));
    return { status: 200, body: { total: 0 } };
  }
  return { status: 200, body: { total: 1 } };
};

const bordeQueDelegaEnElWrapper: Borde = (raw, actor, metricaId, logger) => {
  const r = prepararConsultaAnalitica(raw, actor, metricaId, AHORA);
  if (r.status === "forbidden") {
    // La trampa: `normalizeError` devuelve la shape del AppError en su primera linea y NO
    // registra. El status sale bien; la auditoria no ocurre.
    const shape = normalizeError(new ForbiddenError(), logger);
    return { status: 403, body: shape };
  }
  return { status: 200 };
};

/* ------------------------------ el criterio ------------------------------- */

interface Veredicto {
  readonly audita: boolean;
  readonly responde403: boolean;
  readonly fallos: readonly string[];
}

async function evaluarBorde(borde: Borde): Promise<Veredicto> {
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  const respuesta = await borde(
    ENTRADA_DENEGADA.raw,
    ENTRADA_DENEGADA.actor,
    ENTRADA_DENEGADA.metricaId,
    logger,
  );

  const audita = logError.mock.calls.length === 1;
  const responde403 = respuesta.status === 403;
  const fallos: string[] = [];
  if (!audita) fallos.push("no audita el denegado por el ErrorLogger (R40)");
  if (!responde403) fallos.push(`traduce forbidden a ${respuesta.status} (R41)`);
  if (respuesta.status === 200) fallos.push("devuelve 200 ante un forbidden");

  return { audita, responde403, fallos };
}

describe("R41 · el borde traduce forbidden a 403 y lo audita", () => {
  it("el borde correcto audita una vez y responde 403", async () => {
    const v = await evaluarBorde(bordeCorrecto);
    expect(v.fallos).toEqual([]);
    expect(v.audita).toBe(true);
    expect(v.responde403).toBe(true);
  });

  it("autocomprobacion: el borde que devuelve {data: []} sale ROJO", async () => {
    const v = await evaluarBorde(bordeQueDevuelveListaVacia);
    expect(v.fallos).not.toEqual([]);
    expect(v.responde403).toBe(false);
    expect(v.audita).toBe(false);
  });

  it("autocomprobacion: el borde que devuelve 200 con ceros sale ROJO aunque audite", async () => {
    const v = await evaluarBorde(bordeQueDevuelveCeros);
    expect(v.audita).toBe(true);
    expect(v.responde403).toBe(false);
    expect(v.fallos).toContain("devuelve 200 ante un forbidden");
  });

  it("el borde correcto sigue distinguiendo 400 (entrada mala) de 403 (prohibido)", async () => {
    const logError = vi.fn();
    const malFormada = await bordeCorrecto({ rango: "no_valido" }, TIENDA, "entregas", {
      logError,
    });
    expect(malFormada.status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });

  it("y devuelve 200 solo cuando la consulta se concede de verdad", async () => {
    const logError = vi.fn();
    const ok = await bordeCorrecto({ rango: "dia" }, TIENDA, "entregas", { logError });
    expect(ok.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe("R40 · autocomprobacion: delegar en withErrorHandler deja el 403 MUDO", () => {
  it("el borde que lanza ForbiddenError responde 403 pero NO audita: sale rojo", async () => {
    const v = await evaluarBorde(bordeQueDelegaEnElWrapper);
    expect(v.responde403).toBe(true);
    expect(v.audita).toBe(false);
    expect(v.fallos).toContain("no audita el denegado por el ErrorLogger (R40)");
  });

  it("es exactamente por lo que R40 espia el logger y no el status", async () => {
    const correcto = await evaluarBorde(bordeCorrecto);
    const mudo = await evaluarBorde(bordeQueDelegaEnElWrapper);
    // Los dos responden 403; solo uno deja rastro. Un test que mirase el status los
    // aprobaria a ambos.
    expect(correcto.responde403).toBe(mudo.responde403);
    expect(correcto.audita).not.toBe(mudo.audita);
  });
});
