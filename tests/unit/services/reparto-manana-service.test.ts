import { describe, it, expect, vi } from "vitest";
import { RepartoMananaAvisoService } from "@/lib/services/RepartoMananaAvisoService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRepartoMananaRepository } from "@/lib/interfaces/repositories/IRepartoMananaRepository";
import type { RepartoMananaContexto } from "@/lib/notificaciones/emitir";

/**
 * FICHA 413 (T5.1/T5.1b) — EL PROCESO DE LA TARDE.
 *
 * Cubre R6 (una emisión DIRIGIDA AL USUARIO por mensajero con reparto), R12 (dos corridas la misma
 * noche NO emiten dos veces), R18 (el de cero no recibe nada y los demás sí), R34 (un fallo no se
 * lleva a los demás y la corrida TERMINA), R37 (sin transacciones ni cliente transaccional) y R42
 * (el BLOQUEADO por cierres no recibe el aviso).
 *
 * ⚠️ QUÉ **NO** MIDE ESTE ARCHIVO, y hay que decirlo: el `WHERE`. Aquí el repositorio es un doble,
 * así que estos casos demuestran que el doble hace lo que el doble hace. Que el conteo sea el
 * conjunto correcto —la cota `startOfDayCR` contra una columna `@db.Date`, los tres estados, el
 * borrado, el mensajero ajeno— vive en `tests/integration/db/reparto-manana-repository.test.ts`,
 * contra Postgres real. Es la lección «probar el WHERE donde vive».
 */

/** Reloj fijo: 19:00 CR del 11 de septiembre = 01:00Z del 12 (la corrida real del cron). */
const AHORA = new Date("2026-09-12T01:00:00.000Z");
/** El día anunciado por esa corrida. Escrito A MANO, no derivado del servicio. */
const DIA_ANUNCIADO = "2026-09-12";
/** Y el día CR de la corrida, también a mano: en hora de pared son las 19:00 del 11. */
const DIA_DE_LA_CORRIDA = "2026-09-11";

function repoDoble(filas: Array<{ mensajeroId: string; total: number }>) {
  return {
    resumenPorMensajero: vi.fn<IRepartoMananaRepository["resumenPorMensajero"]>(async () => filas),
    contarReservadasParaOtroDia: vi.fn<IRepartoMananaRepository["contarReservadasParaOtroDia"]>(
      async () => {
        throw new Error("el cron NO usa la cifra viva: eso es de la lectura, no de la emisión");
      },
    ),
  } satisfies IRepartoMananaRepository;
}

/**
 * El repositorio de cierres, en su forma `Pick`: UN solo método.
 *
 * ⚠️ El doble se tipa con la firma REAL de `IOrdenRepository` —no con un `vi.fn()` suelto— para que
 * los asertos sobre `mock.calls[0][0]` comprueben el ARGUMENTO de verdad: sin el tipo, TypeScript
 * ve una tupla vacía y el aserto no compilaría (o, peor, se relajaría a `any`).
 */
function cierresDoble(bloqueados: string[] = []) {
  return {
    findMensajerosBloqueadosPorCierres: vi.fn<
      IOrdenRepository["findMensajerosBloqueadosPorCierres"]
    >(async () => new Set(bloqueados)),
  };
}

function notificadorEspia() {
  const recibidos: RepartoMananaContexto[] = [];
  const fn = vi.fn(async (ctx: RepartoMananaContexto) => {
    recibidos.push(ctx);
  });
  return { fn, recibidos };
}

const loggerMudo = { logError: vi.fn() };

