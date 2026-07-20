import { describe, it, expect, vi } from "vitest";
import {
  DEDUPE_PREFIX,
  OPTIMIZACION_MAX_INTENTOS,
  dedupeKeyDebounce,
  dedupeKeyInmediato,
  encolarOptimizacionDebounce,
  encolarOptimizacionInmediata,
} from "@/lib/services/jobs/optimizacion-ruta-encolado";
import type { EnqueueOpts, IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";

// Feature 92 (R17/R18/R19) — las claves de idempotencia del job de optimizacion.
//
// Este archivo protege las DOS trampas que el design §4 documenta como normativas:
//  A. el namespace del disparo INMEDIATO es DISJUNTO del de DEBOUNCE. Si se unificaran, el
//     `ON CONFLICT ("dedupe_key") DO NOTHING` haria que un debounce en vuelo TRAGARA la
//     reoptimizacion de la gestion EN SILENCIO: sin error, sin log, sin job.
//  B. la clave del debounce lleva una VENTANA TEMPORAL. Sin ella quedaria ocupada PARA
//     SIEMPRE por la primera fila `done` (el indice unico de `dedupe_key` no esta acotado
//     por estado y las filas completadas no se purgan). Es la trampa exacta de F1.4-Q4/91.

const MENSAJERO = "m-1";
const T0 = new Date("2026-07-20T10:00:00.000Z");

/** Cola en memoria con la MISMA regla de unicidad que el indice de `jobs`. */
function colaEnMemoria() {
  const filas: { tipo: JobTipo; payload: Record<string, unknown>; opts: EnqueueOpts }[] = [];
  const repo = {
    enqueue: vi.fn(async (tipo: JobTipo, payload: Record<string, unknown>, opts: EnqueueOpts = {}) => {
      const key = opts.dedupeKey ?? null;
      // ON CONFLICT ("dedupe_key") WHERE dedupe_key IS NOT NULL DO NOTHING.
      if (key !== null && filas.some((f) => f.opts.dedupeKey === key)) return null;
      filas.push({ tipo, payload, opts });
      return null;
    }),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  } as unknown as IJobRepository;
  return { repo, filas };
}

describe("R18 — la clave del debounce lleva ventana temporal", () => {
  it("dos runAfter del MISMO minuto producen la MISMA clave", () => {
    const a = new Date("2026-07-20T10:05:00.000Z");
    const b = new Date("2026-07-20T10:05:59.999Z");
    expect(dedupeKeyDebounce(MENSAJERO, a)).toBe(dedupeKeyDebounce(MENSAJERO, b));
  });

  it("el minuto SIGUIENTE produce una clave DISTINTA (la clave nunca queda ocupada para siempre)", () => {
    const a = new Date("2026-07-20T10:05:59.999Z");
    const b = new Date("2026-07-20T10:06:00.000Z");
    expect(dedupeKeyDebounce(MENSAJERO, a)).not.toBe(dedupeKeyDebounce(MENSAJERO, b));
  });

  it("la clave CONTIENE un componente que avanza con el reloj", () => {
    const clave = dedupeKeyDebounce(MENSAJERO, T0);
    const ventana = Math.floor(T0.getTime() / 60_000);
    expect(clave).toBe(`${DEDUPE_PREFIX}:${MENSAJERO}:debounce:${ventana}`);
    // Y una hora despues el sufijo ES otro numero: no es una constante disfrazada.
    const despues = dedupeKeyDebounce(MENSAJERO, new Date(T0.getTime() + 3_600_000));
    expect(despues).not.toBe(clave);
  });

  it("mensajeros distintos nunca comparten clave en la misma ventana", () => {
    expect(dedupeKeyDebounce("m-1", T0)).not.toBe(dedupeKeyDebounce("m-2", T0));
  });
});

describe("R17 — el debounce colapsa eventos de la misma ventana", () => {
  it("dos recogidas en el mismo instante -> UNA sola fila de job", async () => {
    const { repo, filas } = colaEnMemoria();
    const opts = { ahora: T0, debounceS: 60 };

    await encolarOptimizacionDebounce(repo, undefined, MENSAJERO, opts);
    await encolarOptimizacionDebounce(repo, undefined, MENSAJERO, opts);

    expect(filas).toHaveLength(1);
  });

  it("la segunda recogida NO adelanta el runAfter de la primera", async () => {
    const { repo, filas } = colaEnMemoria();

    await encolarOptimizacionDebounce(repo, undefined, MENSAJERO, { ahora: T0, debounceS: 60 });
    const runAfterPrimero = filas[0].opts.runAfter;
    // 20 s despues, dentro de la misma ventana de destino.
    await encolarOptimizacionDebounce(repo, undefined, MENSAJERO, {
      ahora: new Date(T0.getTime() + 20_000),
      debounceS: 60,
    });

    expect(filas).toHaveLength(1);
    expect(filas[0].opts.runAfter).toBe(runAfterPrimero);
  });

  it("el runAfter es ahora + debounceS y el payload lleva SOLO el mensajeroId (PII)", async () => {
    const { repo, filas } = colaEnMemoria();
    await encolarOptimizacionDebounce(repo, undefined, MENSAJERO, { ahora: T0, debounceS: 60 });

    expect(filas[0].tipo).toBe("optimizacion_ruta");
    expect(filas[0].payload).toEqual({ mensajeroId: MENSAJERO });
    expect(filas[0].opts.runAfter?.getTime()).toBe(T0.getTime() + 60_000);
    expect(filas[0].opts.maxIntentos).toBe(OPTIMIZACION_MAX_INTENTOS);
  });
});

describe("R19 — el disparo INMEDIATO nunca lo traga el debounce", () => {
  it("los dos espacios de claves son DISJUNTOS", () => {
    const debounce = dedupeKeyDebounce(MENSAJERO, T0);
    const inmediato = dedupeKeyInmediato(MENSAJERO, "g-1");
    expect(debounce).not.toBe(inmediato);
    expect(debounce).toContain(":debounce:");
    expect(inmediato).toContain(":inmediato:");
  });

  it("con un debounce EN VUELO, la gestion inserta su fila igual", async () => {
    const { repo, filas } = colaEnMemoria();

    await encolarOptimizacionDebounce(repo, undefined, MENSAJERO, { ahora: T0, debounceS: 60 });
    await encolarOptimizacionInmediata(repo, undefined, MENSAJERO, "gestion-1");

    expect(filas).toHaveLength(2);
    // Y el inmediato NO lleva runAfter: corre en cuanto el cron lo reclame.
    expect(filas[1].opts.runAfter).toBeUndefined();
    expect(filas[1].opts.dedupeKey).toBe(dedupeKeyInmediato(MENSAJERO, "gestion-1"));
  });

  it("dos gestiones distintas -> dos filas (el eventoId las distingue)", async () => {
    const { repo, filas } = colaEnMemoria();

    await encolarOptimizacionInmediata(repo, undefined, MENSAJERO, "gestion-1");
    await encolarOptimizacionInmediata(repo, undefined, MENSAJERO, "gestion-2");

    expect(filas).toHaveLength(2);
  });

  it("re-encolar la MISMA gestion es idempotente (una sola fila)", async () => {
    const { repo, filas } = colaEnMemoria();
    await encolarOptimizacionInmediata(repo, undefined, MENSAJERO, "gestion-1");
    await encolarOptimizacionInmediata(repo, undefined, MENSAJERO, "gestion-1");
    expect(filas).toHaveLength(1);
  });
});
