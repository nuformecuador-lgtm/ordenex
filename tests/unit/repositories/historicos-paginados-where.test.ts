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

// Feature 184 — Tanda B (R5/R14/R15/R16) — los CONJUNTOS de los que salen los archivos de los
// listados 6 y 7, «Cierres de bodega solicitados» y «Cierres del día a consolidar».
//
// Aquí no hay método de repositorio nuevo: los dos conjuntos ya existían
// (`findCierresBodegaByZona` y `findCierresDiaConsolidables`) y son literalmente los que la
// pantalla releía. Lo que cambia con esta tanda es su PAPEL: pasan de ser un campo suelto de un
// listado compuesto a ser la lectura dedicada del archivo. Y en cuanto un archivo depende de
// ellos, su `where` y su `orderBy` dejan de ser un detalle: si divergen de los de la página, la
// fila 26 del archivo deja de ser la primera de la página 2 y no hay ninguna pantalla que lo
// diga.
//
// El aviso de siempre: los tests de servicio usan un doble de repositorio y NO ven esta
// traducción. Por eso estas dos propiedades se afirman aquí y no allí.
describe("los conjuntos de la descarga de la tanda B (feature 184)", () => {
  it("cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)", async () => {
    const entero = delegado();
    await new CierreBodegaRepository({
      cierreBodega: entero,
    } as unknown as PrismaClient).findCierresBodegaByZona("z-a");

    const pagina = delegado();
    await new CierreBodegaRepository({
      cierreBodega: pagina,
    } as unknown as PrismaClient).findCierresBodegaByZonaPaginado("z-a", RANGO);

    const argsEntero = entero.findMany.mock.calls[0]![0]!;
    const argsPagina = pagina.findMany.mock.calls[0]![0]!;

    // El alcance por zona es TODO el criterio de este listado, y sale de una sola declaración.
    expect(argsEntero.where).toEqual({ zonaId: "z-a" });
    expect(argsPagina.where).toEqual(argsEntero.where);
    // El orden también: la página N tiene que ser el segmento N de este conjunto (R5).
    expect(argsEntero.orderBy).toEqual({ solicitadoAt: "desc" });
    expect(argsPagina.orderBy).toEqual(argsEntero.orderBy);
    // La ÚNICA diferencia entre las dos consultas es el recorte.
    expect(argsEntero.skip).toBeUndefined();
    expect(argsEntero.take).toBeUndefined();
    expect(argsPagina.skip).toBe(RANGO.skip);
    expect(argsPagina.take).toBe(RANGO.take);
  });

  it("los dos conjuntos cuestan UNA consulta, sin recorte y sin conteo de página (R15)", async () => {
    // Lo que hace de esta tanda una mejora medible: el archivo pasa de cuatro consultas + cinco
    // agregados + el reparto del efectivo a ESTO. Si mañana alguien le añade a uno de los dos un
    // `count` «para el total», el total del archivo pasaría a salir de otro sitio que sus filas.
    const casos: Array<[string, ReturnType<typeof delegado>, () => Promise<unknown>]> = [];

    const d1 = delegado();
    casos.push([
      "cierres de bodega solicitados",
      d1,
      () =>
        new CierreBodegaRepository({
          cierreBodega: d1,
        } as unknown as PrismaClient).findCierresBodegaByZona("z-a"),
    ]);

    const d2 = delegado();
    casos.push([
      "cierres del día a consolidar",
      d2,
      () =>
        new CierreBodegaRepository({
          cierreDia: d2,
        } as unknown as PrismaClient).findCierresDiaConsolidables("z-a"),
    ]);

    expect(casos).toHaveLength(2); // los DOS listados de la tanda B

    for (const [nombre, d, ejecutar] of casos) {
      await ejecutar();
      expect(d.findMany, `${nombre}: una sola consulta`).toHaveBeenCalledTimes(1);
      expect(d.count, `${nombre}: el conjunto NO cuenta`).not.toHaveBeenCalled();
      const args = d.findMany.mock.calls[0]![0]!;
      expect(args.skip, `${nombre}: sin recorte`).toBeUndefined();
      expect(args.take, `${nombre}: sin recorte`).toBeUndefined();
    }
  });
});

