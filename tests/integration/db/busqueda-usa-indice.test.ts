import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  fksDeOrden,
  parametrosDe,
  type EventoSqlDeTest,
  type FksDeOrden,
} from "./_postgres-real";

/**
 * Feature 169 / T4.2 — R31: la busqueda se resuelve POR INDICE, no recorriendo `orden`.
 *
 * QUE PRUEBA ESTE ARCHIVO Y QUE NO. Esto importa mas que el codigo de abajo.
 *
 * SI prueba, de forma DETERMINISTA, que el indice trigram es APLICABLE a la consulta EXACTA
 * que emite el repositorio, y que resuelve tanto la pagina como el conteo. Ese es el fallo
 * silencioso que arruina la feature: un opclass mal cualificado, un `mode: "insensitive"`
 * colado (que cambia el operador `~~` por `~~*`), un `startsWith` en vez de `contains`, la
 * columna generada renombrada, o Prisma envolviendo la columna en una expresion que el indice
 * ya no reconozca. En TODOS esos casos el listado seguiria devolviendo exactamente lo mismo
 * —por eso ningun test de comportamiento los detecta— pero pasaria a recorrer la tabla entera
 * en cada tecleo. La asercion se hace con `enable_seqscan = off`: eso quita de la ecuacion
 * cuanto CREE Postgres que cuesta cada plan y deja solo la pregunta que si tiene respuesta
 * estable — ¿PUEDE este indice servir esta consulta?
 *
 * NO prueba que el planificador lo ELIJA por coste. Se intento y se BORRO, con evidencia:
 *
 *   · Un GIN con `fastupdate` (el default) no escribe las entradas nuevas en el arbol: las
 *     apila en una PENDING LIST que toda busqueda recorre entera y que dispara el coste
 *     estimado del indice. Un corpus recien insertado deja ahi el 100 % de las entradas.
 *     Medido con el mismo corpus y el mismo termino: 5 000 filas -> Seq Scan con la lista
 *     llena, Bitmap Index Scan tras `gin_clean_pending_list()`; 16 000 filas, idem.
 *   · Y aunque se vacie, el veredicto sigue moviendose: cada corrida de esta suite deja
 *     miles de tuplas muertas (las inserta y revierte), el indice NO encoge, y el coste que
 *     Postgres le asigna sube con el. Medido: la version por coste de este archivo paso en
 *     la 1ª corrida y fallo dos casos en la 2ª y la 3ª, sin tocar una linea.
 *
 * La eleccion por coste se mide donde puede medirse bien: `scripts/bench-busqueda-ordenes.ts`
 * (T4.1), sobre 50 000 filas, con el indice construido de una vez y la pending list vaciada
 * —el estado real de produccion—. Ahi los planes salen `Bitmap Index Scan on
 * orden_busqueda_texto_trgm_idx` para TODOS los terminos, incluido uno que casa el 20 % de la
 * tabla, y `Index Scan using orden_num_guia_key` para la ruta rapida. Sus numeros y sus
 * planes estan pegados en `progress/impl_169-buscador-ordenes.md`.
 *
 * Todo lo que se inserta corre en una transaccion que SIEMPRE se revierte (patron del resto
 * de `tests/integration/db/**` de esta feature): ni una fila queda en la base de desarrollo.
 * El corpus es DELIBERADAMENTE pequeño: ninguna asercion depende de su tamaño, y sembrar de
 * mas solo dejaria bloat en la base de quien corre la suite.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Filas del corpus. Ninguna asercion depende del tamaño (ver cabecera): esto solo tiene que
 *  dar coincidencias que contar y una guia que buscar. */
const FILAS = 300;
/** 1 de cada 30 filas lleva este apellido -> 10 coincidencias. */
const RARO = "zurcher";
/** Guias del corpus: fuera del rango que produce `siguiente_num_guia()`. */
const GUIA_BASE = 31_000_000;

interface Contexto {
  tx: PrismaClient;
  repo: OrdenRepository;
  eventos: EventoSqlDeTest[];
}

