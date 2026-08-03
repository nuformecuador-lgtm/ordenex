import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import { IncidenteAdminRepository } from "@/lib/repositories/IncidenteAdminRepository";
import {
  ESTADOS_COLA_CIERRE_DIA,
  ESTADOS_COLA_SOLICITADO,
} from "@/lib/utils/colas-cierre";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 170 — FASE 2, T J.1 (R41/R44/R49/R51/R54) — el WHERE de las cuatro COLAS paginadas.
//
// Este archivo existe porque T I.1 lo aprendio por las malas: los tests de servicio prueban el
// acotamiento por ACTOR contra un repositorio DOBLE, asi que no ven la traduccion de ese
// acotamiento a SQL. Una mutacion del `where` (`notIn: [cola]` -> `in: ["aprobado"]`) paso
// VERDE entera la suite de servicios, y de ahi nacio
// `tests/unit/repositories/historicos-paginados-where.test.ts`. Esta es su mitad de la tanda J.
//
// Se afirman cuatro cosas por cola:
//   1. `findMany` y `count` reciben el MISMO `where` (si no, el contador de cabecera de R42
//      contaria un conjunto distinto del que la tabla muestra);
//   2. son EXACTAMENTE dos consultas — la pagina y el conteo, ni una mas (R54);
//   3. el `orderBy` y el recorte `skip`/`take` son los que el listado presenta hoy (R51), y el
//      conteo no lleva recorte;
//   4. **la cola y el historico PARTICIONAN el conjunto**: leen la misma constante de estados,
//      una con `in` y otra con `notIn`. Sin eso, una fila puede quedar en las dos listas o —lo
//      grave— en ninguna, y un cierre `vencido` que se cae de las dos deja bloqueada la bodega
//      de su mensajero sin que nadie lo vea.

const RANGO: RangoPagina = { skip: 4, take: 2 };

interface Consulta {
  where?: unknown;
  orderBy?: unknown;
  skip?: number;
  take?: number;
}

/** Delegado Prisma falso que registra los argumentos de `findMany` y `count`. */
function delegado(filas: unknown[] = []) {
  return {
    findMany: vi.fn(async (_args?: Consulta) => filas),
    count: vi.fn(async (_args?: Consulta) => 17),
  };
}

/** Las tres afirmaciones comunes a toda cola que corta en la base. */
function verificar(
  d: ReturnType<typeof delegado>,
  esperado: { where: unknown; orderBy: unknown },
): void {
  expect(d.findMany).toHaveBeenCalledTimes(1);
  expect(d.count).toHaveBeenCalledTimes(1);

  const pagina = d.findMany.mock.calls[0]![0]!;
  const conteo = d.count.mock.calls[0]![0];

  // (1) El mismo `where` en la pagina y en el conteo (R41/R42/R44).
  expect(pagina.where).toEqual(esperado.where);
  expect(conteo?.where).toEqual(esperado.where);

  // (3) Orden y recorte (R51/R40). El conteo NO lleva recorte: contaria la pagina.
  expect(pagina.orderBy).toEqual(esperado.orderBy);
  expect(pagina.skip).toBe(RANGO.skip);
  expect(pagina.take).toBe(RANGO.take);
  expect(conteo?.skip).toBeUndefined();
  expect(conteo?.take).toBeUndefined();
}

/** El `where` sin su corte por estado: lo que queda es el ALCANCE, que las dos mitades comparten. */
function sinEstado(where: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(where).filter(([clave]) => clave !== "estado"));
}

