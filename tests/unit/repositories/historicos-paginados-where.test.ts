import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { IncidenteAdminRepository } from "@/lib/repositories/IncidenteAdminRepository";
import { GastoFijoPlantillaRepository } from "@/lib/repositories/GastoFijoPlantillaRepository";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 170 — FASE 2, T I.1 (R41/R44/R51/R54) — el WHERE de los seis listados paginados que
// cortan en la BASE.
//
// Los tests de servicio (`tests/unit/services/*-paginado.test.ts`) prueban el acotamiento por
// ACTOR: que el servicio pase al repositorio el alcance del actor y no otro. Lo que NO pueden
// probar es la traduccion de ese alcance a SQL, porque ahi usan un doble. Este archivo cierra
// justo ese hueco, y se escribio porque una mutacion lo dejo al descubierto: cambiar
// `notIn: [cola]` por `in: ["aprobado"]` en `CierresBodegaAdminRepository` —que borra los
// cierres RECHAZADOS del historico— no ponia roja ni una prueba.
//
// Se afirman tres cosas por listado, y las tres son las que R54 y R41 vuelven verificables:
//   1. `findMany` y `count` reciben el MISMO `where` (si no, el total cuenta otro conjunto);
//   2. son EXACTAMENTE dos consultas: la pagina y el conteo — ni una mas (R54);
//   3. el `orderBy` y el recorte `skip`/`take` son los que el listado presenta hoy (R51).

const RANGO: RangoPagina = { skip: 4, take: 2 };

interface Consulta {
  where?: unknown;
  orderBy?: unknown;
  skip?: number;
  take?: number;
}

/**
 * Delegado Prisma falso que registra los argumentos de `findMany` y `count`. Los parametros se
 * declaran EXPLICITAMENTE (`args?: Consulta`) porque son justo lo que este archivo afirma: sin
 * ellos, el tipo del mock seria de cero argumentos y `mock.calls[0][0]` no existiria.
 */
function delegado(filas: unknown[] = []) {
  return {
    findMany: vi.fn(async (_args?: Consulta) => filas),
    count: vi.fn(async (_args?: Consulta) => 17),
  };
}

/** Las tres afirmaciones comunes a todos los listados que cortan en la base. */
function verificar(
  d: ReturnType<typeof delegado>,
  esperado: { where: unknown; orderBy: unknown },
): void {
  expect(d.findMany).toHaveBeenCalledTimes(1);
  expect(d.count).toHaveBeenCalledTimes(1);

  const pagina = d.findMany.mock.calls[0]![0]!;
  const conteo = d.count.mock.calls[0]![0];

  // (1) El mismo `where` en la pagina y en el conteo (R41/R44).
  expect(pagina.where).toEqual(esperado.where);
  expect(conteo?.where).toEqual(esperado.where);

  // (3) Orden y recorte (R51/R40). El conteo NO lleva recorte: contaria la pagina.
  expect(pagina.orderBy).toEqual(esperado.orderBy);
  expect(pagina.skip).toBe(RANGO.skip);
  expect(pagina.take).toBe(RANGO.take);
  expect(conteo?.skip).toBeUndefined();
  expect(conteo?.take).toBeUndefined();
}

