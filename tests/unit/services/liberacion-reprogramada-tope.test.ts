import { describe, it, expect, vi } from "vitest";

import type {
  ILiberacionReprogramadaRepository,
  OrdenLiberableRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";

/**
 * FEATURE 276 (T6.2) — LA LIBERACION DE REPROGRAMADAS ESPERA A LA APROBACION DEL CIERRE.
 * R12, R13, R14, R15, R16.
 *
 * ⚠️ ESTE ES EL CAMBIO DE LA RAIZ. Hasta hoy `findOrdenesLiberables` devolvia la orden a bodega por
 * `fecha_reprogramacion <= hoyCR` SIN MIRAR EL CIERRE en ningun punto, con el contador de intentos
 * todavia en el valor viejo. Ahi nacia el 4.º intento que la ficha 276 cierra.
 *
 * ⚠️ Y ESTE ARCHIVO NO BASTA, POR CONSTRUCCION. Usa DOBLES: no ve el SQL, asi que no puede afirmar
 * que el repositorio traiga de verdad el `cierre.estado` ni la sonda de visita real DE LA GESTION
 * CORRECTA. Eso se mide contra Postgres en
 * `tests/integration/db/liberacion-reprogramada-cierre-real.test.ts`, y esa prueba es obligatoria:
 * en este repo esta medido cuatro veces que una mutacion de un `where`/`select` pasa en verde una
 * suite de dobles.
 */

const CENTRAL = "z-central";
const HOY = new Date("2026-07-15T00:00:00.000Z");

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  reprogramada: "os-reprogramada",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
};

function fila(over: Partial<OrdenLiberableRow> = {}): OrdenLiberableRow {
  return {
    id: "o1",
    zonaId: CENTRAL,
    fechaReprogramacion: new Date("2026-07-14T00:00:00.000Z"),
    gestionCierreId: "c1",
    gestionCierreEstado: "aprobado",
    gestionEsVisitaReal: true,
    ...over,
  };
}

function montar(filas: OrdenLiberableRow[], over: Partial<ILiberacionReprogramadaRepository> = {}) {
  const repo: ILiberacionReprogramadaRepository = {
    findOrdenesLiberables: vi.fn(async () => filas),
    findOrdenesLiberablesDeCierre: vi.fn(async () => filas), // ficha 315: mismas filas
    findOrdenesLiberablesDeOrden: vi.fn(async () => filas), // ficha 371: mismas filas
    liberarOrden: vi.fn(async () => true),
    findLiberadasHoy: vi.fn(async () => []),
    ...over,
  };
  const zonaRepo: Pick<IZonaRepository, "findCentralZonaId"> = {
    findCentralZonaId: vi.fn(async () => CENTRAL),
  };
  const ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue"> = {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
  };
  const avisos: string[] = [];
  const service = new LiberacionReprogramadaService(repo, zonaRepo, ordenRepo, {
    warn: (m) => avisos.push(m),
  });
  return { service, repo, avisos };
}

/* -------------------------------------------------------------------------- */
/* 1 · Visita real + cierre SIN aprobar -> NO se libera, y NADA se toca        */
/* -------------------------------------------------------------------------- */