/** Repositorio de cierres del dia con un solo delegado real (el resto no se usa al listar). */
function repoCierresAdmin(cierreDia: ReturnType<typeof delegado>) {
  return new CierresAdminRepository(
    { cierreDia } as unknown as PrismaClient,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function repoIncidentes(ordenIncidente: ReturnType<typeof delegado>) {
  return new IncidenteAdminRepository(
    { ordenIncidente } as unknown as PrismaClient,
    {} as never,
    {} as never,
  );
}

describe("WHERE de las colas paginadas de la tanda J (T J.1)", () => {
  it("cierres del dia — cola: alcance + estados DE la cola, mismo where en pagina y conteo", async () => {
    const cierreDia = delegado();

    // adminSatelite: el alcance acota por tipo de bodega Y por zona.
    await repoCierresAdmin(cierreDia).findColaPaginada(
      { destinoTipo: "bodega_satelite", destinoZonaId: "z-a" },
      RANGO,
    );

    verificar(cierreDia, {
      where: {
        destinoTipo: "bodega_satelite",
        destinoZonaId: "z-a",
        // `in`, el espejo del `if (esColaCierreDia(...))` del servicio. `vencido` esta DENTRO:
        // es resoluble y bloquea la bodega de su mensajero hasta que el admin lo destraba.
        estado: { in: ["solicitado", "vencido"] },
      },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres del dia — cola: el acceso total NO emite destinoZonaId (ve toda la central)", async () => {
    const cierreDia = delegado();

    await repoCierresAdmin(cierreDia).findColaPaginada(
      { destinoTipo: "bodega_central", destinoZonaId: null },
      RANGO,
    );

    verificar(cierreDia, {
      where: { destinoTipo: "bodega_central", estado: { in: ["solicitado", "vencido"] } },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres de bodega — cola: solo `solicitado`, y los RECHAZADOS quedan fuera", async () => {
    const cierreBodega = delegado();
    const repo = new CierresBodegaAdminRepository({ cierreBodega } as unknown as PrismaClient);

    await repo.findColaPaginada(RANGO);

    verificar(cierreBodega, {
      where: { estado: { in: ["solicitado"] } },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("cierres del dia a consolidar: los CUATRO predicados del conjunto que da los totales", async () => {
    const cierreDia = delegado();
    const repo = new CierreBodegaRepository({ cierreDia } as unknown as PrismaClient);

    await repo.findCierresDiaConsolidablesPaginado("z-a", RANGO);

    verificar(cierreDia, {
      // R49: es EL MISMO `where` sobre el que el servicio calcula los cinco agregados de
      // dinero. Si a la pagina le faltara `cierreBodegaId: null`, la tabla mostraria cierres
      // ya consolidados que el total NO cuenta: dos numeros que no cuadran, sin aviso.
      where: {
        estado: "aprobado",
        destinoTipo: "bodega_satelite",
        destinoZonaId: "z-a",
        cierreBodegaId: null,
      },
      orderBy: { solicitadoAt: "desc" },
    });
  });

  it("incidentes — cola: alcance por la zona de la ORDEN + estado de la cola", async () => {
    const ordenIncidente = delegado();

    await repoIncidentes(ordenIncidente).findColaPaginada({ zonaId: "z-a" }, RANGO);

    verificar(ordenIncidente, {
      // El alcance va por `orden.zonaId`, no por la zona del autor.
      where: { orden: { zonaId: "z-a" }, estado: { in: ["solicitado"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("incidentes — cola: el acceso total no emite filtro de zona", async () => {
    const ordenIncidente = delegado();

    await repoIncidentes(ordenIncidente).findColaPaginada({ zonaId: null }, RANGO);

    verificar(ordenIncidente, {
      where: { estado: { in: ["solicitado"] } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro", async () => {
    // Es la afirmacion que sostiene R44 entre las dos tandas. Se comprueba emitiendo los DOS
    // `where` de cada listado y exigiendo que el `in` de la cola y el `notIn` del historico
    // lleven la MISMA lista de estados. Con listas distintas, una fila puede quedar en las dos
    // pantallas o —lo grave— en ninguna, y nadie se entera hasta que falta un cierre.
    const casos: Array<{
      nombre: string;
      cola: () => Promise<unknown>;
      historico: () => Promise<unknown>;
      delegadoCola: ReturnType<typeof delegado>;
      delegadoHistorico: ReturnType<typeof delegado>;
      estados: readonly string[];
    }> = [];

    const dc1 = delegado();
    const dh1 = delegado();
    casos.push({
      nombre: "cierres del dia",
      delegadoCola: dc1,
      delegadoHistorico: dh1,
      estados: ESTADOS_COLA_CIERRE_DIA,
      cola: () =>
        repoCierresAdmin(dc1).findColaPaginada(
          { destinoTipo: "bodega_central", destinoZonaId: null },
          RANGO,
        ),
      historico: () =>
        repoCierresAdmin(dh1).findHistoricoPaginado(
          { destinoTipo: "bodega_central", destinoZonaId: null },
          RANGO,
        ),
    });

    const dc2 = delegado();
    const dh2 = delegado();
    casos.push({
      nombre: "cierres de bodega",
      delegadoCola: dc2,
      delegadoHistorico: dh2,
      estados: ESTADOS_COLA_SOLICITADO,
      cola: () =>
        new CierresBodegaAdminRepository({
          cierreBodega: dc2,
        } as unknown as PrismaClient).findColaPaginada(RANGO),
      historico: () =>
        new CierresBodegaAdminRepository({
          cierreBodega: dh2,
        } as unknown as PrismaClient).findHistoricoPaginado(RANGO),
    });

    const dc3 = delegado();
    const dh3 = delegado();
    casos.push({
      nombre: "incidentes",
      delegadoCola: dc3,
      delegadoHistorico: dh3,
      estados: ESTADOS_COLA_SOLICITADO,
      cola: () => repoIncidentes(dc3).findColaPaginada({ zonaId: null }, RANGO),
      historico: () => repoIncidentes(dh3).findHistoricoPaginado({ zonaId: null }, RANGO),
    });

    // Anti-vacuidad: son los TRES listados que se parten en cola + historico. El cuarto de la
    // tanda J (consolidables) no se parte: es un conjunto propio con sus cuatro predicados.
    expect(casos).toHaveLength(3);

    for (const caso of casos) {
      await caso.cola();
      await caso.historico();

      const whereCola = (caso.delegadoCola.findMany.mock.calls[0]![0] as { where: { estado: { in: string[] } } })
        .where;
      const whereHistorico = (
        caso.delegadoHistorico.findMany.mock.calls[0]![0] as {
          where: { estado: { notIn: string[] } };
        }
      ).where;

      expect(whereCola.estado.in, `${caso.nombre}: la cola`).toEqual([...caso.estados]);
      expect(whereHistorico.estado.notIn, `${caso.nombre}: el historico`).toEqual([
        ...caso.estados,
      ]);
      // La particion, dicha sin rodeos: la lista es LA MISMA en las dos mitades.
      expect(whereCola.estado.in, `${caso.nombre}: misma lista en las dos mitades`).toEqual(
        whereHistorico.estado.notIn,
      );
      // Y el resto del `where` (el ALCANCE) tambien es el mismo: lo unico que cambia entre las
      // dos mitades es el corte por estado.
      expect(sinEstado(whereCola), `${caso.nombre}: mismo alcance`).toEqual(
        sinEstado(whereHistorico),
      );
    }
  });

  it("ninguna de las cuatro colas pide mas de dos consultas: la pagina y el conteo (R54)", async () => {
    // Anti-vacuidad de este archivo: la cuenta de colas cubiertas. Si manana alguien anade un
    // `findFirst` dentro de uno de estos metodos, la suma deja de dar 8 y este test lo dice.
    const casos: Array<[string, ReturnType<typeof delegado>, () => Promise<unknown>]> = [];

    const d1 = delegado();
    casos.push([
      "cierres del dia pendientes",
      d1,
      () =>
        repoCierresAdmin(d1).findColaPaginada(
          { destinoTipo: "bodega_central", destinoZonaId: null },
          RANGO,
        ),
    ]);

    const d2 = delegado();
    casos.push([
      "cierres de bodega pendientes",
      d2,
      () =>
        new CierresBodegaAdminRepository({
          cierreBodega: d2,
        } as unknown as PrismaClient).findColaPaginada(RANGO),
    ]);

    const d3 = delegado();
    casos.push([
      "cierres del dia a consolidar",
      d3,
      () =>
        new CierreBodegaRepository({
          cierreDia: d3,
        } as unknown as PrismaClient).findCierresDiaConsolidablesPaginado("z-a", RANGO),
    ]);

    const d4 = delegado();
    casos.push([
      "incidentes pendientes",
      d4,
      () => repoIncidentes(d4).findColaPaginada({ zonaId: null }, RANGO),
    ]);

    expect(casos).toHaveLength(4); // las CUATRO colas de la tanda J

    let consultas = 0;
    for (const [nombre, d, ejecutar] of casos) {
      await ejecutar();
      const total = d.findMany.mock.calls.length + d.count.mock.calls.length;
      expect(total, `${nombre}: la pagina y el conteo, ni una consulta mas`).toBe(2);
      consultas += total;
    }
    expect(consultas).toBe(8);
  });

  it("el conjunto CONSOLIDABLE se declara una sola vez: la pagina y el listado entero lo comparten", async () => {
    // R44/R49 en su forma mas directa: los cuatro predicados que definen «lo que esta bodega
    // puede cerrar hoy» salen de UNA funcion. Si la pagina tuviera su copia, bastaria con que
    // una de las dos se quedara sin `cierreBodegaId: null` para que la tabla y los totales de
    // dinero hablaran de conjuntos distintos.
    const entero = delegado();
    await new CierreBodegaRepository({
      cierreDia: entero,
    } as unknown as PrismaClient).findCierresDiaConsolidables("z-a");

    const pagina = delegado();
    await new CierreBodegaRepository({
      cierreDia: pagina,
    } as unknown as PrismaClient).findCierresDiaConsolidablesPaginado("z-a", RANGO);

    const argsEntero = entero.findMany.mock.calls[0]![0]!;
    const argsPagina = pagina.findMany.mock.calls[0]![0]!;

    expect(argsPagina.where).toEqual(argsEntero.where);
    expect(argsPagina.orderBy).toEqual(argsEntero.orderBy);
    // La UNICA diferencia entre las dos consultas es el recorte.
    expect(argsEntero.skip).toBeUndefined();
    expect(argsEntero.take).toBeUndefined();
    expect(argsPagina.skip).toBe(RANGO.skip);
    expect(argsPagina.take).toBe(RANGO.take);
    // Y el listado entero NO cuenta: la consulta de conteo solo la anade la pagina (R54).
    expect(entero.count).not.toHaveBeenCalled();
    expect(pagina.count).toHaveBeenCalledTimes(1);
  });
});