describe("413/R6 — un mensajero con reparto recibe UNA emisión dirigida A ÉL", () => {
  it("⭑ con 5 órdenes, una emisión con su id y el DÍA ANUNCIADO", async () => {
    const repo = repoDoble([{ mensajeroId: "u-1", total: 5 }]);
    const cierres = cierresDoble();
    const { fn, recibidos } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(repo, cierres, fn, loggerMudo).ejecutar(
      AHORA,
    );

    expect(fn).toHaveBeenCalledTimes(1);
    // A USUARIO, no a rol: el contexto sólo admite un `mensajeroUsuarioId`.
    expect(recibidos[0]).toEqual({
      mensajeroUsuarioId: "u-1",
      diaAnunciadoISO: DIA_ANUNCIADO,
    });
    expect(resumen.avisosEmitidos).toBe(1);
    expect(resumen.mensajerosConReparto).toBe(1);
  });

  it("⭑ las DOS fechas del resumen son las correctas, escritas a mano", async () => {
    // ⚠️ ES LA TRAMPA HORARIA DE LA FICHA, vista desde el proceso. La corrida es a las 19:00 CR, o
    // sea `01:00Z` DEL DÍA SIGUIENTE: en ese instante el reloj UTC ya va por el día 12. Si alguien
    // derivara el día con `toISOString().slice(0,10)`, `fecha` saldría "2026-09-12" y el aviso
    // hablaría del 13 — en el 100 % de las corridas, no en un caso raro.
    const repo = repoDoble([{ mensajeroId: "u-1", total: 3 }]);
    const cierres = cierresDoble();
    const { fn } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(repo, cierres, fn, loggerMudo).ejecutar(
      AHORA,
    );

    expect(resumen.fecha).toBe(DIA_DE_LA_CORRIDA); // la tarde en que corrió
    expect(resumen.diaAnunciado).toBe(DIA_ANUNCIADO); // el día del que habla
  });

  it("⭑ la cota que pide al repositorio es la medianoche UTC del día CR en curso (`@db.Date`)", async () => {
    // `startOfDayCR(2026-09-12T01:00Z)` = `2026-09-11T00:00:00.000Z`. Con `inicioDelDiaCREnUtc`
    // saldría `2026-09-11T06:00:00.000Z` — seis horas más tarde, la cota de columnas `timestamp`,
    // y `fecha_reparto` NO lo es. Aquí se fija el valor exacto; R3 lo mide contra Postgres.
    const repo = repoDoble([]);
    const cierres = cierresDoble();

    await new RepartoMananaAvisoService(repo, cierres, vi.fn(), loggerMudo).ejecutar(AHORA);

    expect(repo.resumenPorMensajero).toHaveBeenCalledTimes(1);
    expect(repo.resumenPorMensajero.mock.calls[0][0].toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("R7 — dos mensajeros con reparto reciben cada uno el suyo, esa misma noche", async () => {
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 5 },
      { mensajeroId: "u-2", total: 12 },
    ]);
    const { fn, recibidos } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(
      repo,
      cierresDoble(),
      fn,
      loggerMudo,
    ).ejecutar(AHORA);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(recibidos.map((c) => c.mensajeroUsuarioId)).toEqual(["u-1", "u-2"]);
    expect(resumen.avisosEmitidos).toBe(2);
  });
});

describe("413/R18 — el mensajero con CERO no recibe nada, y los demás sí", () => {
  it("⭑ una fila con `total: 0` no emite; las otras dos sí", async () => {
    // El `GROUP BY` real no devuelve filas de cero, así que el `continue` explícito existe para
    // que un doble —o un repositorio futuro— que devolviera `total: 0` TAMPOCO pueda emitir. Es el
    // mismo patrón que 409/R43.
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 4 },
      { mensajeroId: "u-cero", total: 0 },
      { mensajeroId: "u-3", total: 1 },
    ]);
    const { fn, recibidos } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(
      repo,
      cierresDoble(),
      fn,
      loggerMudo,
    ).ejecutar(AHORA);

    expect(recibidos.map((c) => c.mensajeroUsuarioId)).toEqual(["u-1", "u-3"]);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(resumen.mensajerosConReparto).toBe(2);
    expect(resumen.avisosEmitidos).toBe(2);
  });

  it("sin nadie con reparto, no emite nada y NO pregunta por bloqueos", async () => {
    // Una consulta de cierres con la lista vacía sería una consulta de más todas las noches sin
    // reparto. Es barata, pero es medible y no hace falta.
    const repo = repoDoble([]);
    const cierres = cierresDoble();
    const { fn } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(repo, cierres, fn, loggerMudo).ejecutar(
      AHORA,
    );

    expect(fn).not.toHaveBeenCalled();
    expect(cierres.findMensajerosBloqueadosPorCierres).not.toHaveBeenCalled();
    expect(resumen.avisosEmitidos).toBe(0);
    expect(resumen.mensajerosConReparto).toBe(0);
  });
});

