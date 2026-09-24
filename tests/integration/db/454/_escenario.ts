import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { ICorteDiarioRepository } from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";
import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenTraspasoRepository } from "@/lib/repositories/OrdenTraspasoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { RutaOptimizadaRepository } from "@/lib/repositories/RutaOptimizadaRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import { SolicitudAyudaService } from "@/lib/services/SolicitudAyudaService";
import { GestionDesdeAyudaService } from "@/lib/services/GestionDesdeAyudaService";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";

import {
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "../_postgres-real";

/**
 * FEATURE 454 (T0.1) — EL ESCENARIO COMPARTIDO DE LA FASE 0.
 *
 * Construye, DENTRO de una transaccion que SIEMPRE se revierte, un mundo propio (tienda, zona
 * satelite con su tarifa, dos mensajeros, un adminSatelite y un maestro) y expone VERBOS que llaman a
 * los SERVICIOS REALES —no a Prisma—: gestionar, solicitar el cierre, correr el corte, aprobar,
 * rechazar, deshacer, corregir. Asi el mismo test de caracterizacion ejercita el codigo nuevo en la
 * Fase 1 sin reescribirse.
 *
 * La base local es COMPARTIDA: todo lo que se siembra aqui nace y muere en la transaccion revertida.
 * Lo unico que lee de fuera es el catalogo (`order_status`, `rol`) y las FKs geograficas de una orden
 * cualquiera. Si falta algo, FALLA RUIDOSAMENTE: sin base alcanzable la suite se salta con
 * `describe.skip` (visible), nunca con un `return` silencioso.
 */

export const ESTATUS_454 = [
  "por_recoger",
  "en_reparto",
  "ayuda_tienda",
  "entregada",
  "reprogramada",
  "rechazada",
  "devuelta",
  "devolucion_por_confirmar",
  "incidente",
  "sin_gestionar",
  "en_bodega_central",
  "en_bodega_satelite",
  "por_devolver",
  "por_devolver_a_tienda",
] as const;
export type Estatus454 = (typeof ESTATUS_454)[number];

export interface Mundo {
  prisma: PrismaClient;
  fks: { tiendaId: string; zonaId: string; provinciaId: string; cantonId: string };
  tipoIdentificacionId: string;
  rolId: Map<string, string>;
  estatus: Map<string, string>;
  valorDeEstatus: Map<string, string>;
  centralZonaId: string;
}

let secuencia = 0;
// Cada archivo corre en su propio worker y varios arrancan en el MISMO milisegundo: sin la parte
// aleatoria, dos archivos generaban el mismo nombre de zona y la misma guia (medido: `Unique
// constraint failed` en `zona.create` al correr las 28 suites juntas).
const ALEATORIO = randomUUID().replace(/-/g, "").slice(0, 8);
const SUFIJO = `454f0${Date.now().toString(36)}${ALEATORIO}`;
const GUIA_BASE = 454_000_000 + ((Date.now() + parseInt(ALEATORIO.slice(0, 6), 16)) % 40_000_000);

export function claveUnica(): string {
  secuencia += 1;
  return `${SUFIJO}${secuencia}`;
}
export function guiaUnica(): number {
  secuencia += 1;
  return GUIA_BASE + secuencia;
}

/** Carga el catalogo y las FKs. Falla ruidosamente si la base no esta sembrada. */
export async function prepararMundo(): Promise<Mundo> {
  const prisma = crearPrismaDeTest();
  const fks = await fksDeOrden(prisma);
  if (fks === null) throw new Error("tabla `orden` vacia: corre `pnpm run db:seed`.");
  const u = await prisma.usuario.findFirst({ select: { tipoIdentificacionId: true } });
  if (u === null) throw new Error("hace falta al menos un usuario en la base.");
  const roles = await prisma.rol.findMany({ select: { id: true, value: true } });
  const rolId = new Map(roles.map((r) => [r.value as string, r.id]));
  for (const r of ["maestro", "admin", "mensajero", "adminTienda", "adminSatelite"]) {
    if (!rolId.has(r)) throw new Error(`falta el rol «${r}» en la base`);
  }
  const catalogo = await prisma.orderStatus.findMany({ select: { id: true, value: true } });
  const estatus = new Map(catalogo.map((c) => [c.value, c.id]));
  const valorDeEstatus = new Map(catalogo.map((c) => [c.id, c.value]));
  for (const v of ESTATUS_454) {
    if (!estatus.has(v)) throw new Error(`falta el estatus «${v}» en \`order_status\``);
  }
  const central = await prisma.zona.findFirst({ where: { esCentral: true }, select: { id: true } });
  if (central === null) {
    throw new Error("la base no tiene zona central: corre `pnpm exec tsx scripts/seed-zonas.ts`.");
  }
  return {
    prisma,
    fks,
    tipoIdentificacionId: u.tipoIdentificacionId,
    rolId,
    estatus,
    valorDeEstatus,
    centralZonaId: central.id,
  };
}

const URLS: ISignedUrlProvider = {
  createSignedUrl: async (ruta: string) => ruta,
  createSignedUrls: async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, r])),
};
const STORAGE: IFileStorage = {
  upload: async (input) => input.path,
  remove: async () => {},
};
const FOTO = [{ contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }];