describe("276/T6 · R12/R13 — la visita real espera a que su cierre se apruebe", () => {
  it("1. cierre `solicitado` -> no se libera, `esperandoCierre = 1`, y `liberarOrden` NI SE LLAMA", async () => {
    const { service, repo } = montar([
      fila({ gestionCierreId: "c1", gestionCierreEstado: "solicitado" }),
    ]);

    const r = await service.ejecutarLiberacion(HOY);

    // R13: «ninguna corrida del cron cambia su estado, su mensajero, su dia de reparto ni su
    // marca de prioridad». `liberarOrden` es la UNICA escritura de este bucle: que no se llame
    // ES el requisito, no un sintoma de el.
    expect(repo.liberarOrden).not.toHaveBeenCalled();
    expect(r).toEqual({ evaluadas: 1, liberadas: 0, omitidas: 0, esperandoCierre: 1 });
    // Y NO cuenta como `omitida`: omitir es un fallo o una carrera perdida. Esto es la regla.
    expect(r.omitidas).toBe(0);
  });

  it("1.bis — el aviso de la corrida es un AGREGADO sin PII (R38)", async () => {
    const { service, avisos } = montar([
      fila({ gestionCierreEstado: "solicitado" }),
      fila({ id: "o2", gestionCierreEstado: "solicitado" }),
    ]);

    await service.ejecutarLiberacion(HOY);

    const aviso = avisos.find((a) => a.includes("esperan"));
    expect(aviso).toBeDefined();
    expect(aviso).toContain("2 orden(es)");
    // Ni ids, ni guias, ni mensajeros, ni tiendas.
    expect(aviso).not.toContain("o1");
    expect(aviso).not.toContain("o2");
    expect(aviso).not.toContain("c1");
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · Visita real + cierre APROBADO -> se libera (R15)                        */
/* -------------------------------------------------------------------------- */

describe("276/T6 · R15 — al aprobarse el cierre, la corrida siguiente la libera", () => {
  it("2. cierre `aprobado` -> se libera", async () => {
    const { service, repo } = montar([fila({ gestionCierreEstado: "aprobado" })]);

    const r = await service.ejecutarLiberacion(HOY);

    expect(repo.liberarOrden).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ evaluadas: 1, liberadas: 1, omitidas: 0, esperandoCierre: 0 });
  });

  it("2.bis — la MISMA orden, antes y despues de la aprobacion, con la misma fecha", async () => {
    // Es R15 leido de punta a punta: lo unico que cambia entre las dos corridas es el estado del
    // cierre. Si alguien sustituyera `aprobado` por otro estado en el servicio, la primera corrida
    // liberaria y este caso caeria.
    const antes = montar([fila({ gestionCierreEstado: "solicitado" })]);
    const despues = montar([fila({ gestionCierreEstado: "aprobado" })]);

    const r1 = await antes.service.ejecutarLiberacion(HOY);
    const r2 = await despues.service.ejecutarLiberacion(HOY);

    expect(r1.liberadas).toBe(0);
    expect(r2.liberadas).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · Visita real SIN cierre todavia -> NO se libera                          */
/* -------------------------------------------------------------------------- */

describe("276/T6 · R12/R32 — sin cierre asignado tampoco se libera", () => {
  it("3. `cierreId = null` con visita real -> no se libera", async () => {
    // Es el caso mas facil de olvidar y el mas peligroso: la gestion del dia que el mensajero aun
    // no ha cerrado TODAVIA PUEDE entrar en un cierre y sumar +1. Liberar aqui es exactamente
    // devolver la orden a circulacion con el contador pendiente de subir (R32).
    const { service, repo } = montar([
      fila({ gestionCierreId: null, gestionCierreEstado: null }),
    ]);

    const r = await service.ejecutarLiberacion(HOY);

    expect(repo.liberarOrden).not.toHaveBeenCalled();
    expect(r.esperandoCierre).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · La gestion SINTETICA no espera a nadie (R14)                            */
/* -------------------------------------------------------------------------- */

describe("276/T6 · R14 — la reprogramacion de escritorio de la tienda no pierde latencia", () => {
  it("4. NO visita real + `cierreId = null` -> SI se libera, con el criterio de fecha de siempre", async () => {
    // `reprogramacion_tienda` (feature 100) crea una gestion SINTETICA que NO esta en
    // `ORIGEN_TIPOS_VISITA_REAL` y por tanto NUNCA va a contar como intento. Hacerla esperar la
    // aprobacion de un cierre seria pagar latencia (mediana medida 8,2 h, p90 22,1 h, max 48,2 h)
    // por un invariante que en esa via ya se cumple.
    const { service, repo } = montar([
      fila({ gestionEsVisitaReal: false, gestionCierreId: null, gestionCierreEstado: null }),
    ]);

    const r = await service.ejecutarLiberacion(HOY);

    expect(repo.liberarOrden).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ evaluadas: 1, liberadas: 1, omitidas: 0, esperandoCierre: 0 });
  });

  it("4.bis — y tampoco espera aunque su cierre este SIN aprobar", async () => {
    // La sintetica se vincula al siguiente cierre del mensajero (`crearCierre`), asi que puede
    // tener `cierreId` con estado `solicitado`. Sigue sin contar: la condicion que manda es que no
    // es visita real.
    const { service, repo } = montar([
      fila({ gestionEsVisitaReal: false, gestionCierreId: "c9", gestionCierreEstado: "solicitado" }),
    ]);

    const r = await service.ejecutarLiberacion(HOY);

    expect(repo.liberarOrden).toHaveBeenCalledTimes(1);
    expect(r.esperandoCierre).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · Los otros dos estados de cierre                                         */
/* -------------------------------------------------------------------------- */

describe("276/T6 · R12 — `rechazado` y `vencido` tampoco liberan", () => {
  it("5. ninguno de los dos se libera, y la valvula que lo hace aceptable esta declarada", async () => {
    // `forzarSolicitudVencido` (`ESTADOS_REABRIBLES = ["vencido","rechazado"]`) devuelve esos dos
    // a `solicitado`, asi que NINGUN cierre queda fuera del alcance de una aprobacion posterior.
    // Por eso esperar no es una trampa sin salida: es una espera con valvula.
    for (const estado of ["rechazado", "vencido"]) {
      const { service, repo } = montar([fila({ gestionCierreEstado: estado })]);

      const r = await service.ejecutarLiberacion(HOY);

      expect(repo.liberarOrden, `estado ${estado}`).not.toHaveBeenCalled();
      expect(r.esperandoCierre, `estado ${estado}`).toBe(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 6 · R16 — idempotencia y resiliencia por orden                              */
/* -------------------------------------------------------------------------- */

describe("276/T6 · R16 — la corrida sigue siendo resiliente e idempotente", () => {
  it("6. una orden que falla no aborta la corrida: la siguiente se libera igual", async () => {
    const liberarOrden = vi
      .fn<ILiberacionReprogramadaRepository["liberarOrden"]>()
      .mockRejectedValueOnce(new Error("base caida"))
      .mockResolvedValueOnce(true);
    const { service, repo } = montar(
      [fila({ id: "o-falla" }), fila({ id: "o-ok" })],
      { liberarOrden },
    );

    const r = await service.ejecutarLiberacion(HOY);

    expect(r).toEqual({ evaluadas: 2, liberadas: 1, omitidas: 1, esperandoCierre: 0 });
    expect((repo.liberarOrden as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("6.bis — una congelada NO impide que la siguiente candidata se libere", async () => {
    // La regla reduce el conjunto de candidatas; no corta la corrida.
    const { service, repo } = montar([
      fila({ id: "o-espera", gestionCierreEstado: "solicitado" }),
      fila({ id: "o-libre", gestionCierreEstado: "aprobado" }),
    ]);

    const r = await service.ejecutarLiberacion(HOY);

    expect(r).toEqual({ evaluadas: 2, liberadas: 1, omitidas: 0, esperandoCierre: 1 });
    expect(repo.liberarOrden).toHaveBeenCalledTimes(1);
    expect((repo.liberarOrden as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ordenId: "o-libre",
    });
  });

  it("6.ter — la idempotencia del `updateMany` guardado no cambia: `false` sigue siendo `omitida`", async () => {
    const { service } = montar([fila()], { liberarOrden: vi.fn(async () => false) });

    const r = await service.ejecutarLiberacion(HOY);

    expect(r).toEqual({ evaluadas: 1, liberadas: 0, omitidas: 1, esperandoCierre: 0 });
  });
});
