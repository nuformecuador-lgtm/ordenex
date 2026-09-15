import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { ICorteDiarioRepository } from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * FICHA 425 (B7, R2/R8/R10/R11/R12/R13/R14/R20) — APROBAR UN CIERRE QUE INCORPORA RECHAZOS DE TIENDA,
 * CONTRA POSTGRES Y CON LA CADENA REAL ENTERA.
 *
 * Molde: `liberacion-al-aprobar-cierre-real.test.ts` (315) y `cierre-aprobacion-libera-solo-lo-suyo`
 * (271). La diferencia DELIBERADA con los dos: aqui los libros de dinero son los REALES
 * (`WalletFeedService`, `WalletTiendaFeedService`, `WalletMensajeroFeedService`,
 * `WalletIndemnizacionFeedService` y sus repositorios). R8 dice que aprobar NO emite ni un apunte por
 * un rechazo de tienda, y eso no lo puede afirmar un doble que no emite nada nunca.
 *
 * LOS CUATRO ESCENARIOS:
 *
 *   1. NA-981 REPRODUCIDO (R13). Tres ordenes (NA-947, NA-981, NA-1103) de un mismo mensajero,
 *      rechazadas por la tienda POR LA VIA REAL (`GestionOrdenRepository.rechazarDesdeDevuelta`) desde
 *      una devolucion de un cierre ya aprobado, y sin ninguna gestion propia suelta. El cierre lo crea
 *      el CORTE real, el mensajero lo re-solicita y un admin lo aprueba con `CierresAdminService`, sin
 *      escanear nada. Ni una edicion manual sobre las ordenes ni sobre sus gestiones.
 *
 *   2. CON CALLE, EMPAREJADO (R8/R10/R11/R12). El mismo cierre —una entregada y una rechazada de calle—
 *      sembrado dos veces: con dos rechazos de tienda (uno en zona CENTRAL y otro en SATELITE) y sin
 *      ellos. Se aprueba confirmando SOLO el paquete de la rechazada de calle. Los apuntes de los dos
 *      cierres tienen que ser el MISMO conjunto, y no vacio.
 *
 *   3. CIERRE RECHAZADO (R20). El admin lo rechaza: el vinculo se queda con ESE cierre, un cierre
 *      posterior no se lo lleva y al re-solicitarlo sigue siendo el suyo.
 *
 *   4. EL CAMINO DE ANDY Y ARNEL, QUE NO TRABAJAN (R11/R12/R13). Nadie re-solicita: el corte crea
 *      el `vencido` con solo rechazos y lo resuelve un ADMIN. P1: aprobarlo directamente da
 *      `conflict` (solo se aprueba un `solicitado`, desde la 111) y las ordenes siguen en
 *      `rechazada`. P2: el admin lo destraba con `forzarSolicitudVencido` y lo aprueba, y las
 *      ordenes salen hacia su destino por zona sin que el mensajero toque nada. La contraprueba
 *      —quitar el destrabe pone P2 en rojo— esta en `progress/impl_425.md`.
 *
 * Todo corre en transacciones que SIEMPRE se revierten. SIN base se SALTA; con base y sin catalogo o
 * sin zona central, falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f425a${Date.now().toString(36)}`;
const GUIA_BASE = 525_000_000 + (Date.now() % 50_000_000);

const URLS_NO_USADAS: ISignedUrlProvider = {
  createSignedUrl: async (ruta: string) => ruta,
  createSignedUrls: async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, r])),
};

const ESTATUS_USADOS = [
  "entregada",
  "rechazada",
  "devuelta",
  "por_devolver",
  "por_devolver_a_tienda",
] as const;
type EstatusUsado = (typeof ESTATUS_USADOS)[number];

interface EstadoDeOrden {
  estatus: string;
  mensajeroAsignadoId: string | null;
  prioridad: boolean;
  montoCobrar: string | null;
}

describeSiHayBase("425/B7 — aprobar un cierre con rechazos de tienda, contra Postgres", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let fksUsuario: { tipoIdentificacionId: string; rolId: string };
  let estatus: Map<string, string>;
  let centralZonaId: string;
  let n = 0;

  function idDe(value: EstatusUsado): string {
    const id = estatus.get(value);
    if (id === undefined) throw new Error(`falta el estatus «${value}» en \`order_status\``);
    return id;
  }

  // ---------------------------------------------------------------------------------------------
  // Siembra
  // ---------------------------------------------------------------------------------------------

  async function crearUsuario(tx: TxDeTest, prefijo: string, zonaId: string): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `${prefijo} 425 ${clave}`,
        email: `${prefijo}425-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `${prefijo.slice(0, 1).toUpperCase()}425${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
        zonaId,
      },
      select: { id: true },
    });
    return u.id;
  }

  /** Una zona SATELITE nueva con su tarifa por defecto, su mensajero y su admin de bodega. */
  async function sembrarPersonas(tx: TxDeTest) {
    const clave = `${SUFIJO}${(n += 1)}`;
    const zona = await tx.zona.create({
      data: { nombre: `Zona satelite 425 ${clave}` },
      select: { id: true },
    });
    await tx.tarifaZonaMensajero.create({
      data: { zonaId: zona.id, vehiculoId: null, cobroEntregado: "1500.00", cobroRechazado: "164.00" },
    });
    const mensajeroId = await crearUsuario(tx, "mensajero", zona.id);
    const adminId = await crearUsuario(tx, "admin", zona.id);
    const actorMensajero: Actor = { usuarioId: mensajeroId, rol: "mensajero" };
    const actorAdmin: Actor = { usuarioId: adminId, rol: "adminSatelite", zonaId: zona.id };
    return { zonaSateliteId: zona.id, mensajeroId, adminId, actorMensajero, actorAdmin };
  }

  async function sembrarOrden(
    tx: TxDeTest,
    o: { mensajeroId: string; estatus: EstatusUsado; zonaId: string; montoCobrar: string; remision?: string },
  ) {
    const clave = `${SUFIJO}${(n += 1)}`;
    const numGuia = GUIA_BASE + n;
    const numRemision = o.remision ? `${o.remision}-${clave}` : `R-${clave}`;
    const orden = await tx.orden.create({
      data: {
        numGuia,
        numRemision,
        destinatario: `Dest ${clave}`,
        telefonoDest: "88880000",
        producto: `Prod ${clave}`,
        estatusId: idDe(o.estatus),
        mensajeroAsignadoId: o.mensajeroId,
        montoCobrar: o.montoCobrar,
        tiendaId: fks.tiendaId,
        zonaId: o.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
      },
      select: { id: true },
    });
    return { ordenId: orden.id, numGuia, numRemision };
  }

  /** Una gestion SUELTA con su historial. `efectivo` = entregada con esa linea de pago. */
  async function sembrarGestionSuelta(
    tx: TxDeTest,
    g: {
      ordenId: string;
      mensajeroId: string;
      resultado: "entregada" | "rechazada";
      origenTipo: OrdenHistorialOrigenTipo;
      efectivo?: string;
    },
  ): Promise<string> {
    const gestion = await tx.gestionOrden.create({
      data: {
        ordenId: g.ordenId,
        mensajeroId: g.mensajeroId,
        resultado: g.resultado,
        cierreId: null,
        ...(g.efectivo
          ? { montoRecibido: g.efectivo, metodoPago: "efectivo" as const }
          : { motivo: "No la recibe" }),
      },
      select: { id: true },
    });
    if (g.efectivo) {
      await tx.gestionOrdenPago.create({
        data: { gestionId: gestion.id, metodo: "efectivo", monto: g.efectivo },
      });
    }
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId: g.ordenId,
        estatusOrigenId: null,
        estatusDestinoId: idDe(g.resultado),
        actorUsuarioId: null,
        origenTipo: g.origenTipo,
        gestionOrdenId: gestion.id,
      },
    });
    return gestion.id;
  }

  // ---------------------------------------------------------------------------------------------
  // La cadena REAL, sobre la transaccion del test
  // ---------------------------------------------------------------------------------------------

  function montar(tx: TxDeTest) {
    const cliente = clienteConTransaccionAnidada(tx);
    const zonaRepo = new ZonaRepository(cliente);
    const ordenRepo = new OrdenRepository(cliente);
    const tarifaZonaRepo = new TarifaZonaMensajeroRepository(cliente);
    const cierreDiaRepo = new CierreDiaRepository(cliente, new TarifaVigenteRepository(cliente));
    const adminRepo = new CierresAdminRepository(
      cliente,
      new WalletMovimientoRepository(cliente),
      new WalletFeedService(),
      new WalletTiendaMovimientoRepository(cliente),
      new WalletTiendaFeedService(),
      new PagoMensajeroMovimientoRepository(cliente),
      new WalletMensajeroFeedService(),
      new WalletIndemnizacionFeedService(),
    );
    const corteReal = new CorteDiarioRepository(cliente);
    return {
      gestionRepo: new GestionOrdenRepository(cliente),
      adminRepo,
      mensajero: new CierreDiaService(cierreDiaRepo, zonaRepo, ordenRepo, URLS_NO_USADAS, tarifaZonaRepo),
      admin: new CierresAdminService(
        adminRepo,
        zonaRepo,
        ordenRepo,
        URLS_NO_USADAS,
        new LiquidacionPagoRepository(cliente),
        new PagoMensajeroMovimientoRepository(cliente),
      ),
      corteDe: (mensajeroId: string) =>
        new CorteDiarioService(
          {
            // La seleccion REAL, recortada a ESTE mensajero (la base local es compartida).
            findMensajerosConActividadSinCierre: async (dia: Date) =>
              (await corteReal.findMensajerosConActividadSinCierre(dia)).filter(
                (m) => m.mensajeroId === mensajeroId,
              ),
          } as ICorteDiarioRepository,
          cierreDiaRepo,
          zonaRepo,
          ordenRepo,
          tarifaZonaRepo,
          { warn: () => {} },
        ),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Lecturas
  // ---------------------------------------------------------------------------------------------

  async function leerOrdenes(tx: TxDeTest, ordenIds: string[]): Promise<EstadoDeOrden[]> {
    const filas = await tx.orden.findMany({
      where: { id: { in: ordenIds } },
      select: {
        id: true,
        estatus: { select: { value: true } },
        mensajeroAsignadoId: true,
        prioridad: true,
        montoCobrar: true,
      },
    });
    const porId = new Map(filas.map((f) => [f.id, f]));
    return ordenIds.map((id) => {
      const f = porId.get(id);
      if (f === undefined) throw new Error(`la orden ${id} desaparecio`);
      return {
        estatus: f.estatus.value,
        mensajeroAsignadoId: f.mensajeroAsignadoId,
        prioridad: f.prioridad,
        montoCobrar: f.montoCobrar?.toFixed(2) ?? null,
      };
    });
  }

  type Apunte = { tipo: string; categoria: string; monto: Prisma.Decimal; origenTipo: string };

  /** Los apuntes de los TRES libros cuyo origen es alguno de estos ids, normalizados y ordenados. */
  async function apuntesDe(tx: TxDeTest, origenIds: string[]): Promise<string[]> {
    const donde = { origenId: { in: origenIds } };
    const sel = { tipo: true, categoria: true, monto: true, origenTipo: true } as const;
    const caja = await tx.walletMovimiento.findMany({ where: donde, select: sel });
    const tienda = await tx.walletTiendaMovimiento.findMany({ where: donde, select: sel });
    const mensajero = await tx.pagoMensajeroMovimiento.findMany({ where: donde, select: sel });
    const fila = (libro: string) => (m: Apunte) =>
      `${libro}|${m.origenTipo}|${m.tipo}|${m.categoria}|${m.monto.toFixed(2)}`;
    return [
      ...caja.map(fila("caja")),
      ...tienda.map(fila("tienda")),
      ...mensajero.map(fila("mensajero")),
    ].sort();
  }

  async function historialDeDevolucion(tx: TxDeTest, ordenIds: string[]) {
    const filas = await tx.ordenHistorialEstado.findMany({
      where: { ordenId: { in: ordenIds }, origenTipo: "devolucion_rechazada" },
      select: {
        ordenId: true,
        actorUsuarioId: true,
        estatusOrigen: { select: { value: true } },
        estatusDestino: { select: { value: true } },
      },
    });
    return ordenIds.map((ordenId) =>
      filas
        .filter((f) => f.ordenId === ordenId)
        .map((f) => ({
          actor: f.actorUsuarioId,
          origen: f.estatusOrigen?.value ?? null,
          destino: f.estatusDestino.value,
        })),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Escenario 1 — NA-981 reproducido
  // ---------------------------------------------------------------------------------------------

  function escenarioNA981() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ctx = montar(tx);
      const p = await sembrarPersonas(tx);

      // La devolucion ya se aprobo en un cierre ANTERIOR del mismo mensajero: asi llegan a `devuelta`.
      const viejo = await tx.cierreDia.create({
        data: {
          mensajeroId: p.mensajeroId,
          estado: "aprobado",
          destinoTipo: "bodega_satelite",
          destinoZonaId: p.zonaSateliteId,
        },
        select: { id: true },
      });
      const ordenes: { ordenId: string; gestionRechazoId: string; numRemision: string }[] = [];
      for (const remision of ["NA-947", "NA-981", "NA-1103"]) {
        const o = await sembrarOrden(tx, {
          mensajeroId: p.mensajeroId,
          estatus: "devuelta",
          zonaId: centralZonaId,
          montoCobrar: "25000.00",
          remision,
        });
        await tx.gestionOrden.create({
          data: {
            ordenId: o.ordenId,
            mensajeroId: p.mensajeroId,
            resultado: "devuelta",
            cierreId: viejo.id,
            createdAt: new Date("2026-09-09T20:00:00.000Z"),
          },
        });
        // LA VIA REAL DE LA TIENDA (240): `devuelta -> rechazada`, gestion sintetica atribuida al
        // mensajero de la devolucion y con `cierre_id` NULL. Exactamente como nacio NA-981.
        const aplicado = await ctx.gestionRepo.rechazarDesdeDevuelta({
          ordenId: o.ordenId,
          estatusDevueltaId: idDe("devuelta"),
          estatusRechazadaId: idDe("rechazada"),
          motivo: "La tienda no recibe la devolucion",
          actorUsuarioId: fks.tiendaId,
        });
        if (!aplicado) throw new Error(`rechazarDesdeDevuelta no aplico sobre ${remision}`);
        const g = await tx.gestionOrden.findFirstOrThrow({
          where: { ordenId: o.ordenId, resultado: "rechazada" },
          select: { id: true },
        });
        ordenes.push({ ordenId: o.ordenId, gestionRechazoId: g.id, numRemision: o.numRemision });
      }
      const ordenIds = ordenes.map((o) => o.ordenId);
      const gestionIds = ordenes.map((o) => o.gestionRechazoId);
      const antes = await leerOrdenes(tx, ordenIds);

      const sonda = await ctx.mensajero.solicitarCierre(p.actorMensajero);
      const corte = await ctx.corteDe(p.mensajeroId).ejecutarCorte(new Date());
      const vencido = await tx.cierreDia.findFirst({
        where: { mensajeroId: p.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (vencido === null) throw new Error(`el corte no creo el cierre: ${JSON.stringify(corte)}`);
      const resolicitud = await ctx.mensajero.solicitarCierre(p.actorMensajero);
      const detalle = await ctx.admin.verCierreDetalle(vencido.id, p.actorAdmin);
      const aprobacion = await ctx.admin.aprobarCierre(vencido.id, p.actorAdmin, [], []);

      const vinculos = await tx.cierreRechazoTienda.findMany({
        where: { gestionId: { in: gestionIds } },
        select: { cierreId: true },
      });
      const gestiones = await tx.gestionOrden.findMany({
        where: { id: { in: gestionIds } },
        select: { cierreId: true, pagoMensajero: true, ingresoBodegaRechazo: true },
      });
      return {
        adminId: p.adminId,
        cierreId: vencido.id,
        remisiones: ordenes.map((o) => o.numRemision).sort(),
        sonda,
        vencidosCreados: corte.vencidosCreados,
        resolicitud,
        remisionesEnElDetalle:
          detalle.status === "ok" ? detalle.rechazosDeTienda.map((r) => r.numRemision).sort() : null,
        aprobacion: aprobacion.status,
        antes,
        despues: await leerOrdenes(tx, ordenIds),
        historial: await historialDeDevolucion(tx, ordenIds),
        cierresDeLosVinculos: vinculos.map((v) => v.cierreId),
        gestiones: gestiones.map((g) => ({
          cierreId: g.cierreId,
          pago: g.pagoMensajero,
          ingreso: g.ingresoBodegaRechazo,
        })),
        apuntes: await apuntesDe(tx, [vencido.id, ...gestionIds]),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Escenario 2 — con calle, emparejado
  // ---------------------------------------------------------------------------------------------

  function escenarioConCalle(conRechazosDeTienda: boolean) {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ctx = montar(tx);
      const p = await sembrarPersonas(tx);

      const entregada = await sembrarOrden(tx, {
        mensajeroId: p.mensajeroId,
        estatus: "entregada",
        zonaId: centralZonaId,
        montoCobrar: "12500.00",
      });
      await sembrarGestionSuelta(tx, {
        ordenId: entregada.ordenId,
        mensajeroId: p.mensajeroId,
        resultado: "entregada",
        origenTipo: "gestion",
        efectivo: "12500.00",
      });
      const rechazadaCalle = await sembrarOrden(tx, {
        mensajeroId: p.mensajeroId,
        estatus: "rechazada",
        zonaId: centralZonaId,
        montoCobrar: "9000.00",
      });
      const gestionCalle = await sembrarGestionSuelta(tx, {
        ordenId: rechazadaCalle.ordenId,
        mensajeroId: p.mensajeroId,
        resultado: "rechazada",
        origenTipo: "gestion",
      });

      const tienda: { central: string; satelite: string; gestiones: string[] } | null =
        conRechazosDeTienda ? { central: "", satelite: "", gestiones: [] } : null;
      if (tienda !== null) {
        const central = await sembrarOrden(tx, {
          mensajeroId: p.mensajeroId,
          estatus: "rechazada",
          zonaId: centralZonaId,
          montoCobrar: "7000.00",
        });
        const satelite = await sembrarOrden(tx, {
          mensajeroId: p.mensajeroId,
          estatus: "rechazada",
          zonaId: p.zonaSateliteId,
          montoCobrar: "8000.00",
        });
        tienda.central = central.ordenId;
        tienda.satelite = satelite.ordenId;
        for (const ordenId of [central.ordenId, satelite.ordenId]) {
          tienda.gestiones.push(
            await sembrarGestionSuelta(tx, {
              ordenId,
              mensajeroId: p.mensajeroId,
              resultado: "rechazada",
              origenTipo: "rechazo_tienda",
            }),
          );
        }
      }
      const ordenesDeTienda = tienda === null ? [] : [tienda.central, tienda.satelite];
      const antes = await leerOrdenes(tx, ordenesDeTienda);

      const solicitud = await ctx.mensajero.solicitarCierre(p.actorMensajero);
      if (solicitud.status !== "ok" || solicitud.via !== "creado") {
        throw new Error(`solicitarCierre no creo el cierre: ${JSON.stringify(solicitud)}`);
      }
      const cierreId = solicitud.cierreId;
      if (cierreId === undefined) throw new Error("solicitarCierre respondio `creado` sin cierreId");
      const retornables = await ctx.adminRepo.findGestionesRetornablesDelCierre(cierreId, {
        destinoTipo: "bodega_satelite",
        destinoZonaId: p.zonaSateliteId,
      });
      // R10: SOLO se confirma el paquete de la rechazada de CALLE. Si el servicio exigiera tambien los
      // rechazos de tienda, esta aprobacion volveria como `validation_error`.
      const aprobacion = await ctx.admin.aprobarCierre(cierreId, p.actorAdmin, [], [
        { gestionId: gestionCalle, numGuia: rechazadaCalle.numGuia },
      ]);

      return {
        adminId: p.adminId,
        gestionCalle,
        retornables: retornables.map((r) => r.gestionId),
        aprobacion,
        antes,
        despues: await leerOrdenes(tx, ordenesDeTienda),
        historial: await historialDeDevolucion(tx, ordenesDeTienda),
        cierresDeLosVinculos:
          tienda === null
            ? []
            : (
                await tx.cierreRechazoTienda.findMany({
                  where: { gestionId: { in: tienda.gestiones } },
                  select: { cierreId: true },
                })
              ).map((v) => v.cierreId),
        cierreId,
        apuntesDelCierre: await apuntesDe(tx, [cierreId]),
        apuntesDeLosRechazos: tienda === null ? [] : await apuntesDe(tx, tienda.gestiones),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Escenario 3 — cierre rechazado
  // ---------------------------------------------------------------------------------------------

  function escenarioRechazado() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ctx = montar(tx);
      const p = await sembrarPersonas(tx);

      const sembrarDia = async () => {
        const e = await sembrarOrden(tx, {
          mensajeroId: p.mensajeroId,
          estatus: "entregada",
          zonaId: centralZonaId,
          montoCobrar: "5000.00",
        });
        await sembrarGestionSuelta(tx, {
          ordenId: e.ordenId,
          mensajeroId: p.mensajeroId,
          resultado: "entregada",
          origenTipo: "gestion",
          efectivo: "5000.00",
        });
        const r = await sembrarOrden(tx, {
          mensajeroId: p.mensajeroId,
          estatus: "rechazada",
          zonaId: centralZonaId,
          montoCobrar: "6000.00",
        });
        const g = await sembrarGestionSuelta(tx, {
          ordenId: r.ordenId,
          mensajeroId: p.mensajeroId,
          resultado: "rechazada",
          origenTipo: "rechazo_tienda",
        });
        return { ordenRechazo: r.ordenId, gestionRechazo: g };
      };

      const dia1 = await sembrarDia();
      const solicitud = await ctx.mensajero.solicitarCierre(p.actorMensajero);
      if (solicitud.status !== "ok" || solicitud.via !== "creado") {
        throw new Error(`solicitarCierre no creo el cierre: ${JSON.stringify(solicitud)}`);
      }
      const c1 = solicitud.cierreId;
      if (c1 === undefined) throw new Error("solicitarCierre respondio `creado` sin cierreId");
      const rechazo = await ctx.admin.rechazarCierre(c1, "Falta un paquete", p.actorAdmin);
      const cierresDelVinculoTrasRechazar = (
        await tx.cierreRechazoTienda.findMany({
          where: { gestionId: dia1.gestionRechazo },
          select: { cierreId: true },
        })
      ).map((v) => v.cierreId);
      const [ordenTrasRechazar] = await leerOrdenes(tx, [dia1.ordenRechazo]);

      // Trabajo NUEVO y el corte de esa noche: nace un segundo cierre.
      const dia2 = await sembrarDia();
      const corte = await ctx.corteDe(p.mensajeroId).ejecutarCorte(new Date());
      const c2 = await tx.cierreDia.findFirst({
        where: { mensajeroId: p.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (c2 === null) throw new Error(`el corte no creo el segundo cierre: ${JSON.stringify(corte)}`);
      const vinculosDeC2 = (
        await tx.cierreRechazoTienda.findMany({ where: { cierreId: c2.id }, select: { gestionId: true } })
      ).map((v) => v.gestionId);

      // El mensajero re-solicita: le toca el MAS VIEJO, el rechazado.
      const resolicitud = await ctx.mensajero.solicitarCierre(p.actorMensajero);
      const estadoDeC1 = (
        await tx.cierreDia.findUniqueOrThrow({ where: { id: c1 }, select: { estado: true } })
      ).estado;
      const cierresDelVinculoAlFinal = (
        await tx.cierreRechazoTienda.findMany({
          where: { gestionId: dia1.gestionRechazo },
          select: { cierreId: true },
        })
      ).map((v) => v.cierreId);

      return {
        c1,
        c2: c2.id,
        gestionRechazoDia1: dia1.gestionRechazo,
        gestionRechazoDia2: dia2.gestionRechazo,
        rechazo,
        cierresDelVinculoTrasRechazar,
        ordenTrasRechazar,
        vinculosDeC2,
        resolicitud,
        estadoDeC1,
        cierresDelVinculoAlFinal,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------

  // ---------------------------------------------------------------------------------------------
  // Escenario 4 — el mensajero NO trabaja: el ADMIN saca adelante el `vencido` (P1 y P2)
  // ---------------------------------------------------------------------------------------------

  /**
   * El camino que van a seguir Andy Cortes y Arnel Guillen: no trabajan, asi que nadie re-solicita su
   * cierre. Lo crea el corte con SOLO rechazos y lo resuelve un administrador.
   *
   * `destrabar = false` es la sonda P1: aprobar el `vencido` tal cual. `destrabar = true` es P2:
   * «Destrabar cierre vencido» (`forzarSolicitudVencido`) y despues aprobar. En los DOS, despues de
   * registrar los rechazos NO se llama a ningun servicio del mensajero: ni solicitar ni re-solicitar.
   */
  function escenarioAdminSinMensajero(destrabar: boolean) {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ctx = montar(tx);
      const p = await sembrarPersonas(tx);

      // Un rechazo de tienda en zona CENTRAL y otro en SATELITE, los dos por la VIA REAL de la tienda
      // y desde una devolucion que ya se aprobo en un cierre anterior.
      const viejo = await tx.cierreDia.create({
        data: {
          mensajeroId: p.mensajeroId,
          estado: "aprobado",
          destinoTipo: "bodega_satelite",
          destinoZonaId: p.zonaSateliteId,
        },
        select: { id: true },
      });
      const ordenIds: string[] = [];
      for (const zonaId of [centralZonaId, p.zonaSateliteId]) {
        const o = await sembrarOrden(tx, {
          mensajeroId: p.mensajeroId,
          estatus: "devuelta",
          zonaId,
          montoCobrar: "18000.00",
        });
        await tx.gestionOrden.create({
          data: {
            ordenId: o.ordenId,
            mensajeroId: p.mensajeroId,
            resultado: "devuelta",
            cierreId: viejo.id,
            createdAt: new Date("2026-09-09T20:00:00.000Z"),
          },
        });
        const aplicado = await ctx.gestionRepo.rechazarDesdeDevuelta({
          ordenId: o.ordenId,
          estatusDevueltaId: idDe("devuelta"),
          estatusRechazadaId: idDe("rechazada"),
          motivo: "La tienda no recibe la devolucion",
          actorUsuarioId: fks.tiendaId,
        });
        if (!aplicado) throw new Error("rechazarDesdeDevuelta no aplico");
        ordenIds.push(o.ordenId);
      }
      const antes = await leerOrdenes(tx, ordenIds);

      const corte = await ctx.corteDe(p.mensajeroId).ejecutarCorte(new Date());
      const vencido = await tx.cierreDia.findFirst({
        where: { mensajeroId: p.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (vencido === null) throw new Error(`el corte no creo el cierre: ${JSON.stringify(corte)}`);

      // A partir de aqui actua el ADMIN, y solo el admin.
      const destrabe = destrabar ? await ctx.admin.forzarSolicitudVencido(vencido.id, p.actorAdmin) : null;
      const aprobacion = await ctx.admin.aprobarCierre(vencido.id, p.actorAdmin, [], []);

      const estadoFinal = (
        await tx.cierreDia.findUniqueOrThrow({ where: { id: vencido.id }, select: { estado: true } })
      ).estado;
      return {
        adminId: p.adminId,
        vencidosCreados: corte.vencidosCreados,
        destrabe,
        aprobacion: aprobacion.status,
        estadoFinal,
        antes,
        despues: await leerOrdenes(tx, ordenIds),
        historial: await historialDeDevolucion(tx, ordenIds),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------

  let na981: Awaited<ReturnType<typeof escenarioNA981>>;
  let conRechazos: Awaited<ReturnType<typeof escenarioConCalle>>;
  let sinRechazos: Awaited<ReturnType<typeof escenarioConCalle>>;
  let rechazado: Awaited<ReturnType<typeof escenarioRechazado>>;
  let adminP1: Awaited<ReturnType<typeof escenarioAdminSinMensajero>>;
  let adminP2: Awaited<ReturnType<typeof escenarioAdminSinMensajero>>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error("hay DATABASE_URL pero la tabla `orden` esta vacia: corre `pnpm run db:seed`.");
    }
    fks = encontradas;
    const usuario = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (usuario === null) throw new Error("hace falta al menos UN usuario en la base.");
    fksUsuario = usuario;
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: [...ESTATUS_USADOS] } },
      select: { id: true, value: true },
    });
    estatus = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of ESTATUS_USADOS) idDe(v);
    const central = await prisma.zona.findFirst({ where: { esCentral: true }, select: { id: true } });
    if (central === null) {
      throw new Error(
        "la base no tiene zona CENTRAL (`zona.es_central`): sin ella R11 no se puede medir. " +
          "Corre `pnpm exec tsx scripts/seed-zonas.ts`.",
      );
    }
    centralZonaId = central.id;

    na981 = await escenarioNA981();
    conRechazos = await escenarioConCalle(true);
    sinRechazos = await escenarioConCalle(false);
    rechazado = await escenarioRechazado();
    adminP1 = await escenarioAdminSinMensajero(false);
    adminP2 = await escenarioAdminSinMensajero(true);
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ============================ Escenario 1 — NA-981 reproducido ============================

  it("R13: NA-947, NA-981 y NA-1103 salen de `rechazada` sin edicion manual (via real + corte + aprobacion)", () => {
    expect(na981.antes.map((o) => o.estatus)).toEqual(["rechazada", "rechazada", "rechazada"]);
    // Sonda: el mensajero no puede pedirlo el; lo crea el corte, y el lo re-solicita.
    expect(na981.sonda).toMatchObject({ status: "conflict" });
    expect(na981.vencidosCreados).toBe(1);
    expect(na981.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
    // R10: aprobado SIN confirmar un solo paquete.
    expect(na981.aprobacion).toBe("ok");
    // R11: las tres son de zona CENTRAL.
    expect(na981.despues.map((o) => o.estatus)).toEqual([
      "por_devolver_a_tienda",
      "por_devolver_a_tienda",
      "por_devolver_a_tienda",
    ]);
  });

  it("R14 (datos): el detalle del admin trae los tres rechazos para separar el paquete", () => {
    expect(na981.remisionesEnElDetalle).toEqual(na981.remisiones);
  });

  it("R12: cada salida queda en el historial con el admin como actor, sin tocar mensajero, prioridad ni importe", () => {
    for (const filas of na981.historial) {
      expect(filas).toEqual([
        { actor: na981.adminId, origen: "rechazada", destino: "por_devolver_a_tienda" },
      ]);
    }
    const sinEstatus = (o: EstadoDeOrden) => ({ ...o, estatus: undefined });
    expect(na981.despues.map(sinEstatus)).toEqual(na981.antes.map(sinEstatus));
    expect(na981.antes.every((o) => o.mensajeroAsignadoId !== null)).toBe(true);
  });

  it("R2/R9: el vinculo sobrevive a la aprobacion y las gestiones siguen sin cierre y sin dinero", () => {
    expect(na981.cierresDeLosVinculos).toEqual([na981.cierreId, na981.cierreId, na981.cierreId]);
    expect(na981.gestiones).toEqual([
      { cierreId: null, pago: null, ingreso: null },
      { cierreId: null, pago: null, ingreso: null },
      { cierreId: null, pago: null, ingreso: null },
    ]);
  });

  it("R8: aprobar un cierre SOLO de rechazos no emite un solo apunte", () => {
    // Por si solo seria verde por vacio (el cierre no tiene gestiones); el emparejado de abajo no.
    expect(na981.apuntes).toEqual([]);
  });

  // ============================ Escenario 2 — con calle, emparejado ============================

  it("R10: la confirmacion fisica exige SOLO la rechazada de calle, y el cierre se aprueba con ella", () => {
    expect(conRechazos.retornables).toEqual([conRechazos.gestionCalle]);
    expect(sinRechazos.retornables).toEqual([sinRechazos.gestionCalle]);
    expect(conRechazos.aprobacion.status).toBe("ok");
    expect(sinRechazos.aprobacion.status).toBe("ok");
  });

  it("R11: el rechazo de zona CENTRAL va a `por_devolver_a_tienda` y el de SATELITE a `por_devolver`", () => {
    expect(conRechazos.antes.map((o) => o.estatus)).toEqual(["rechazada", "rechazada"]);
    expect(conRechazos.despues.map((o) => o.estatus)).toEqual(["por_devolver_a_tienda", "por_devolver"]);
  });

  it("R12: las dos salidas llevan al admin en el historial y no tocan mensajero, prioridad ni importe", () => {
    expect(conRechazos.historial).toEqual([
      [{ actor: conRechazos.adminId, origen: "rechazada", destino: "por_devolver_a_tienda" }],
      [{ actor: conRechazos.adminId, origen: "rechazada", destino: "por_devolver" }],
    ]);
    const sinEstatus = (o: EstadoDeOrden) => ({ ...o, estatus: undefined });
    expect(conRechazos.despues.map(sinEstatus)).toEqual(conRechazos.antes.map(sinEstatus));
    expect(conRechazos.antes.map((o) => o.montoCobrar)).toEqual(["7000.00", "8000.00"]);
  });

  it("R8: los apuntes de la aprobacion son EL MISMO conjunto con y sin los rechazos de tienda, y no vacio", () => {
    // Contrapunto primero: la aprobacion SI movio dinero, asi que la igualdad no es verde por vacio.
    expect(sinRechazos.apuntesDelCierre.length).toBeGreaterThan(0);
    expect(conRechazos.apuntesDelCierre).toEqual(sinRechazos.apuntesDelCierre);
    // Ni un apunte con origen en las gestiones de los rechazos de tienda.
    expect(conRechazos.apuntesDeLosRechazos).toEqual([]);
    // Y en particular: el flete de devolucion no se emite ni una vez mas por ellos.
    const fletes = (xs: string[]) =>
      xs.filter((x) => x.includes("|ingreso_flete_devolucion|") || x.includes("|ingreso_iva_flete_devolucion|"));
    expect(fletes(conRechazos.apuntesDelCierre)).toEqual(fletes(sinRechazos.apuntesDelCierre));
  });

  it("R2: los dos vinculos siguen apuntando al cierre despues de aprobarlo", () => {
    expect(conRechazos.cierresDeLosVinculos).toEqual([conRechazos.cierreId, conRechazos.cierreId]);
  });

  // ============================ Escenario 3 — cierre rechazado ============================

  it("R20: rechazar el cierre conserva su vinculo y NO saca la orden de `rechazada`", () => {
    expect(rechazado.rechazo).toMatchObject({ status: "ok", estado: "rechazado" });
    expect(rechazado.cierresDelVinculoTrasRechazar).toEqual([rechazado.c1]);
    expect(rechazado.ordenTrasRechazar.estatus).toBe("rechazada");
  });

  it("R20/R3: el cierre posterior se lleva SOLO el rechazo nuevo, y al re-solicitar el viejo sigue siendo suyo", () => {
    expect(rechazado.vinculosDeC2).toEqual([rechazado.gestionRechazoDia2]);
    expect(rechazado.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
    expect(rechazado.estadoDeC1).toBe("solicitado");
    expect(rechazado.cierresDelVinculoAlFinal).toEqual([rechazado.c1]);
  });

  // ================= Escenario 4 — el mensajero no trabaja: lo resuelve el ADMIN =================

  it("P1: aprobar DIRECTAMENTE el `vencido` da `conflict` y las ordenes siguen en `rechazada`", () => {
    // La regla, documentada: desde la 111 solo se aprueba un `solicitado` (`ESTADOS_RESOLUBLES`).
    expect(adminP1.vencidosCreados).toBe(1);
    expect(adminP1.aprobacion).toBe("conflict");
    expect(adminP1.estadoFinal).toBe("vencido");
    expect(adminP1.despues.map((o) => o.estatus)).toEqual(["rechazada", "rechazada"]);
    expect(adminP1.historial).toEqual([[], []]);
  });

  it("P2 (R11/R13): el admin DESTRABA el `vencido` y lo aprueba; las ordenes salen hacia su destino sin que el mensajero haga nada", () => {
    expect(adminP2.antes.map((o) => o.estatus)).toEqual(["rechazada", "rechazada"]);
    // Primero el efecto que importa: la zona CENTRAL va a `por_devolver_a_tienda`, la SATELITE a
    // `por_devolver`.
    expect(adminP2.despues.map((o) => o.estatus)).toEqual(["por_devolver_a_tienda", "por_devolver"]);
    expect(adminP2.aprobacion).toBe("ok");
    expect(adminP2.estadoFinal).toBe("aprobado");
  });

  it("P2 (R12): cada salida lleva al admin en el historial y no toca mensajero, prioridad ni importe", () => {
    expect(adminP2.historial).toEqual([
      [{ actor: adminP2.adminId, origen: "rechazada", destino: "por_devolver_a_tienda" }],
      [{ actor: adminP2.adminId, origen: "rechazada", destino: "por_devolver" }],
    ]);
    const sinEstatus = (o: EstadoDeOrden) => ({ ...o, estatus: undefined });
    expect(adminP2.despues.map(sinEstatus)).toEqual(adminP2.antes.map(sinEstatus));
  });

  it("P2: el destrabe es `forzarSolicitudVencido`, y deja el cierre en `solicitado` antes de aprobarlo", () => {
    expect(adminP2.destrabe).toMatchObject({ status: "ok", estado: "solicitado" });
  });
});
