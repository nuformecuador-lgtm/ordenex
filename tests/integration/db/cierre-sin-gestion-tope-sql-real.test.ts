import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { MOTIVO_RECHAZO_TOPE_INTENTOS } from "@/lib/repositories/CierresAdminRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 273 (T9, bloque 🔴 OBLIGATORIO) — EL RECHAZO DE LA NO GESTION, EJECUTADO CONTRA POSTGRES.
 * R21, R22, R23, R25, R26, R27. Absorbe la ficha 218.
 *
 * ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES. Lo que este bloque hace es un `groupBy` con el
 * predicado unico de intentos DENTRO de la transaccion mas cara del sistema, un `updateMany`
 * guardado, un `create` de gestion y un append que pasa por el CHOKE POINT de estados (140). Con
 * dobles, ninguna de las cuatro cosas se ejecuta: el `where` no selecciona nada, el choke point no
 * valida el par `(sin_gestionar, rechazada)` contra `TRANSICIONES`, y la fila del historial no
 * existe. Un verde ahi no diria absolutamente nada.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. SIN base alcanzable se SALTA
 * (`describe.skip`), que se VE en la salida; nunca un `return` silencioso dentro del caso.
 *
 * QUE NO SE MIDE AQUI: la NEUTRALIDAD EN DINERO (R24). Vive en el caso emparejado de
 * `tests/unit/services/cierres-admin-service.aprobar.sin-gestion.test.ts`, que aprueba el MISMO
 * cierre semilla dos veces —con y sin una orden en el umbral— con los feeds REALES y compara los
 * movimientos campo a campo. Ese corpus no se puede sembrar en Postgres sin arrastrar tarifas y
 * `cierre_detail` enteros, y lo que R24 exige comparar es lo que los feeds EMITEN.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `273t9-${Date.now().toString(36)}`;
const GUIA_BASE = 920_000_000 + (Date.now() % 40_000_000);
const UMBRAL = 3;

/** Captores: lo que cada feed emitio. Los feeds son REALES; lo que se dobla es el que persiste. */
function captores() {
  const caja: unknown[][] = [];
  const tienda: unknown[][] = [];
  const mensajero: unknown[][] = [];
  const walletMovimientoRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: unknown[]) => {
      caja.push(movs);
      return movs.length;
    }),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  } as unknown as IWalletMovimientoRepository;
  const walletTiendaMovimientoRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: unknown[]) => {
      tienda.push(movs);
      return movs.length;
    }),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;
  const pagoMensajeroMovimientoRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: unknown[]) => {
      mensajero.push(movs);
      return movs.length;
    }),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
  } as unknown as IPagoMensajeroMovimientoRepository;
  return {
    caja,
    tienda,
    mensajero,
    walletMovimientoRepo,
    walletTiendaMovimientoRepo,
    pagoMensajeroMovimientoRepo,
  };
}

/**
 * El corpus. Cada semilla es una orden barrida a `sin_gestionar` por EL MISMO cierre, y lo que
 * cambia entre ellas es cuantos intentos VIGENTES tiene y de que clase.
 */
interface Semilla {
  clave: string;
  /** Cuantos cierres APROBADOS distintos con gestion contable y visita real. */
  intentosContables: number;
  /** Ademas, gestiones ANULADAS en cierres aprobados (NO deben contar, R5 de la 215). */
  gestionesAnuladas?: number;
  /** Zona: `central` o `satelite`, para comprobar el destino de la rama vieja (R25). */
  zona?: "central" | "satelite";
}

const SEMILLAS: Semilla[] = [
  // Caso 1: en el umbral -> se rechaza y, por el bloque de la 139, acaba en `por_devolver*`.
  { clave: "en-el-tope", intentosContables: UMBRAL },
  // Caso 2: por debajo -> la rama de siempre, INTACTA.
  { clave: "bajo-el-tope", intentosContables: UMBRAL - 1 },
  // Caso 3: el punto que NO se confia. Sus gestiones contables son UMBRAL-1, y ademas tiene DOS
  // gestiones ANULADAS. Si las anuladas contaran, llegaria al umbral y se rechazaria.
  { clave: "anuladas-no-cuentan", intentosContables: UMBRAL - 1, gestionesAnuladas: 2 },
  // Y una sin ningun intento, la orden normal de un corte cualquiera.
  { clave: "sin-intentos", intentosContables: 0 },
];

