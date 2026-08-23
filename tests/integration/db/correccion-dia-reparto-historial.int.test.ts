import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  fksDeOrden,
  parametrosDe,
  serializarEscriturasReales,
  type EventoSqlDeTest,
} from "./_postgres-real";

/**
 * ⭑⭑ FEATURE 262 (B28, R37/R38/R40) — LA LECTURA DEL RASTRO, CONTRA POSTGRES DE VERDAD.
 *
 * **Por qué este archivo existe y no bastan los dobles**, y esto está medido cinco veces en este
 * repo: un test con dobles NO VE EL SQL. Las tres cosas que aquí se prueban son las tres que un
 * doble daría por buenas pase lo que pase:
 *
 *  - el **`WHERE` por `orden_id`** (mutación **M-ak**: colar en la línea de tiempo la corrección
 *    de OTRA orden). Un doble devuelve lo que se le diga;
 *  - el **desempate por `id`** del `ORDER BY`. Un lote corregido de golpe escribe N filas con el
 *    MISMO `CURRENT_TIMESTAMP` —eso sólo pasa de verdad dentro de una transacción de Postgres—;
 *  - que el **`DATE` se serializa al día correcto** con la sesión en `America/Costa_Rica`. Es la
 *    trampa de las seis horas que cerró la 166, y sólo el motor puede demostrarla.
 *
 * ⚠️ NADA DE `if (!fks) return;`. Con base y sin catálogo, esto REVIENTA con un mensaje que lo
 * dice: un `return` temprano reporta `passed` sin haber comprobado nada — ya pasó en este repo.
 * Sin base, el `describe.skip` se ve en la salida con su nombre.
 *
 * TODO corre dentro de una transacción que SIEMPRE se revierte: ni una fila queda en la base.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `262-hist-${Date.now().toString(36)}`;
const GUIA_BASE = 970_000_000 + (Date.now() % 20_000_000);

const MOTIVO = "la bodega marco el lote para el dia siguiente por error";

describeSiHayBase("262/B28 — el rastro de una orden, leido de Postgres", () => {
  let prisma: PrismaClient;
  let eventos: EventoSqlDeTest[];
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };
  /** Se reusa el id de la tienda como actor: lo que se mide es una CONSULTA, no un rol. */
  let ACTOR: string;
  let ACTOR_NOMBRE: string;

  beforeAll(async () => {
    const espia = crearPrismaDeTestConEspia();
    prisma = espia.prisma;
    eventos = espia.eventos;

    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    FKS = fks;
    ACTOR = fks.tiendaId;

    const actor = await prisma.usuario.findUnique({
      where: { id: ACTOR },
      select: { nombre: true },
    });
    if (!actor) {
      throw new Error(
        `el usuario \`${ACTOR}\` (tienda de la orden semilla) no existe: sin actor no hay ` +
          "`include` del nombre que comprobar.",
      );
    }
    ACTOR_NOMBRE = actor.nombre;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Crea una orden minima dentro del `tx` y devuelve su id. */
  async function crearOrden(tx: PrismaClient, n: number): Promise<string> {
    const orden = await tx.orden.create({
      data: {
        numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000) + n,
        numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 8)}-${n}`,
        destinatario: "Corpus 262 historial",
        telefonoDest: "88880000",
        producto: "caja",
        estatusId: FKS.estatusId,
        tiendaId: FKS.tiendaId,
        zonaId: FKS.zonaId,
        provinciaId: FKS.provinciaId,
        cantonId: FKS.cantonId,
      },
      select: { id: true },
    });
    return orden.id;
  }

  interface FilaRastro {
    id?: string;
    ordenId: string;
    fechaAnterior: string;
    fechaNueva: string;
    motivo?: string;
    createdAt?: Date;
  }

  /**
   * Inserta filas del rastro con SQL crudo. Las fechas entran como TEXTO `YYYY-MM-DD` con
   * `::date`, que es exactamente la convencion del escritor de produccion: si el test sembrara
   * con un `Date` de JS estaria midiendo OTRA cosa.
   */
  async function sembrarRastro(tx: PrismaClient, filas: FilaRastro[]): Promise<string[]> {
    const ids: string[] = [];
    for (const fila of filas) {
      const id = fila.id ?? randomUUID();
      ids.push(id);
      if (fila.createdAt) {
        await tx.$executeRawUnsafe(
          `INSERT INTO orden_dia_reparto_cambio
             (id, orden_id, fecha_anterior, fecha_nueva, actor_usuario_id, motivo, created_at)
           VALUES ($1, $2, $3::date, $4::date, $5, $6, $7::timestamp)`,
          id,
          fila.ordenId,
          fila.fechaAnterior,
          fila.fechaNueva,
          ACTOR,
          fila.motivo ?? MOTIVO,
          fila.createdAt.toISOString(),
        );
      } else {
        // Sin `created_at` explicito: lo pone el DEFAULT `CURRENT_TIMESTAMP`, que dentro de una
        // transaccion es EL MISMO para todas las filas. Ese es el empate que hay que desempatar.
        await tx.$executeRawUnsafe(
          `INSERT INTO orden_dia_reparto_cambio
             (id, orden_id, fecha_anterior, fecha_nueva, actor_usuario_id, motivo)
           VALUES ($1, $2, $3::date, $4::date, $5, $6)`,
          id,
          fila.ordenId,
          fila.fechaAnterior,
          fila.fechaNueva,
          ACTOR,
          fila.motivo ?? MOTIVO,
        );
      }
    }
    return ids;
  }

  async function conBase<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      const cliente = tx as unknown as PrismaClient;
      await serializarEscriturasReales(cliente);
      return fn(cliente);
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* R37 — las correcciones de ESTA orden, todas y sólo las suyas                           */
  /* ------------------------------------------------------------------------------------ */

  it("R37/R38: devuelve TODAS las correcciones de la orden, con las dos fechas, el actor y el motivo", async () => {
    const leidas = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 1);
      await sembrarRastro(tx, [
        {
          ordenId,
          fechaAnterior: "2026-08-21",
          fechaNueva: "2026-08-22",
          motivo: "primera correccion: se marco para manana por error",
          createdAt: new Date("2026-08-21T09:14:00.000Z"),
        },
        {
          ordenId,
          fechaAnterior: "2026-08-22",
          fechaNueva: "2026-08-23",
          motivo: "segunda correccion: el cliente pidio otro dia",
          createdAt: new Date("2026-08-22T11:00:00.000Z"),
        },
      ]);
      return new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(ordenId);
    });

    // El literal es EL CONTRATO del DTO que llega al drawer: las dos fechas YA en `YYYY-MM-DD`
    // (nunca un `Date`), el nombre del actor resuelto por `include`, el motivo entero y la clase.
    expect(leidas).toEqual([
      {
        clase: "correccion_dia",
        fechaAnteriorISO: "2026-08-21",
        fechaNuevaISO: "2026-08-22",
        actorNombre: ACTOR_NOMBRE,
        motivo: "primera correccion: se marco para manana por error",
        createdAt: new Date("2026-08-21T09:14:00.000Z"),
      },
      {
        clase: "correccion_dia",
        fechaAnteriorISO: "2026-08-22",
        fechaNuevaISO: "2026-08-23",
        actorNombre: ACTOR_NOMBRE,
        motivo: "segunda correccion: el cliente pidio otro dia",
        createdAt: new Date("2026-08-22T11:00:00.000Z"),
      },
    ]);
  });

  it("⭑ M-ak: la correccion de OTRA orden NO entra en esta linea de tiempo", async () => {
    // El `WHERE orden_id = $1`, probado DONDE VIVE. Quitarlo deja los tests de servicio en verde
    // y mete en el historial de una orden lo que le pasó a otra.
    const { mias, ajenas } = await conBase(async (tx) => {
      const miOrden = await crearOrden(tx, 2);
      const otraOrden = await crearOrden(tx, 3);
      await sembrarRastro(tx, [
        { ordenId: miOrden, fechaAnterior: "2026-08-21", fechaNueva: "2026-08-22", motivo: "es MIA" },
        // Con `created_at` explicito y distinto: si las dos compartieran instante, su orden lo
        // decidiria el `id ASC` (aleatorio aqui) y este control positivo seria intermitente.
        {
          ordenId: otraOrden,
          fechaAnterior: "2026-08-21",
          fechaNueva: "2026-08-22",
          motivo: "es de la OTRA orden",
          createdAt: new Date("2026-08-21T08:00:00.000Z"),
        },
        {
          ordenId: otraOrden,
          fechaAnterior: "2026-08-22",
          fechaNueva: "2026-08-23",
          motivo: "tambien de la OTRA orden",
          createdAt: new Date("2026-08-22T08:00:00.000Z"),
        },
      ]);
      const repo = new OrdenDiaRepartoCambioRepository(tx);
      return {
        mias: await repo.findCorreccionesByOrden(miOrden),
        ajenas: await repo.findCorreccionesByOrden(otraOrden),
      };
    });

    expect(mias.map((c) => c.motivo)).toEqual(["es MIA"]);
    // CONTROL POSITIVO: la otra orden SÍ tiene sus dos, así que el `WHERE` filtra en vez de
    // devolver vacío por accidente.
    expect(ajenas.map((c) => c.motivo)).toEqual([
      "es de la OTRA orden",
      "tambien de la OTRA orden",
    ]);
  });

  it("una orden SIN correcciones devuelve lista vacia (R45: el caso normal, y no es un error)", async () => {
    const leidas = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 4);
      return new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(ordenId);
    });
    expect(leidas).toEqual([]);
  });

  /* ------------------------------------------------------------------------------------ */
  /* R40 — el ORDER BY, con su desempate                                                    */
  /* ------------------------------------------------------------------------------------ */

  it("R40: las devuelve ascendentes por instante aunque se hayan insertado del reves", async () => {
    const leidas = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 5);
      await sembrarRastro(tx, [
        {
          ordenId,
          fechaAnterior: "2026-08-23",
          fechaNueva: "2026-08-24",
          motivo: "la TERCERA en el tiempo, insertada primera",
          createdAt: new Date("2026-08-23T08:00:00.000Z"),
        },
        {
          ordenId,
          fechaAnterior: "2026-08-21",
          fechaNueva: "2026-08-22",
          motivo: "la PRIMERA en el tiempo, insertada ultima",
          createdAt: new Date("2026-08-21T08:00:00.000Z"),
        },
        {
          ordenId,
          fechaAnterior: "2026-08-22",
          fechaNueva: "2026-08-23",
          motivo: "la SEGUNDA en el tiempo",
          createdAt: new Date("2026-08-22T08:00:00.000Z"),
        },
      ]);
      return new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(ordenId);
    });

    expect(leidas.map((c) => c.motivo)).toEqual([
      "la PRIMERA en el tiempo, insertada ultima",
      "la SEGUNDA en el tiempo",
      "la TERCERA en el tiempo, insertada primera",
    ]);
  });

  it("⭑ R40: TRES filas del MISMO instante salen desempatadas por `id`, no por como se insertaron", async () => {
    // Esto es lo que un doble no puede montar: las tres filas comparten `created_at` porque
    // `CURRENT_TIMESTAMP` es el instante en que EMPEZO la transaccion —que es justo lo que le
    // pasa a un lote corregido de golpe—. Sin el `id ASC`, el orden seria indefinido y la linea
    // de tiempo cambiaria entre dos recargas.
    //
    // Los tres ids se ordenan A MANO y se insertan en el orden CONTRARIO: si el `ORDER BY` se
    // quedara solo con `created_at`, Postgres devolveria el orden fisico (el de insercion) y
    // esta asercion se pondria roja.
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    const [idA, idB, idC] = ids;

    const { leidas, mismoInstante } = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 6);
      await sembrarRastro(tx, [
        { id: idC, ordenId, fechaAnterior: "2026-08-21", fechaNueva: "2026-08-22", motivo: "id C" },
        { id: idA, ordenId, fechaAnterior: "2026-08-21", fechaNueva: "2026-08-23", motivo: "id A" },
        { id: idB, ordenId, fechaAnterior: "2026-08-21", fechaNueva: "2026-08-24", motivo: "id B" },
      ]);
      const repo = new OrdenDiaRepartoCambioRepository(tx);
      const filas = await repo.findCorreccionesByOrden(ordenId);
      return {
        leidas: filas,
        mismoInstante: new Set(filas.map((f) => f.createdAt.getTime())).size,
      };
    });

    // CONTROL DE NO-VACUIDAD del escenario: si las tres NO compartieran instante, el desempate
    // por `id` no estaria siendo ejercitado y este test no probaria nada.
    expect(mismoInstante, "las tres filas no comparten `created_at`: el empate no se dio").toBe(1);
    expect(leidas.map((c) => c.motivo)).toEqual(["id A", "id B", "id C"]);
  });

  /* ------------------------------------------------------------------------------------ */
  /* R38 — el `DATE` sale al dia correcto, con la sesion en Costa Rica                       */
  /* ------------------------------------------------------------------------------------ */

  it("R38: con la sesion en `America/Costa_Rica` las dos fechas siguen siendo el dia escrito", async () => {
    // La trampa de las seis horas (166/246): un `@db.Date` leido por Prisma es la medianoche UTC
    // de esa fecha; leerlo en hora local devolveria el dia ANTERIOR. `fechaRepartoComoTexto` usa
    // los getters `getUTC*` justamente por esto.
    const { leidas, zona } = await conBase(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Costa_Rica'");
      const filas = (await tx.$queryRawUnsafe("SHOW TimeZone")) as Record<string, string>[];
      const ordenId = await crearOrden(tx, 7);
      await sembrarRastro(tx, [
        {
          ordenId,
          fechaAnterior: "2026-01-01",
          fechaNueva: "2026-12-31",
          createdAt: new Date("2026-08-21T04:30:00.000Z"), // 22:30 CR del dia ANTERIOR
        },
      ]);
      return {
        leidas: await new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(ordenId),
        zona: Object.values(filas[0] ?? {})[0],
      };
    });

    // La asercion de que el `SET LOCAL` TOMO EFECTO: sin ella, este test podria estar midiendo
    // una sesion en UTC y creerse que probo algo.
    expect(zona).toBe("America/Costa_Rica");
    expect(leidas).toHaveLength(1);
    expect(leidas[0].fechaAnteriorISO).toBe("2026-01-01");
    expect(leidas[0].fechaNuevaISO).toBe("2026-12-31");
    // Y ninguna de las dos es un `Date` disfrazado: el DataTable de este repo descarta objetos
    // al renderizar, asi que un `Date` aqui seria una celda vacia en pantalla.
    expect(typeof leidas[0].fechaAnteriorISO).toBe("string");
    expect(typeof leidas[0].fechaNuevaISO).toBe("string");
  });

  /* ------------------------------------------------------------------------------------ */
  /* El indice que §5.1 declaro «la unica consulta prevista» SIRVE a este consumidor         */
  /* ------------------------------------------------------------------------------------ */

  it("la consulta REAL del repositorio se resuelve por `(orden_id, created_at)`, sin recorrer la tabla", async () => {
    // Se explica el SQL EXACTO que Prisma mando —capturado con el espia—, no uno escrito a mano:
    // un `EXPLAIN` sobre SQL inventado demuestra que el invento usa el indice, no que lo use lo
    // que corre en produccion.
    const plan = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 8);
      await sembrarRastro(tx, [
        { ordenId, fechaAnterior: "2026-08-21", fechaNueva: "2026-08-22" },
      ]);
      await tx.$executeRawUnsafe("ANALYZE orden_dia_reparto_cambio");

      eventos.length = 0;
      await new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(ordenId);
      await new Promise((r) => setTimeout(r, 20)); // el evento `query` llega por callback

      const consulta = eventos.find((e) =>
        e.query.includes('FROM "public"."orden_dia_reparto_cambio"'),
      );
      if (!consulta) {
        throw new Error(
          `no se capturo el SQL de la lectura del rastro (${eventos.length} eventos). Sin el, ` +
            "este test no puede explicar NADA y se detiene en rojo.",
        );
      }

      // Con dos filas en la tabla el planificador elige `Seq Scan` porque es mas barato, y eso
      // no dice nada del indice. Se le quita esa opcion para preguntarle lo que de verdad
      // importa: si el indice PUEDE servir esta consulta entera (mismo patron que
      // `busqueda-usa-indice.test.ts`).
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const filas = (await tx.$queryRawUnsafe(
        `EXPLAIN ${consulta.query}`,
        ...parametrosDe(consulta),
      )) as Record<string, string>[];
      return filas.map((f) => Object.values(f)[0]).join("\n");
    });

    expect(plan).toContain("orden_dia_reparto_cambio_orden_id_created_at_idx");
    expect(plan).not.toContain("Seq Scan on orden_dia_reparto_cambio");
  });

  it("la lectura del rastro emite UNA sola consulta, con el `include` del actor resuelto en ella", async () => {
    // Sin esto, un `include` mal puesto produciria un N+1 invisible: el drawer de una orden con
    // veinte correcciones haria veintiuna consultas y nada se pondria rojo.
    const consultas = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 9);
      await sembrarRastro(tx, [
        { ordenId, fechaAnterior: "2026-08-21", fechaNueva: "2026-08-22", motivo: "una" },
        { ordenId, fechaAnterior: "2026-08-22", fechaNueva: "2026-08-23", motivo: "dos" },
        { ordenId, fechaAnterior: "2026-08-23", fechaNueva: "2026-08-24", motivo: "tres" },
      ]);

      eventos.length = 0;
      const leidas = await new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(
        ordenId,
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(leidas).toHaveLength(3);
      expect(leidas.every((c) => c.actorNombre === ACTOR_NOMBRE)).toBe(true);

      return eventos.filter(
        (e) =>
          e.query.includes('FROM "public"."orden_dia_reparto_cambio"') ||
          e.query.includes('FROM "public"."usuario"'),
      ).length;
    });

    // Prisma resuelve el `include` con una segunda consulta al catalogo de usuarios; lo que NO
    // puede haber es una por fila.
    expect(consultas).toBeLessThanOrEqual(2);
  });
  /* ------------------------------------------------------------------------------------ */
  /* B29 / R43 — el RASTREO PUBLICO no ve la correccion                                      */
  /* ------------------------------------------------------------------------------------ */

  /**
   * La guardia `tests/unit/guards/rastreo-frontera.guardia.test.ts` sigue INTACTA y verde: el
   * borde publico tiene prohibido nombrar `OrdenHistorialEntradaDTO`, y ese simbolo sigue
   * existiendo con el mismo nombre (design §14.1, punto 1), asi que vigila algo vivo.
   *
   * Pero una guardia de AUSENCIA solo prueba que nadie IMPORTA el DTO. Lo que falta —y es esto—
   * es el CONTROL POSITIVO: que una orden CON correccion devuelve por el borde publico
   * exactamente las mismas transiciones que sin ella. Se hace contra Postgres real y con el
   * repositorio publico DE VERDAD, porque el doble de `tests/integration/repositories/
   * rastreo-publico.int.test.ts` no puede tener una tabla que el tipo del repositorio ni
   * declara: alli la ausencia seria trivial y no probaria nada.
   */
  it("⭑ R43: una orden CON correccion devuelve por el rastreo publico las MISMAS transiciones que sin ella", async () => {
    const { sinCorreccion, conCorreccion, correcciones } = await conBase(async (tx) => {
      const ordenId = await crearOrden(tx, 10);
      const publico = new RastreoPublicoRepository(tx);

      // Dos transiciones reales, para que la comparacion no sea entre dos listas vacias.
      const estados = await tx.orderStatus.findMany({
        where: { value: { in: ["en_preparacion", "por_recoger"] } },
        select: { id: true, value: true },
      });
      if (estados.length < 2) {
        throw new Error(
          "el catalogo `order_status` no tiene `en_preparacion` y `por_recoger`: sin dos " +
            "transiciones esta comparacion no dice nada. Corre el seed del catalogo.",
        );
      }
      for (const [i, estado] of estados.entries()) {
        await tx.$executeRawUnsafe(
          `INSERT INTO orden_historial_estado
             (id, orden_id, estatus_origen_id, estatus_destino_id, origen_tipo, created_at)
           VALUES ($1, $2, NULL, $3, 'ajuste_estado'::orden_historial_origen_tipo, $4::timestamp)`,
          randomUUID(),
          ordenId,
          estado.id,
          new Date(`2026-08-2${i + 1}T08:00:00.000Z`).toISOString(),
        );
      }

      const antes = await publico.listarTransiciones(ordenId);

      // Ahora la orden gana DOS correcciones del dia de reparto.
      await sembrarRastro(tx, [
        {
          ordenId,
          fechaAnterior: "2026-08-21",
          fechaNueva: "2026-08-22",
          createdAt: new Date("2026-08-21T09:14:00.000Z"),
        },
        {
          ordenId,
          fechaAnterior: "2026-08-22",
          fechaNueva: "2026-08-23",
          createdAt: new Date("2026-08-22T09:14:00.000Z"),
        },
      ]);

      return {
        sinCorreccion: antes,
        conCorreccion: await publico.listarTransiciones(ordenId),
        correcciones: await new OrdenDiaRepartoCambioRepository(tx).findCorreccionesByOrden(
          ordenId,
        ),
      };
    });

    // CONTROL DE NO-VACUIDAD por partida doble: si no hubiera transiciones, o si las
    // correcciones no se hubieran escrito, la igualdad de abajo seria trivial.
    expect(sinCorreccion.length, "la orden no tiene transiciones que comparar").toBe(2);
    expect(correcciones.length, "las correcciones no se escribieron: no hay nada que ocultar").toBe(
      2,
    );

    // Y la afirmacion: el borde publico devuelve EXACTAMENTE lo mismo, ni un campo mas.
    expect(conCorreccion).toEqual(sinCorreccion);
    expect(
      JSON.stringify(conCorreccion),
      "el rastreo publico gano algun campo por culpa de la 262",
    ).not.toMatch(/fecha|motivo|actor/i);
  });
});
