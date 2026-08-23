import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CorreccionDiaConflictoError } from "@/lib/interfaces/repositories/IOrdenRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑⭑ FEATURE 262 (B12, R1/R8/R9/R12/R20-R24/R27) — LA ESCRITURA GUARDADA Y SU RASTRO, CONTRA
 * POSTGRES DE VERDAD.
 *
 * POR QUE ESTE ARCHIVO EXISTE Y NO BASTAN LOS DOBLES, y esto esta MEDIDO CUATRO VECES EN ESTE REPO:
 * un test de servicio con dobles NO VE EL SQL. Una mutacion del `WHERE` —quitar la guarda de
 * estado, la de zona, la de «dia distinto» o la de mensajero— deja once tests de servicio en verde
 * y el defecto suelto. El `WHERE` se prueba DONDE VIVE.
 *
 * Y lo mismo vale para el `FOR UPDATE` y para la atomicidad del rastro: una transaccion solo existe
 * dentro de una transaccion de verdad.
 *
 * ⚠️ NADA DE `if (!fks) return;`. Con base y sin catalogo, esto REVIENTA con un mensaje que lo dice:
 * un `return` temprano reporta `passed` sin haber comprobado nada — ya paso aqui. Sin base, el
 * `describe.skip` se ve en la salida con su nombre.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: ni una fila queda en la base.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `262-esc-${Date.now().toString(36)}`;
const GUIA_BASE = 930_000_000 + (Date.now() % 40_000_000);

/**
 * 22:30 CR del 21 de agosto = 04:30Z del 22. La misma hora que uso la 261, y elegida por lo mismo:
 * el dia UTC y el dia de Costa Rica NO coinciden, asi que un dia derivado con el helper equivocado
 * saldria «22» y varias aserciones se pondrian rojas.
 */
const HOY = new Date("2026-08-21T00:00:00.000Z");
const MANANA = new Date("2026-08-22T00:00:00.000Z");
/** Un instante VIEJO y distinguible: si el `SET` tocara `asignado_at`, se notaria. */
const ASIGNADO_AT = new Date("2026-08-19T15:00:00.000Z");
const MOTIVO = "la bodega marco el lote para el dia siguiente por error";

