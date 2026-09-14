import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenService } from "@/lib/services/OrdenService";
import { listarOrdenesSchema } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { sembrarBase, estatusId, type BaseSembrada, type TxDeTest } from "./_semilla-rollup";

// FICHA 423 — EL ORDEN NATURAL POR NUMERO DE REMISION, CONTRA POSTGRES REAL.
//
// POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST DE SERVICIO CON DOBLES. Lo que aqui se afirma es el
// `ORDER BY` que ejecuta el motor sobre una columna GENERADA con `COLLATE "C"`. Un repositorio
// en memoria «que hace lo mismo» solo demostraria que dos implementaciones mias coinciden, y en
// este repo esta medido CUATRO veces que una mutacion del `WHERE`/`ORDER BY` pasa VERDE con
// dobles (memoria: «Probar el WHERE donde vive»). Ni la clave generada ni la collation existen
// fuera de Postgres.
//
// EL ORDEN ESPERADO SE ESCRIBE COMO LITERAL, CON LOS VALORES REALES DE PRODUCCION, y nunca
// derivandolo de la expresion que lo produce (memoria: «Aserción contra su propia fuente»). Si
// el literal se calculase con la misma regla que la columna, el test estaria verde por
// construccion y no podria ponerse rojo nunca — que es exactamente el defecto que esta feature
// viene a arreglar, solo que en un test.
//
// NO HAY NINGUN `if (!datos) return;` EN ESTE ARCHIVO, a proposito: `sembrarBase` REVIENTA si la
// base local no tiene catalogos, en vez de dejar la suite verde sin haber comprobado nada
// (memoria: «Test de integración verde sin datos»).
//
// Todo corre dentro de una transaccion que SIEMPRE se revierte: la base de desarrollo la
// comparten varias sesiones y aqui no queda ni una fila. El corpus se acota a dos ventanas del
// año 2001, donde la base real no tiene nada, y el PRIMER caso comprueba ese acotamiento: si
// entrara una fila ajena, ninguna asercion de abajo afirmaria nada.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MAESTRO: Actor = { usuarioId: "m423", rol: "maestro" };

/* -------------------------------------------------------------------------- */
/* Las dos ventanas del corpus                                                 */
/* -------------------------------------------------------------------------- */

/** Ventana A — LAS CUATRO SERIES REALES. Marzo de 2001. */
const SERIES_DESDE = new Date(Date.UTC(2001, 2, 1));
const SERIES_HASTA = new Date(Date.UTC(2001, 3, 1));
const T_SERIES = new Date(Date.UTC(2001, 2, 10, 12, 0, 0));
/** Las mismas dos fechas como las escribe la barra de filtros (`YYYY-MM-DD`, calendario CR). */
const SERIES_DESDE_CR = "2001-03-01";
const SERIES_HASTA_CR = "2001-03-31";

/** Ventana B — EL EMPATE DE CLAVE. Junio de 2001. */
const EMPATE_DESDE = new Date(Date.UTC(2001, 5, 1));
const EMPATE_HASTA = new Date(Date.UTC(2001, 6, 1));
const T_EMPATE = new Date(Date.UTC(2001, 5, 10, 12, 0, 0));

/* -------------------------------------------------------------------------- */
/* Ventana A — las remisiones, y el orden que TIENEN QUE dar                   */
/* -------------------------------------------------------------------------- */

/**
 * Las remisiones del corpus, EN DESORDEN DELIBERADO (ni alfabetico ni natural): el orden en que
 * entran no debe poder colarse como el orden que sale. Son valores REALES de produccion —las
 * cuatro series medidas el 2026-09-14— e incluyen las que rompen el orden lexicografico.
 */
const REMISIONES_SERIES = [
  "NA-1069",
  "SC-050",
  "72912",
  "NA-107",
  "BS-00010",
  "NA-1863",
  "SC-008",
  "NA-1067",
  "73636",
  "BS-00001",
  "NA-1070",
  "NA-001",
] as const;