// Feature 184 — Tanda C (R5/R14/R15/R16) — el CONJUNTO del que sale el archivo del listado 1,
// «Cierres solicitados por el mensajero».
//
// Tampoco aquí hay método de repositorio nuevo: `findCierresByMensajero` ya devolvía el conjunto
// entero del mensajero, con el mismo `select` y el mismo mapper que su hermano paginado. Lo que
// cambia con esta tanda es su PAPEL —pasa de ser un campo suelto de un listado compuesto a ser la
// lectura dedicada del archivo— y, con él, la importancia de su `where` y su `orderBy`: si
// divergen de los de la página, la fila 26 del archivo deja de ser la primera de la página 2 y no
// hay ninguna pantalla que lo diga.
//
// El aviso de siempre: `tests/unit/services/cierre-dia-pasados-completo.test.ts` usa un doble de
// repositorio y NO ve esta traducción. Por eso estas propiedades se afirman aquí y no allí.
describe("el conjunto de la descarga de la tanda C (feature 184)", () => {
  it("cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)", async () => {
    const entero = delegado();
    await new CierreDiaRepository(
      { cierreDia: entero } as unknown as PrismaClient,
      {} as never,
    ).findCierresByMensajero("m-a");

    const pagina = delegado();
    await new CierreDiaRepository(
      { cierreDia: pagina } as unknown as PrismaClient,
      {} as never,
    ).findCierresByMensajeroPaginado("m-a", RANGO);

    const argsEntero = entero.findMany.mock.calls[0]![0]!;
    const argsPagina = pagina.findMany.mock.calls[0]![0]!;

    // El `mensajero_id` es TODO el criterio de este listado —no filtra por estado— y sale de una
    // sola declaración. Es además el acotamiento por actor: sin él, el archivo traería el dinero
    // de todos los mensajeros.
    expect(argsEntero.where).toEqual({ mensajeroId: "m-a" });
    expect(argsPagina.where).toEqual(argsEntero.where);
    // El orden también: la página N tiene que ser el segmento N de este conjunto (R5).
    expect(argsEntero.orderBy).toEqual({ solicitadoAt: "desc" });
    expect(argsPagina.orderBy).toEqual(argsEntero.orderBy);
    // La ÚNICA diferencia entre las dos consultas es el recorte.
    expect(argsEntero.skip).toBeUndefined();
    expect(argsEntero.take).toBeUndefined();
    expect(argsPagina.skip).toBe(RANGO.skip);
    expect(argsPagina.take).toBe(RANGO.take);
  });

  it("el conjunto del mensajero cuesta UNA consulta, sin recorte y sin conteo de página (R15)", async () => {
    // Lo que hace de esta tanda una mejora medible: el archivo pasa de cuatro consultas + la
    // resolución de tarifa + la firma en lote de las evidencias del día a ESTO. Si mañana alguien
    // le añadiera un `count` «para el total», el total del archivo saldría de otro sitio que sus
    // filas.
    const d = delegado();
    await new CierreDiaRepository(
      { cierreDia: d } as unknown as PrismaClient,
      {} as never,
    ).findCierresByMensajero("m-a");

    expect(d.findMany).toHaveBeenCalledTimes(1);
    expect(d.count).not.toHaveBeenCalled();
    const args = d.findMany.mock.calls[0]![0]!;
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
  });
});

