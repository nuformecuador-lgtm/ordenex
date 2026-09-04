import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient, RolValue } from "@prisma/client";

import { CorreccionFechaReprogramacionRepository } from "@/lib/repositories/CorreccionFechaReprogramacionRepository";
import { CorreccionFechaReprogramacionService } from "@/lib/services/CorreccionFechaReprogramacionService";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import { liberarTrasCorregirFechaCon } from "@/lib/services/liberacion-tras-corregir-fecha";
import { findGestionReprogramadaVigente } from "@/lib/repositories/gestion-reprogramada-vigente";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  MSG_CARRERA,
  MSG_ORDEN_BORRADA,
  MSG_YA_ES_ESA_FECHA,
  msgEstadoNoReprogramada,
} from "@/lib/services/mensajes-correccion-fecha-reprogramacion";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  clienteConTransaccionAnidada,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * ⭑ FICHA 371 — LA CORRECCION DE LA FECHA, EJECUTADA CONTRA POSTGRES.
 *
 * ⚠️ POR QUE ESTE ARCHIVO ES OBLIGATORIO Y NO UN EXTRA. `tests/unit/services/
 * correccion-fecha-reprogramacion.test.ts` prueba la REGLA con dobles: le entrega al servicio filas
 * ya construidas y comprueba que decide bien. Pero esas filas las construye el TEST, no el `WHERE`
 * del repositorio. En este repo esta MEDIDO CUATRO VECES que una mutacion de un `WHERE` sobrevive
 * en verde a una suite de dobles.
 *
 * Lo que aqui es imposible falsear:
 *   · que la escritura va GUARDADA por el estado de la orden (una orden fuera de `reprogramada` no
 *     cambia de fecha ni deja rastro);
 *   · que el `FOR UPDATE` fotografia la fecha ANTERIOR de verdad —si se fotografiara despues del
 *     `UPDATE`, la fila del rastro diria «de X a X» y este archivo lo veria—;
 *   · que la gestion elegida es LA MISMA que el cron mira cuando hay varias;
 *   · que corregir a HOY dispara la liberacion REAL, con la puerta de la 276 puesta: libera la de
 *     cierre aprobado y la de escritorio, y NO libera la visita real sin cierre aprobado;
 *   · que se escribe EXACTAMENTE una fila en cada rastro, y las dos en la misma transaccion;
 *   · que el CHECK de la base muerde.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. SIN base alcanzable se SALTA
 * (`describe.skip`), que se VE en la salida; nunca un `return` silencioso dentro del caso.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `371-${Date.now().toString(36)}`;
const GUIA_BASE = 970_000_000 + (Date.now() % 20_000_000);

/** 12:00 CR del 2 de septiembre. `startOfDayCR(NOW)` = la medianoche UTC del 2. */
const NOW = new Date("2026-09-02T18:00:00.000Z");
const HOY_CR = "2026-09-02";
const FUTURO = "2026-09-10";
/** La fecha equivocada del caso real (guia 49906911): el 4, escrita el 2. */
const FECHA_MALA = new Date("2026-09-04T00:00:00.000Z");
/** Señuelo de la gestion ANULADA: si el `take: 1` se equivocara, saldria esta. */
const FECHA_SENUELO = new Date("2026-09-20T00:00:00.000Z");

const MOTIVO = "se cambio la ruta para manana y el mensajero puso el dia siguiente";
const MAESTRO = (usuarioId: string): Actor => ({ usuarioId, rol: "maestro" as RolValue });
const MENSAJERO = (usuarioId: string): Actor => ({ usuarioId, rol: "mensajero" as RolValue });