/**
 * EL CONTRATO DE R3 Y R4, ESCRITO A MANO. No se calcula: se lee.
 *
 * R4 — las series ascendentes van: primero las PURAMENTE NUMERICAS (`72912`…`73636`), luego
 * `BS-`, luego `NA-`, luego `SC-`. Sale de que la clave pone el prefijo alfanumerico delante y
 * la comparacion es byte a byte: `0…` (0x30) < `B` (0x42) < `N` (0x4E) < `S` (0x53).
 *
 * R3 — DENTRO de una serie manda el valor NUMERICO, no el texto. Las tres lineas que lo
 * demuestran y que hoy salen mal: `NA-107` va antes que `NA-1067`, `NA-1067` antes que
 * `NA-1069` y `NA-1069` antes que `NA-1070`. Con orden lexicografico, `NA-107` caeria entre
 * `NA-1069` y `NA-1070`.
 */
const ORDEN_ASCENDENTE_ESPERADO = [
  "72912",
  "73636",
  "BS-00001",
  "BS-00010",
  "NA-001",
  "NA-107",
  "NA-1067",
  "NA-1069",
  "NA-1070",
  "NA-1863",
  "SC-008",
  "SC-050",
] as const;

/** El sentido contrario, tambien LITERAL (R9). No es `[...].reverse()` de la constante de
 *  arriba a proposito: `desc` es una consulta DISTINTA —`prioridad DESC` NO se invierte— y
 *  derivar el esperado de la otra asercion seria dar por hecho justo lo que se mide. */
const ORDEN_DESCENDENTE_ESPERADO = [
  "SC-050",
  "SC-008",
  "NA-1863",
  "NA-1070",
  "NA-1069",
  "NA-1067",
  "NA-107",
  "NA-001",
  "BS-00010",
  "BS-00001",
  "73636",
  "72912",
] as const;

const TOTAL_SERIES = REMISIONES_SERIES.length; // 12
const PAGINA_SERIES = 5; // 12 ordenes -> 3 paginas, con dos cortes que cruzar
const PAGINAS_SERIES = Math.ceil(TOTAL_SERIES / PAGINA_SERIES);

/* -------------------------------------------------------------------------- */
/* Ventana B — el empate de clave                                              */
/* -------------------------------------------------------------------------- */

/**
 * 241 remisiones DISTINTAS que comparten EXACTAMENTE la misma clave de orden.
 *
 * COMO SE CONSIGUE, y por que no es un truco de laboratorio: la clave rellena el bloque final de
 * digitos a 18 con `lpad`, y `lpad` TRUNCA cuando la entrada es mas larga. Estas remisiones
 * llevan 21 digitos cuyos primeros 18 son identicos (`1` + 17 ceros), asi que las 241 producen
 * la misma clave `EMP100000000000000000`. Es la COLISION CONOCIDA Y ACEPTADA que el design
 * declara (§2.2): la clave no es una identidad, es una clave de ORDEN.
 *
 * PARA QUE SIRVE: es el peor caso de R8. Con paginas de 25, un empate de 241 filas cruza NUEVE
 * cortes de pagina. Sin el desempate por `id` que añade `ordenTotal` (ficha 352), el orden
 * dentro del empate lo decide el plan, y `LIMIT 25 OFFSET 0` no se resuelve con el mismo plan
 * que `LIMIT 25 OFFSET 100`: una orden sale dos veces y otra no sale nunca.
 *
 * El tamaño esta copiado del corpus de la ficha 352, que lo MIDIO: con 25 filas y paginas de 10
 * el defecto NO aparece (Postgres ordena el conjunto entero y devuelve lo mismo en las dos
 * paginas). Si alguien encoge esto, el caso deja de demostrar lo que dice demostrar.
 */