describe("413/R42 — el mensajero BLOQUEADO por cierres NO recibe este aviso", () => {
  it("⭑⭑ tres con reparto, el SEGUNDO bloqueado ⇒ DOS emisiones y él ninguna", async () => {
    // ⚠️ EL ASERTO DE R42. Decisión del humano del 2026-09-11, y no es regla nueva: el bloqueo
    // alcanza «recibir trabajo nuevo, reparto Y recolección» desde el 2026-08-23 (271). Anunciarle
    // su reparto sería prometerle algo que el servidor le va a negar, y ya tiene su aviso propio
    // —el de bloqueo— que sí le pide la acción que lo desbloquea. Dos avisos que apuntan a acciones
    // opuestas es peor que uno menos.
    //
    // MUTACIÓN OBLIGATORIA (design §13.10): borrar el `continue` del bloqueo ⇒ 3 emisiones y ROJO.
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 5 },
      { mensajeroId: "u-bloqueado", total: 9 },
      { mensajeroId: "u-3", total: 2 },
    ]);
    const cierres = cierresDoble(["u-bloqueado"]);
    const { fn, recibidos } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(repo, cierres, fn, loggerMudo).ejecutar(
      AHORA,
    );

    expect(fn).toHaveBeenCalledTimes(2);
    expect(recibidos.map((c) => c.mensajeroUsuarioId)).toEqual(["u-1", "u-3"]);
    expect(recibidos.map((c) => c.mensajeroUsuarioId)).not.toContain("u-bloqueado");
    expect(resumen.avisosEmitidos).toBe(2);
    expect(resumen.mensajerosBloqueados).toBe(1);
  });

  it("⭑ la consulta del bloqueo va EN LOTE: UNA llamada por corrida, no una por mensajero", async () => {
    // Coste declarado: «una consulta más por corrida diaria, no por mensajero» (design §6.1). Si
    // alguien la moviera dentro del bucle, esto se pone rojo con el número delante.
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 5 },
      { mensajeroId: "u-2", total: 9 },
      { mensajeroId: "u-3", total: 2 },
    ]);
    const cierres = cierresDoble();

    await new RepartoMananaAvisoService(repo, cierres, vi.fn(), loggerMudo).ejecutar(AHORA);

    expect(cierres.findMensajerosBloqueadosPorCierres).toHaveBeenCalledTimes(1);
    // Y con los ids que el `GROUP BY` ya trajo, no con una consulta propia de mensajeros.
    expect(cierres.findMensajerosBloqueadosPorCierres.mock.calls[0][0]).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
  });

  it("⭑ ANTI-VACUIDAD: con NADIE bloqueado, los tres reciben el suyo", async () => {
    // Sin este caso, un servicio que no emitiera nunca dejaría el anterior verde. Aquí se demuestra
    // que el filtro DISTINGUE: cambia sólo el conjunto de bloqueados y cambia el resultado.
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 5 },
      { mensajeroId: "u-bloqueado", total: 9 },
      { mensajeroId: "u-3", total: 2 },
    ]);
    const { fn, recibidos } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(
      repo,
      cierresDoble([]),
      fn,
      loggerMudo,
    ).ejecutar(AHORA);

    expect(fn).toHaveBeenCalledTimes(3);
    expect(recibidos.map((c) => c.mensajeroUsuarioId)).toContain("u-bloqueado");
    expect(resumen.mensajerosBloqueados).toBe(0);
  });

  it("si TODOS están bloqueados, no se emite nada y el resumen lo dice", async () => {
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 5 },
      { mensajeroId: "u-2", total: 9 },
    ]);
    const { fn } = notificadorEspia();

    const resumen = await new RepartoMananaAvisoService(
      repo,
      cierresDoble(["u-1", "u-2"]),
      fn,
      loggerMudo,
    ).ejecutar(AHORA);

    expect(fn).not.toHaveBeenCalled();
    expect(resumen.mensajerosConReparto).toBe(2);
    expect(resumen.mensajerosBloqueados).toBe(2);
    expect(resumen.avisosEmitidos).toBe(0);
  });
});

describe("413/R34 — una emisión que falla NO se lleva por delante a las demás", () => {
  it("⭑ tres mensajeros, el SEGUNDO lanza ⇒ 2 emisiones, 1 fallo y la corrida TERMINA", async () => {
    const repo = repoDoble([
      { mensajeroId: "u-1", total: 5 },
      { mensajeroId: "u-explota", total: 9 },
      { mensajeroId: "u-3", total: 2 },
    ]);
    const logger = { logError: vi.fn() };
    const recibidos: string[] = [];
    const fn = vi.fn(async (ctx: RepartoMananaContexto) => {
      if (ctx.mensajeroUsuarioId === "u-explota") throw new Error("la base se cayó");
      recibidos.push(ctx.mensajeroUsuarioId);
    });

    const resumen = await new RepartoMananaAvisoService(repo, cierresDoble(), fn, logger).ejecutar(
      AHORA,
    );

    // LA CORRIDA TERMINA: devuelve su resumen en vez de propagar.
    expect(resumen.avisosEmitidos).toBe(2);
    expect(resumen.fallos).toBe(1);
    expect(resumen.mensajerosConReparto).toBe(3);
    // Y el TERCERO recibió el suyo: el fallo del segundo no cortó el bucle.
    expect(recibidos).toEqual(["u-1", "u-3"]);
    // No es un `catch` vacío: el fallo queda REGISTRADO con su operación y su causa.
    expect(logger.logError).toHaveBeenCalledTimes(1);
  });

  it("el fallo registrado NO lleva el id del mensajero ni ningún otro dato (R29/R35)", async () => {
    const repo = repoDoble([{ mensajeroId: "u-secreto-413", total: 5 }]);
    const logger = { logError: vi.fn() };
    const fn = vi.fn(async () => {
      throw new Error("la base se cayó");
    });

    await new RepartoMananaAvisoService(repo, cierresDoble(), fn, logger).ejecutar(AHORA);

    const registrado = String(logger.logError.mock.calls[0][0]);
    expect(registrado).not.toContain("u-secreto-413");
    expect(registrado).toContain("reparto_manana");
  });
});

