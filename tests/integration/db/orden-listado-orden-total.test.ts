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

// FICHA 352 — EL ORDEN DEL LISTADO DE `/ordenes` ES TOTAL Y ESTABLE, contra Postgres real.
//
// Por que contra la base y no con un doble: lo que se prueba aqui es el `ORDER BY` que ejecuta
// el motor. Un repositorio en memoria «que hace lo mismo» solo demostraria que dos
// implementaciones mias coinciden — y en este repo esta medido cuatro veces que una mutacion
// del `WHERE`/`ORDER BY` pasa VERDE con dobles.
//
// EL CASO QUE JUSTIFICA EL ARCHIVO. Las ordenes nacen por CARGA MASIVA: un `createMany` dentro
// de una transaccion, con `created_at` tomando el `CURRENT_TIMESTAMP` de esa transaccion, asi
// que TODO EL LOTE comparte instante al milisegundo. Medido en la base local el 2026-09-01:
// sobre 67 ordenes hay un grupo de 23 y otro de 22 filas empatadas. Ordenar solo por
// `created_at` deja el orden dentro del empate a merced del plan, y `LIMIT 25 OFFSET 0` no se
// resuelve con el mismo plan que `LIMIT 25 OFFSET 100` (Postgres acota el «top-N» al tamaño
// que le piden, y con un limite distinto el monticulo resuelve los empates distinto).
//
// EL TAMAÑO DEL CORPUS ESTA ELEGIDO, NO ES ARBITRARIO, y esto se midio. Con 25 filas y
// paginas de 10, Postgres ordena el conjunto entero y devuelve el mismo orden en las dos
// paginas: quitando el desempate el recorrido seguia saliendo VERDE — el test no valia. Con
// 241 filas en dos empates de 120 y paginas de 25 el defecto aparece: sin desempate, el
// recorrido de las 10 paginas devolvio 200 filas distintas de 241 en `desc` (41 perdidas y
// otras tantas repetidas) y 238 de 241 en `asc`. Si alguien encoge este corpus, el archivo
// deja de demostrar lo que dice demostrar.
//
// Y LA MITAD DEL LOTE A NO TIENE GUIA, tampoco por casualidad: es el estado real de una orden
// `pendiente`, y es lo que sostiene la afirmacion de `OrdenRepository` de que desempatar por
// `num_guia` —unica, pero NULLABLE— no arreglaria nada. Medido igual: con `num_guia` de
// desempate el recorrido `asc` devolvio 230 filas distintas de 241.
//
// Todo corre dentro de una transaccion que SIEMPRE se revierte: la base de desarrollo la
// comparten varias sesiones y aqui no queda ni una fila. El corpus se acota a una ventana del
// año 2001, donde la base real no tiene nada, y el PRIMER caso comprueba ese acotamiento: si
// entrara una fila ajena, ningun conteo de abajo afirmaria nada.
//
// NO hay ningun `if (!datos) return;` en este archivo, a proposito: `sembrarBase` REVIENTA si
// la base local no tiene catalogos, en vez de dejar la suite verde sin comprobar nada.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MAESTRO: Actor = { usuarioId: "m352", rol: "maestro" };

/** La ventana del corpus: el año 2001, donde no hay ningun dato real de la aplicacion. */
const DESDE = new Date(Date.UTC(2001, 0, 1));
const HASTA = new Date(Date.UTC(2001, 11, 31));
/** Las mismas dos fechas como las escribe la barra de filtros (`YYYY-MM-DD`, calendario CR). */
const DESDE_CR = "2001-01-01";
const HASTA_CR = "2001-12-30";

const T_A = new Date(Date.UTC(2001, 2, 10, 12, 0, 0)); // lote 1: 120 ordenes EMPATADAS
const T_B = new Date(Date.UTC(2001, 2, 11, 12, 0, 0)); // lote 2: 120 ordenes EMPATADAS
const T_C = new Date(Date.UTC(2001, 2, 12, 12, 0, 0)); // 1 orden suelta, la mas reciente

const TAM_LOTE = 120;
const TOTAL = TAM_LOTE * 2 + 1; // 241
const PAGINA = 25; // el `DEFAULT_PAGE_SIZE` del listado
const PAGINAS = Math.ceil(TOTAL / PAGINA); // 10