describeSiHayBase("R31 — la busqueda usa el indice y no recorre `orden`", () => {
  let prisma: PrismaClient;
  let eventos: EventoSqlDeTest[];
  let fks: FksDeOrden | null;
  let conCorpus: <T>(fn: (ctx: Contexto) => Promise<T>) => Promise<T>;
  /** Sin sembrar nada: para los casos que solo miran el SQL EMITIDO, que no depende de
   *  cuantas filas haya. Sembrar ahi solo costaria tiempo de suite y bloat. */
  let sinCorpus: <T>(fn: (ctx: Contexto) => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    const espia = crearPrismaDeTestConEspia();
    prisma = espia.prisma;
    eventos = espia.eventos;
    fks = await fksDeOrden(prisma);
    if (!fks) return;
    const base = fks;
    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        const cliente = tx as unknown as PrismaClient;
        await cliente.$executeRawUnsafe(
          `INSERT INTO orden (
             id, num_guia, num_remision, estatus_id, destinatario, telefono_dest,
             tienda_id, zona_id, provincia_id, canton_id, producto, created_at, updated_at
           )
           SELECT gen_random_uuid(), $6::int + g, 'R31-' || $7::text || '-' || g, $1,
             CASE WHEN g % 30 = 0 THEN 'Wenceslao Zurcher' ELSE 'Juan Perez Gomez ' || g END,
             '8' || lpad(g::text, 7, '0'), $2, $3, $4, $5, 'caja', now(), now()
           FROM generate_series(1, ${FILAS}) g`,
          base.estatusId,
          base.tiendaId,
          base.zonaId,
          base.provinciaId,
          base.cantonId,
          GUIA_BASE,
          Date.now().toString(36),
        );
        // Sin estadisticas frescas el planificador cree que la tabla tiene el tamaño de
        // antes del INSERT y EXPLAIN no dice nada util.
        await cliente.$executeRawUnsafe("ANALYZE orden");
        eventos.length = 0;
        return fn({ tx: cliente, repo: new OrdenRepository(cliente), eventos });
      });
    sinCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        const cliente = tx as unknown as PrismaClient;
        eventos.length = 0;
        return fn({ tx: cliente, repo: new OrdenRepository(cliente), eventos });
      });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Ejecuta la consulta REAL del repositorio y devuelve el SQL que Prisma mando al servidor. */
  async function sqlDeLaBusqueda(
    ctx: Contexto,
    where: { busqueda?: string; busquedaDigitos?: string; numGuia?: number },
  ): Promise<{ findMany: EventoSqlDeTest; count: EventoSqlDeTest }> {
    ctx.eventos.length = 0;
    await ctx.repo.list({ where, sortBy: "created_at", sortDir: "desc", skip: 0, take: 25 });
    // El evento `query` llega por callback: se cede el turno al event loop para no leer la
    // lista antes de que Prisma haya anotado la ultima consulta.
    await new Promise((r) => setTimeout(r, 20));
    const deOrden = ctx.eventos.filter((e) => e.query.includes('FROM "public"."orden"'));
    const findMany = deOrden.find((e) => e.query.includes("LIMIT"));
    const count = deOrden.find((e) => e.query.includes("COUNT(*)"));
    if (!findMany || !count) {
      throw new Error(`no se capturo el SQL del listado (${ctx.eventos.length} eventos)`);
    }
    return { findMany, count };
  }

  /** `EXPLAIN` del SQL EXACTO capturado. Ver la cabecera sobre `forzarIndice`. */
  async function explicar(
    ctx: Contexto,
    evento: EventoSqlDeTest,
    opciones: { forzarIndice?: boolean } = {},
  ): Promise<string> {
    if (opciones.forzarIndice) {
      await ctx.tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    }
    const filas = (await ctx.tx.$queryRawUnsafe(
      `EXPLAIN ${evento.query}`,
      ...parametrosDe(evento),
    )) as Record<string, string>[];
    return filas.map((f) => Object.values(f)[0]).join("\n");
  }

  it("hay ordenes de las que tomar las FKs", () => {
    expect(fks).not.toBeNull();
  });

  describe("el indice trigram SIRVE para la consulta REAL del listado (R31)", () => {
    it("el findMany se resuelve por `orden_busqueda_texto_trgm_idx`, no recorriendo la tabla", async () => {
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, { busqueda: RARO });
        return explicar(ctx, findMany, { forzarIndice: true });
      });
      expect(plan).toContain("Bitmap Index Scan on orden_busqueda_texto_trgm_idx");
      expect(plan).not.toContain("Seq Scan on orden");
    });

    it("el CONTEO de la paginacion se resuelve por el MISMO indice", async () => {
      // R15 dice que el conteo usa el mismo criterio; R31 exige ademas que lo pague igual de
      // barato. Si el `count` recorriera la tabla, la mitad del coste seguiria ahi.
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { count } = await sqlDeLaBusqueda(ctx, { busqueda: RARO });
        return explicar(ctx, count, { forzarIndice: true });
      });
      expect(plan).toContain("Bitmap Index Scan on orden_busqueda_texto_trgm_idx");
      expect(plan).not.toContain("Seq Scan on orden");
    });

    it("el indice devuelve LAS MISMAS filas que el recorrido secuencial", async () => {
      // Un indice que se usa pero devuelve de menos es peor que no tenerlo: la busqueda "no
      // encuentra" y nada peta. Se compara el resultado del plan indexado contra el del
      // recorrido completo, en la MISMA transaccion y sobre el MISMO corpus.
      if (!fks) return;
      const { conIndice, sinIndice } = await conCorpus(async (ctx) => {
        const filasCon = await ctx.tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) n FROM orden WHERE deleted_at IS NULL AND busqueda_texto LIKE '%${RARO}%'`,
        );
        await ctx.tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
        await ctx.tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        const filasSin = await ctx.tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) n FROM orden WHERE deleted_at IS NULL AND busqueda_texto LIKE '%${RARO}%'`,
        );
        return { conIndice: Number(filasCon[0].n), sinIndice: Number(filasSin[0].n) };
      });
      expect(conIndice).toBe(FILAS / 30);
      expect(sinIndice).toBe(conIndice);
    });
  });

  describe("las DOS formas del termino tambien se resuelven por el indice (M1)", () => {
    // M1 del review anadio un segundo `LIKE` sobre la MISMA columna cuando el termino trae
    // separadores. La pregunta que hay que contestar —y no dar por hecha— es si el indice
    // sigue sirviendo con el `OR` en medio: un `OR` es justo la construccion que puede
    // dejar un indice inservible. Contestada aqui (¿SIRVE?) y en el banco de T4.1 (¿lo
    // ELIGE, y a que precio?), con el mismo reparto y por los mismos motivos que R31.
    //
    // El termino: un telefono del corpus tecleado CON guion. La forma tal cual no casa nada
    // —los telefonos se siembran pelados— y la reducida casa una fila; las dos tienen
    // trigramas, que es lo unico que el plan necesita.
    const TEL_CON_GUION = "8000-0007";
    const TEL_PELADO = "80000007";

    it("el findMany usa un BitmapOr de DOS Bitmap Index Scan sobre el MISMO indice", async () => {
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, {
          busqueda: TEL_CON_GUION,
          busquedaDigitos: TEL_PELADO,
        });
        return explicar(ctx, findMany, { forzarIndice: true });
      });
      expect(plan).toContain("BitmapOr");
      expect(plan.match(/Bitmap Index Scan on orden_busqueda_texto_trgm_idx/g)).toHaveLength(2);
      expect(plan).not.toContain("Seq Scan on orden");
    });

    it("el CONTEO paga lo mismo: el mismo OR por el mismo indice", async () => {
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { count } = await sqlDeLaBusqueda(ctx, {
          busqueda: TEL_CON_GUION,
          busquedaDigitos: TEL_PELADO,
        });
        return explicar(ctx, count, { forzarIndice: true });
      });
      expect(plan).toContain("BitmapOr");
      expect(plan.match(/Bitmap Index Scan on orden_busqueda_texto_trgm_idx/g)).toHaveLength(2);
      expect(plan).not.toContain("Seq Scan on orden");
    });

    it("el OR emitido compara SOLO `busqueda_texto`, con las dos formas como parametros", async () => {
      // La forma del SQL es la garantia de alcance: `... AND (busqueda_texto LIKE $1 OR
      // busqueda_texto LIKE $2)`. El `AND` de fuera es donde vive el acotamiento por rol; si
      // el OR se hubiera abierto a otra columna, el rol dejaria de acotar.
      if (!fks) return;
      const { sql, params } = await sinCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, {
          busqueda: TEL_CON_GUION,
          busquedaDigitos: TEL_PELADO,
        });
        return { sql: findMany.query, params: JSON.parse(findMany.params) as unknown[] };
      });
      expect(sql).toContain(
        `("public"."orden"."busqueda_texto"::text LIKE ('%' || $1 || '%')` +
          ` OR "public"."orden"."busqueda_texto"::text LIKE ('%' || $2 || '%'))`,
      );
      expect(sql).not.toContain("ESCAPE");
      expect(params[0]).toBe(TEL_CON_GUION);
      expect(params[1]).toBe(TEL_PELADO);
    });

    it("una sola forma sigue emitiendo UNA condicion (sin OR): el plan medido en T4.1 no cambia", async () => {
      if (!fks) return;
      const sql = await sinCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, { busqueda: RARO });
        return findMany.query;
      });
      expect(sql).not.toContain(" OR ");
    });
  });

  describe("forma de la consulta emitida (lo que hace que el indice sirva)", () => {
    it("usa LIKE (`~~`) y NO ILIKE: la columna ya viene plegada", async () => {
      // `mode: "insensitive"` colado en el repositorio cambiaria el operador a `~~*` y
      // obligaria a plegar caja en cada recheck, para nada (design §4.3).
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, { busqueda: RARO });
        return explicar(ctx, findMany, { forzarIndice: true });
      });
      expect(plan).toContain("~~");
      expect(plan).not.toContain("~~*");
    });

    it("el termino viaja como PARAMETRO y el patron es `%valor%`", async () => {
      if (!fks) return;
      const { sql, params } = await sinCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, { busqueda: RARO });
        return { sql: findMany.query, params: findMany.params };
      });
      expect(sql).toContain(`"public"."orden"."busqueda_texto"`);
      expect(sql).toContain("LIKE ('%' || $1 || '%')");
      // Sin clausula ESCAPE: Postgres aplica su escape por defecto (`\`), que es exactamente
      // el que produce `escaparLike` en el repositorio (design §4.3, R7).
      expect(sql).not.toContain("ESCAPE");
      expect(JSON.parse(params)[0]).toBe(RARO);
    });

    it("los comodines del termino llegan ESCAPADOS al patron (R7)", async () => {
      if (!fks) return;
      const params = await sinCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, { busqueda: "100%_a\\b" });
        return JSON.parse(findMany.params) as unknown[];
      });
      expect(params[0]).toBe("100\\%\\_a\\\\b");
    });
  });

  describe("ruta rapida por numero de guia (design §5)", () => {
    // Estas dos SI son aserciones de ELECCION por coste, sin forzar nada, y son estables a
    // cualquier tamaño: es un indice UNICO sobre una IGUALDAD, o sea una fila.
    //
    // Se aserta el NOMBRE DEL INDICE, no el nodo. Postgres alterna entre `Index Scan using
    // orden_num_guia_key` y `Bitmap Index Scan on orden_num_guia_key` segun el bloat de la
    // tabla —medido: las dos formas aparecieron en corridas consecutivas de este archivo, sin
    // tocar una linea—. Las dos leen la misma fila por el mismo indice unico, que es lo que
    // R31 exige; asertar el nodo convertiria este caso en un generador de rojos falsos. En el
    // banco de T4.1, con 50 000 filas y sin bloat, sale `Index Scan using orden_num_guia_key`.
    it("un termino que es una guia se resuelve por `orden_num_guia_key`, SIN forzar nada", async () => {
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { findMany } = await sqlDeLaBusqueda(ctx, { numGuia: GUIA_BASE + 7 });
        return explicar(ctx, findMany);
      });
      expect(plan).toContain("orden_num_guia_key");
      expect(plan).toMatch(/(Index Scan using|Bitmap Index Scan on) orden_num_guia_key/);
      expect(plan).not.toContain("Seq Scan on orden");
      expect(plan).not.toContain("orden_busqueda_texto_trgm_idx");
    });

    it("el conteo de la ruta rapida tambien usa el indice unico", async () => {
      if (!fks) return;
      const plan = await conCorpus(async (ctx) => {
        const { count } = await sqlDeLaBusqueda(ctx, { numGuia: GUIA_BASE + 7 });
        return explicar(ctx, count);
      });
      expect(plan).toMatch(/(Index Scan using|Bitmap Index Scan on) orden_num_guia_key/);
      expect(plan).not.toContain("Seq Scan on orden");
    });
  });

  describe("el indice existe y es el que se cree que es", () => {
    it("es un GIN sobre `busqueda_texto` con el opclass de trigramas", async () => {
      if (!fks) return;
      const filas = (await prisma.$queryRawUnsafe(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'orden_busqueda_texto_trgm_idx'",
      )) as { indexdef: string }[];
      expect(filas).toHaveLength(1);
      expect(filas[0].indexdef).toContain("USING gin");
      expect(filas[0].indexdef).toContain("busqueda_texto");
      expect(filas[0].indexdef).toContain("gin_trgm_ops");
    });
  });
});