describeSiHayBase("262/B12 — corregir el dia de reparto, contra Postgres real", () => {
  let prisma: PrismaClient;
  let ESTATUS: Record<string, string>;
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };
  let ZONA_AJENA: string;
  /** Se reusa el id de la tienda: lo que se mide es una SENTENCIA, no un rol. */
  let ACTOR: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    FKS = fks;
    ACTOR = fks.tiendaId;

    const valores = ["por_recoger", "en_reparto", "ayuda_tienda", "entregada"];
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: valores } },
      select: { id: true, value: true },
    });
    ESTATUS = Object.fromEntries(estados.map((e) => [e.value, e.id]));
    const faltan = valores.filter((v) => !ESTATUS[v]);
    if (faltan.length > 0) {
      throw new Error(
        `el catalogo \`order_status\` no tiene ${faltan.join(", ")}: sin ellos no hay guarda de ` +
          `estado que medir. Corre el seed del catalogo.`,
      );
    }

    const zonas = await prisma.zona.findMany({ select: { id: true }, take: 5 });
    const ajena = zonas.find((z) => z.id !== fks.zonaId);
    if (!ajena) {
      throw new Error(
        "solo hay UNA zona en la base: el caso del `adminSatelite` (R12) no se puede medir. " +
          "Corre `pnpm exec tsx scripts/seed-zonas.ts`.",
      );
    }
    ZONA_AJENA = ajena.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  interface Semilla {
    estatusValue?: string;
    fechaReparto?: Date | null;
    conMensajero?: boolean;
    zonaId?: string;
    borrada?: boolean;
  }

  /**
   * Siembra las ordenes descritas y ejecuta `fn` con el repositorio apuntando al `tx`. Todo se
   * revierte al terminar, pase lo que pase.
   */
  async function conOrdenes<T>(
    semillas: Semilla[],
    fn: (ctx: {
      repo: OrdenRepository;
      tx: PrismaClient;
      ids: string[];
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ids: string[] = [];
      let n = 0;
      for (const s of semillas) {
        n += 1;
        const orden = await tx.orden.create({
          data: {
            numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000) + n,
            numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 8)}-${n}`,
            destinatario: "Corpus 262",
            telefonoDest: "88880000",
            producto: "caja",
            estatusId: ESTATUS[s.estatusValue ?? "por_recoger"],
            tiendaId: FKS.tiendaId,
            zonaId: s.zonaId ?? FKS.zonaId,
            provinciaId: FKS.provinciaId,
            cantonId: FKS.cantonId,
            mensajeroAsignadoId: s.conMensajero === false ? null : ACTOR,
            asignadoAt: ASIGNADO_AT,
            fechaReparto: s.fechaReparto === undefined ? MANANA : s.fechaReparto,
            deletedAt: s.borrada ? new Date() : null,
          },
          select: { id: true },
        });
        ids.push(orden.id);
      }
      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      return fn({ repo, tx: tx as unknown as PrismaClient, ids });
    });
  }

  /** Los tres estados admitidos, ya resueltos a id. */
  function estatusIdsAdmitidos(): string[] {
    return [ESTATUS.por_recoger, ESTATUS.en_reparto, ESTATUS.ayuda_tienda];
  }

  /* ------------------------------------------------------------------------ */
  /* CASO 1 y 2 — se corrige el DIA, y NADA MAS                               */
  /* ------------------------------------------------------------------------ */

  it("⭑ R1/R27: la fila queda con el dia nuevo y todo lo demas IDENTICO", async () => {
    const { antes, despues, aplicadas } = await conOrdenes(
      [{ estatusValue: "por_recoger", fechaReparto: MANANA }],
      async (ctx) => {
        const columnas = {
          estatusId: true,
          mensajeroAsignadoId: true,
          asignadoAt: true,
          numGuia: true,
          numRemision: true,
          fechaReparto: true,
          prioridad: true,
          intentosContacto: true,
          zonaId: true,
        } as const;
        const antes = await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ids[0] },
          select: columnas,
        });
        const aplicadas = await ctx.repo.corregirDiaRepartoLote(
          ctx.ids,
          HOY,
          estatusIdsAdmitidos(),
          null,
          { actorUsuarioId: ACTOR, motivo: MOTIVO },
        );
        const despues = await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ids[0] },
          select: columnas,
        });
        return { antes, despues, aplicadas };
      },
    );

    // EL efecto: el dia cambio.
    expect(antes.fechaReparto).toEqual(MANANA);
    expect(despues.fechaReparto).toEqual(HOY);
    // Y NADA MAS cambio. Se compara la fila ENTERA menos el dia, no campo a campo elegido a dedo:
    // asi una columna que alguien anada al `SET` en el futuro rompe este test.
    expect({ ...despues, fechaReparto: null }).toEqual({ ...antes, fechaReparto: null });
    // ⭑ `asignado_at` INTACTO (R27): corregir el dia NO es re-asignar. Con el `SET` mutado a
    // `"asignado_at" = NOW()` (M-k), esto se pone rojo.
    expect(despues.asignadoAt).toEqual(ASIGNADO_AT);
    expect(aplicadas).toHaveLength(1);
    expect(aplicadas[0].mensajeroAsignadoId).toBe(ACTOR);
    expect(aplicadas[0].fechaAnterior).toEqual(MANANA);
    expect(aplicadas[0].fechaNueva).toEqual(HOY);
  });

  it("R6: los TRES estados admitidos se corrigen (`por_recoger`, `en_reparto`, `ayuda_tienda`)", async () => {
    const dias = await conOrdenes(
      [
        { estatusValue: "por_recoger" },
        { estatusValue: "en_reparto" },
        { estatusValue: "ayuda_tienda" },
      ],
      async (ctx) => {
        await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        });
        const filas = await ctx.tx.orden.findMany({
          where: { id: { in: ctx.ids } },
          select: { fechaReparto: true },
        });
        return filas.map((f) => f.fechaReparto);
      },
    );
    expect(dias).toEqual([HOY, HOY, HOY]);
  });

  /* ------------------------------------------------------------------------ */
  /* CASO 3 — EL RASTRO                                                        */
  /* ------------------------------------------------------------------------ */

  it("⭑ R20/R21/R22: UNA fila de rastro por orden corregida, con las dos fechas, el actor y el motivo", async () => {
    const rastro = await conOrdenes(
      [{ fechaReparto: MANANA }, { fechaReparto: MANANA }],
      async (ctx) => {
        await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        });
        return ctx.tx.ordenDiaRepartoCambio.findMany({
          where: { ordenId: { in: ctx.ids } },
          orderBy: { ordenId: "asc" },
          select: {
            id: true,
            ordenId: true,
            fechaAnterior: true,
            fechaNueva: true,
            actorUsuarioId: true,
            motivo: true,
            createdAt: true,
          },
        });
      },
    );

    expect(rastro).toHaveLength(2);
    for (const fila of rastro) {
      expect(fila.fechaAnterior).toEqual(MANANA); // R24: el dia que TENIA
      expect(fila.fechaNueva).toEqual(HOY);
      expect(fila.actorUsuarioId).toBe(ACTOR);
      expect(fila.motivo).toBe(MOTIVO);
      expect(fila.createdAt).toBeInstanceOf(Date);
    }
    // Dos filas, dos ids distintos: el `randomUUID()` del choke point no colisiona.
    expect(new Set(rastro.map((f) => f.id)).size).toBe(2);
  });

  it("⭑ R24: `fecha_anterior` es el dia REAL de cada fila, no un valor comun del lote", async () => {
    // Sin esto, un choke point que escribiera «la fecha del primero» para todas pasaria el test de
    // arriba, donde las dos ordenes tenian el mismo dia.
    const rastro = await conOrdenes(
      [
        { fechaReparto: MANANA },
        { fechaReparto: new Date("2026-08-25T00:00:00.000Z") },
      ],
      async (ctx) => {
        await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        });
        const filas = await ctx.tx.ordenDiaRepartoCambio.findMany({
          where: { ordenId: { in: ctx.ids } },
          select: { ordenId: true, fechaAnterior: true },
        });
        return new Map(filas.map((f) => [f.ordenId, f.fechaAnterior]));
      },
    );

    expect(rastro.size).toBe(2);
    expect([...rastro.values()].map((d) => d.toISOString().slice(0, 10)).sort()).toEqual([
      "2026-08-22",
      "2026-08-25",
    ]);
  });

  /* ------------------------------------------------------------------------ */
  /* CASO 4 — TODO O NADA                                                      */
  /* ------------------------------------------------------------------------ */

  it("⭑ R8/R22: si UNA orden pierde la guarda, NI UNA se corrige y NI UNA fila de rastro se escribe", async () => {
    const resultado = await conOrdenes(
      [
        { estatusValue: "por_recoger", fechaReparto: MANANA },
        { estatusValue: "entregada", fechaReparto: MANANA }, // pierde la guarda de estado
      ],
      async (ctx) => {
        let lanzo: unknown = null;
        try {
          await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
            actorUsuarioId: ACTOR,
            motivo: MOTIVO,
          });
        } catch (e) {
          lanzo = e;
        }
        const dias = await ctx.tx.orden.findMany({
          where: { id: { in: ctx.ids } },
          orderBy: { id: "asc" },
          select: { fechaReparto: true },
        });
        const rastro = await ctx.tx.ordenDiaRepartoCambio.count({
          where: { ordenId: { in: ctx.ids } },
        });
        return { lanzo, dias: dias.map((d) => d.fechaReparto), rastro };
      },
    );

    expect(resultado.lanzo).toBeInstanceOf(CorreccionDiaConflictoError);
    // ⭑ NINGUNA se movio: ni siquiera la que SI ganaba su guarda (mata M-f: «dejar pasar a los
    // ganadores»).
    expect(resultado.dias).toEqual([MANANA, MANANA]);
    // ⭑ CERO filas de rastro (mata M-m y M-n: el rastro fuera de la tx, o escrito con todas las ids).
    expect(resultado.rastro).toBe(0);
  });

  it("el error nombra SOLO las que no se corrigieron", async () => {
    const ids = await conOrdenes(
      [{ estatusValue: "por_recoger" }, { estatusValue: "entregada" }],
      async (ctx) => {
        try {
          await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
            actorUsuarioId: ACTOR,
            motivo: MOTIVO,
          });
          return { esperados: ctx.ids, recibidos: [] as readonly string[] };
        } catch (e) {
          return {
            esperados: [ctx.ids[1]],
            recibidos: (e as CorreccionDiaConflictoError).ordenIdsNoCorregidas,
          };
        }
      },
    );
    expect([...ids.recibidos]).toEqual(ids.esperados);
  });

  /* ------------------------------------------------------------------------ */
  /* EL `WHERE`, GUARDA A GUARDA                                               */
  /* ------------------------------------------------------------------------ */

  it("⭑ R9 (M-g): una orden en estado NO admitido no se corrige — la guarda esta en el `WHERE`", async () => {
    const dia = await conOrdenes([{ estatusValue: "entregada" }], async (ctx) => {
      await ctx.repo
        .corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        })
        .catch(() => null);
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { fechaReparto: true },
      });
      return fila.fechaReparto;
    });
    expect(dia).toEqual(MANANA);
  });

  it("⭑ R5/R9 (M-h): una orden SIN dia no se corrige — la correccion no PONE dia donde no lo habia", async () => {
    const dia = await conOrdenes([{ fechaReparto: null }], async (ctx) => {
      await ctx.repo
        .corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        })
        .catch(() => null);
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { fechaReparto: true },
      });
      return fila.fechaReparto;
    });
    expect(dia).toBeNull();
  });

  it("⭑ R9: una orden SIN mensajero no se corrige — la invariante 246/R10 sigue entera", async () => {
    const dia = await conOrdenes([{ conMensajero: false }], async (ctx) => {
      await ctx.repo
        .corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        })
        .catch(() => null);
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { fechaReparto: true },
      });
      return fila.fechaReparto;
    });
    // Sigue con su dia original: la correccion no puede dejar un dia sin mensajero.
    expect(dia).toEqual(MANANA);
  });

  it("⭑ R7/R9 (M-j): una orden que YA esta en el dia elegido no se corrige", async () => {
    const { lanzo, rastro } = await conOrdenes([{ fechaReparto: HOY }], async (ctx) => {
      let lanzo: unknown = null;
      try {
        await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        });
      } catch (e) {
        lanzo = e;
      }
      const rastro = await ctx.tx.ordenDiaRepartoCambio.count({
        where: { ordenId: { in: ctx.ids } },
      });
      return { lanzo, rastro };
    });
    // Sin el `<>` en el `WHERE` la fila se «corregiria» con el mismo valor y el rastro escribiria
    // una fila que el CHECK de la tabla rechazaria con un error de Postgres en vez de con un motivo
    // accionable.
    expect(lanzo).toBeInstanceOf(CorreccionDiaConflictoError);
    expect(rastro).toBe(0);
  });

  it("R9: una orden BORRADA no se corrige", async () => {
    const dia = await conOrdenes([{ borrada: true }], async (ctx) => {
      await ctx.repo
        .corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        })
        .catch(() => null);
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { fechaReparto: true },
      });
      return fila.fechaReparto;
    });
    expect(dia).toEqual(MANANA);
  });

  /* ------------------------------------------------------------------------ */
  /* CASO 5 — LA ZONA DEL `adminSatelite`                                      */
  /* ------------------------------------------------------------------------ */

  it("⭑ R12 (M-i): con `zonaId`, una orden de OTRA zona no se corrige aunque venga en `ordenIds`", async () => {
    const resultado = await conOrdenes(
      [{ zonaId: undefined }, { zonaId: ZONA_AJENA }],
      async (ctx) => {
        let lanzo: unknown = null;
        try {
          await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), FKS.zonaId, {
            actorUsuarioId: ACTOR,
            motivo: MOTIVO,
          });
        } catch (e) {
          lanzo = e;
        }
        const filas = await ctx.tx.orden.findMany({
          where: { id: { in: ctx.ids } },
          orderBy: { id: "asc" },
          select: { id: true, fechaReparto: true },
        });
        const rastro = await ctx.tx.ordenDiaRepartoCambio.count({
          where: { ordenId: { in: ctx.ids } },
        });
        return {
          lanzo,
          ajenaId: ctx.ids[1],
          filas: new Map(filas.map((f) => [f.id, f.fechaReparto])),
          rastro,
        };
      },
    );

    // La de otra zona pierde la guarda -> el LOTE entero se revierte (todo-o-nada).
    expect(resultado.lanzo).toBeInstanceOf(CorreccionDiaConflictoError);
    expect((resultado.lanzo as CorreccionDiaConflictoError).ordenIdsNoCorregidas).toEqual([
      resultado.ajenaId,
    ]);
    expect([...resultado.filas.values()]).toEqual([MANANA, MANANA]);
    expect(resultado.rastro).toBe(0);
  });

  it("R12: con `zonaId = null` (acceso total) esa MISMA orden de otra zona SI se corrige", async () => {
    // El control positivo. Sin el, «no se corrige» podria deberse a cualquier otra cosa.
    const dia = await conOrdenes([{ zonaId: ZONA_AJENA }], async (ctx) => {
      await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { fechaReparto: true },
      });
      return fila.fechaReparto;
    });
    expect(dia).toEqual(HOY);
  });

  /* ------------------------------------------------------------------------ */
  /* CASO 6 — LA TRAMPA HORARIA, PROBADA DE VERDAD                             */
  /* ------------------------------------------------------------------------ */

  it("⭑⭑ M-p: con la sesion en `America/Costa_Rica`, el dia persistido SIGUE siendo el correcto", async () => {
    // ⚠️ ESTE ES EL TEST QUE MATA LA MUTACION MAS DIFICIL DE VER. Si el `SET` recibiera el `Date` de
    // JS en vez de `fechaRepartoComoTexto(...)::date`, el driver `pg` lo serializaria como
    // `timestamptz` y Postgres lo convertiria a `date` con el `TimeZone` DE LA SESION: con la sesion
    // en UTC saldria el dia correcto y con la sesion en `America/Costa_Rica` saldria el ANTERIOR.
    // O sea: el dia de reparto dependeria de la configuracion del servidor de base de datos, y en
    // desarrollo (sesion en UTC) nadie lo veria nunca.
    const { dia, tz } = await conOrdenes([{ fechaReparto: MANANA }], async (ctx) => {
      await ctx.tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/Costa_Rica'`);
      // ANTI-VACUIDAD: si el `SET LOCAL` no hubiera tomado efecto —otra conexion, un pool que
      // reparte, un adaptador que no lo propaga—, este test estaria midiendo una sesion en UTC y
      // pasaria con CUALQUIER implementacion. Se comprueba que la sesion es la que decimos.
      const tzFilas = await ctx.tx.$queryRawUnsafe<{ TimeZone: string }[]>(`SHOW TimeZone`);
      await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const filas = await ctx.tx.$queryRawUnsafe<{ dia: string }[]>(
        `SELECT to_char("fecha_reparto", 'YYYY-MM-DD') AS dia FROM "orden" WHERE "id" = $1`,
        ctx.ids[0],
      );
      return { dia: filas[0].dia, tz: Object.values(tzFilas[0])[0] };
    });
    expect(tz, "el `SET LOCAL TIME ZONE` no tomo efecto: este test no estaria midiendo nada").toBe(
      "America/Costa_Rica",
    );
    expect(dia).toBe("2026-08-21");
  });

  it("⭑⭑ M-p (la otra mitad): el `fecha_anterior` del RASTRO tampoco se desplaza", async () => {
    const dia = await conOrdenes([{ fechaReparto: MANANA }], async (ctx) => {
      await ctx.tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/Costa_Rica'`);
      await ctx.repo.corregirDiaRepartoLote(ctx.ids, HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const filas = await ctx.tx.$queryRawUnsafe<{ anterior: string; nueva: string }[]>(
        `SELECT to_char("fecha_anterior", 'YYYY-MM-DD') AS anterior,
                to_char("fecha_nueva", 'YYYY-MM-DD') AS nueva
           FROM "orden_dia_reparto_cambio" WHERE "orden_id" = $1`,
        ctx.ids[0],
      );
      return filas[0];
    });
    expect(dia).toEqual({ anterior: "2026-08-22", nueva: "2026-08-21" });
  });

  /* ------------------------------------------------------------------------ */
  /* LA FORMA DEL SQL — `FOR UPDATE` y el `SET`                                */
  /* ------------------------------------------------------------------------ */

  /**
   * ⚠️ ASERCIONES DE **FORMA** SOBRE EL SQL EMITIDO, Y SE DECLARAN COMO TALES.
   *
   * NO son pruebas de comportamiento: no demuestran que el `FOR UPDATE` bloquee ni que el `::date`
   * evite un desplazamiento. Existen porque hay dos propiedades de esta escritura que NO son
   * observables desde fuera en este entorno, y decirlo es parte del trabajo:
   *
   *  · **`FOR UPDATE`** — probarlo de verdad exige DOS transacciones concurrentes peleandose por la
   *    misma fila, que es un test caro, lento y con carreras propias (M-l, declarada asi en el
   *    propio `design.md`).
   *  · **`::date` sobre TEXTO** — ⭑ MEDIDO EL 2026-08-22, y contra lo que se esperaba: con la sesion
   *    puesta en `America/Costa_Rica`, pasar el `Date` de JS SUELTO (sin `fechaRepartoComoTexto` ni
   *    `::date`) TAMBIEN persiste el dia correcto. El motivo es que el parametro va SIN TIPO y
   *    Postgres lo infiere del destino del `SET` —una columna `date`—, asi que lo parsea como fecha
   *    y no hay conversion horaria que aplicar. O sea: en ESTA sentencia la trampa de la 246 no se
   *    reproduce, y el test de la sesion en CR (mas abajo) pasa con las dos formas.
   *    La forma con texto SE CONSERVA igualmente —no depende de la inferencia, que cambia con el
   *    contexto y con la version del driver— y ES ESTA asercion la que la sostiene. La otra, la de
   *    la sesion en CR, se queda como red por si el driver cambia de criterio.
   *
   * El SQL se lee del cliente ESPIA, no se escribe a mano: escribirlo a mano demostraria que un SQL
   * inventado tiene la forma que decimos, no que la tenga el que corre en produccion.
   */
  it("⭑ M-l / M-p (FORMA): el SQL emitido lleva `FOR UPDATE` y el dia entra como texto `::date`", async () => {
    const { prisma: espia, eventos } = crearPrismaDeTestConEspia();
    try {
      await enTransaccionRevertida(espia, async (tx) => {
        await serializarEscriturasReales(tx);
        const orden = await tx.orden.create({
          data: {
            numGuia: GUIA_BASE + 999_002,
            numRemision: `R-${SUFIJO}-espia`,
            destinatario: "Corpus 262",
            telefonoDest: "88880000",
            producto: "caja",
            estatusId: ESTATUS.por_recoger,
            tiendaId: FKS.tiendaId,
            zonaId: FKS.zonaId,
            provinciaId: FKS.provinciaId,
            cantonId: FKS.cantonId,
            mensajeroAsignadoId: ACTOR,
            asignadoAt: ASIGNADO_AT,
            fechaReparto: MANANA,
          },
          select: { id: true },
        });
        eventos.length = 0; // solo interesa lo que emite la correccion
        const repo = new OrdenRepository(tx as unknown as PrismaClient);
        await repo.corregirDiaRepartoLote([orden.id], HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        });
      });
    } finally {
      await espia.$disconnect();
    }

    const consultas = eventos.map((e) => e.query);
    expect(consultas.length, "el espia no capturo ni una consulta").toBeGreaterThan(0);

    const select = consultas.find((q) => /SELECT[\s\S]*FROM "orden"/i.test(q) && /FOR UPDATE/i.test(q));
    expect(
      select,
      "el pre-SELECT del dia anterior NO lleva `FOR UPDATE`: sin el, el `fecha_anterior` del " +
        "rastro puede ser un valor que ya no era el de la fila (R24), y un rastro que miente es " +
        "peor que no tenerlo",
    ).toBeDefined();
    expect(select).toMatch(/ORDER BY\s+"id"/i); // orden de bloqueo determinista

    const update = consultas.find((q) => /^\s*UPDATE "orden"/im.test(q));
    expect(update, "no se emitio ningun UPDATE sobre `orden`").toBeDefined();
    expect(
      update,
      "el dia NO entra como texto con `::date` explicito. Ver el comentario de arriba: hoy la " +
        "inferencia de tipos de Postgres tapa el defecto, pero eso es una propiedad del driver y " +
        "del contexto, no del codigo.",
    ).toMatch(/"fecha_reparto"\s*=\s*\$\d+::date/i);
    // Y el `SET` sigue tocando SOLO las dos columnas de la excepcion declarada (§6.3 / B9).
    const set = (update as string).slice(
      (update as string).search(/\bSET\b/i),
      (update as string).search(/\bWHERE\b/i),
    );
    expect([...set.matchAll(/"([a-z_]+)"\s*=/g)].map((m) => m[1]).sort()).toEqual([
      "fecha_reparto",
      "updated_at",
    ]);
  });

  it("R23: la tabla del rastro es APPEND-ONLY tambien en la base (no tiene donde mutar)", async () => {
    const columnas = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orden_dia_reparto_cambio'
        ORDER BY column_name`,
    );
    const nombres = columnas.map((c) => c.column_name);
    expect(nombres.length, "la tabla del rastro no existe en la base").toBeGreaterThan(0);
    expect(nombres).not.toContain("updated_at");
    expect(nombres).not.toContain("deleted_at");
    expect(nombres.sort()).toEqual([
      "actor_usuario_id",
      "created_at",
      "fecha_anterior",
      "fecha_nueva",
      "id",
      "motivo",
      "orden_id",
    ]);
  });

  it("R7 en la base: el CHECK `fecha_nueva <> fecha_anterior` rechaza una correccion vacia", async () => {
    // La tercera y ultima red. Se intenta escribir a mano una fila con las dos fechas iguales.
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + 999_001,
          numRemision: `R-${SUFIJO}-check`,
          destinatario: "Corpus 262",
          telefonoDest: "88880000",
          producto: "caja",
          estatusId: ESTATUS.por_recoger,
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          mensajeroAsignadoId: ACTOR,
          asignadoAt: ASIGNADO_AT,
          fechaReparto: MANANA,
        },
        select: { id: true },
      });
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO "orden_dia_reparto_cambio"
             ("id","orden_id","fecha_anterior","fecha_nueva","actor_usuario_id","motivo")
           VALUES (gen_random_uuid()::text, $1, DATE '2026-08-21', DATE '2026-08-21', $2, $3)`,
          orden.id,
          ACTOR,
          MOTIVO,
        );
        return "escribio";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(resultado).not.toBe("escribio");
    expect(resultado).toContain("orden_dia_reparto_cambio_dia_distinto");
  });
});