describe("WHERE de los listados paginados de la tanda I (T I.1)", () => {
  it("cierres del dia — historico: alcance + estados fuera de la cola, mismo where en pagina y conteo", async () => {
    const cierreDia = delegado();
    const repo = new CierresAdminRepository(
      { cierreDia } as unknown as PrismaClient,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // adminSatelite: el alcance acota por tipo de bodega Y por zona.
    await repo.findHistoricoPaginado(
      { destinoTipo: "bodega_satelite", destinoZonaId: "z-a" },
      RANGO,
    );

    verificar(cierreDia, {
      where: {
        destinoTipo: "bodega_satelite",
        destinoZonaId: "z-a",
        // El corte cola/historico: `notIn`, el espejo del `else` del servicio. Un
        // `in: ["aprobado","rechazado"]` haria desaparecer cualquier estado nuevo del enum.
        estado: { notIn: ["solicitado", "vencido"] },
      },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres del dia — historico: el acceso total NO emite destinoZonaId (ve toda la central)", async () => {
    const cierreDia = delegado();
    const repo = new CierresAdminRepository(
      { cierreDia } as unknown as PrismaClient,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await repo.findHistoricoPaginado({ destinoTipo: "bodega_central", destinoZonaId: null }, RANGO);

    verificar(cierreDia, {
      where: { destinoTipo: "bodega_central", estado: { notIn: ["solicitado", "vencido"] } },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres de bodega — resueltos: estados fuera de la cola (los RECHAZADOS siguen dentro)", async () => {
    const cierreBodega = delegado();
    const repo = new CierresBodegaAdminRepository({ cierreBodega } as unknown as PrismaClient);

    await repo.findHistoricoPaginado(RANGO);

    verificar(cierreBodega, {
      // `notIn: ["solicitado"]`, no `in: ["aprobado"]`: un cierre de bodega RECHAZADO es
      // historico y tiene que seguir viendose.
      where: { estado: { notIn: ["solicitado"] } },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres de bodega — solicitados: acota por zona y NO filtra por estado", async () => {
    const cierreBodega = delegado();
    const repo = new CierreBodegaRepository({ cierreBodega } as unknown as PrismaClient);

    await repo.findCierresBodegaByZonaPaginado("z-a", RANGO);

    verificar(cierreBodega, {
      // La zona es todo el acotamiento: sin ella, un adminSatelite veria el historico de
      // dinero de la bodega vecina. Y NO hay filtro de estado: este listado los muestra todos.
      where: { zonaId: "z-a" },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres solicitados del mensajero: acota por mensajeroId y NO filtra por estado", async () => {
    const cierreDia = delegado();
    const repo = new CierreDiaRepository({ cierreDia } as unknown as PrismaClient, {} as never);

    await repo.findCierresByMensajeroPaginado("m-a", RANGO);

    verificar(cierreDia, {
      where: { mensajeroId: "m-a" },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("incidentes — historico: alcance por la zona de la ORDEN + estados fuera de la cola", async () => {
    const ordenIncidente = delegado();
    const repo = new IncidenteAdminRepository(
      { ordenIncidente } as unknown as PrismaClient,
      {} as never,
      {} as never,
    );

    await repo.findHistoricoPaginado({ zonaId: "z-a" }, RANGO);

    verificar(ordenIncidente, {
      // El alcance va por `orden.zonaId`, no por la zona del autor: un maestro puede reportar
      // sobre una orden de cualquier zona y el adminSatelite solo debe ver las suyas.
      where: { orden: { zonaId: "z-a" }, estado: { notIn: ["solicitado"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("incidentes — historico: el acceso total no emite filtro de zona", async () => {
    const ordenIncidente = delegado();
    const repo = new IncidenteAdminRepository(
      { ordenIncidente } as unknown as PrismaClient,
      {} as never,
      {} as never,
    );

    await repo.findHistoricoPaginado({ zonaId: null }, RANGO);

    verificar(ordenIncidente, {
      where: { estado: { notIn: ["solicitado"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("plantillas de gasto fijo: sin where (activas e inactivas), dos consultas y el orden de hoy", async () => {
    const gastoFijoPlantilla = delegado();
    const repo = new GastoFijoPlantillaRepository({
      gastoFijoPlantilla,
    } as unknown as PrismaClient);

    await repo.listarPaginado(RANGO);

    expect(gastoFijoPlantilla.findMany).toHaveBeenCalledTimes(1);
    expect(gastoFijoPlantilla.count).toHaveBeenCalledTimes(1);
    const pagina = gastoFijoPlantilla.findMany.mock.calls[0]![0]!;
    // R26: NINGUN `where`. Filtrar por `activa` aqui convertiria este listado en el del cron.
    expect(pagina.where).toBeUndefined();
    expect(pagina.orderBy).toEqual({ createdAt: "desc" });
    expect(pagina.skip).toBe(RANGO.skip);
    expect(pagina.take).toBe(RANGO.take);
    expect(gastoFijoPlantilla.count.mock.calls[0]![0]).toBeUndefined();
  });

  it("ninguno de los seis pide mas de dos consultas: la pagina y el conteo (R54)", async () => {
    // Anti-vacuidad de este archivo: la cuenta de listados cubiertos. Si manana alguien anade
    // un `findFirst` para "resolver el nombre de la zona" dentro de uno de estos metodos, la
    // suma deja de dar 12 y este test lo dice.
    const casos: Array<[string, ReturnType<typeof delegado>, () => Promise<unknown>]> = [];

    const d1 = delegado();
    casos.push([
      "cierres del dia",
      d1,
      () =>
        new CierresAdminRepository(
          { cierreDia: d1 } as unknown as PrismaClient,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        ).findHistoricoPaginado({ destinoTipo: "bodega_central", destinoZonaId: null }, RANGO),
    ]);

    const d2 = delegado();
    casos.push([
      "cierres de bodega resueltos",
      d2,
      () =>
        new CierresBodegaAdminRepository({
          cierreBodega: d2,
        } as unknown as PrismaClient).findHistoricoPaginado(RANGO),
    ]);

    const d3 = delegado();
    casos.push([
      "cierres de bodega solicitados",
      d3,
      () =>
        new CierreBodegaRepository({
          cierreBodega: d3,
        } as unknown as PrismaClient).findCierresBodegaByZonaPaginado("z-a", RANGO),
    ]);

    const d4 = delegado();
    casos.push([
      "cierres del mensajero",
      d4,
      () =>
        new CierreDiaRepository(
          { cierreDia: d4 } as unknown as PrismaClient,
          {} as never,
        ).findCierresByMensajeroPaginado("m-a", RANGO),
    ]);

    const d5 = delegado();
    casos.push([
      "incidentes historico",
      d5,
      () =>
        new IncidenteAdminRepository(
          { ordenIncidente: d5 } as unknown as PrismaClient,
          {} as never,
          {} as never,
        ).findHistoricoPaginado({ zonaId: null }, RANGO),
    ]);

    const d6 = delegado();
    casos.push([
      "plantillas de gasto fijo",
      d6,
      () =>
        new GastoFijoPlantillaRepository({
          gastoFijoPlantilla: d6,
        } as unknown as PrismaClient).listarPaginado(RANGO),
    ]);

    expect(casos).toHaveLength(6); // los seis que cortan en la base (el septimo agrega, no corta)

    let consultas = 0;
    for (const [nombre, d, ejecutar] of casos) {
      await ejecutar();
      const total = d.findMany.mock.calls.length + d.count.mock.calls.length;
      expect(total, `${nombre}: la pagina y el conteo, ni una consulta mas`).toBe(2);
      consultas += total;
    }
    expect(consultas).toBe(12);
  });
});