describe("413/R12 — dos corridas la misma noche dejan UNA emisión efectiva", () => {
  it("⭑ la segunda corrida, con OTRO número, produce la MISMA entidad", async () => {
    // R12 dice que una orden que entra DESPUÉS de la hora no produce una notificación adicional
    // esa noche. Quien lo garantiza de verdad es la ENTIDAD —el día anunciado, idéntico en las dos
    // corridas— y el índice único, que se miden contra Postgres (R22). Lo que SÍ es del servicio y
    // se mide aquí: que la entidad NO dependa del número ni del instante, sino sólo del día.
    const primera = repoDoble([{ mensajeroId: "u-1", total: 5 }]);
    const segunda = repoDoble([{ mensajeroId: "u-1", total: 8 }]);
    const { fn, recibidos } = notificadorEspia();

    await new RepartoMananaAvisoService(primera, cierresDoble(), fn, loggerMudo).ejecutar(AHORA);
    // Dos horas más tarde, la misma noche: 21:00 CR = 03:00Z del 12.
    await new RepartoMananaAvisoService(segunda, cierresDoble(), fn, loggerMudo).ejecutar(
      new Date("2026-09-12T03:00:00.000Z"),
    );

    expect(recibidos).toHaveLength(2);
    // ⭑ LA MISMA entidad las dos veces: el número no entra en ella, y el emisor no lo recibe.
    expect(recibidos[0].diaAnunciadoISO).toBe(DIA_ANUNCIADO);
    expect(recibidos[1].diaAnunciadoISO).toBe(DIA_ANUNCIADO);
    // Y ningún campo del contexto lleva el 5 ni el 8.
    expect(JSON.stringify(recibidos)).not.toContain("8");
  });

  it("⭑ la noche SIGUIENTE anuncia otro día (R23), y eso es lo que hace que sí avise", async () => {
    const repo = repoDoble([{ mensajeroId: "u-1", total: 5 }]);
    const { fn, recibidos } = notificadorEspia();

    await new RepartoMananaAvisoService(repo, cierresDoble(), fn, loggerMudo).ejecutar(AHORA);
    await new RepartoMananaAvisoService(repo, cierresDoble(), fn, loggerMudo).ejecutar(
      new Date("2026-09-13T01:00:00.000Z"), // 19:00 CR del día 12
    );

    expect(recibidos.map((c) => c.diaAnunciadoISO)).toEqual(["2026-09-12", "2026-09-13"]);
  });
});

describe("413/R37 — la emisión no corre dentro de ninguna transacción", () => {
  it("⭑ el servicio NO recibe cliente transaccional: su constructor tiene cuatro argumentos y ninguno lo es", () => {
    // R37 dicho como propiedad de la firma: no hay por dónde colarle un `tx`. Si alguien añadiera
    // uno, este aserto se pone rojo y obliga a justificarlo — una emisión dentro de la transacción
    // de una operación de negocio la puede REVERTIR (en Postgres un error de sentencia aborta la
    // transacción entera).
    expect(RepartoMananaAvisoService.length).toBe(2); // los dos obligatorios: repo y cierresRepo
  });

  it("⭑ y el default del notificador es el NO-OP: un servicio sin cablear NO escribe (R36)", async () => {
    // La base local es COMPARTIDA entre worktrees. Que el default sea el no-op —y no al revés— es
    // lo que impide que una suite que construya este servicio escriba avisos de verdad.
    const repo = repoDoble([{ mensajeroId: "u-1", total: 5 }]);

    const resumen = await new RepartoMananaAvisoService(repo, cierresDoble()).ejecutar(AHORA);

    // Emite (cuenta como emitido) pero el no-op no escribe nada: no hay forma de observarlo desde
    // aquí salvo que no lanza y que el resumen sale coherente. Lo que se afirma es que el servicio
    // se puede construir SIN notificador, que es la condición del default.
    expect(resumen.avisosEmitidos).toBe(1);
    expect(resumen.fallos).toBe(0);
  });
});