// Feature 184 — Tanda D (R5/R14/R15/R16) — el CONJUNTO del que sale el archivo del listado 2,
// «Cierres del día — histórico» del admin.
//
// **Aquí SÍ hay método de repositorio nuevo, y es la diferencia con las tandas B y C.** Allí el
// conjunto ya existía y bastó reusarlo. Aquí la única lectura sin recorte de este dominio es
// `findCierresByAlcance`, que devuelve la UNIÓN de la cola y el histórico: no es este conjunto,
// es este conjunto MÁS el otro listado de la misma pantalla. Reusarla habría dejado el archivo
// saliendo de un listado compuesto (R1) y habría obligado a partir en memoria lo que la base ya
// sabe cortar. De ahí `findHistoricoCompleto`.
//
// Lo que sí se hizo igual que en B y C: el criterio y el orden se declaran UNA vez
// (`historicoWhere`, `ORDEN_CIERRES_ADMIN`) y los comparten la página y el conjunto. El orden
// estaba escrito TRES veces en el archivo y esta tanda habría sumado dos copias más.
//
// El aviso de siempre: `tests/unit/services/cierres-admin-completo.test.ts` usa un doble de
// repositorio y NO ve esta traducción a SQL. Por eso estas propiedades se afirman aquí.
describe("el conjunto del HISTÓRICO de cierres del admin (feature 184, tanda D)", () => {
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

  it("cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)", async () => {
    const entero = delegado();
    await repoCierresAdmin(entero).findHistoricoCompleto({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-a",
    });

    const pagina = delegado();
    await repoCierresAdmin(pagina).findHistoricoPaginado(
      { destinoTipo: "bodega_satelite", destinoZonaId: "z-a" },
      RANGO,
    );

    const argsEntero = entero.findMany.mock.calls[0]![0]!;
    const argsPagina = pagina.findMany.mock.calls[0]![0]!;

    // El alcance del actor (tipo de bodega + zona) MÁS el corte cola/histórico, en valores
    // ABSOLUTOS: compartir la declaración no la vuelve invisible.
    expect(argsEntero.where).toEqual({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-a",
      estado: { notIn: ["solicitado", "vencido"] },
    });
    expect(argsPagina.where).toEqual(argsEntero.where);
    // El orden también: la página N tiene que ser el segmento N de este conjunto (R5).
    expect(argsEntero.orderBy).toEqual({ solicitadoAt: "desc" });
    expect(argsPagina.orderBy).toEqual(argsEntero.orderBy);
    // La ÚNICA diferencia entre las dos consultas es el recorte.
    expect(argsEntero.skip).toBeUndefined();
    expect(argsEntero.take).toBeUndefined();
    expect(argsPagina.skip).toBe(RANGO.skip);
    expect(argsPagina.take).toBe(RANGO.take);
  });

  it("cierres del día — histórico: el acceso total NO emite destinoZonaId, pero SÍ el tipo de bodega (R4)", async () => {
    // El lado feo de R4: el maestro ve TODA la central sin filtro de zona, pero `destinoTipo`
    // sigue estando. Sin él, su archivo traería además los cierres de todas las satélite.
    const entero = delegado();
    await repoCierresAdmin(entero).findHistoricoCompleto({
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });

    expect(entero.findMany.mock.calls[0]![0]!.where).toEqual({
      destinoTipo: "bodega_central",
      estado: { notIn: ["solicitado", "vencido"] },
    });
  });

  it("los dos conjuntos del admin cuestan UNA consulta, sin recorte y sin conteo de página (R15)", async () => {
    // Lo que hace de esta tanda una mejora medible: el archivo pasa de traer el alcance ENTERO
    // (cola + histórico) a traer solo su mitad. Si mañana alguien le añadiera un `count` «para el
    // total», el total del archivo saldría de otro sitio que sus filas.
    const casos: Array<[string, ReturnType<typeof delegado>, () => Promise<unknown>]> = [];

    const d1 = delegado();
    casos.push([
      "cierres del día — histórico",
      d1,
      () =>
        repoCierresAdmin(d1).findHistoricoCompleto({
          destinoTipo: "bodega_central",
          destinoZonaId: null,
        }),
    ]);

    const d2 = delegado();
    casos.push([
      "cierres del día — cola",
      d2,
      () =>
        repoCierresAdmin(d2).findColaCompleta({
          destinoTipo: "bodega_central",
          destinoZonaId: null,
        }),
    ]);

    expect(casos).toHaveLength(2); // los DOS listados de la tanda D

    for (const [nombre, d, ejecutar] of casos) {
      await ejecutar();
      expect(d.findMany, `${nombre}: una sola consulta`).toHaveBeenCalledTimes(1);
      expect(d.count, `${nombre}: el conjunto NO cuenta`).not.toHaveBeenCalled();
      const args = d.findMany.mock.calls[0]![0]!;
      expect(args.skip, `${nombre}: sin recorte`).toBeUndefined();
      expect(args.take, `${nombre}: sin recorte`).toBeUndefined();
    }
  });

  it("el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)", async () => {
    // Es la afirmación que justifica que este método exista. `findCierresByAlcance` —la lectura
    // que la pantalla releía— emite el MISMO alcance pero SIN corte por estado: devuelve la cola
    // y el histórico juntos. Si `findHistoricoCompleto` se hubiera implementado delegando en
    // ella, su `where` no llevaría `estado` y este caso lo diría.
    const compuesto = delegado();
    await repoCierresAdmin(compuesto).findCierresByAlcance({
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });

    const historico = delegado();
    await repoCierresAdmin(historico).findHistoricoCompleto({
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });

    type ArgsConWhere = Consulta & { where: Record<string, unknown> };
    const argsCompuesto = compuesto.findMany.mock.calls[0]![0]! as ArgsConWhere;
    const argsHistorico = historico.findMany.mock.calls[0]![0]! as ArgsConWhere;

    // El listado compuesto no corta por estado: por eso descargar una mitad traía las dos.
    expect(argsCompuesto.where).not.toHaveProperty("estado");
    expect(argsHistorico.where.estado).toEqual({ notIn: ["solicitado", "vencido"] });
    // Y el resto del `where` —el ALCANCE— es idéntico: lo único que el conjunto añade es el corte.
    expect(argsCompuesto.where).toEqual(
      Object.fromEntries(
        Object.entries(argsHistorico.where).filter(([clave]) => clave !== "estado"),
      ),
    );
    // Mismo orden en los dos: el archivo no cambia de criterio al dejar de releer el compuesto.
    expect(argsHistorico.orderBy).toEqual(compuesto.findMany.mock.calls[0]![0]!.orderBy);
  });
});