const TOTAL_EMPATE = 241;
const PAGINA_EMPATE = 25;
const PAGINAS_EMPATE = Math.ceil(TOTAL_EMPATE / PAGINA_EMPATE);

function remisionEmpatada(i: number): string {
  return `EMP-1${"0".repeat(17)}${String(i).padStart(3, "0")}`;
}

/* -------------------------------------------------------------------------- */

interface SembradaSeries {
  id: string;
  numRemision: string;
}

async function sembrarSeries(tx: TxDeTest, base: BaseSembrada): Promise<SembradaSeries[]> {
  const filas = REMISIONES_SERIES.map((numRemision) => ({ id: randomUUID(), numRemision }));
  await tx.orden.createMany({
    data: filas.map((f) => ({
      id: f.id,
      numRemision: f.numRemision,
      destinatario: "Persona De Prueba",
      telefonoDest: "80000000",
      producto: "caja",
      estatusId: estatusId(base, "en_bodega_central"),
      tiendaId: base.tienda1,
      zonaId: base.zonaA,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      prioridad: false,
      createdAt: T_SERIES,
    })),
  });
  return filas;
}

/**
 * Las 241 del empate. Los `id` se insertan del MAYOR al MENOR: asi «el orden en que entraron» es
 * el INVERSO de «id ascendente», y la falta de desempate se vuelve observable en vez de depender
 * de la suerte.
 */
async function sembrarEmpate(tx: TxDeTest, base: BaseSembrada): Promise<string[]> {
  const ids = Array.from({ length: TOTAL_EMPATE }, () => randomUUID()).sort();
  await tx.orden.createMany({
    data: [...ids].reverse().map((id, i) => ({
      id,
      numRemision: remisionEmpatada(i),
      destinatario: "Persona De Prueba",
      telefonoDest: "80000000",
      producto: "caja",
      estatusId: estatusId(base, "en_bodega_central"),
      tiendaId: base.tienda1,
      zonaId: base.zonaA,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      prioridad: false,
      createdAt: T_EMPATE,
    })),
  });
  return ids;
}

interface Corpus {
  repo: OrdenRepository;
  service: OrdenService;
  tx: TxDeTest;
  series: SembradaSeries[];
  empatadas: string[];
}

