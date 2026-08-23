import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { RESERVA_MOTIVO_SERVIDOR } from "@/lib/utils/dia-reparto-textos";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  IGestionOrdenRepository,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑ FEATURE 262 (B13, R25/R26/R30/R31) — LAS AUSENCIAS Y LAS CONSECUENCIAS, contra Postgres real.
 *
 * POR QUE AQUI Y NO CON DOBLES:
 *
 *  · **R25 es una AUSENCIA.** «No se añade ninguna entrada a la línea de tiempo de estados» sólo se
 *    puede afirmar CONTANDO FILAS antes y después. Un doble no tiene filas que contar.
 *  · **R26 se lee de la BASE.** `pg_class.relrowsecurity`, no el `.sql` de la migración: afirmar que
 *    la RLS está activa leyendo el archivo que la escribe es una aserción contra su propia fuente —
 *    siempre verde, incluso si la migración nunca se aplicó.
 *  · **R30 es el predicado del corte**, evaluado contra la fila ya corregida.
 *  · **R31** usa el servicio de la 261 alimentado con el valor QUE LA BASE DEVOLVIÓ tras corregir.
 *    Así no se compara la regla contra sí misma: el dato viaja de la escritura real al predicado
 *    real.
 *
 * ⚠️ NADA DE `if (!fks) return;`: con base y sin catálogo esto REVIENTA. Sin base, `describe.skip`
 * visible. Todo dentro de una transacción que siempre se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `262-efe-${Date.now().toString(36)}`;
const GUIA_BASE = 940_000_000 + (Date.now() % 40_000_000);

const HOY = new Date("2026-08-21T00:00:00.000Z");
const MANANA = new Date("2026-08-22T00:00:00.000Z");
/** 22:30 CR del 21 = 04:30Z del 22. El dia CR y el UTC no coinciden: es a proposito. */
const NOCHE_DEL_21 = new Date("2026-08-22T04:30:00.000Z");
const ASIGNADO_AT = new Date("2026-08-19T15:00:00.000Z");
const MOTIVO = "la bodega marco el lote para el dia siguiente por error";

const MENSAJERO_ACTOR: Actor = { usuarioId: "m1", rol: "mensajero" };