export type ResultadoGestion = "entregada" | "reprogramada" | "rechazada" | "devuelta" | "incidente";

/** Monta los servicios REALES sobre el cliente dado (la tx del test o un cliente propio). */
export function montarServicios(cliente: PrismaClient) {
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
  const historialService = new OrdenHistorialService(
    ordenRepo,
    new OrdenHistorialRepository(cliente),
    new OrdenDiaRepartoCambioRepository(cliente),
    new OrdenTraspasoRepository(cliente),
  );
  const gestionRepo = new GestionOrdenRepository(cliente);
  const corteReal = new CorteDiarioRepository(cliente);
  const notaRepo = new OrdenNotaRepository(cliente);
  return {
    notaRepo,
    gestionDesdeAyuda: new GestionDesdeAyudaService({
      notaRepo,
      ordenRepo,
      gestionRepo,
      historial: historialService,
      storage: STORAGE,
    }),
    solicitudAyuda: new SolicitudAyudaService(
      new OrdenNotaService(notaRepo),
      ordenRepo,
      notaRepo,
      gestionRepo,
    ),
    zonaRepo,
    ordenRepo,
    tarifaZonaRepo,
    cierreDiaRepo,
    adminRepo,
    gestionRepo,
    corteReal,
    historialService,
    misAsignaciones: new MisAsignacionesService(
      gestionRepo,
      ordenRepo,
      STORAGE,
      URLS,
      new RutaOptimizadaRepository(cliente),
      new OrdenMensajeroMetaRepository(cliente),
      historialService,
    ),
    cierreDia: new CierreDiaService(cierreDiaRepo, zonaRepo, ordenRepo, URLS, tarifaZonaRepo),
    cierresAdmin: new CierresAdminService(
      adminRepo,
      zonaRepo,
      ordenRepo,
      URLS,
      new LiquidacionPagoRepository(cliente),
      new PagoMensajeroMovimientoRepository(cliente),
    ),
    /** El corte REAL, con la seleccion REAL recortada a los mensajeros de ESTE escenario. */
    corteDe: (mensajeros: string[]) =>
      new CorteDiarioService(
        {
          findMensajerosConActividadSinCierre: async (dia: Date) =>
            (await corteReal.findMensajerosConActividadSinCierre(dia)).filter((m) =>
              mensajeros.includes(m.mensajeroId),
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

export type Servicios = ReturnType<typeof montarServicios>;

/** Construye la entrada de `gestionar` para un resultado, con evidencia y datos minimos validos. */
export function entradaGestion(
  ordenId: string,
  resultado: ResultadoGestion,
  opts: {
    monto?: number;
    pagos?: { metodo: "efectivo" | "SINPE" | "transferencia"; monto: number }[];
    fechaReprogramacion?: string;
    causaDevolucion?: "not_found" | "wrong_number" | "wrong_address";
  } = {},
): GestionarInput {
  switch (resultado) {
    case "entregada": {
      const monto = opts.monto ?? 0;
      const pagos = opts.pagos ?? (monto > 0 ? [{ metodo: "efectivo" as const, monto }] : []);
      return {
        ordenId,
        resultado,
        montoRecibido: monto,
        metodoPago: pagos.length === 1 ? pagos[0].metodo : null,
        pagos,
        evidencias: FOTO,
        ubicacionAusencia: "no_disponible",
      } as GestionarInput;
    }
    case "reprogramada":
      return {
        ordenId,
        resultado,
        fechaReprogramacion: opts.fechaReprogramacion ?? "2026-12-31",
        motivo: "No estaba",
        ubicacionAusencia: "no_disponible",
      } as GestionarInput;
    case "rechazada":
      return { ordenId, resultado, motivo: "No la quiere", evidencias: FOTO, ubicacionAusencia: "no_disponible" } as GestionarInput;
    case "devuelta":
      return {
        ordenId,
        resultado,
        causaDevolucion: opts.causaDevolucion ?? "not_found",
        motivo: "No aparece",
        evidencias: FOTO,
        ubicacionAusencia: "no_disponible",
      } as GestionarInput;
    case "incidente":
      return {
        ordenId,
        resultado,
        causaIncidente: "danado",
        motivo: "Se rompio",
        evidencias: FOTO,
        ubicacionAusencia: "no_disponible",
      } as GestionarInput;
  }
}

export interface OrdenSembrada {
  ordenId: string;
  numGuia: number;
}

/**
 * El escenario: personas propias + verbos sobre los servicios reales + lecturas.
 * `cliente` es la tx del test envuelta para que los repos puedan abrir su `$transaction`.
 */
export async function crearEscenario(mundo: Mundo, tx: TxDeTest, cliente: PrismaClient) {
  const s = montarServicios(cliente);

  async function crearUsuario(rol: string, zonaId: string | null): Promise<string> {
    const clave = claveUnica();
    const u = await tx.usuario.create({
      data: {
        nombre: `${rol} 454 ${clave}`,
        email: `${rol.toLowerCase()}454-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa",
        cedula: `C454${clave}`,
        tipoIdentificacionId: mundo.tipoIdentificacionId,
        rolId: mundo.rolId.get(rol) as string,
        zonaId,
        estado: "activo",
      },
      select: { id: true },
    });
    return u.id;
  }

  const clave = claveUnica();
  const zona = await tx.zona.create({
    data: { sinpeNumero: "80000000", sinpeNombre: "Titular 454", nombre: `Zona 454 ${clave}` },
    select: { id: true },
  });
  const zonaSateliteId = zona.id;
  // Tarifa por defecto de la zona satelite: 1500 por entrega, 164 por rechazo.
  await tx.tarifaZonaMensajero.create({
    data: { zonaId: zonaSateliteId, vehiculoId: null, cobroEntregado: "1500.00", cobroRechazado: "164.00" },
  });
  const tiendaId = await crearUsuario("adminTienda", null);
  const mensajeroId = await crearUsuario("mensajero", zonaSateliteId);
  const mensajero2Id = await crearUsuario("mensajero", zonaSateliteId);
  const adminSateliteId = await crearUsuario("adminSatelite", zonaSateliteId);
  const maestroId = await crearUsuario("maestro", null);

  const actorMensajero: Actor = { usuarioId: mensajeroId, rol: "mensajero", zonaId: zonaSateliteId };
  const actorMensajero2: Actor = { usuarioId: mensajero2Id, rol: "mensajero", zonaId: zonaSateliteId };
  const actorAdminSatelite: Actor = { usuarioId: adminSateliteId, rol: "adminSatelite", zonaId: zonaSateliteId };
  const actorMaestro: Actor = { usuarioId: maestroId, rol: "maestro", zonaId: null };
  const actorTienda: Actor = { usuarioId: tiendaId, rol: "adminTienda", zonaId: null };

  const id = (v: Estatus454 | string): string => {
    const r = mundo.estatus.get(v);
    if (r === undefined) throw new Error(`estatus «${v}» no esta en el catalogo`);
    return r;
  };

  async function sembrarOrden(o: {
    estatus: Estatus454;
    mensajeroId?: string | null;
    zona?: "central" | "satelite";
    montoCobrar?: number;
    fechaReparto?: Date | null;
  }): Promise<OrdenSembrada> {
    const k = claveUnica();
    const numGuia = guiaUnica();
    const orden = await tx.orden.create({
      data: {
        numGuia,
        numRemision: `R-${k}`,
        destinatario: `Dest ${k}`,
        telefonoDest: "88880000",
        producto: `Prod ${k}`,
        estatusId: id(o.estatus),
        mensajeroAsignadoId: o.mensajeroId === undefined ? mensajeroId : o.mensajeroId,
        asignadoAt: new Date(),
        montoCobrar: o.montoCobrar ?? 0,
        fechaReparto: o.fechaReparto ?? null,
        tiendaId,
        zonaId: (o.zona ?? "central") === "central" ? mundo.centralZonaId : zonaSateliteId,
        provinciaId: mundo.fks.provinciaId,
        cantonId: mundo.fks.cantonId,
      },
      select: { id: true },
    });
    return { ordenId: orden.id, numGuia };
  }

  /** `gestionar` REAL del portal del mensajero (escoge la orden antes, como la pantalla). */
  async function gestionar(
    ordenId: string,
    resultado: ResultadoGestion,
    opts: Parameters<typeof entradaGestion>[2] & { actor?: Actor; now?: Date; escoger?: boolean } = {},
  ) {
    const actor = opts.actor ?? actorMensajero;
    if (opts.escoger !== false) await s.misAsignaciones.escogerParaGestion(ordenId, actor, opts.now);
    return s.misAsignaciones.gestionar(entradaGestion(ordenId, resultado, opts), actor, opts.now);
  }

  /** Gestiona y devuelve el id de la gestion creada; lanza si no fue `ok`. */
  async function gestionarOk(
    ordenId: string,
    resultado: ResultadoGestion,
    opts: Parameters<typeof gestionar>[2] = {},
  ): Promise<string> {
    const r = await gestionar(ordenId, resultado, opts);
    if (r.status !== "ok") throw new Error(`gestionar(${resultado}) no fue ok: ${JSON.stringify(r)}`);
    const g = await tx.gestionOrden.findFirst({
      where: { ordenId, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (g === null) throw new Error("gestionar fue ok y no dejo gestion");
    return g.id;
  }

  async function solicitarCierre(actor: Actor = actorMensajero, now?: Date) {
    return s.cierreDia.solicitarCierre(actor, now);
  }

  async function solicitarCierreOk(actor: Actor = actorMensajero): Promise<string> {
    const r = await solicitarCierre(actor);
    if (r.status !== "ok" || r.via !== "creado" || r.cierreId === undefined) {
      throw new Error(`solicitarCierre no creo el cierre: ${JSON.stringify(r)}`);
    }
    return r.cierreId;
  }

  async function correrCorte(now: Date = new Date(), mensajeros: string[] = [mensajeroId, mensajero2Id]) {
    return s.corteDe(mensajeros).ejecutarCorte(now);
  }

  /** La confirmacion fisica EXACTA que el servicio exige (238): todas las retornables del cierre. */
  async function confirmacionDe(cierreId: string, alcance: Parameters<CierresAdminRepository["findGestionesRetornablesDelCierre"]>[1]) {
    const retornables = await s.adminRepo.findGestionesRetornablesDelCierre(cierreId, alcance);
    return retornables.map((r) => ({ gestionId: r.gestionId, numGuia: r.numGuia as number }));
  }

  /** Aprueba por el SERVICIO real, confirmando exactamente lo que vuelve. */
  async function aprobar(
    cierreId: string,
    actor: Actor = actorAdminSatelite,
    indemnizaciones: { gestionId: string; monto: string }[] = [],
  ) {
    const alcance =
      actor.rol === "adminSatelite"
        ? { destinoTipo: "bodega_satelite" as const, destinoZonaId: zonaSateliteId }
        : { destinoTipo: "bodega_central" as const, destinoZonaId: null };
    const confirmacion = await confirmacionDe(cierreId, alcance);
    return s.cierresAdmin.aprobarCierre(cierreId, actor, indemnizaciones, confirmacion);
  }

  async function rechazar(cierreId: string, actor: Actor = actorAdminSatelite) {
    return s.cierresAdmin.rechazarCierre(cierreId, "No cuadra", actor);
  }

  /** Pedir ayuda a la tienda, por el servicio REAL (nota + transicion). */
  async function pedirAyuda(ordenId: string, actor: Actor = actorMensajero) {
    const r = await s.solicitudAyuda.solicitar({ ordenId, motivo: "No contesta, ayuda" }, actor);
    return r;
  }

  /** La TIENDA registra reprogramar/rechazar desde la pestaña de ayuda (237), por el servicio real. */
  async function gestionarDesdeAyuda(
    ordenId: string,
    resultado: "reprogramada" | "rechazada",
    opts: { fechaReprogramacion?: string; actor?: Actor; now?: Date } = {},
  ) {
    const input =
      resultado === "rechazada"
        ? { ordenId, resultado, motivo: "El cliente no la quiere", evidencias: FOTO }
        : {
            ordenId,
            resultado,
            fechaReprogramacion: opts.fechaReprogramacion ?? "2026-12-31",
            motivo: "El cliente pide otro dia",
            evidencias: FOTO,
          };
    return s.gestionDesdeAyuda.gestionar(input as never, opts.actor ?? actorTienda, opts.now);
  }

  /** «Recuperar» del mensajero sobre una orden con ayuda. */
  async function recuperar(ordenId: string, actor: Actor = actorMensajero) {
    return s.solicitudAyuda.recuperar({ ordenId }, actor);
  }

  /**
   * FIXTURE de un intento PASADO: gestion en un cierre YA APROBADO + su fila de historial (lo que
   * lee `whereIntentosVigentes`). Para montar ordenes con N intentos sin recorrer N jornadas.
   */
  async function sembrarIntentoPasado(
    ordenId: string,
    g: {
      resultado?: "devuelta" | "reprogramada" | "rechazada";
      origenTipo?: "gestion" | "escalado_devuelta_sla";
      anulada?: boolean;
      cierreEstado?: "aprobado" | "solicitado";
      en?: Date;
    } = {},
  ): Promise<{ gestionId: string; cierreId: string }> {
    const en = g.en ?? new Date("2026-09-01T10:00:00.000Z");
    const resultado = g.resultado ?? "devuelta";
    const cierre = await tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: g.cierreEstado ?? "aprobado",
        destinoTipo: "bodega_satelite",
        destinoZonaId: zonaSateliteId,
        solicitadoAt: en,
      },
      select: { id: true },
    });
    const gestion = await tx.gestionOrden.create({
      data: {
        ordenId,
        mensajeroId,
        resultado,
        cierreId: cierre.id,
        anuladaAt: g.anulada ? new Date(en.getTime() + 3600_000) : null,
        createdAt: en,
      },
      select: { id: true },
    });
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusDestinoId: id(resultado === "devuelta" ? "devolucion_por_confirmar" : resultado),
        origenTipo: g.origenTipo ?? "gestion",
        gestionOrdenId: gestion.id,
        createdAt: en,
      },
    });
    return { gestionId: gestion.id, cierreId: cierre.id };
  }

  /**
   * Un mensajero de la zona CENTRAL (sus cierres van a `bodega_central`, alcance de maestro/admin) y
   * una tarifa por defecto de la central fijada DENTRO de la tx a 1500/164, para que los importes del
   * test no dependan de lo que la base compartida tenga sembrado.
   */
  async function mensajeroCentral(): Promise<{ mensajeroId: string; actor: Actor }> {
    const existente = await tx.tarifaZonaMensajero.findFirst({
      where: { zonaId: mundo.centralZonaId, vehiculoId: null },
      select: { id: true },
    });
    if (existente) {
      await tx.tarifaZonaMensajero.update({
        where: { id: existente.id },
        data: { cobroEntregado: "1500.00", cobroRechazado: "164.00" },
      });
    } else {
      await tx.tarifaZonaMensajero.create({
        data: { zonaId: mundo.centralZonaId, vehiculoId: null, cobroEntregado: "1500.00", cobroRechazado: "164.00" },
      });
    }
    const idCentral = await crearUsuario("mensajero", mundo.centralZonaId);
    return { mensajeroId: idCentral, actor: { usuarioId: idCentral, rol: "mensajero", zonaId: mundo.centralZonaId } };
  }

  async function estadoDe(ordenId: string): Promise<string> {
    const o = await tx.orden.findUniqueOrThrow({ where: { id: ordenId }, select: { estatusId: true } });
    return mundo.valorDeEstatus.get(o.estatusId) as string;
  }

  async function ordenDe(ordenId: string) {
    return tx.orden.findUniqueOrThrow({
      where: { id: ordenId },
      select: { estatusId: true, mensajeroAsignadoId: true, prioridad: true, fechaReparto: true },
    });
  }

  async function gestionesDe(ordenId: string) {
    return tx.gestionOrden.findMany({
      where: { ordenId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        resultado: true,
        cierreId: true,
        anuladaAt: true,
        mensajeroId: true,
        motivo: true,
        pagoMensajero: true,
        ingresoBodegaRechazo: true,
      },
    });
  }

  async function historialDe(ordenId: string) {
    const filas = await tx.ordenHistorialEstado.findMany({
      where: { ordenId },
      orderBy: { createdAt: "asc" },
      select: {
        origenTipo: true,
        estatusOrigenId: true,
        estatusDestinoId: true,
        actorUsuarioId: true,
        gestionOrdenId: true,
      },
    });
    return filas.map((f) => ({
      ...f,
      origen: f.estatusOrigenId ? (mundo.valorDeEstatus.get(f.estatusOrigenId) as string) : null,
      destino: mundo.valorDeEstatus.get(f.estatusDestinoId) as string,
    }));
  }

  return {
    tx,
    cliente,
    s,
    mundo,
    id,
    zonaSateliteId,
    tiendaId,
    mensajeroId,
    mensajero2Id,
    adminSateliteId,
    maestroId,
    actorMensajero,
    actorMensajero2,
    actorAdminSatelite,
    actorMaestro,
    actorTienda,
    crearUsuario,
    sembrarOrden,
    gestionar,
    gestionarOk,
    solicitarCierre,
    solicitarCierreOk,
    correrCorte,
    confirmacionDe,
    pedirAyuda,
    gestionarDesdeAyuda,
    sembrarIntentoPasado,
    mensajeroCentral,
    recuperar,
    aprobar,
    rechazar,
    estadoDe,
    ordenDe,
    gestionesDe,
    historialDe,
  };
}

export type Escenario = Awaited<ReturnType<typeof crearEscenario>>;

/** Corre `fn` sobre un escenario nuevo, en una transaccion que SIEMPRE se revierte. */
export function conEscenario<T>(mundo: Mundo, fn: (e: Escenario) => Promise<T>): Promise<T> {
  return enTransaccionRevertida(mundo.prisma, async (tx) => {
    await serializarEscriturasReales(tx);
    const cliente = clienteConTransaccionAnidada(tx);
    const e = await crearEscenario(mundo, tx, cliente);
    return fn(e);
  });
}

/** Hoy en Costa Rica como fecha `@db.Date` (medianoche UTC del dia CR) mas `dias`. */
export function diaCR(dias = 0, now: Date = new Date()): Date {
  const cr = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return new Date(Date.UTC(cr.getUTCFullYear(), cr.getUTCMonth(), cr.getUTCDate() + dias));
}

export interface Comprometido {
  usuarios: string[];
  zonaId: string;
  ordenIds: string[];
  mensajeroId: string;
  mensajero2Id: string;
  tiendaId: string;
  actorMensajero: Actor;
  actorTienda: Actor;
}

/**
 * Para los DOS unicos tests que necesitan dos conexiones (C02, C07-concurrente): siembra un
 * escenario CONFIRMADO (commit real) y devuelve los ids para limpiarlo despues con
 * `limpiarComprometido`. Todo lo demas de la Fase 0 corre en transacciones revertidas.
 */
export async function sembrarComprometido(
  mundo: Mundo,
  fn: (e: Escenario) => Promise<{ ordenIds: string[] }>,
): Promise<Comprometido> {
  return mundo.prisma.$transaction(
    async (tx) => {
      const e = await crearEscenario(mundo, tx, clienteConTransaccionAnidada(tx));
      const { ordenIds } = await fn(e);
      return {
        usuarios: [e.tiendaId, e.mensajeroId, e.mensajero2Id, e.adminSateliteId, e.maestroId],
        zonaId: e.zonaSateliteId,
        ordenIds,
        mensajeroId: e.mensajeroId,
        mensajero2Id: e.mensajero2Id,
        tiendaId: e.tiendaId,
        actorMensajero: e.actorMensajero,
        actorTienda: e.actorTienda,
      };
    },
    { timeout: 30_000, maxWait: 15_000 },
  );
}

/** Borra, en orden de FKs, todo lo que un escenario CONFIRMADO pudo dejar. */
export async function limpiarComprometido(
  prisma: PrismaClient,
  s: { usuarios: string[]; zonaId: string; ordenIds: string[] },
): Promise<void> {
  const cierres = (
    await prisma.cierreDia.findMany({ where: { mensajeroId: { in: s.usuarios } }, select: { id: true } })
  ).map((c) => c.id);
  const gestiones = (
    await prisma.gestionOrden.findMany({ where: { ordenId: { in: s.ordenIds } }, select: { id: true } })
  ).map((g) => g.id);
  // FICHA 454 (T1.4, 2026-09-23, cambio autorizado #5 de la bitacora del backend): desde la Fase 1
  // registrar una gestion escribe `orden_evento` (FK RESTRICT a orden, gestion y usuario) y puede
  // encolar su job `webhook_evento`. Se borran PRIMERO, o el resto de la limpieza choca con la FK.
  const eventos = (
    await prisma.ordenEvento.findMany({ where: { ordenId: { in: s.ordenIds } }, select: { id: true } })
  ).map((e) => e.id);
  for (const ordenEventoId of eventos) {
    await prisma.job.deleteMany({
      where: { tipo: "webhook_evento", payload: { path: ["ordenEventoId"], equals: ordenEventoId } },
    });
  }
  await prisma.ordenEvento.deleteMany({ where: { ordenId: { in: s.ordenIds } } });
  await prisma.ordenHistorialEstado.deleteMany({ where: { ordenId: { in: s.ordenIds } } });
  await prisma.cierreSinGestion.deleteMany({ where: { cierreId: { in: cierres } } });
  await prisma.cierreDetail.deleteMany({ where: { cierreId: { in: cierres } } });
  await prisma.gestionOrdenEvidencia.deleteMany({ where: { gestionId: { in: gestiones } } });
  await prisma.gestionOrdenPago.deleteMany({ where: { gestionId: { in: gestiones } } });
  await prisma.usuario.updateMany({ where: { id: { in: s.usuarios } }, data: { ordenEnGestionId: null } });
  await prisma.gestionOrden.deleteMany({ where: { id: { in: gestiones } } });
  await prisma.cierreDia.deleteMany({ where: { id: { in: cierres } } });
  for (const m of s.usuarios) {
    await prisma.job.deleteMany({ where: { payload: { path: ["mensajeroId"], equals: m } } });
  }
  await prisma.orden.deleteMany({ where: { id: { in: s.ordenIds } } });
  await prisma.notificacion.deleteMany({
    where: { OR: [{ destinatarioUsuarioId: { in: s.usuarios } }, { tiendaId: { in: s.usuarios } }] },
  });
  await prisma.usuario.deleteMany({ where: { id: { in: s.usuarios } } });
  await prisma.tarifaZonaMensajero.deleteMany({ where: { zonaId: s.zonaId } });
  await prisma.zona.deleteMany({ where: { id: s.zonaId } });
}