describeSiHayBase("el orden por numero de remision es NATURAL y por serie (ficha 423)", () => {
  let prisma: PrismaClient;
  let conCorpus: <T>(fn: (ctx: Corpus) => Promise<T>) => Promise<T>;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // Primera sentencia de la transaccion: serializa contra los otros archivos que escriben
        // en `public.usuario`/`public.orden` (si no, deadlock 40P01).
        await serializarEscriturasReales(tx);
        const base = await sembrarBase(tx);
        const series = await sembrarSeries(tx, base);
        const empatadas = await sembrarEmpate(tx, base);
        const repo = new OrdenRepository(tx as unknown as PrismaClient);
        return fn({
          repo,
          service: new OrdenService(repo, fakeIntentosEnLote()),
          tx,
          series,
          empatadas,
        });
      });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una pagina de la ventana de SERIES, ordenada por remision. */
  async function paginaSeries(
    repo: OrdenRepository,
    n: number,
    sortDir: "asc" | "desc",
  ): Promise<{ remisiones: string[]; total: number }> {
    const { items, total } = await repo.list({
      where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
      sortBy: "num_remision",
      sortDir,
      skip: (n - 1) * PAGINA_SERIES,
      take: PAGINA_SERIES,
    });
    return { remisiones: items.map((o) => o.numRemision), total };
  }

  /** Las 3 paginas de la ventana de series, concatenadas como las recorreria el usuario. */
  async function recorrerSeries(
    repo: OrdenRepository,
    sortDir: "asc" | "desc",
  ): Promise<string[]> {
    const remisiones: string[] = [];
    for (let n = 1; n <= PAGINAS_SERIES; n += 1) {
      remisiones.push(...(await paginaSeries(repo, n, sortDir)).remisiones);
    }
    return remisiones;
  }

  /** Las 10 paginas de la ventana del EMPATE, por ids. */
  async function recorrerEmpate(repo: OrdenRepository, sortDir: "asc" | "desc"): Promise<string[]> {
    const ids: string[] = [];
    for (let n = 1; n <= PAGINAS_EMPATE; n += 1) {
      const { items } = await repo.list({
        where: { createdAt: { gte: EMPATE_DESDE, lt: EMPATE_HASTA } },
        sortBy: "num_remision",
        sortDir,
        skip: (n - 1) * PAGINA_EMPATE,
        take: PAGINA_EMPATE,
      });
      ids.push(...items.map((o) => o.id));
    }
    return ids;
  }

  it("el corpus queda aislado: cada ventana del 2001 solo contiene lo sembrado", async () => {
    // Contrapeso de TODO el archivo. Si esto fallara, las aserciones de abajo estarian mirando
    // filas de la base de desarrollo y no afirmarian nada.
    const medido = await conCorpus(async ({ repo, series, empatadas }) => ({
      totalSeries: (await paginaSeries(repo, 1, "asc")).total,
      totalEmpate: (
        await repo.list({
          where: { createdAt: { gte: EMPATE_DESDE, lt: EMPATE_HASTA } },
          sortBy: "num_remision",
          sortDir: "asc",
          skip: 0,
          take: 1,
        })
      ).total,
      sembradasSeries: series.length,
      sembradasEmpate: empatadas.length,
    }));
    expect(medido.sembradasSeries).toBe(TOTAL_SERIES);
    expect(medido.sembradasEmpate).toBe(TOTAL_EMPATE);
    expect(medido.totalSeries).toBe(TOTAL_SERIES);
    expect(medido.totalEmpate).toBe(TOTAL_EMPATE);
  });

  it("R3+R4 — ascendente: numericas, BS-, NA-, SC-, y `NA-107` ANTES que `NA-1069`", async () => {
    const remisiones = await conCorpus(async ({ repo }) => {
      const { items } = await repo.list({
        where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
        sortBy: "num_remision",
        sortDir: "asc",
        skip: 0,
        take: TOTAL_SERIES,
      });
      return items.map((o) => o.numRemision);
    });

    // El literal, palabra por palabra. Aqui es donde se rompe si alguien devuelve `SORT_COLUMN`
    // a la columna cruda: el orden lexicografico daria `NA-1067, NA-1069, NA-107, NA-1070`.
    expect(remisiones).toEqual([...ORDEN_ASCENDENTE_ESPERADO]);

    // Y las tres comparaciones de R3, dichas una a una para que el rojo nombre el defecto.
    expect(remisiones.indexOf("NA-107")).toBeLessThan(remisiones.indexOf("NA-1067"));
    expect(remisiones.indexOf("NA-1067")).toBeLessThan(remisiones.indexOf("NA-1069"));
    expect(remisiones.indexOf("NA-1069")).toBeLessThan(remisiones.indexOf("NA-1070"));
  });

  it("R9 — descendente devuelve el sentido opuesto exacto, con el mismo total", async () => {
    const { asc, desc, totalAsc, totalDesc } = await conCorpus(async ({ repo }) => {
      const a = await repo.list({
        where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
        sortBy: "num_remision",
        sortDir: "asc",
        skip: 0,
        take: TOTAL_SERIES,
      });
      const d = await repo.list({
        where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
        sortBy: "num_remision",
        sortDir: "desc",
        skip: 0,
        take: TOTAL_SERIES,
      });
      return {
        asc: a.items.map((o) => o.numRemision),
        desc: d.items.map((o) => o.numRemision),
        totalAsc: a.total,
        totalDesc: d.total,
      };
    });

    expect(desc).toEqual([...ORDEN_DESCENDENTE_ESPERADO]);
    expect(totalDesc).toBe(totalAsc);
    // La primera del ascendente es la ultima del descendente, y al reves (R9, dicho tal cual).
    expect(desc[0]).toBe(asc[asc.length - 1]);
    expect(desc[desc.length - 1]).toBe(asc[0]);
  });

  it("R2 — pagina 1 trae las MAS BAJAS del conjunto, no las 5 primeras reordenadas", async () => {
    // El fallo que esto caza es el de `design §5.1`: ordenar en el cliente las 25 filas de la
    // pagina PARECE correcto —el usuario ve `72912` arriba y cree que es la mas baja de todas—.
    // Aqui las paginas se piden por separado y se exige que, concatenadas, den el orden GLOBAL.
    const { pagina1, pagina2, pagina3, recorrido } = await conCorpus(async ({ repo }) => ({
      pagina1: (await paginaSeries(repo, 1, "asc")).remisiones,
      pagina2: (await paginaSeries(repo, 2, "asc")).remisiones,
      pagina3: (await paginaSeries(repo, 3, "asc")).remisiones,
      recorrido: await recorrerSeries(repo, "asc"),
    }));

    expect(pagina1).toEqual(["72912", "73636", "BS-00001", "BS-00010", "NA-001"]);
    expect(pagina2).toEqual(["NA-107", "NA-1067", "NA-1069", "NA-1070", "NA-1863"]);
    expect(pagina3).toEqual(["SC-008", "SC-050"]);
    expect(recorrido).toEqual([...ORDEN_ASCENDENTE_ESPERADO]);
  });

  it("R7 — `prioridad` sigue mandando por delante del orden por remision", async () => {
    // Feature 101/R6, INTACTA. Se prueba con `SC-050`, que por remision es la ULTIMA de todas en
    // ascendente: marcada como prioritaria tiene que flotar a la PRIMERA fila de la pagina 1.
    const { primeraFila, restoEnOrden } = await conCorpus(async ({ repo, tx }) => {
      await tx.orden.updateMany({
        where: { numRemision: "SC-050", createdAt: T_SERIES },
        data: { prioridad: true },
      });
      const recorrido = await recorrerSeries(repo, "asc");
      return { primeraFila: recorrido[0], restoEnOrden: recorrido.slice(1) };
    });

    expect(primeraFila).toBe("SC-050");
    // Y el resto conserva su orden natural: la prioridad flota UNA fila, no reordena el bloque.
    expect(restoEnOrden).toEqual(ORDEN_ASCENDENTE_ESPERADO.filter((r) => r !== "SC-050"));
  });

  it("R8 — con 241 claves EMPATADAS, paginar no repite ni pierde una sola fila (asc)", async () => {
    const { recorridas, esperados } = await conCorpus(async ({ repo, empatadas }) => ({
      recorridas: await recorrerEmpate(repo, "asc"),
      esperados: empatadas,
    }));

    expect(recorridas).toHaveLength(TOTAL_EMPATE); // ninguna pagina vino corta
    expect(new Set(recorridas).size).toBe(TOTAL_EMPATE); // NINGUNA fila sale dos veces
    expect([...recorridas].sort()).toEqual([...esperados].sort()); // NINGUNA se pierde
  });

  it("R8 — lo mismo en descendente, y la misma pagina pedida dos veces es identica", async () => {
    const { recorridas, esperados, primera, segunda } = await conCorpus(
      async ({ repo, empatadas }) => {
        const pagina5 = async () =>
          (
            await repo.list({
              where: { createdAt: { gte: EMPATE_DESDE, lt: EMPATE_HASTA } },
              sortBy: "num_remision",
              sortDir: "desc",
              skip: 4 * PAGINA_EMPATE,
              take: PAGINA_EMPATE,
            })
          ).items.map((o) => o.id);
        return {
          recorridas: await recorrerEmpate(repo, "desc"),
          esperados: empatadas,
          primera: await pagina5(),
          segunda: await pagina5(),
        };
      },
    );

    expect(recorridas).toHaveLength(TOTAL_EMPATE);
    expect(new Set(recorridas).size).toBe(TOTAL_EMPATE);
    expect([...recorridas].sort()).toEqual([...esperados].sort());
    expect(primera).toHaveLength(PAGINA_EMPATE);
    expect(segunda).toEqual(primera);
  });

  it("R13 — la DESCARGA sale exactamente en el mismo orden que la pantalla", async () => {
    // `listarCompleto` es el dataset sin paginar de la descarga (feature 151). Hereda
    // `sortBy`/`sortDir` por el `omit({page,pageSize})` del schema; esto lo COMPRUEBA en vez de
    // deducirlo. Si divergieran, la fila N del Excel no seria la fila N de la pantalla.
    const { archivo, pantalla } = await conCorpus(async ({ repo, service }) => {
      const r = await service.listarCompleto(
        listarOrdenesSchema.omit({ page: true, pageSize: true }).parse({
          sortBy: "num_remision",
          sortDir: "asc",
          filter: { created_desde: SERIES_DESDE_CR, created_hasta: SERIES_HASTA_CR },
        }),
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error(`la descarga respondio ${r.status}`);
      return {
        archivo: r.items.map((o) => o.numRemision),
        pantalla: await recorrerSeries(repo, "asc"),
      };
    });

    expect(archivo).toHaveLength(TOTAL_SERIES);
    expect(archivo).toEqual([...ORDEN_ASCENDENTE_ESPERADO]);
    expect(archivo).toEqual(pantalla);
  });

  it("R2 — por el SERVICIO, el listado paginado da el mismo orden que el repositorio", async () => {
    // El camino REAL de la pantalla: Server Action -> `OrdenService.listar` -> repositorio, con
    // el filtro de fechas de la barra (`created_desde`/`created_hasta`) acotando al corpus.
    const remisiones = await conCorpus(async ({ service }) => {
      const salida: string[] = [];
      for (let page = 1; page <= PAGINAS_SERIES; page += 1) {
        const r = await service.listar(
          listarOrdenesSchema.parse({
            page,
            pageSize: PAGINA_SERIES,
            sortBy: "num_remision",
            sortDir: "asc",
            filter: { created_desde: SERIES_DESDE_CR, created_hasta: SERIES_HASTA_CR },
          }),
          MAESTRO,
        );
        if (r.status !== "ok") throw new Error(`el listado respondio ${r.status}`);
        expect(r.total).toBe(TOTAL_SERIES);
        salida.push(...r.items.map((o) => o.numRemision));
      }
      return salida;
    });

    expect(remisiones).toEqual([...ORDEN_ASCENDENTE_ESPERADO]);
  });

  it("R16/T2.4 — el `omit` global NO impide el `orderBy`, y la clave NO viaja en el payload", async () => {
    // LA MEDIDA QUE PEDIA T2.4, y por eso vive aqui y no en un comentario. El comentario de
    // `lib/db/prisma-client.ts` afirmaba que el `omit` no afecta al `where`; sobre el `orderBy`
    // no decia NADA — y esta columna existe justo para eso. Si el `omit` lo rompiera, el plan B
    // (design §2.6) era sacarla del `omit` y cubrir R16 con aserciones sobre el DTO.
    const { remisiones, clavesEnPayload, clavesEnDto } = await conCorpus(async ({ repo, tx }) => {
      // (a) Prisma CRUDO, con el mismo cliente `omit`-ado que usa produccion.
      const filas = await tx.orden.findMany({
        where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
        orderBy: [{ claveRemision: "asc" }, { id: "asc" }],
      });
      // (b) el DTO que sale por la Server Action.
      const { items } = await repo.list({
        where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
        sortBy: "num_remision",
        sortDir: "asc",
        skip: 0,
        take: TOTAL_SERIES,
      });
      return {
        remisiones: filas.map((f) => f.numRemision),
        clavesEnPayload: filas.filter((f) => "claveRemision" in f).length,
        clavesEnDto: items.filter((o) => "claveRemision" in o).length,
      };
    });

    // ORDENA: el `omit` recorta la PROYECCION, no la clausula de orden.
    expect(remisiones).toEqual([...ORDEN_ASCENDENTE_ESPERADO]);
    // Y NO VIAJA: ni en la fila cruda de Prisma ni en el DTO del listado (R16).
    expect(clavesEnPayload).toBe(0);
    expect(clavesEnDto).toBe(0);
  });

  it("la clave que Postgres calculo es la del design, y el indice PARCIAL existe", async () => {
    // La tabla de `design §2.1`, leida de la base por SQL crudo (el cliente la omite a
    // proposito). Sin esto, el archivo solo afirmaria el ORDEN; esto afirma el VALOR, que es lo
    // que hace el orden reproducible en cualquier entorno (R6).
    const { claves, indice } = await conCorpus(async ({ tx, series }) => {
      // Se acota por los ids SEMBRADOS, no por un rango de fechas: el corpus es el unico
      // universo posible y el caso no depende de como el adaptador serialice una fecha.
      const ids = series
        .filter((f) => ["72912", "BS-00001", "NA-107", "NA-1069", "SC-050"].includes(f.numRemision))
        .map((f) => f.id);
      expect(ids).toHaveLength(5);
      const filas = await tx.$queryRawUnsafe<{ num_remision: string; clave_remision: string }[]>(
        `SELECT num_remision, clave_remision FROM orden WHERE id = ANY($1::text[])
          ORDER BY num_remision`,
        ids,
      );
      const idx = await tx.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'orden_prioridad_clave_remision_idx'`,
      );
      return {
        claves: Object.fromEntries(filas.map((f) => [f.num_remision, f.clave_remision])),
        indice: idx[0]?.indexdef,
      };
    });

    expect(claves).toEqual({
      "72912": "000000000000072912",
      "BS-00001": "BS000000000000000001",
      "NA-107": "NA000000000000000107",
      "NA-1069": "NA000000000000001069",
      "SC-050": "SC000000000000000050",
    });
    expect(indice).toContain("WHERE (deleted_at IS NULL)");
  });

  it("R15 — el orden por FECHA no cambio: sigue siendo el default y sigue mandando", async () => {
    // Contraprueba del alcance. `SORT_COLUMN` cambio SOLO la traduccion de `num_remision`; si
    // alguien tocase la de `created_at`, esto se pone rojo. El default del schema tambien se
    // afirma aqui, contra su propia fuente independiente (`listarOrdenesSchema`).
    const entrada = listarOrdenesSchema.parse({});
    expect(entrada.sortBy).toBe("created_at");
    expect(entrada.sortDir).toBe("desc");

    const { porFecha, porRemision } = await conCorpus(async ({ repo }) => {
      const args = {
        where: { createdAt: { gte: SERIES_DESDE, lt: SERIES_HASTA } },
        sortDir: "asc" as const,
        skip: 0,
        take: TOTAL_SERIES,
      };
      const f = await repo.list({ ...args, sortBy: "created_at" });
      const r = await repo.list({ ...args, sortBy: "num_remision" });
      return {
        porFecha: f.items.map((o) => o.numRemision),
        porRemision: r.items.map((o) => o.numRemision),
      };
    });

    // Las 12 comparten `created_at` al milisegundo, asi que por fecha el orden lo fija el
    // desempate por `id` (ficha 352) — un orden que NO es el de la remision.
    expect(porFecha).toHaveLength(TOTAL_SERIES);
    expect(porRemision).toEqual([...ORDEN_ASCENDENTE_ESPERADO]);
    expect(porFecha).not.toEqual(porRemision);
  });
});