interface OpcionesEscenario {
  /** Estado de la ORDEN. Por defecto `reprogramada`, que es la ventana de la correccion. */
  estatusOrden?: "reprogramada" | "en_reparto";
  /** ¿la gestion vigente nace de una VISITA REAL del mensajero? (puerta 276) */
  visitaReal?: boolean;
  /** Estado del cierre de la gestion vigente; `null` = todavia no entro en ningun cierre. */
  cierre?: "aprobado" | "solicitado" | null;
  fechaVigente?: Date;
  /** Una SEGUNDA gestion `reprogramada` VIVA, mas reciente que la primera. */
  segundaVigente?: Date | null;
  borrada?: boolean;
}

interface Contexto {
  ordenId: string;
  /** La gestion que el cron considera vigente (la mas reciente no anulada). */
  gestionVigenteId: string;
  /** La gestion ANULADA con la fecha señuelo. */
  gestionAnuladaId: string;
  /** La primera gestion viva, cuando el escenario crea una segunda mas reciente. */
  gestionVieja: string | null;
  service: CorreccionFechaReprogramacionService;
  actor: Actor;
  tx: TxDeTest;
  estatusReprogramadaId: string;
}

describeSiHayBase("371 — corregir la fecha de una reprogramacion, contra Postgres real", () => {
  let prisma: PrismaClient;
  let conEscenario: <T>(
    opciones: OpcionesEscenario,
    fn: (ctx: Contexto) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, jamas un `return` silencioso: con base alcanzable y sin catalogo este archivo
    // no puede comprobar nada, y un `passed` en esas condiciones es la clase de verde que este repo
    // ya se comio una vez.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "escenario. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const catalogo = await prisma.orderStatus.findMany({
      where: {
        value: { in: ["reprogramada", "en_reparto", "en_bodega_central", "en_bodega_satelite"] },
      },
      select: { id: true, value: true },
    });
    const idPorValue = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of ["reprogramada", "en_reparto", "en_bodega_central", "en_bodega_satelite"]) {
      if (!idPorValue.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en el catalogo \`order_status\`. Corre \`pnpm run db:seed\`.`,
        );
      }
    }
    const estatusReprogramadaId = idPorValue.get("reprogramada") as string;

    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 1 });
    if (usuarios.length < 1) {
      throw new Error("hace falta al menos UN usuario en la base para sembrar las gestiones.");
    }
    const usuarioId = usuarios[0].id;

    let n = 0;
    conEscenario = (opciones, fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en `public`.
        await serializarEscriturasReales(tx);
        n += 1;

        const estatusOrden = opciones.estatusOrden ?? "reprogramada";
        const orden = await tx.orden.create({
          data: {
            numGuia: GUIA_BASE + n,
            numRemision: `R-${SUFIJO}-${n}`,
            destinatario: `Dest ${n}`,
            telefonoDest: "88880000",
            producto: `Prod ${n}`,
            estatusId: idPorValue.get(estatusOrden) as string,
            mensajeroAsignadoId: usuarioId,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
            deletedAt: opciones.borrada === true ? new Date("2026-09-01T10:00:00.000Z") : null,
          },
          select: { id: true },
        });

        // ── LA GESTION VIEJA, ANULADA, con la fecha SEÑUELO ─────────────────────────────────
        // Su unico trabajo es hacer que equivocarse de gestion sea DETECTABLE.
        const anulada = await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId: usuarioId,
            resultado: "reprogramada",
            fechaReprogramacion: FECHA_SENUELO,
            anuladaAt: new Date("2026-09-01T12:00:00.000Z"),
            createdAt: new Date("2026-08-31T10:00:00.000Z"),
          },
          select: { id: true },
        });

        const cierreId =
          opciones.cierre == null
            ? null
            : (
                await tx.cierreDia.create({
                  data: {
                    mensajeroId: usuarioId,
                    estado: opciones.cierre,
                    destinoTipo: "bodega_central",
                    destinoZonaId: fks.zonaId,
                  },
                  select: { id: true },
                })
              ).id;

        // ── LA GESTION VIVA (la que el `take: 1` debe elegir si no hay segunda) ─────────────
        const primeraViva = await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId: usuarioId,
            resultado: "reprogramada",
            fechaReprogramacion: opciones.fechaVigente ?? FECHA_MALA,
            cierreId,
            anuladaAt: null,
            createdAt: new Date("2026-09-02T09:00:00.000Z"),
          },
          select: { id: true },
        });
        // La sonda de VISITA REAL de la puerta 276: una fila de historial de la familia `gestion`
        // enlazada a ESTA gestion. Sin ella, la gestion es de ESCRITORIO (100).
        await tx.ordenHistorialEstado.create({
          data: {
            ordenId: orden.id,
            estatusDestinoId: estatusReprogramadaId,
            origenTipo: (opciones.visitaReal ?? true) ? "gestion" : "reprogramacion_tienda",
            gestionOrdenId: primeraViva.id,
          },
        });

        // ── LA SEGUNDA GESTION VIVA, MAS RECIENTE (solo en el escenario de la correlacion) ──
        let segunda: string | null = null;
        if (opciones.segundaVigente != null) {
          const fila = await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId: usuarioId,
              resultado: "reprogramada",
              fechaReprogramacion: opciones.segundaVigente,
              cierreId,
              anuladaAt: null,
              createdAt: new Date("2026-09-02T15:00:00.000Z"), // MAS RECIENTE
            },
            select: { id: true },
          });
          await tx.ordenHistorialEstado.create({
            data: {
              ordenId: orden.id,
              estatusDestinoId: estatusReprogramadaId,
              origenTipo: (opciones.visitaReal ?? true) ? "gestion" : "reprogramacion_tienda",
              gestionOrdenId: fila.id,
            },
          });
          segunda = fila.id;
        }

        const cliente = clienteConTransaccionAnidada(tx);
        const estatusRepo = {
          findEstatusIdByValue: async (v: string) => idPorValue.get(v) ?? null,
        };
        const liberacion = new LiberacionReprogramadaService(
          new LiberacionReprogramadaRepository(cliente),
          { findCentralZonaId: async () => fks.zonaId }, // la zona de la orden ES la central
          estatusRepo,
          { warn: () => {} },
        );
        const service = new CorreccionFechaReprogramacionService(
          new CorreccionFechaReprogramacionRepository(cliente),
          estatusRepo,
          // EL CAMINO REAL de la liberacion, no un doble: es lo unico que demuestra que corregir a
          // hoy dispara la MISMA liberacion que el cron, con su puerta 276 puesta.
          liberarTrasCorregirFechaCon(liberacion, () => NOW, { warn: () => {} }),
        );

        return fn({
          ordenId: orden.id,
          gestionVigenteId: segunda ?? primeraViva.id,
          gestionAnuladaId: anulada.id,
          gestionVieja: segunda === null ? null : primeraViva.id,
          service,
          actor: MAESTRO(usuarioId),
          tx,
          estatusReprogramadaId,
        });
      });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** La fecha de una gestion, como `YYYY-MM-DD`. */
  async function fechaDe(ctx: Contexto, gestionId: string): Promise<string | null> {
    const g = await ctx.tx.gestionOrden.findUnique({
      where: { id: gestionId },
      select: { fechaReprogramacion: true },
    });
    return g?.fechaReprogramacion?.toISOString().slice(0, 10) ?? null;
  }

  /** El `value` del estatus actual de la orden. */
  async function estatusDe(ctx: Contexto): Promise<string> {
    const o = await ctx.tx.orden.findUnique({
      where: { id: ctx.ordenId },
      select: { estatus: { select: { value: true } } },
    });
    return o?.estatus.value as string;
  }

  /** Las filas del rastro DETALLADO de esta orden. */
  async function rastroDe(ctx: Contexto) {
    return ctx.tx.gestionFechaReprogramacionCambio.findMany({
      where: { ordenId: ctx.ordenId },
      select: {
        gestionId: true,
        fechaAnterior: true,
        fechaNueva: true,
        actorUsuarioId: true,
        motivo: true,
      },
    });
  }

  /** Las filas del historial de acciones de esta correccion. */
  async function historialDe(ctx: Contexto, gestionId: string) {
    return ctx.tx.historialAccion.findMany({
      where: { entidadId: gestionId, accion: "gestion_fecha_reprogramacion_corregida" },
      select: {
        accion: true,
        entidadTipo: true,
        valorAnterior: true,
        valorNuevo: true,
        actorUsuarioId: true,
        monto: true,
      },
    });
  }

  // -------------------------------------------------------------------------------------------
  // 1 — LOS CUATRO DESENLACES DE LA LIBERACION, cada uno con su contrario en la misma corrida
  // -------------------------------------------------------------------------------------------

  it("⭑ a fecha FUTURA: la gestion vigente cambia y la orden SIGUE en `reprogramada`", async () => {
    await conEscenario({ cierre: "aprobado" }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: FUTURO, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      expect(r).toMatchObject({
        status: "ok",
        fechaAnterior: "2026-09-04",
        fechaNueva: FUTURO,
        liberacion: "espera_fecha",
      });
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe(FUTURO);
      // La fecha de reprogramacion es un COMPROMISO con el destinatario: una futura NO libera.
      expect(await estatusDe(ctx)).toBe("reprogramada");
    });
  });

  it("⭑ a HOY con VISITA REAL y cierre APROBADO: la orden queda LIBERADA en el mismo acto", async () => {
    await conEscenario({ visitaReal: true, cierre: "aprobado" }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      expect(r).toMatchObject({ status: "ok", liberacion: "liberada" });
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe(HOY_CR);
      // Volvio a bodega: el cron de medianoche ya no tiene nada que hacer con ella.
      expect(await estatusDe(ctx)).toBe("en_bodega_central");
      const orden = await ctx.tx.orden.findUnique({
        where: { id: ctx.ordenId },
        select: { mensajeroAsignadoId: true, prioridad: true, liberadaReprogramadaAt: true },
      });
      expect(orden?.mensajeroAsignadoId).toBeNull(); // handoff limpio a la bodega
      expect(orden?.prioridad).toBe(true); // reasignacion prioritaria (110)
      expect(orden?.liberadaReprogramadaAt).not.toBeNull();
    });
  });

  it("⭑ a HOY con VISITA REAL y cierre SIN APROBAR: NO se libera, y el resultado lo DICE", async () => {
    await conEscenario({ visitaReal: true, cierre: "solicitado" }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      // La puerta de la 276 se RESPETA: liberar una visita real antes de aprobar su cierre
      // devolveria la orden con el contador de intentos atrasado.
      expect(r).toMatchObject({ status: "ok", liberacion: "espera_cierre" });
      // La correccion SI ocurrio: lo que no ocurre es la liberacion.
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe(HOY_CR);
      expect(await estatusDe(ctx)).toBe("reprogramada");
    });
  });

  it("⭑ a HOY una reprogramacion DE ESCRITORIO: libera aunque no haya cierre", async () => {
    await conEscenario({ visitaReal: false, cierre: null }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      // Una gestion sintetica (100) nunca va a sumar intento: esperar no ganaria nada.
      expect(r).toMatchObject({ status: "ok", liberacion: "liberada" });
      expect(await estatusDe(ctx)).toBe("en_bodega_central");
    });
  });

  // -------------------------------------------------------------------------------------------
  // 2 — LA CORRELACION DE LA GESTION VIGENTE: la misma que el cron
  // -------------------------------------------------------------------------------------------

  it("⭑ con DOS gestiones vivas, se corrige la MAS RECIENTE y no la vieja ni la anulada", async () => {
    await conEscenario(
      { segundaVigente: FECHA_MALA, fechaVigente: new Date("2026-09-06T00:00:00.000Z") },
      async (ctx) => {
        const r = await ctx.service.corregir(
          { ordenId: ctx.ordenId, fecha: FUTURO, motivo: MOTIVO },
          ctx.actor,
          NOW,
        );

        expect(r).toMatchObject({ status: "ok", gestionId: ctx.gestionVigenteId });
        expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe(FUTURO);
        // ⭑ Ni la vieja ni la anulada se tocan. Si el `orderBy` fuera `asc`, la de arriba y esta
        // se invertirian.
        expect(await fechaDe(ctx, ctx.gestionVieja as string)).toBe("2026-09-06");
        expect(await fechaDe(ctx, ctx.gestionAnuladaId)).toBe("2026-09-20");
      },
    );
  });

  it("⭑ PARIDAD: la gestion que se corrige es la MISMA que el cron mira", async () => {
    // Es la propiedad que impide el defecto mudo de esta ficha: si la correccion eligiera con una
    // expresion propia, un dia escribiria sobre una fila y el cron leeria otra, las dos plausibles.
    // La MAS RECIENTE lleva una fecha YA VENCIDA y la vieja una FUTURA: si el cron eligiera la
    // vieja, la orden ni siquiera seria candidata y `candidatas` saldria vacia.
    await conEscenario(
      {
        fechaVigente: new Date("2026-09-06T00:00:00.000Z"),
        segundaVigente: new Date("2026-09-01T00:00:00.000Z"),
        cierre: "aprobado",
      },
      async (ctx) => {
        const cliente = clienteConTransaccionAnidada(ctx.tx);
        // (a) la que elige la correlacion COMPARTIDA (la del repositorio de la correccion);
        const elegida = await findGestionReprogramadaVigente(cliente, ctx.ordenId);
        // (b) la fecha que el cron proyecta para esta orden, por su propio `select`.
        const candidatas = await new LiberacionReprogramadaRepository(
          cliente,
        ).findOrdenesLiberablesDeOrden(ctx.ordenId, new Date(`${HOY_CR}T00:00:00.000Z`));

        expect(elegida?.id).toBe(ctx.gestionVigenteId);
        expect(candidatas).toHaveLength(1);
        expect(candidatas[0].fechaReprogramacion.toISOString().slice(0, 10)).toBe(
          elegida?.fechaReprogramacion?.toISOString().slice(0, 10),
        );
        expect(candidatas[0].fechaReprogramacion.toISOString().slice(0, 10)).toBe("2026-09-01");
      },
    );
  });

  // -------------------------------------------------------------------------------------------
  // 3 — LO QUE NO SE PUEDE ESCRIBIR (y que no deja NI UNA fila)
  // -------------------------------------------------------------------------------------------

  it("⭑ una orden que NO esta en `reprogramada`: rechazada y SIN escribir nada", async () => {
    await conEscenario({ estatusOrden: "en_reparto" }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      expect(r).toEqual({ status: "conflict", motivo: msgEstadoNoReprogramada("en_reparto") });
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe("2026-09-04"); // intacta
      expect(await rastroDe(ctx)).toEqual([]);
      expect(await historialDe(ctx, ctx.gestionVigenteId)).toEqual([]);
    });
  });

  it("una orden BORRADA: rechazada y sin escribir nada", async () => {
    await conEscenario({ borrada: true }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );
      expect(r).toEqual({ status: "conflict", motivo: MSG_ORDEN_BORRADA });
      expect(await rastroDe(ctx)).toEqual([]);
    });
  });

  it("⭑ un rol que no es maestro/admin: `forbidden` y la base INTACTA", async () => {
    await conEscenario({}, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        MENSAJERO(ctx.actor.usuarioId),
        NOW,
      );

      expect(r).toEqual({ status: "forbidden" });
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe("2026-09-04");
      expect(await estatusDe(ctx)).toBe("reprogramada");
      expect(await rastroDe(ctx)).toEqual([]);
      expect(await historialDe(ctx, ctx.gestionVigenteId)).toEqual([]);
    });
  });

  it.each([
    ["anterior a hoy", "2026-09-01"],
    ["inexistente", "2026-02-31"],
    ["con formato ajeno", "02/09/2026"],
  ])("una fecha %s: rechazada y sin escribir nada", async (_nombre, fecha) => {
    await conEscenario({}, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );
      expect(r.status).toBe("validation_error");
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe("2026-09-04");
      expect(await rastroDe(ctx)).toEqual([]);
    });
  });

  it.each([
    ["vacio", ""],
    ["en blanco", "    "],
  ])("⭑ sin motivo (%s): rechazada y sin escribir nada", async (_nombre, motivo) => {
    await conEscenario({}, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo },
        ctx.actor,
        NOW,
      );
      expect(r.status).toBe("validation_error");
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe("2026-09-04");
      expect(await rastroDe(ctx)).toEqual([]);
      expect(await historialDe(ctx, ctx.gestionVigenteId)).toEqual([]);
    });
  });

  it("⭑ corregir a la MISMA fecha: rechazada antes de escribir", async () => {
    await conEscenario({ fechaVigente: new Date(`${HOY_CR}T00:00:00.000Z`) }, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );
      expect(r).toEqual({ status: "conflict", motivo: MSG_YA_ES_ESA_FECHA });
      expect(await rastroDe(ctx)).toEqual([]);
    });
  });

  it("⭑ y el CHECK de la base MUERDE: una fila con las dos fechas iguales no entra", async () => {
    // La ultima de las tres barreras. Aunque alguien se saltara el servicio y el `WHERE`, la base
    // no admite un rastro que documente una correccion que no corrige nada.
    await conEscenario({}, async (ctx) => {
      await expect(
        ctx.tx.gestionFechaReprogramacionCambio.create({
          data: {
            gestionId: ctx.gestionVigenteId,
            ordenId: ctx.ordenId,
            fechaAnterior: new Date(`${HOY_CR}T00:00:00.000Z`),
            fechaNueva: new Date(`${HOY_CR}T00:00:00.000Z`),
            actorUsuarioId: ctx.actor.usuarioId,
            motivo: MOTIVO,
          },
        }),
      ).rejects.toThrow(/fecha_distinta|violates check constraint/i);
    });
  });

  it("una orden inexistente: `conflict`, sin reventar", async () => {
    await conEscenario({}, async (ctx) => {
      const r = await ctx.service.corregir(
        { ordenId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399", fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );
      expect(r.status).toBe("conflict");
      expect(await rastroDe(ctx)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // 4 — LOS DOS RASTROS: exactamente una fila en cada uno, y la fecha ANTERIOR de verdad
  // -------------------------------------------------------------------------------------------

  it("⭑ escribe EXACTAMENTE una fila de rastro con la fecha ANTERIOR y su motivo", async () => {
    await conEscenario({ cierre: "aprobado" }, async (ctx) => {
      await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: `  ${MOTIVO}  ` },
        ctx.actor,
        NOW,
      );

      const filas = await rastroDe(ctx);
      expect(filas).toHaveLength(1);
      expect(filas[0].gestionId).toBe(ctx.gestionVigenteId);
      // ⭑ AQUI GANA SU SUELDO EL `FOR UPDATE`: si la foto se tomara DESPUES del `UPDATE`, esta
      // fecha seria la NUEVA y el rastro diria «de 2026-09-02 a 2026-09-02».
      expect(filas[0].fechaAnterior.toISOString().slice(0, 10)).toBe("2026-09-04");
      expect(filas[0].fechaNueva.toISOString().slice(0, 10)).toBe(HOY_CR);
      expect(filas[0].actorUsuarioId).toBe(ctx.actor.usuarioId);
      expect(filas[0].motivo).toBe(MOTIVO); // ya recortado
    });
  });

  it("⭑ escribe EXACTAMENTE una fila de `historial_accion`, con las DOS fechas", async () => {
    await conEscenario({ cierre: "aprobado" }, async (ctx) => {
      await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      const filas = await historialDe(ctx, ctx.gestionVigenteId);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        accion: "gestion_fecha_reprogramacion_corregida",
        entidadTipo: "gestion_orden",
        valorAnterior: "2026-09-04",
        valorNuevo: HOY_CR,
        actorUsuarioId: ctx.actor.usuarioId,
      });
      // No mueve dinero: la fila no lleva importe.
      expect(filas[0].monto).toBeNull();
    });
  });

  it("⭑ el MOTIVO no cruza a `historial_accion`: esa tabla se descarga y no se purga", async () => {
    await conEscenario({ cierre: "aprobado" }, async (ctx) => {
      await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );

      const fila = (await historialDe(ctx, ctx.gestionVigenteId))[0];
      const texto = JSON.stringify(fila);
      expect(texto).not.toContain("ruta");
      expect(texto).not.toContain(MOTIVO);
      // Y sigue estando donde SI debe: en la tabla propia.
      expect((await rastroDe(ctx))[0].motivo).toBe(MOTIVO);
    });
  });

  it("⭑ dos correcciones seguidas dejan DOS filas, y la segunda parte de la primera", async () => {
    await conEscenario({ cierre: "solicitado" }, async (ctx) => {
      // Se usa un cierre SIN aprobar a proposito: asi la orden NO se libera y sigue siendo
      // corregible, que es justo la poblacion que puede necesitar dos correcciones.
      await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: FUTURO, motivo: MOTIVO },
        ctx.actor,
        NOW,
      );
      const r2 = await ctx.service.corregir(
        { ordenId: ctx.ordenId, fecha: HOY_CR, motivo: "y despues se adelanto a hoy" },
        ctx.actor,
        NOW,
      );

      expect(r2).toMatchObject({ status: "ok", fechaAnterior: FUTURO, fechaNueva: HOY_CR });
      const filas = (await rastroDe(ctx)).sort((a, b) =>
        a.fechaNueva.getTime() - b.fechaNueva.getTime(),
      );
      expect(filas).toHaveLength(2);
      // La tabla es append-only: la primera fila NO se reescribe.
      expect(filas.map((f) => f.fechaAnterior.toISOString().slice(0, 10))).toEqual([
        FUTURO,
        "2026-09-04",
      ]);
      expect(await historialDe(ctx, ctx.gestionVigenteId)).toHaveLength(2);
    });
  });

  it("una carrera perdida no deja rastro huerfano", async () => {
    await conEscenario({}, async (ctx) => {
      // Se simula la carrera moviendo la orden fuera de `reprogramada` DESPUES del pre-chequeo:
      // el `WHERE` guardado de la escritura es lo unico que queda entre eso y un rastro falso. Se
      // consigue pidiendo la correccion con un `estatus_id` que ya no es el de la orden.
      const repo = new CorreccionFechaReprogramacionRepository(
        clienteConTransaccionAnidada(ctx.tx),
      );
      const aplicada = await repo.corregirFecha({
        ordenId: ctx.ordenId,
        fecha: HOY_CR,
        estatusReprogramadaId: "os-que-no-es-el-suyo",
        actorUsuarioId: ctx.actor.usuarioId,
        motivo: MOTIVO,
      });

      expect(aplicada).toBeNull();
      expect(await fechaDe(ctx, ctx.gestionVigenteId)).toBe("2026-09-04");
      expect(await rastroDe(ctx)).toEqual([]);
      expect(await historialDe(ctx, ctx.gestionVigenteId)).toEqual([]);
      // Y el servicio traduce esa carrera a su motivo, sin inventarse un exito.
      expect(MSG_CARRERA.length).toBeGreaterThan(10);
    });
  });
});
