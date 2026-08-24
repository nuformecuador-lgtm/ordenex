import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 261 (B11, R1/R4/R5/R7/R8) — EL `WHERE` DE `recogerLote`, EJECUTADO CONTRA POSTGRES.
 *
 * ⚠️ POR QUE ESTE ARCHIVO EXISTE aunque ya haya tests de servicio de la misma regla. Un test de
 * servicio con dobles NO VE EL SQL: el doble de `recogerLote` acepta cualquier cosa y devuelve
 * lo que le digan. Medido cuatro veces seguidas en este repo: una mutacion del `WHERE` deja once
 * tests de servicio EN VERDE. Y R5 es explicitamente «el rechazo vive en el servidor, de modo
 * que una peticion que no venga de la interfaz del portal sea rechazada igual» — eso es una
 * afirmacion sobre la SENTENCIA, no sobre el servicio.
 *
 * QUE SIEMBRA: tres ordenes del MISMO mensajero en `por_recoger`, identicas salvo por el dia de
 * reparto —mañana, hoy y `NULL`—, y llama a `recogerLote` con `diaEnCurso = hoy`. Cada fila es
 * el testigo de una rama del predicado.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si
 * el proceso muere, no queda ni una fila.
 *
 * SIN BASE ALCANZABLE se SALTA ENTERO y con su nombre en el reporte. Con base pero sin catalogo,
 * REVIENTA con un mensaje que dice que hay que sembrar: un `if (!fks) return;` reporta `passed`
 * sin haber comprobado nada, y eso ya paso aqui.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` y `num_guia` son UNIQUE en `orden`. */
const SUFIJO = `261-recoger-${Date.now().toString(36)}`;
const GUIA_BASE = 910_000_000 + (Date.now() % 40_000_000);

/** El dia de Costa Rica «en curso» del test, en la convencion `@db.Date`. */
const HOY = new Date("2026-08-21T00:00:00.000Z");
const MANANA = new Date("2026-08-22T00:00:00.000Z");
const AYER = new Date("2026-08-20T00:00:00.000Z");

/** Las cuatro filas del corpus. La clave es lo que las distingue. */
const SEMILLAS: { clave: string; fechaReparto: Date | null }[] = [
  { clave: "reservada-manana", fechaReparto: MANANA },
  { clave: "de-hoy", fechaReparto: HOY },
  { clave: "sin-dia", fechaReparto: null },
  { clave: "de-ayer", fechaReparto: AYER },
];

/** Cola de jobs en memoria: `recogerLote` encola la reoptimizacion dentro de su tx. */
function colaFake() {
  return {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

describeSiHayBase("261/B11 — el dia de reparto en el `WHERE` de recogerLote, contra Postgres", () => {
  let prisma: PrismaClient;

  /** Ejecuta `fn` con el corpus sembrado y revierte todo al terminar. */
  let conCorpus: <T>(
    fn: (ctx: {
      repo: GestionOrdenRepository;
      tx: PrismaClient;
      mensajeroId: string;
      porRecogerId: string;
      enRepartoId: string;
      idPorClave: Map<string, string>;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, no `return` silencioso: con base alcanzable y sin catalogo este archivo no
    // puede comprobar nada, y un `passed` en esas condiciones es la clase de verde que este repo
    // ya se comio una vez.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: ["por_recoger", "en_reparto"] } },
      select: { id: true, value: true },
    });
    const porRecogerId = estados.find((e) => e.value === "por_recoger")?.id;
    const enRepartoId = estados.find((e) => e.value === "en_reparto")?.id;
    if (!porRecogerId || !enRepartoId) {
      throw new Error(
        "el catalogo `order_status` no tiene `por_recoger` y/o `en_reparto`: sin ellos no hay " +
          "transicion que medir. Corre el seed del catalogo.",
      );
    }
    // `mensajero_asignado_id` es FK -> `usuario`. Se reusa el id de la tienda de una orden real:
    // lo que se mide aqui es un WHERE, no un rol.
    const mensajeroId = fks.tiendaId;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en las tablas
        // reales de `public` (ver `_postgres-real.ts`).
        await serializarEscriturasReales(tx);

        const idPorClave = new Map<string, string>();
        let n = 0;
        for (const s of SEMILLAS) {
          n += 1;
          const orden = await tx.orden.create({
            data: {
              numGuia: GUIA_BASE + n,
              numRemision: `R-${SUFIJO}-${s.clave}`,
              destinatario: "Corpus 261",
              telefonoDest: "88880000",
              producto: "caja",
              estatusId: porRecogerId,
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
              mensajeroAsignadoId: mensajeroId,
              asignadoAt: new Date("2026-08-21T12:00:00.000Z"),
              fechaReparto: s.fechaReparto,
            },
            select: { id: true },
          });
          idPorClave.set(s.clave, orden.id);
        }

        const repo = new GestionOrdenRepository(
          tx as unknown as PrismaClient,
          colaFake() as never,
        );
        return fn({
          repo,
          tx: tx as unknown as PrismaClient,
          mensajeroId,
          porRecogerId,
          enRepartoId,
          idPorClave,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R1/R8: de las cuatro, transicionan TRES — la reservada para mañana NO", async () => {
    const { movidas, esperadas, afectadas } = await conCorpus(async (ctx) => {
      const ids = [...ctx.idPorClave.values()];
      const afectadas = await ctx.repo.recogerLote(
        ids,
        ctx.mensajeroId,
        ctx.porRecogerId,
        ctx.enRepartoId,
        HOY,
      );
      const filas = await ctx.tx.orden.findMany({
        where: { id: { in: ids } },
        select: { id: true, estatusId: true },
      });
      const claves = new Map([...ctx.idPorClave].map(([k, v]) => [v, k]));
      return {
        afectadas,
        movidas: filas
          .filter((f) => f.estatusId === ctx.enRepartoId)
          .map((f) => claves.get(f.id) as string)
          .sort(),
        esperadas: ["de-ayer", "de-hoy", "sin-dia"],
      };
    });

    // Igualdad EXACTA: lo que sobra importa tanto como lo que falta.
    //  · `sin-dia`  -> R8: `NULL` entra por la primera rama del `OR` y se recoge igual que siempre.
    //  · `de-hoy`   -> el limite es `<=` y no `<`: una orden reservada para HOY es de hoy (M-e).
    //  · `de-ayer`  -> una reserva que ya paso tampoco bloquea.
    //  · la de mañana queda fuera, y la produce SOLO la condicion nueva del `WHERE` (M-d).
    expect(movidas).toEqual(esperadas);
    expect(afectadas).toBe(3);
  });

  it("R1: la reservada SIGUE en `por_recoger` — el UPDATE no la toco", async () => {
    const { estatus, porRecogerId } = await conCorpus(async (ctx) => {
      await ctx.repo.recogerLote(
        [...ctx.idPorClave.values()],
        ctx.mensajeroId,
        ctx.porRecogerId,
        ctx.enRepartoId,
        HOY,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.idPorClave.get("reservada-manana") as string },
        select: { estatusId: true },
      });
      return { estatus: fila.estatusId, porRecogerId: ctx.porRecogerId };
    });

    expect(estatus).toBe(porRecogerId);
  });

  it("⭑ R4: la reservada NO deja fila de historial (el `RETURNING` no la incluyo)", async () => {
    // ESTA es la mitad que un test de estado no ve. `recogerLote` hace el append sobre los ids
    // que devuelve el `RETURNING`: si la orden pierde la guarda no aparece ahi y NO DEJA RASTRO.
    // Un `WHERE` sin la condicion del dia dejaria aqui una fila `recoleccion` fantasma.
    const { historialReservada, historialDeHoy } = await conCorpus(async (ctx) => {
      await ctx.repo.recogerLote(
        [...ctx.idPorClave.values()],
        ctx.mensajeroId,
        ctx.porRecogerId,
        ctx.enRepartoId,
        HOY,
      );
      const contar = (ordenId: string) =>
        ctx.tx.ordenHistorialEstado.count({ where: { ordenId, origenTipo: "recoleccion" } });
      return {
        historialReservada: await contar(ctx.idPorClave.get("reservada-manana") as string),
        historialDeHoy: await contar(ctx.idPorClave.get("de-hoy") as string),
      };
    });

    expect(historialReservada).toBe(0);
    // Y la mitad positiva: si esto fuera 0 tambien, el test estaria midiendo el vacio.
    expect(historialDeHoy).toBe(1);
  });

  it("R1/R4: pidiendo SOLO la reservada, no se afecta ninguna fila", async () => {
    // El lote de una sola orden: la guarda no depende de que la acompañen otras.
    const afectadas = await conCorpus(async (ctx) =>
      ctx.repo.recogerLote(
        [ctx.idPorClave.get("reservada-manana") as string],
        ctx.mensajeroId,
        ctx.porRecogerId,
        ctx.enRepartoId,
        HOY,
      ),
    );

    expect(afectadas).toBe(0);
  });

  it("R7: la MISMA fila, con el dia siguiente, SI se recoge — sin escribir nada por el camino", async () => {
    // R7 dicho contra la base: el bloqueo caduca SOLO. No se toca `fecha_reparto`; lo unico que
    // cambia es el `diaEnCurso` que entra en el `WHERE`.
    const { afectadas, fechaRepartoDespues } = await conCorpus(async (ctx) => {
      const id = ctx.idPorClave.get("reservada-manana") as string;
      const afectadas = await ctx.repo.recogerLote(
        [id],
        ctx.mensajeroId,
        ctx.porRecogerId,
        ctx.enRepartoId,
        MANANA,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id },
        select: { fechaReparto: true },
      });
      return { afectadas, fechaRepartoDespues: fila.fechaReparto };
    });

    expect(afectadas).toBe(1);
    // La reserva sigue ahi: recoger no escribe el dia (R22).
    expect(fechaRepartoDespues).toEqual(MANANA);
  });

  it("el dia entra como fecha CALENDARIO: la hora del `diaEnCurso` no mueve el resultado", async () => {
    // `fechaRepartoComoTexto` lee los campos UTC del `Date`, asi que un `diaEnCurso` con hora
    // sigue siendo el mismo dia. Si alguien pasara el `Date` crudo al SQL en vez del texto
    // `YYYY-MM-DD::date`, el `TimeZone` de la sesion decidiria el dia y este caso lo delataria.
    const afectadas = await conCorpus(async (ctx) =>
      ctx.repo.recogerLote(
        [ctx.idPorClave.get("de-hoy") as string],
        ctx.mensajeroId,
        ctx.porRecogerId,
        ctx.enRepartoId,
        new Date("2026-08-21T00:00:00.000Z"),
      ),
    );

    expect(afectadas).toBe(1);
  });

  it("R5: las guardias VIEJAS siguen ahi — otra orden de OTRO mensajero no se toca", async () => {
    // No-regresion: la condicion nueva se SUMA a propiedad + origen + no-borrada, no las
    // sustituye. Si el `WHERE` se hubiera reescrito, esto lo caza.
    const afectadas = await conCorpus(async (ctx) =>
      ctx.repo.recogerLote(
        [...ctx.idPorClave.values()],
        "no-existe-este-mensajero-261",
        ctx.porRecogerId,
        ctx.enRepartoId,
        HOY,
      ),
    );

    expect(afectadas).toBe(0);
  });
});
