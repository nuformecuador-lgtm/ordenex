import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RutaOptimizadaRepository } from "@/lib/repositories/RutaOptimizadaRepository";
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
 * ⭑ FEATURE 262 (B13, R25/R26/R30/R31/R32) — LAS AUSENCIAS Y LAS CONSECUENCIAS, contra Postgres
 * real.
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
 *  · **R32 es OTRA AUSENCIA, y es la que faltaba.** «La corrección no altera la ruta optimizada del
 *    mensajero ni los indicadores de su portal» sólo se puede afirmar con ruta SEMBRADA que perder:
 *    con la tabla vacía, cualquier conteo da cero y sigue dando cero aunque la corrección borre
 *    todo. Ver el bloque R32 al final del archivo.
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
  /** Catálogos para fabricar un mensajero PROPIO en el bloque R32 (ver `conOrdenEnRuta`). */
  let TIPO_IDENTIFICACION_ID: string;
  let ROL_MENSAJERO_ID: string;

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

    // R32 siembra un mensajero PROPIO (el porqué está en `conOrdenEnRuta`). Fallo CERRADO y
    // ruidoso si faltan los catálogos: sin ellos el bloque R32 no puede sembrar nada, y un test
    // que no siembra nada mide cero y se pone verde.
    const [tipoIdentificacion, rolMensajero] = await Promise.all([
      prisma.tipoIdentificacion.findFirst({ select: { id: true } }),
      prisma.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } }),
    ]);
    if (tipoIdentificacion === null || rolMensajero === null) {
      throw new Error(
        "la base local no tiene los catalogos `tipo_identificacion` / `rol` (valor `mensajero`): " +
          "sin ellos no se puede sembrar el mensajero con ruta que R32 necesita. Corre el seed.",
      );
    }
    TIPO_IDENTIFICACION_ID = tipoIdentificacion.id;
    ROL_MENSAJERO_ID = rolMensajero.id;
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
        // cambio; ni gestión ni historial.
        //
        // ⚠️ LA RUTA NO SE CUENTA AQUI, Y ES A PROPOSITO. Esta orden no tiene ruta sembrada, así
        // que un `rutaOptimizadaParada.count()` daría 0 antes y 0 después PASE LO QUE PASE —
        // incluso si la corrección borrara la ruta entera. Sería una aserción vacua vestida de
        // comprobación, que es peor que no tenerla. La ruta se comprueba en el bloque **R32** del
        // final de este archivo, donde SÍ hay ruta que perder. (Hasta el 2026-08-23 este
        // comentario prometía «ni ruta» y el código de abajo no la contaba.)
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

  /* ------------------------------------------------------------------------ */
  /* R32 — LA RUTA OPTIMIZADA Y LOS INDICADORES DEL PORTAL, INTACTOS           */
  /* ------------------------------------------------------------------------ */

  /**
   * ⭑⭑ POR QUE ESTE BLOQUE EXISTE, ESCRITO EL 2026-08-23.
   *
   * Hasta hoy **R32 no tenía ningún test que mordiera**, y no es una sospecha: la revisión
   * (`progress/review_262.md`, bloqueante 1) inyectó dentro de `corregirDiaRepartoLote`, en su
   * MISMA transacción, exactamente el defecto que R32 prohíbe —
   *
   *     await tx.rutaOptimizadaParada.deleteMany({
   *       where: { ordenId: { in: movidas.map((m) => m.id) } },
   *     });
   *
   * — y `vitest related lib/repositories/OrdenRepository.ts` devolvió **245 archivos, 3.302 tests,
   * CERO rojos**. La corrección podía empezar a borrar la ruta del mensajero y nadie se enteraba.
   * El mapa lo asignaba a `B15` («correr las suites de ruta sin tocarlas») y a `F6` («ver la app»),
   * y ninguna de las dos es una aserción.
   *
   * POR QUE HACE FALTA SEMBRAR RUTA, Y NO BASTA CONTAR. Con la tabla vacía, `count()` da 0 antes y
   * 0 después haga lo que haga la corrección: la aserción parece una comprobación y no lo es. Aquí
   * hay **cabecera + una parada posicionada con su tramo** que perder, y las tres pruebas fallan si
   * se pierden.
   *
   * POR QUE UN MENSAJERO PROPIO. `ruta_optimizada.mensajero_id` es **UNIQUE**: reusar el usuario
   * semilla haría que el `create` reventara con `P2002` en cualquier máquina donde ese usuario ya
   * tuviera ruta. Y un mensajero recién creado no tiene NINGUNA otra orden asignada, así que el
   * listado del portal que se compara antes/después describe exactamente lo que este test sembró y
   * nada más. La base local es COMPARTIDA: la única forma de que el corpus sea el mismo en todas
   * las máquinas es fabricarlo dentro de la transacción que se revierte.
   */

  /** Corpus de R32: mensajero propio + orden `en_reparto` + ruta vigente con su parada. */
  interface CorpusConRuta {
    repo: OrdenRepository;
    tx: PrismaClient;
    ordenId: string;
    mensajeroId: string;
    rutaId: string;
  }

  const CALCULADA_AT = new Date("2026-08-20T13:00:00.000Z");
  const ORIGEN_AT = new Date("2026-08-20T12:58:00.000Z");
  const TRAMO_VIVO_AT = new Date("2026-08-20T13:05:00.000Z");

  async function conOrdenEnRuta<T>(
    fechaReparto: Date,
    fn: (ctx: CorpusConRuta) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (txRaw) => {
      await serializarEscriturasReales(txRaw);
      const tx = txRaw as unknown as PrismaClient;
      const marca = `${SUFIJO}-${Math.random().toString(36).slice(2, 10)}`;

      const mensajero = await tx.usuario.create({
        data: {
          nombre: `mensajero-${marca}`,
          email: `${marca}@262-r32.local`,
          telefono: "88880000",
          passwordHash: "no-es-una-credencial",
          cedula: marca,
          tipoIdentificacionId: TIPO_IDENTIFICACION_ID,
          rolId: ROL_MENSAJERO_ID,
          zonaId: FKS.zonaId,
        },
        select: { id: true },
      });

      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000),
          numRemision: `R-${marca}`,
          destinatario: "Corpus 262 R32",
          telefonoDest: "88880000",
          producto: "caja",
          // `en_reparto`: el paquete YA está en la moto, que es cuando la orden ES parada de la
          // ruta optimizada (92/R28). Una `por_recoger` no lo es y el corpus no probaría nada.
          estatusId: ESTATUS.en_reparto,
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          mensajeroAsignadoId: mensajero.id,
          asignadoAt: ASIGNADO_AT,
          fechaReparto,
          intentosContacto: 2,
          montoCobrar: 12_345, // valor DISTINGUIBLE: alimenta `porCobrar`/`totalACobrar`
        },
        select: { id: true },
      });

      // Cabecera CON TODAS SUS COLUMNAS LLENAS. Las nueve que se rellenan aquí son las que el
      // portal sirve en `RutaResumenDTO` (estado, calculadaAt, origenFuente, secuenciaFuente,
      // trazado) más las que sólo viven en la fila: si una escritura descuidada tocara cualquiera
      // de ellas, la comparación de fila entera de más abajo lo vería.
      const ruta = await tx.rutaOptimizada.create({
        data: {
          mensajeroId: mensajero.id,
          estado: "vigente",
          calculadaAt: CALCULADA_AT,
          origenLat: 9.9333296,
          origenLng: -84.0833282,
          origenAt: ORIGEN_AT,
          origenFuente: "gps",
          huellaSet: `huella-${marca}`,
          secuenciaFuente: "proveedor",
          trazadoPolilinea: "yzocFzynhVq}@n}@o}@nzD",
          trazadoDistanciaM: 4_210,
          trazadoDuracionS: 640,
          trazadoFuente: "routes",
          tramoVivoAt: TRAMO_VIVO_AT,
        },
        select: { id: true },
      });

      await tx.rutaOptimizadaParada.create({
        data: {
          rutaId: ruta.id,
          ordenId: orden.id,
          secuencia: 1,
          tramoPolilinea: "cxocFvxnhVoJnG",
          tramoDistanciaM: 1_180,
          tramoDuracionS: 210,
        },
      });

      const repo = new OrdenRepository(tx);
      return fn({ repo, tx, ordenId: orden.id, mensajeroId: mensajero.id, rutaId: ruta.id });
    });
  }

  it("⭑⭑ R32: la correccion NO TOCA NI UNA FILA de la ruta optimizada del mensajero", async () => {
    // La mitad literal de R32: «no debe alterar la RUTA OPTIMIZADA del mensajero». Se comparan las
    // FILAS ENTERAS —cabecera y paradas— leídas de la base antes y después, no un puñado de
    // columnas elegidas: `updated_at` de la cabecera lleva `@updatedAt`, así que cualquier
    // escritura sobre ella, aunque no cambiara ningún valor de negocio, movería la fila y esto se
    // pondría rojo.
    const r = await conOrdenEnRuta(MANANA, async (ctx) => {
      const cabeceraAntes = await ctx.tx.rutaOptimizada.findUniqueOrThrow({
        where: { id: ctx.rutaId },
      });
      const paradasAntes = await ctx.tx.rutaOptimizadaParada.findMany({
        where: { rutaId: ctx.rutaId },
        orderBy: { secuencia: "asc" },
      });

      await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });

      const cabeceraDespues = await ctx.tx.rutaOptimizada.findUniqueOrThrow({
        where: { id: ctx.rutaId },
      });
      const paradasDespues = await ctx.tx.rutaOptimizadaParada.findMany({
        where: { rutaId: ctx.rutaId },
        orderBy: { secuencia: "asc" },
      });
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { fechaReparto: true },
      });
      return { cabeceraAntes, cabeceraDespues, paradasAntes, paradasDespues, fila, ctx: ctx.ordenId };
    });

    // ANTI-VACUIDAD (1): la corrección OCURRIÓ. Sin esto, un repo que no hiciera nada pasaría.
    expect(r.fila.fechaReparto?.toISOString()).toBe(HOY.toISOString());
    // ANTI-VACUIDAD (2): HABÍA una parada de esta orden que perder. Sin esto, el `toEqual` de dos
    // listas vacías sería verde aunque la corrección borrara la ruta entera.
    expect(r.paradasAntes).toHaveLength(1);
    expect(r.paradasAntes[0].ordenId).toBe(r.ctx);
    expect(r.paradasAntes[0].secuencia).toBe(1);

    // R32: ni la parada ni la cabecera se movieron. `toEqual` de la fila COMPLETA.
    expect(r.paradasDespues).toEqual(r.paradasAntes);
    expect(r.cabeceraDespues).toEqual(r.cabeceraAntes);
  });

  it("⭑⭑ R32: los INDICADORES DEL PORTAL del mensajero no se mueven al corregir", async () => {
    // La otra mitad de R32: «ni los indicadores de su portal». Se compara el resultado REAL de
    // `MisAsignacionesService.listarMisAsignaciones` antes y después, con los repositorios REALES
    // sobre la transacción: la secuencia de la ruta y los KPIs salen de la base, no de un doble
    // que devolvería lo mismo pase lo que pase.
    const r = await conOrdenEnRuta(MANANA, async (ctx) => {
      const antes = await listarPortal(ctx.tx, ctx.mensajeroId);
      await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const despues = await listarPortal(ctx.tx, ctx.mensajeroId);
      return { antes, despues, ordenId: ctx.ordenId };
    });

    if (r.antes.status !== "ok" || r.despues.status !== "ok") {
      throw new Error(`el portal del mensajero devolvio ${r.antes.status}/${r.despues.status}`);
    }

    // ANTI-VACUIDAD (1): el portal veía la orden como parada POSICIONADA de la ruta.
    expect(r.antes.porGestionar.map((o) => [o.id, o.secuenciaRuta])).toEqual([[r.ordenId, 1]]);
    expect(r.antes.ruta.paradasSinOptimizar).toBe(0);
    expect(r.antes.ruta.trazado?.encodedPolyline).toBe("yzocFzynhVq}@n}@o}@nzD");
    // ANTI-VACUIDAD (2): la corrección SÍ se nota donde TIENE que notarse — el día de la orden.
    // Sin este par, «nada cambió» podría significar «no pasó nada» en vez de «pasó lo que debía».
    expect([
      r.antes.porGestionar[0].fechaRepartoISO,
      r.despues.porGestionar[0].fechaRepartoISO,
    ]).toEqual(["2026-08-22", "2026-08-21"]);
    expect([r.antes.porGestionar[0].esParaManana, r.despues.porGestionar[0].esParaManana]).toEqual([
      true,
      false,
    ]);

    // R32: y NO se nota en ningún indicador del portal.
    expect(r.despues.kpis).toEqual(r.antes.kpis);
    expect(r.despues.ruta).toEqual(r.antes.ruta);
    expect(r.despues.porGestionar.map((o) => [o.id, o.secuenciaRuta])).toEqual(
      r.antes.porGestionar.map((o) => [o.id, o.secuenciaRuta]),
    );
    expect(r.despues.porRecoger.map((o) => o.id)).toEqual(r.antes.porRecoger.map((o) => o.id));
    expect(r.despues.conAyuda.map((o) => o.id)).toEqual(r.antes.conAyuda.map((o) => o.id));
    // Los KPIs no son cero: el `montoCobrar` distinguible del corpus llega hasta aquí.
    expect(r.antes.kpis).toEqual({
      pendientes: 1,
      entregadas: 0,
      porCobrar: 12_345,
      totalACobrar: 12_345,
    });
  });

  it("⭑ R32: la correccion no ENCOLA ninguna reoptimizacion de ruta", async () => {
    // El otro camino por el que la ruta se alteraría sin tocar sus tablas: encolar el job
    // `optimizacion_ruta` (92/R16) desde la corrección, como hace `GestionOrdenRepository`. Se
    // cuenta el delta DENTRO de la transacción, así que las filas que ya hubiera en la base
    // compartida son las mismas antes y después y no contaminan la medida.
    const r = await conOrdenEnRuta(MANANA, async (ctx) => {
      const reoptimizacionesAntes = await ctx.tx.job.count({
        where: { tipo: "optimizacion_ruta" },
      });
      const totalAntes = await ctx.tx.job.count();
      await ctx.repo.corregirDiaRepartoLote([ctx.ordenId], HOY, estatusIdsAdmitidos(), null, {
        actorUsuarioId: ACTOR,
        motivo: MOTIVO,
      });
      const reoptimizacionesDespues = await ctx.tx.job.count({
        where: { tipo: "optimizacion_ruta" },
      });
      const totalDespues = await ctx.tx.job.count();
      const rastro = await ctx.tx.ordenDiaRepartoCambio.count({ where: { ordenId: ctx.ordenId } });
      return { reoptimizacionesAntes, reoptimizacionesDespues, totalAntes, totalDespues, rastro };
    });

    // ANTI-VACUIDAD: la corrección ocurrió (dejó su fila de rastro).
    expect(r.rastro).toBe(1);
    expect(r.reoptimizacionesDespues).toBe(r.reoptimizacionesAntes);
    expect(r.totalDespues).toBe(r.totalAntes);
  });

  /**
   * El portal del mensajero, con los repositorios REALES sobre la transacción. Lo único con doble
   * es lo que R32 no mira: `ordenRepo` y el almacenamiento no los usa `listarMisAsignaciones`, y el
   * derivador de intentos va con el fake compartido porque su fuente —`orden_historial_estado`— ya
   * está probada intacta por el test de R25 de este mismo archivo.
   */
  async function listarPortal(tx: PrismaClient, mensajeroId: string) {
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

    const service = new MisAsignacionesService(
      new GestionOrdenRepository(tx),
      ordenRepo,
      storage,
      signed,
      new RutaOptimizadaRepository(tx),
      new OrdenMensajeroMetaRepository(tx),
      fakeIntentosEnLote(),
    );
    return service.listarMisAsignaciones({ usuarioId: mensajeroId, rol: "mensajero" }, NOCHE_DEL_21);
  }
});