describeSiHayBase("262/B13 — las ausencias y las consecuencias, contra Postgres real", () => {
  let prisma: PrismaClient;
  let ESTATUS: Record<string, string>;
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };
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

    const valores = ["por_recoger", "en_reparto", "ayuda_tienda"];
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: valores } },
      select: { id: true, value: true },
    });
    ESTATUS = Object.fromEntries(estados.map((e) => [e.value, e.id]));
    const faltan = valores.filter((v) => !ESTATUS[v]);
    if (faltan.length > 0) {
      throw new Error(
        `el catalogo \`order_status\` no tiene ${faltan.join(", ")}. Corre el seed del catalogo.`,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function estatusIdsAdmitidos(): string[] {
    return [ESTATUS.por_recoger, ESTATUS.en_reparto, ESTATUS.ayuda_tienda];
  }

  /** Siembra UNA orden asignada con `fechaReparto` y ejecuta `fn`. Todo se revierte. */
  async function conOrden<T>(
    fechaReparto: Date,
    fn: (ctx: { repo: OrdenRepository; tx: PrismaClient; ordenId: string }) => Promise<T>,
    estatusValue = "por_recoger",
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000),
          numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 10)}`,
          destinatario: "Corpus 262",
          telefonoDest: "88880000",
          producto: "caja",
          estatusId: ESTATUS[estatusValue],
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          mensajeroAsignadoId: ACTOR,
          asignadoAt: ASIGNADO_AT,
          fechaReparto,
          intentosContacto: 2, // un valor DISTINGUIBLE: si algo lo tocara, se veria
        },
        select: { id: true },
      });
      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      return fn({ repo, tx: tx as unknown as PrismaClient, ordenId: orden.id });
    });
  }

  /* ------------------------------------------------------------------------ */
  /* R25 — LAS AUSENCIAS                                                       */
  /* ------------------------------------------------------------------------ */

  it("⭑ R25: la correccion NO añade NI UNA fila a `orden_historial_estado`", async () => {
    // Es la razon por la que el rastro tiene tabla propia (A1): una fila falsa
    // `por_recoger -> por_recoger` en el historial rompería «Deshacer asignación» por
    // `findOrigenesReversion`, la rechazaría el choke point por transición ilegal y emitiría un
    // webhook duplicado a los integradores. Aquí se afirma que no ocurre.
    const { antes, despues } = await conOrden(MANANA, async (ctx) => {
      const antes = await ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } });
      await ctx.repo.corregirDiaRepartoLote(
        [ctx.ordenId],
        HOY,
        estatusIdsAdmitidos(),
        null,
        { actorUsuarioId: ACTOR, motivo: MOTIVO },
      );
      const despues = await ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } });
      return { antes, despues };
    });

    expect(despues).toBe(antes);
  });

  it("⭑ R25: tampoco cambia el conteo de intentos ni crea ninguna gestion", async () => {
    // «Intentos de entrega» se deriva de las GESTIONES vigentes en cierres aprobados (215/R6), y
    // `intentos_contacto` es el contador que lleva la tienda. La corrección no toca ninguno de los
    // dos: no crea gestión y no escribe la columna.
    const r = await conOrden(MANANA, async (ctx) => {
      const gestionesAntes = await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } });
      const antes = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { intentosContacto: true },
      });
      await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const gestionesDespues = await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } });
      const despues = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { intentosContacto: true },
      });
      return { gestionesAntes, gestionesDespues, antes, despues };
    });

    expect(r.gestionesDespues).toBe(r.gestionesAntes);
    expect(r.despues.intentosContacto).toBe(r.antes.intentosContacto);
    expect(r.antes.intentosContacto).toBe(2); // anti-vacuidad: el valor sembrado se leyo de verdad
  });

  /* ------------------------------------------------------------------------ */
  /* R26 — LA RLS, LEIDA DE LA BASE                                            */
  /* ------------------------------------------------------------------------ */

  it("⭑ R26: `orden_dia_reparto_cambio` tiene la RLS ACTIVA en la base", async () => {
    // Se lee `pg_class.relrowsecurity`, NO el `.sql` de la migración. Afirmarlo leyendo el archivo
    // que lo escribe sería una aserción contra su propia fuente: seguiría verde aunque la migración
    // no se hubiera aplicado nunca.
    const filas = await prisma.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'orden_dia_reparto_cambio'`,
    );
    expect(filas, "la tabla del rastro no existe en la base aplicada").toHaveLength(1);
    expect(filas[0].relrowsecurity).toBe(true);
  });

  it("R26: y NO tiene policies — este repo no usa Supabase Auth, la autorizacion vive en el service", async () => {
    // Patrón `orden_nota` / `plantilla_mensaje` / `notificacion` / `orden_historial_estado`. Una
    // policy no tendría a quién preguntar (no hay `auth.uid()`); lo que la RLS garantiza es lo que
    // R26 pide: a estas filas no se llega si no es por el servidor de la aplicación.
    const filas = await prisma.$queryRawUnsafe<{ policyname: string }[]>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'orden_dia_reparto_cambio'`,
    );
    expect(filas).toEqual([]);
  });

  it("R26: la RLS de la tabla del rastro es la MISMA postura que la del historial de estados", async () => {
    // Control positivo: si la consulta de arriba estuviera mal escrita, esto lo delataría.
    const filas = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('orden_dia_reparto_cambio', 'orden_historial_estado')
        ORDER BY c.relname`,
    );
    expect(filas.map((f) => f.relrowsecurity)).toEqual([true, true]);
  });

  /* ------------------------------------------------------------------------ */
  /* R30 — EL CORTE CAMBIA DE OPINION CON EL DIA                               */
  /* ------------------------------------------------------------------------ */

  it("⭑ R30: corregida a MAÑANA, el corte de esta noche DEJA de alcanzarla", async () => {
    // El predicado REAL del corte, contra la base: `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)`.
    const alcanzadas = await conOrden(HOY, async (ctx) => {
      await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], MANANA, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const barridas = await ctx.tx.orden.findMany({
        where: {
          id: ctx.ordenId,
          OR: [{ fechaReparto: null }, { fechaReparto: { lte: HOY } }],
        },
        select: { id: true },
      });
      return barridas.length;
    });
    expect(alcanzadas).toBe(0);
  });

  it("⭑ R30: corregida al DIA EN CURSO, el corte de esta noche VUELVE a alcanzarla", async () => {
    // La otra mitad, y sin ella la de arriba pasaría también con una fila que nunca se movió.
    const alcanzadas = await conOrden(MANANA, async (ctx) => {
      await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const barridas = await ctx.tx.orden.findMany({
        where: {
          id: ctx.ordenId,
          OR: [{ fechaReparto: null }, { fechaReparto: { lte: HOY } }],
        },
        select: { id: true },
      });
      return barridas.length;
    });
    expect(alcanzadas).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* R31 — EL MENSAJERO SE DESBLOQUEA SOLO, SIN NINGUNA OTRA ACCION            */
  /* ------------------------------------------------------------------------ */

  it("⭑⭑ R31: con la fila ya corregida a HOY, la guarda de la 261 DEJA de dispararse", async () => {
    // ⚠️ EL DATO VIAJA DE LA ESCRITURA REAL AL PREDICADO REAL. Lo que se le da al servicio de la
    // 261 es el `fecha_reparto` QUE LA BASE DEVOLVIÓ después de corregir, no un valor escrito a
    // mano en el test. Si se escribiera a mano, esto sería una aserción contra su propia fuente.
    //
    // Y no se escribe NADA MÁS para desbloquear: la única escritura fue la corrección.
    const { antesDeCorregir, despuesDeCorregir, escrituras } = await conOrden(
      MANANA,
      async (ctx) => {
        const antesDeCorregir = await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ordenId },
          select: { fechaReparto: true },
        });
        await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], HOY, estatusIdsAdmitidos(), null, {
          actorUsuarioId: ACTOR,
          motivo: MOTIVO,
        });
        const despuesDeCorregir = await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ordenId },
          select: { fechaReparto: true },
        });
        // «Sin que se escriba nada más» (R31): el ÚNICO rastro de esta operación es la fila del
        // cambio; ni gestión, ni historial, ni ruta.
        const escrituras = {
          rastro: await ctx.tx.ordenDiaRepartoCambio.count({ where: { ordenId: ctx.ordenId } }),
          historial: await ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } }),
          gestiones: await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
        };
        return { antesDeCorregir, despuesDeCorregir, escrituras };
      },
      "en_reparto", // el caso que la puerta humana nombró: el paquete YA en la mano del mensajero
    );

    // ANTES: la fila real bloqueaba.
    const bloqueada = await escoger(antesDeCorregir.fechaReparto);
    expect(bloqueada.status).toBe("conflict");
    if (bloqueada.status === "conflict") expect(bloqueada.motivo).toBe(RESERVA_MOTIVO_SERVIDOR);

    // DESPUÉS: la MISMA guarda, con el valor que la base devolvió, deja de dispararse.
    const desbloqueada = await escoger(despuesDeCorregir.fechaReparto);
    expect(desbloqueada.status).toBe("ok");

    expect(escrituras.rastro).toBe(1);
    expect(escrituras.historial).toBe(0);
    expect(escrituras.gestiones).toBe(0);
  });

  /**
   * Ejercita `MisAsignacionesService.escoger` —la guarda de la 261— con el `fechaReparto` que la
   * base devolvió. El resto del servicio va con dobles: aquí lo que se mide es SÓLO si esa guarda
   * se dispara o no.
   */
  async function escoger(fechaReparto: Date | null) {
    const gestionRow: OrdenGestionRow = {
      id: "o1",
      estatusValue: "en_reparto",
      deletedAt: null,
      mensajeroAsignadoId: "m1",
      montoCobrar: 100,
      zonaId: "z1",
      fechaReparto,
    };
    const repo = {
      findMisAsignaciones: vi.fn(async () => []),
      findMisAsignacionesByIds: vi.fn(async () => []),
      contarEntregadas: vi.fn(async () => 0),
      sumMontoCobrarGestionadas: vi.fn(async () => 0),
      findByIdsParaGestion: vi.fn(async () => [gestionRow]),
      getOrdenEnGestion: vi.fn(async () => null),
      setOrdenEnGestion: vi.fn(async () => true),
      liberarOrdenEnGestion: vi.fn(async () => true),
      recogerLote: vi.fn(async (ids: string[]) => ids.length),
      crearGestionYTransicionar: vi.fn(async () => "g1"),
      reprogramarDesdeDevuelta: vi.fn(async () => true),
      crearGestionDesdeAyuda: vi.fn(async () => "g-ayuda"),
      rechazarDesdeDevuelta: vi.fn(async () => true),
    } as unknown as IGestionOrdenRepository;
    const ordenRepo = {
      findEstatusIdByValue: vi.fn(async (v: string) => `os-${v}`),
      findMensajerosBloqueadosParaGestion: vi.fn(async () => new Set<string>()),
    } as unknown as Pick<
      IOrdenRepository,
      "findEstatusIdByValue" | "findMensajerosBloqueadosParaGestion"
    >;
    const storage = {
      upload: vi.fn(async (input: { path: string }) => input.path),
      remove: vi.fn(async () => {}),
    } as unknown as IFileStorage;
    const signed = {
      createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
      createSignedUrls: vi.fn(async (ps: string[]) =>
        Object.fromEntries(ps.map((p) => [p, `https://signed/${p}`])),
      ),
    } as unknown as ISignedUrlProvider;
    const rutaRepo = {
      findByMensajero: vi.fn(async () => null),
      upsertOrigen: vi.fn(async () => {}),
    } as unknown as Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">;
    const metaRepo = {
      findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
    } as unknown as Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero">;

    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      storage,
      signed,
      rutaRepo,
      metaRepo,
      fakeIntentosEnLote(),
    );
    return service.escogerParaGestion("o1", MENSAJERO_ACTOR, NOCHE_DEL_21);
  }
});