interface Sembrada {
  id: string;
  createdAt: Date;
  /** `null` = orden todavia SIN guia (estado `pendiente`). Existen en produccion, y son las
   *  que demuestran que un desempate por `num_guia` —unica pero NULLABLE— no cerraria nada. */
  numGuia: number | null;
  lote: "A" | "B" | "C";
}

/**
 * Siembra un LOTE de ordenes que comparten `created_at`, como lo hace una carga masiva.
 *
 * Los `id` son explicitos y las filas se insertan del id MAYOR al MENOR: asi «el orden en que
 * entraron» es el INVERSO de «id ascendente», y la falta de desempate se vuelve observable en
 * vez de depender de la suerte.
 *
 * `sinGuia` deja a una de cada dos filas con `num_guia = NULL`, que es el estado real de una
 * orden `pendiente`. Sirve para una afirmacion concreta del codigo: que desempatar por
 * `num_guia` —unica, pero NULLABLE— NO arregla nada, porque todas las que no tienen guia
 * siguen empatadas entre si.
 */
async function sembrarLote(
  tx: TxDeTest,
  base: BaseSembrada,
  lote: "A" | "B" | "C",
  createdAt: Date,
  cuantas: number,
  primeraGuia: number,
  sinGuia = false,
): Promise<Sembrada[]> {
  const ids = Array.from({ length: cuantas }, () => randomUUID()).sort();
  const filas: Sembrada[] = [...ids].reverse().map((id, i) => ({
    id,
    createdAt,
    numGuia: sinGuia && i % 2 === 1 ? null : primeraGuia + i,
    lote,
  }));

  await tx.orden.createMany({
    data: filas.map((f) => ({
      id: f.id,
      numGuia: f.numGuia,
      numRemision: `352-${base.sufijo}-${lote}-${f.id.slice(0, 8)}`,
      destinatario: "Persona De Prueba",
      telefonoDest: "80000000",
      producto: "caja",
      estatusId: estatusId(base, "en_bodega_central"),
      tiendaId: base.tienda1,
      zonaId: base.zonaA,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      prioridad: false,
      createdAt: f.createdAt,
    })),
  });
  return filas;
}

interface Corpus {
  repo: OrdenRepository;
  service: OrdenService;
  tx: TxDeTest;
  filas: Sembrada[];
}