describeSiHayBase("273/T9 — el rechazo por tope al aprobar el cierre (Postgres real)", () => {
  let prisma: PrismaClient;

  let conCorpus: <T>(
    fn: (ctx: {
      repo: CierresAdminRepository;
      cierreId: string;
      mensajeroId: string;
      adminId: string;
      idPorClave: Map<string, string>;
      clavePorId: Map<string, string>;
      estatus: Map<string, string>;
      zonaId: string;
      caja: unknown[][];
      tienda: unknown[][];
      mensajeroMovs: unknown[][];
      /** Estado + mensajero + prioridad de una orden del corpus, leidos de la tx. */
      leerOrden: (clave: string) => Promise<{
        estatusId: string;
        mensajeroAsignadoId: string | null;
        prioridad: boolean;
      } | null>;
      /** Las filas de historial de una orden, en orden cronologico. */
      leerHistorial: (clave: string) => Promise<
        { origenTipo: string; estatusOrigenId: string | null; estatusDestinoId: string; actorUsuarioId: string | null; gestionOrdenId: string | null }[]
      >;
      /** Las gestiones SIN cierre de una orden (las sinteticas que nacen aqui). */
      leerGestionesSinCierre: (clave: string) => Promise<
        { resultado: string; motivo: string | null; mensajeroId: string; cierreId: string | null }[]
      >;
      /** Ejecuta `resolverCierre` con el estado pedido. */
      resolver: (nuevoEstado: "aprobado" | "rechazado") => Promise<unknown>;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const VALUES = [
      "en_reparto",
      "sin_gestionar",
      "en_bodega_central",
      "en_bodega_satelite",
      "rechazada",
      "por_devolver",
      "por_devolver_a_tienda",
      "devolucion_por_confirmar",
      "devuelta",
    ];
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: VALUES } },
      select: { id: true, value: true },
    });
    const estatus = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of VALUES) {
      if (!estatus.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en \`order_status\`. Corre \`pnpm run db:seed\`: sin el, este ` +
            "archivo no puede sembrar el corpus y NO debe pasar en verde.",
        );
      }
    }

    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (usuarios.length < 2) {
      throw new Error("hacen falta DOS usuarios: el mensajero del cierre y el admin que aprueba.");
    }
    const mensajeroId = usuarios[0].id;
    const adminId = usuarios[1].id;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);

        // EL CIERRE que se va a aprobar. `solicitado` porque es el unico estado desde el que la
        // guarda del `updateMany` deja resolverlo... y `vencido`, que tambien esta en
        // ESTADOS_RESOLUBLES; se usa `solicitado`, que es el caso normal.
        const cierre = await tx.cierreDia.create({
          data: {
            mensajeroId,
            estado: "solicitado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
          },
          select: { id: true },
        });

        const idPorClave = new Map<string, string>();
        const clavePorId = new Map<string, string>();
        let n = 0;

        for (const s of SEMILLAS) {
          n += 1;
          const orden = await tx.orden.create({
            data: {
              numGuia: GUIA_BASE + n,
              numRemision: `R-${SUFIJO}-${s.clave}`,
              destinatario: `Dest ${s.clave}`,
              telefonoDest: "88880000",
              producto: `Prod ${s.clave}`,
              // Barrida por el corte: en `sin_gestionar` y CON su mensajero.
              estatusId: estatus.get("sin_gestionar") as string,
              mensajeroAsignadoId: mensajeroId,
              prioridad: false,
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          });
          idPorClave.set(s.clave, orden.id);
          clavePorId.set(orden.id, s.clave);

          // El registro de la 264: QUE ordenes barrio ESTE cierre.
          await tx.cierreSinGestion.create({
            data: {
              cierreId: cierre.id,
              ordenId: orden.id,
              numGuia: GUIA_BASE + n,
              numRemision: `R-${SUFIJO}-${s.clave}`,
              destinatario: `Dest ${s.clave}`,
              producto: `Prod ${s.clave}`,
              tiendaNombre: "Tienda",
              zonaNombre: "Zona",
              estatusOrigenId: estatus.get("en_reparto") as string,
            },
            select: { id: true },
          });

          // ── LOS INTENTOS. Cada uno es un cierre APROBADO DISTINTO con una gestion contable
          //    VIGENTE que nace de una VISITA REAL. Es el predicado de `whereIntentosVigentes`
          //    sembrado en la base, no una simulacion.
          const sembrarIntento = async (anulada: boolean) => {
            const cierreViejo = await tx.cierreDia.create({
              data: {
                mensajeroId,
                estado: "aprobado",
                destinoTipo: "bodega_central",
                destinoZonaId: fks.zonaId,
              },
              select: { id: true },
            });
            const gestion = await tx.gestionOrden.create({
              data: {
                ordenId: orden.id,
                mensajeroId,
                resultado: "devuelta",
                cierreId: cierreViejo.id,
                anuladaAt: anulada ? new Date("2026-08-01T10:00:00.000Z") : null,
              },
              select: { id: true },
            });
            await tx.ordenHistorialEstado.create({
              data: {
                ordenId: orden.id,
                estatusDestinoId: estatus.get("devolucion_por_confirmar") as string,
                origenTipo: "gestion", // VISITA REAL
                gestionOrdenId: gestion.id,
              },
            });
          };
          for (let i = 0; i < s.intentosContables; i++) await sembrarIntento(false);
          for (let i = 0; i < (s.gestionesAnuladas ?? 0); i++) await sembrarIntento(true);
        }

        const cap = captores();
        const repo = new CierresAdminRepository(
          tx as unknown as PrismaClient,
          cap.walletMovimientoRepo,
          new WalletFeedService(),
          cap.walletTiendaMovimientoRepo,
          new WalletTiendaFeedService(),
          cap.pagoMensajeroMovimientoRepo,
          new WalletMensajeroFeedService(),
          new WalletIndemnizacionFeedService(),
        );

        const resolver = (nuevoEstado: "aprobado" | "rechazado") =>
          repo.resolverCierre(
            nuevoEstado === "aprobado"
              ? {
                  cierreId: cierre.id,
                  alcance: { destinoTipo: "bodega_central", destinoZonaId: null },
                  nuevoEstado: "aprobado",
                  resueltoPor: adminId,
                  motivoRechazo: null,
                  liberacionSinGestionar: {
                    sinGestionarEstatusId: estatus.get("sin_gestionar") as string,
                    enBodegaEstatusId: estatus.get("en_bodega_central") as string,
                    enBodegaSateliteEstatusId: estatus.get("en_bodega_satelite") as string,
                    centralZonaId: fks.zonaId,
                    rechazadaEstatusId: estatus.get("rechazada") as string,
                    umbralIntentos: UMBRAL,
                  },
                  devolucionRechazadas: {
                    rechazadaId: estatus.get("rechazada") as string,
                    porDevolverId: estatus.get("por_devolver") as string,
                    porDevolverATiendaId: estatus.get("por_devolver_a_tienda") as string,
                    centralZonaId: fks.zonaId,
                  },
                  anclajeDevolucion: {
                    preEstadoId: estatus.get("devolucion_por_confirmar") as string,
                    devueltaId: estatus.get("devuelta") as string,
                  },
                  confirmacionFisica: [],
                  indemnizaciones: [],
                }
              : {
                  cierreId: cierre.id,
                  alcance: { destinoTipo: "bodega_central", destinoZonaId: null },
                  nuevoEstado: "rechazado",
                  resueltoPor: adminId,
                  motivoRechazo: "no cuadra la caja",
                },
          );

        return fn({
          repo,
          cierreId: cierre.id,
          mensajeroId,
          adminId,
          idPorClave,
          clavePorId,
          estatus,
          zonaId: fks.zonaId,
          caja: cap.caja,
          tienda: cap.tienda,
          mensajeroMovs: cap.mensajero,
          leerOrden: async (clave) =>
            tx.orden.findUnique({
              where: { id: idPorClave.get(clave) as string },
              select: { estatusId: true, mensajeroAsignadoId: true, prioridad: true },
            }),
          leerHistorial: async (clave) =>
            tx.ordenHistorialEstado.findMany({
              where: { ordenId: idPorClave.get(clave) as string, gestionOrdenId: null },
              orderBy: { createdAt: "asc" },
              select: {
                origenTipo: true,
                estatusOrigenId: true,
                estatusDestinoId: true,
                actorUsuarioId: true,
                gestionOrdenId: true,
              },
            }) as never,
          leerGestionesSinCierre: async (clave) =>
            tx.gestionOrden.findMany({
              where: { ordenId: idPorClave.get(clave) as string, cierreId: null },
              select: { resultado: true, motivo: true, mensajeroId: true, cierreId: true },
            }) as never,
          resolver,
        });
      });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /* ------------------------------------------------------------------ */
  /* Caso 1 · R21/R22/R23                                               */
  /* ------------------------------------------------------------------ */

  it("1. la barrida CON `intentos = umbral` acaba en `por_devolver_a_tienda`, no en bodega (R21)", async () => {
    const { orden, estatus } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return { orden: await ctx.leerOrden("en-el-tope"), estatus: ctx.estatus };
    });

    // El bloque de la 139 corre inmediatamente despues EN LA MISMA TX y recoge la orden porque el
    // paso 1 CONSERVO su mensajero. Ese es el destino correcto: el paquete vuelve a la tienda.
    // Si el `updateMany` limpiara el mensajero, la orden se quedaria en `rechazada` para siempre.
    expect(orden?.estatusId).toBe(estatus.get("por_devolver_a_tienda"));
    expect(orden?.estatusId).not.toBe(estatus.get("en_bodega_central"));
    expect(orden?.estatusId).not.toBe(estatus.get("sin_gestionar"));
  });

  it("1b. su historial tiene las DOS filas, en orden, con la familia PROPIA y el admin como actor (R22)", async () => {
    const { historial, estatus, adminId } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return {
        historial: await ctx.leerHistorial("en-el-tope"),
        estatus: ctx.estatus,
        adminId: ctx.adminId,
      };
    });

    // `leerHistorial` filtra por `gestionOrdenId: null`, asi que aqui SOLO sale la fila del bloque
    // de la 139 —la de la 273 SI enlaza su gestion sintetica y se comprueba en el caso 1c—. Que
    // exista demuestra que la orden paso por `rechazada`: sin ese paso intermedio, el bloque de la
    // 139 no la habria visto y no habria nada que leer.
    expect(historial.map((h) => h.origenTipo)).toEqual(["devolucion_rechazada"]);
    const devolucion = historial[0];
    expect(devolucion.estatusOrigenId).toBe(estatus.get("rechazada"));
    expect(devolucion.estatusDestinoId).toBe(estatus.get("por_devolver_a_tienda"));
    expect(devolucion.actorUsuarioId).toBe(adminId);
  });

  it("1c. la fila de `rechazo_tope_intentos` existe, ENLAZA la gestion sintetica y la escribio el admin (R22)", async () => {
    const { filas, estatus, adminId } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return {
        filas: await leerHistorialCompleto(ctx, "en-el-tope"),
        estatus: ctx.estatus,
        adminId: ctx.adminId,
      };
    });

    const delTope = filas.filter((f) => f.origenTipo === "rechazo_tope_intentos");
    expect(delTope).toHaveLength(1);
    expect(delTope[0].estatusOrigenId).toBe(estatus.get("sin_gestionar"));
    expect(delTope[0].estatusDestinoId).toBe(estatus.get("rechazada"));
    expect(delTope[0].actorUsuarioId).toBe(adminId); // R22: el admin que aprobo, no el cron
    // ⭑ ENLAZA la gestion sintetica: es lo que permite auditar QUE cobro nacio de QUE aprobacion.
    expect(delTope[0].gestionOrdenId).not.toBeNull();
    // Y NO reusa ninguna familia existente.
    expect(filas.map((f) => f.origenTipo)).not.toContain("liberacion_sin_gestionar");
    expect(filas.map((f) => f.origenTipo)).not.toContain("escalado_devuelta_sla");
  });

  it("1d. 💰 R23 (Q1) — nace UNA gestion sintetica `rechazada`, del mensajero del cierre y SIN cierre", async () => {
    const { gestiones, mensajeroId } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return {
        gestiones: await ctx.leerGestionesSinCierre("en-el-tope"),
        mensajeroId: ctx.mensajeroId,
      };
    });

    expect(gestiones).toHaveLength(1);
    expect(gestiones[0].resultado).toBe("rechazada");
    // `cierre_id NULL` es lo que hace que el SIGUIENTE cierre del mensajero la recoja y cobre el
    // `cobroRechazado` (56). Con el id de ESTE cierre, cambiaria sus totales despues de que su
    // snapshot se congelara (R24).
    expect(gestiones[0].cierreId).toBeNull();
    expect(gestiones[0].mensajeroId).toBe(mensajeroId);
    // R38: el motivo es el texto FIJO, sin PII.
    expect(gestiones[0].motivo).toBe(MOTIVO_RECHAZO_TOPE_INTENTOS);
    expect(gestiones[0].motivo).not.toContain(String(GUIA_BASE));
    expect(gestiones[0].motivo).not.toContain("Dest ");
  });

  /* ------------------------------------------------------------------ */
  /* Caso 2 · R25 — la rama vieja, INTACTA                              */
  /* ------------------------------------------------------------------ */

  it("2. la barrida con `intentos = umbral - 1` va a bodega, sin mensajero y con prioridad (R25)", async () => {
    const { orden, filas, estatus, adminId } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return {
        orden: await ctx.leerOrden("bajo-el-tope"),
        filas: await leerHistorialCompleto(ctx, "bajo-el-tope"),
        estatus: ctx.estatus,
        adminId: ctx.adminId,
      };
    });

    expect(orden?.estatusId).toBe(estatus.get("en_bodega_central"));
    // Los tres efectos de la rama vieja, que esta ficha NO toca.
    expect(orden?.mensajeroAsignadoId).toBeNull();
    expect(orden?.prioridad).toBe(true);
    const liberacion = filas.filter((f) => f.origenTipo === "liberacion_sin_gestionar");
    expect(liberacion).toHaveLength(1);
    expect(liberacion[0].estatusOrigenId).toBe(estatus.get("sin_gestionar"));
    expect(liberacion[0].estatusDestinoId).toBe(estatus.get("en_bodega_central"));
    expect(liberacion[0].actorUsuarioId).toBe(adminId);
    // Y NINGUNA fila del tope: la orden no llego al umbral.
    expect(filas.map((f) => f.origenTipo)).not.toContain("rechazo_tope_intentos");
  });

  it("2b. la orden SIN ningun intento tambien va a bodega (el corte normal, sin cambios)", async () => {
    const { orden, estatus } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return { orden: await ctx.leerOrden("sin-intentos"), estatus: ctx.estatus };
    });

    expect(orden?.estatusId).toBe(estatus.get("en_bodega_central"));
  });

  /* ------------------------------------------------------------------ */
  /* Caso 3 · el punto que NO se confia: las ANULADAS no cuentan        */
  /* ------------------------------------------------------------------ */

  it("3. una barrida con gestiones ANULADAS no ve subir su contador dentro de la tx (R21)", async () => {
    // Tiene `umbral - 1` contables + DOS anuladas. Si las anuladas contaran, sumaria `umbral + 1`
    // y acabaria rechazada. Que acabe en bodega demuestra que el predicado importado —y no una
    // copia reescrita— es el que decide DENTRO de la transaccion.
    const { orden, filas, estatus } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      return {
        orden: await ctx.leerOrden("anuladas-no-cuentan"),
        filas: await leerHistorialCompleto(ctx, "anuladas-no-cuentan"),
        estatus: ctx.estatus,
      };
    });

    expect(orden?.estatusId).toBe(estatus.get("en_bodega_central"));
    expect(filas.map((f) => f.origenTipo)).not.toContain("rechazo_tope_intentos");
  });

  /* ------------------------------------------------------------------ */
  /* Caso 4 · R26 — aprobar dos veces no duplica                        */
  /* ------------------------------------------------------------------ */

  it("4. aprobar DOS veces deja una sola fila de historial, una sola gestion y un solo cambio (R26)", async () => {
    const { filas, gestiones, orden, estatus, segunda } = await conCorpus(async (ctx) => {
      await ctx.resolver("aprobado");
      const segunda = await ctx.resolver("aprobado");
      return {
        filas: await leerHistorialCompleto(ctx, "en-el-tope"),
        gestiones: await ctx.leerGestionesSinCierre("en-el-tope"),
        orden: await ctx.leerOrden("en-el-tope"),
        estatus: ctx.estatus,
        segunda,
      };
    });

    // La idempotencia es POR CONSTRUCCION, sin codigo de idempotencia: el bloque entero vive
    // dentro de `res.count === 1 && aprobado`, y el `updateMany` del cierre esta guardado por
    // `estado IN ESTADOS_RESOLUBLES`. Un cierre ya aprobado devuelve `count = 0` y no entra.
    // La segunda llamada no encuentra el cierre en un estado resoluble -> `conflict`, sin entrar
    // en la rama que mueve nada.
    expect(segunda).toBe("conflict");
    expect(filas.filter((f) => f.origenTipo === "rechazo_tope_intentos")).toHaveLength(1);
    expect(gestiones).toHaveLength(1);
    expect(orden?.estatusId).toBe(estatus.get("por_devolver_a_tienda"));
  });

  /* ------------------------------------------------------------------ */
  /* Caso 5 · R27 — rechazar el cierre no rechaza ninguna orden         */
  /* ------------------------------------------------------------------ */

  it("5. RECHAZAR el cierre no mueve ninguna orden ni crea ninguna gestion (R27)", async () => {
    const { tope, bajo, gestiones, filas, estatus } = await conCorpus(async (ctx) => {
      await ctx.resolver("rechazado");
      return {
        tope: await ctx.leerOrden("en-el-tope"),
        bajo: await ctx.leerOrden("bajo-el-tope"),
        gestiones: await ctx.leerGestionesSinCierre("en-el-tope"),
        filas: await leerHistorialCompleto(ctx, "en-el-tope"),
        estatus: ctx.estatus,
      };
    });

    // Las dos siguen exactamente donde el corte las dejo, con su mensajero.
    expect(tope?.estatusId).toBe(estatus.get("sin_gestionar"));
    expect(bajo?.estatusId).toBe(estatus.get("sin_gestionar"));
    expect(tope?.mensajeroAsignadoId).not.toBeNull();
    expect(gestiones).toHaveLength(0);
    expect(filas.filter((f) => f.origenTipo === "rechazo_tope_intentos")).toHaveLength(0);
    expect(filas.filter((f) => f.origenTipo === "liberacion_sin_gestionar")).toHaveLength(0);
  });
});

/** El historial COMPLETO de una orden del corpus (con y sin gestion enlazada), cronologico. */
async function leerHistorialCompleto(
  ctx: {
    repo: CierresAdminRepository;
    idPorClave: Map<string, string>;
  },
  clave: string,
): Promise<
  {
    origenTipo: string;
    estatusOrigenId: string | null;
    estatusDestinoId: string;
    actorUsuarioId: string | null;
    gestionOrdenId: string | null;
  }[]
> {
  // El repositorio guarda su cliente (que aqui ES la transaccion) en `prisma`. Se lee por ahi para
  // no tener que pasear el `tx` por todo el contexto.
  const tx = (ctx.repo as unknown as { prisma: PrismaClient }).prisma;
  return tx.ordenHistorialEstado.findMany({
    where: { ordenId: ctx.idPorClave.get(clave) as string },
    orderBy: { createdAt: "asc" },
    select: {
      origenTipo: true,
      estatusOrigenId: true,
      estatusDestinoId: true,
      actorUsuarioId: true,
      gestionOrdenId: true,
    },
  }) as never;
}