describeSiHayBase("el orden del listado de /ordenes es total y estable (ficha 352)", () => {
  let prisma: PrismaClient;

  /** Ejecuta `fn` sobre el corpus recien sembrado y revierte. */
  let conCorpus: <T>(fn: (ctx: Corpus) => Promise<T>) => Promise<T>;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // Primera sentencia de la transaccion: serializa contra los otros archivos que
        // escriben en `public.usuario`/`public.orden` (si no, deadlock 40P01).
        await serializarEscriturasReales(tx);
        const base = await sembrarBase(tx);
        const filas: Sembrada[] = [
          // El lote A lleva la mitad de sus ordenes SIN guia, como las `pendiente` reales.
          ...(await sembrarLote(tx, base, "A", T_A, TAM_LOTE, 3_520_000, true)),
          ...(await sembrarLote(tx, base, "B", T_B, TAM_LOTE, 3_530_000)),
          ...(await sembrarLote(tx, base, "C", T_C, 1, 3_540_000)),
        ];
        const repo = new OrdenRepository(tx as unknown as PrismaClient);
        return fn({ repo, service: new OrdenService(repo, fakeIntentosEnLote()), tx, filas });
      });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una pagina del listado, acotada al corpus. Devuelve los ids EN EL ORDEN que dio la base. */
  async function pagina(
    repo: OrdenRepository,
    n: number,
    sortDir: "asc" | "desc" = "desc",
    sortBy: "created_at" | "num_guia" = "created_at",
  ): Promise<{ ids: string[]; total: number }> {
    const { items, total } = await repo.list({
      where: { createdAt: { gte: DESDE, lt: HASTA } },
      sortBy,
      sortDir,
      skip: (n - 1) * PAGINA,
      take: PAGINA,
    });
    return { ids: items.map((o) => o.id), total };
  }

  /** Las 10 paginas del corpus, concatenadas como las recorreria el usuario. */
  async function recorrerPaginas(
    repo: OrdenRepository,
    sortDir: "asc" | "desc" = "desc",
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let n = 1; n <= PAGINAS; n += 1) ids.push(...(await pagina(repo, n, sortDir)).ids);
    return ids;
  }

  it("el corpus queda aislado: la ventana del 2001 solo contiene las 241 filas sembradas", async () => {
    // Contrapeso de todo el archivo. Si esto fallara, los conteos de abajo estarian contando
    // filas de la base de desarrollo y no afirmarian nada.
    const { total, sembradas } = await conCorpus(async ({ repo, filas }) => ({
      total: (await pagina(repo, 1)).total,
      sembradas: filas.length,
    }));
    expect(sembradas).toBe(TOTAL);
    expect(total).toBe(TOTAL);
  });

  it("con fechas EMPATADAS, paginar no repite ni pierde una sola fila (desc)", async () => {
    // ÉSTE es el caso que motiva la ficha: dos lotes de 120 ordenes con el MISMO `created_at`
    // y paginas de 25, asi que los dos empates cruzan varios cortes de pagina.
    const { recorridas, esperados } = await conCorpus(async ({ repo, filas }) => ({
      recorridas: await recorrerPaginas(repo, "desc"),
      esperados: filas.map((f) => f.id),
    }));

    expect(recorridas).toHaveLength(TOTAL); // ninguna pagina vino corta
    expect(new Set(recorridas).size).toBe(TOTAL); // NINGUNA fila sale dos veces
    expect([...recorridas].sort()).toEqual([...esperados].sort()); // NINGUNA fila se pierde
  });

  it("con fechas EMPATADAS, paginar no repite ni pierde una sola fila (asc)", async () => {
    const { recorridas, esperados } = await conCorpus(async ({ repo, filas }) => ({
      recorridas: await recorrerPaginas(repo, "asc"),
      esperados: filas.map((f) => f.id),
    }));

    expect(recorridas).toHaveLength(TOTAL);
    expect(new Set(recorridas).size).toBe(TOTAL);
    expect([...recorridas].sort()).toEqual([...esperados].sort());
  });

  it("dentro de un empate de fecha, el orden lo fija el desempate por id (no el de insercion)", async () => {
    // La forma DIRECTA de ver el desempate. Las filas de cada lote se sembraron del id mayor al
    // menor, asi que «el orden en que entraron» es el inverso de «id ascendente»: sin desempate
    // en el `ORDER BY`, esto devuelve el primero.
    const { recorridas, filas } = await conCorpus(async ({ repo, filas }) => ({
      recorridas: await recorrerPaginas(repo, "desc"),
      filas,
    }));

    for (const lote of ["A", "B"] as const) {
      const delLote = new Set(filas.filter((f) => f.lote === lote).map((f) => f.id));
      expect(delLote.size).toBe(TAM_LOTE);
      const comoSalieron = recorridas.filter((id) => delLote.has(id));
      expect(comoSalieron, `empate del lote ${lote}`).toEqual([...delLote].sort());
    }
  });

  it("el orden por defecto NO cambia: de la mas reciente a la mas antigua", async () => {
    // Pedido humano del 2026-08-19, vigente. `listarOrdenesSchema` sin argumentos tiene que
    // seguir dando `created_at` descendente.
    const entrada = listarOrdenesSchema.parse({ pageSize: PAGINA });
    expect(entrada.sortBy).toBe("created_at");
    expect(entrada.sortDir).toBe("desc");

    const fechas = await conCorpus(async ({ repo }) => {
      const { items } = await repo.list({
        where: { createdAt: { gte: DESDE, lt: HASTA } },
        sortBy: entrada.sortBy,
        sortDir: entrada.sortDir,
        skip: 0,
        take: TOTAL,
      });
      return items.map((o) => o.createdAt.getTime());
    });

    expect(fechas).toHaveLength(TOTAL);
    expect(fechas[0]).toBe(T_C.getTime()); // la suelta, que es la mas reciente
    expect(fechas.at(-1)).toBe(T_A.getTime()); // el lote mas antiguo, al final
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas); // no creciente en TODA la lista
  });

  it("`asc` invierte de verdad el sentido: la mas antigua primero", async () => {
    const fechas = await conCorpus(async ({ repo }) => {
      const { items } = await repo.list({
        where: { createdAt: { gte: DESDE, lt: HASTA } },
        sortBy: "created_at",
        sortDir: "asc",
        skip: 0,
        take: TOTAL,
      });
      return items.map((o) => o.createdAt.getTime());
    });

    expect(fechas).toHaveLength(TOTAL);
    expect(fechas[0]).toBe(T_A.getTime());
    expect(fechas.at(-1)).toBe(T_C.getTime());
    expect([...fechas].sort((a, b) => a - b)).toEqual(fechas);
  });

  it("la misma pagina pedida dos veces devuelve exactamente los mismos ids", async () => {
    // Estabilidad. Sin desempate, dos lecturas de la MISMA pagina pueden diferir dentro del
    // empate; con el, son identicas.
    const { primera, segunda } = await conCorpus(async ({ repo }) => ({
      primera: (await pagina(repo, 5)).ids,
      segunda: (await pagina(repo, 5)).ids,
    }));
    expect(primera).toHaveLength(PAGINA);
    expect(segunda).toEqual(primera);
  });

  it("`prioridad` sigue mandando por delante del orden elegido", async () => {
    // Feature 101/R6, INTACTA: una orden prioritaria flota a la primera pagina aunque su fecha
    // la mande al final. Se comprueba con la MAS ANTIGUA de todas, que en `desc` seria la
    // ultima fila de la ultima pagina.
    const { primera, esperada } = await conCorpus(async ({ repo, tx, filas }) => {
      const laMasAntigua = filas
        .filter((f) => f.lote === "A")
        .map((f) => f.id)
        .sort()[0];
      await tx.orden.update({ where: { id: laMasAntigua }, data: { prioridad: true } });
      return { primera: (await pagina(repo, 1)).ids[0], esperada: laMasAntigua };
    });
    expect(primera).toBe(esperada);
  });

  it("`sortBy` llega hasta la consulta: por num_guia el orden es OTRO", async () => {
    // Contraprueba de que la clave publica no es decorativa. `num_guia` crece con el orden de
    // insercion dentro de cada lote, que es el INVERSO del de id.
    const { porGuia, porFecha } = await conCorpus(async ({ repo }) => ({
      porGuia: (await pagina(repo, 1, "asc", "num_guia")).ids,
      porFecha: (await pagina(repo, 1, "asc", "created_at")).ids,
    }));
    expect(porGuia).toHaveLength(PAGINA);
    expect(porGuia).not.toEqual(porFecha);
  });

  it("la DESCARGA sale exactamente en el mismo orden que la pantalla", async () => {
    // `listarCompleto` es el dataset sin paginar de la descarga (feature 151). Comparte
    // `repo.list` con el listado, asi que hereda el desempate; esto lo COMPRUEBA en vez de
    // deducirlo. Si divergieran, la fila 30 del Excel no seria la fila 30 de la pantalla.
    const { archivo, pantalla } = await conCorpus(async ({ repo, service }) => {
      const r = await service.listarCompleto(
        listarOrdenesSchema
          .omit({ page: true, pageSize: true })
          .parse({ filter: { created_desde: DESDE_CR, created_hasta: HASTA_CR } }),
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error(`la descarga respondio ${r.status}`);
      return { archivo: r.items.map((o) => o.id), pantalla: await recorrerPaginas(repo, "desc") };
    });

    expect(archivo).toHaveLength(TOTAL);
    expect(archivo).toEqual(pantalla);
  });

  it("el listado por el SERVICIO recorre las paginas sin repetir ni perder filas", async () => {
    // El mismo invariante por el camino que usa la pantalla: Server Action ->
    // `OrdenService.listar` -> repositorio, con el filtro de fechas REAL de la barra
    // (`created_desde`/`created_hasta`) acotando al corpus.
    const { recorridas, esperados } = await conCorpus(async ({ service, filas }) => {
      const ids: string[] = [];
      for (let page = 1; page <= PAGINAS; page += 1) {
        const r = await service.listar(
          listarOrdenesSchema.parse({
            page,
            pageSize: PAGINA,
            filter: { created_desde: DESDE_CR, created_hasta: HASTA_CR },
          }),
          MAESTRO,
        );
        if (r.status !== "ok") throw new Error(`el listado respondio ${r.status}`);
        expect(r.total).toBe(TOTAL);
        ids.push(...r.items.map((o) => o.id));
      }
      return { recorridas: ids, esperados: filas.map((f) => f.id) };
    });

    expect(recorridas).toHaveLength(TOTAL);
    expect(new Set(recorridas).size).toBe(TOTAL);
    expect([...recorridas].sort()).toEqual([...esperados].sort());
  });
});
