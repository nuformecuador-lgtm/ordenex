import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { ReprogramadaRetenidaRepository } from "@/lib/repositories/ReprogramadaRetenidaRepository";
import {
  LiberacionReprogramadaService,
  puedeLiberarse,
} from "@/lib/services/LiberacionReprogramadaService";
import { buildReprogramadasRetenidasService } from "@/lib/services/reprogramadas-retenidas-composicion";
import {
  recortarPorAmbito,
  type ResumenRetenidas,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Escenario, type Mundo } from "../454/_escenario";

/**
 * FICHA 462 (T1.5, design §8.1) — EL PREDICADO DE «RETENIDA», CONTRA POSTGRES DE VERDAD.
 *
 * Los tests de servicio con dobles no ven el `WHERE` (memoria «probar el WHERE donde vive»): aqui
 * se siembran las dos formas, cada exclusion de R2 y los casos borde (R40-R47) DENTRO de una
 * transaccion que SIEMPRE se revierte, y se mide:
 *   · la Forma B en su SQL (`findRetenidasEnReparto`) y la Forma A en su reuso (`findOrdenesLiberables`
 *     + `!puedeLiberarse`);
 *   · el servicio ENTERO montado con el ensamblaje real (`buildReprogramadasRetenidasService`);
 *   · R3: la Forma A del servicio ES el `esperandoCierre` del reloj sobre la misma base;
 *   · R55: el script de produccion (`scripts/medir-462-retenidas.sql`) da el mismo numero.
 *
 * La base local es COMPARTIDA y puede traer reprogramadas propias: por eso cada aserto se hace por
 * PERTENENCIA de lo sembrado (cierres y mensajeros creados aqui), nunca por un total absoluto — salvo
 * las igualdades R3 y R55, que comparan dos lecturas GLOBALES de la misma base en la misma tx.
 *
 * Mutaciones del design §8.2 que este archivo pone en ROJO: 1 (quitar `<= hoy` en B), 2 (contar la
 * Forma A sin `!puedeLiberarse`), 3 (quitar `resultado = 'reprogramado'` en B), 4 (contar `en_reparto`
 * sin gestion pendiente), 5 (tomar la gestion mas antigua), 6 (ambito global para maestro) y 10
 * (contar borradas).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const HOY = diaCR(0);
const AYER = diaCR(-1);
const MANANA = diaCR(1);

const SCRIPT = fs.readFileSync(
  path.join(process.cwd(), "scripts", "medir-462-retenidas.sql"),
  "utf8",
);

type EstadoCierre = "solicitado" | "vencido" | "rechazado" | "aprobado";

describeSiHayBase("462/T1.5 — reprogramadas retenidas (Postgres real)", () => {
  let mundo: Mundo;
  let m: Awaited<ReturnType<typeof medir>>;

  async function crearCierre(
    e: Escenario,
    o: { estado: EstadoCierre; destino: "central" | "satelite"; mensajeroId: string; createdAt?: Date },
  ): Promise<string> {
    const c = await e.tx.cierreDia.create({
      data: {
        mensajeroId: o.mensajeroId,
        estado: o.estado,
        destinoTipo: o.destino === "central" ? "bodega_central" : "bodega_satelite",
        destinoZonaId: o.destino === "central" ? mundo.centralZonaId : e.zonaSateliteId,
        solicitadoAt: new Date(),
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
      select: { id: true },
    });
    return c.id;
  }

  /** Una gestion `reprogramado` + su fila de historial (visita real o de escritorio) sobre una orden. */
  async function gestionA(
    e: Escenario,
    o: {
      ordenId: string;
      mensajeroId: string;
      fecha: Date;
      visitaReal: boolean;
      cierreId: string | null;
      anulada?: boolean;
      createdAt?: Date;
    },
  ): Promise<string> {
    const g = await e.tx.gestionOrden.create({
      data: {
        ordenId: o.ordenId,
        mensajeroId: o.mensajeroId,
        resultado: "reprogramado",
        fechaReprogramacion: o.fecha,
        cierreId: o.cierreId,
        anuladaAt: o.anulada ? new Date() : null,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
      select: { id: true },
    });
    await e.tx.ordenHistorialEstado.create({
      data: {
        ordenId: o.ordenId,
        estatusOrigenId: e.id("en_reparto"),
        estatusDestinoId: e.id("reprogramado"),
        // `gestion` ES visita real; `reprogramacion_tienda` (la de escritorio de la 100) NO.
        origenTipo: o.visitaReal ? "gestion" : "reprogramacion_tienda",
        gestionOrdenId: g.id,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
    });
    return g.id;
  }

  /** Forma A: orden en `reprogramado` (u otro estado) con su gestion reprogramada. */
  async function sembrarA(
    e: Escenario,
    o: {
      estatus?: "reprogramado" | "en_bodega_central";
      fecha?: Date;
      visitaReal?: boolean;
      cierreId: string | null;
      mensajeroId?: string;
      zona?: "central" | "satelite";
      borrada?: boolean;
      anulada?: boolean;
    },
  ) {
    const mensajeroId = o.mensajeroId ?? e.mensajeroId;
    const orden = await e.sembrarOrden({ estatus: o.estatus ?? "reprogramado", mensajeroId, zona: o.zona ?? "central" });
    const gestionId = await gestionA(e, {
      ordenId: orden.ordenId,
      mensajeroId,
      fecha: o.fecha ?? HOY,
      visitaReal: o.visitaReal ?? true,
      cierreId: o.cierreId,
      anulada: o.anulada,
    });
    if (o.borrada) {
      await e.tx.orden.update({ where: { id: orden.ordenId }, data: { deletedAt: new Date() } });
    }
    return { ordenId: orden.ordenId, gestionId };
  }

  /** Una gestion de CALLE del modelo 454 (con o sin evento de registro) sobre una orden. */
  async function gestionB(
    e: Escenario,
    o: {
      ordenId: string;
      mensajeroId: string;
      resultado: "reprogramado" | "entregado";
      fecha: Date | null;
      cierreId: string | null;
      conEvento: boolean;
      anulada?: boolean;
      createdAt?: Date;
    },
  ): Promise<string> {
    const g = await e.tx.gestionOrden.create({
      data: {
        ordenId: o.ordenId,
        mensajeroId: o.mensajeroId,
        resultado: o.resultado,
        fechaReprogramacion: o.fecha,
        cierreId: o.cierreId,
        anuladaAt: o.anulada ? new Date() : null,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
      select: { id: true },
    });
    if (o.conEvento) {
      await e.tx.ordenEvento.create({
        data: {
          ordenId: o.ordenId,
          tipo: "gestion_registrada",
          gestionOrdenId: g.id,
          familiaAplicacion: "gestion",
          resultado: o.resultado,
          mensajeroId: o.mensajeroId,
          actorUsuarioId: o.mensajeroId,
          actorRol: "mensajero",
          ...(o.createdAt ? { createdAt: o.createdAt } : {}),
        },
      });
    }
    return g.id;
  }

  /** Forma B: orden `en_reparto` con una gestion pendiente (por defecto `reprogramado` de hoy). */
  async function sembrarB(
    e: Escenario,
    o: {
      estatus?: "en_reparto" | "entregado";
      resultado?: "reprogramado" | "entregado";
      fecha?: Date | null;
      cierreId: string | null;
      conEvento?: boolean;
      anulada?: boolean;
      mensajeroId?: string;
      zona?: "central" | "satelite";
      borrada?: boolean;
    },
  ) {
    const mensajeroId = o.mensajeroId ?? e.mensajeroId;
    const orden = await e.sembrarOrden({ estatus: o.estatus ?? "en_reparto", mensajeroId, zona: o.zona ?? "central" });
    const gestionId = await gestionB(e, {
      ordenId: orden.ordenId,
      mensajeroId,
      resultado: o.resultado ?? "reprogramado",
      fecha: o.fecha === undefined ? HOY : o.fecha,
      cierreId: o.cierreId,
      conEvento: o.conEvento ?? true,
      anulada: o.anulada,
    });
    if (o.borrada) {
      await e.tx.orden.update({ where: { id: orden.ordenId }, data: { deletedAt: new Date() } });
    }
    return { ordenId: orden.ordenId, gestionId };
  }

  type FilaScript = {
    cierre_id: string | null;
    estado: string | null;
    destino_tipo: string | null;
    mensajero: string | null;
    retenidas: bigint;
    forma_a: bigint;
    forma_b: bigint;
  };

  async function medir() {
    return conEscenario(mundo, async (e) => {
      // ── Personas propias: cada caso lleva su mensajero para que la pertenencia sea inequivoca ──
      const mA = await e.crearUsuario("mensajero", mundo.centralZonaId); // Forma A, central
      const mB = await e.crearUsuario("mensajero", mundo.centralZonaId); // Forma B, central
      const mSinCierreA = await e.crearUsuario("mensajero", mundo.centralZonaId);
      const mSinCierreB = await e.crearUsuario("mensajero", e.zonaSateliteId);
      const mSat = e.mensajeroId; // el del escenario, de la zona satelite
      const hace2h = new Date(Date.now() - 2 * 3600_000);
      const hace1h = new Date(Date.now() - 3600_000);

      // ── Cierres, uno por caso ──
      const cSol = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cVen = await crearCierre(e, { estado: "vencido", destino: "central", mensajeroId: mA });
      const cRec = await crearCierre(e, { estado: "rechazado", destino: "central", mensajeroId: mA });
      const cApr = await crearCierre(e, { estado: "aprobado", destino: "central", mensajeroId: mA });
      const cEscritorio = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cFutura = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cAyer = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cBorrada = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cBodega = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cAnulada = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cViejo = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cNuevoApr = await crearCierre(e, { estado: "aprobado", destino: "central", mensajeroId: mA });
      const cViejoApr = await crearCierre(e, { estado: "aprobado", destino: "central", mensajeroId: mA });
      const cNuevoSol = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mA });
      const cSat = await crearCierre(e, { estado: "vencido", destino: "satelite", mensajeroId: mSat });
      const cBSol = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBApr = await crearCierre(e, { estado: "aprobado", destino: "central", mensajeroId: mB });
      const cBRec = await crearCierre(e, { estado: "rechazado", destino: "central", mensajeroId: mB });
      const cBEnt = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBFut = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBAnu = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBLeg = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBViejo = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBNuevo = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBBorr = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBAyer = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mB });
      const cBSat = await crearCierre(e, { estado: "solicitado", destino: "satelite", mensajeroId: mSat });
      const cVincular = await crearCierre(e, { estado: "solicitado", destino: "central", mensajeroId: mSinCierreA });

      // ── Forma A (orden en `reprogramado`) ──
      const a1 = await sembrarA(e, { cierreId: cSol, mensajeroId: mA }); // retenida
      const a2 = await sembrarA(e, { cierreId: cVen, mensajeroId: mA }); // retenida (R42)
      const a3 = await sembrarA(e, { cierreId: cRec, mensajeroId: mA }); // retenida (R41)
      const a4 = await sembrarA(e, { cierreId: cApr, mensajeroId: mA }); // NO: cierre aprobado, aun en reprogramado (R40)
      const a5 = await sembrarA(e, { cierreId: null, mensajeroId: mSinCierreA, zona: "central" }); // sin cierre -> grupo del mensajero
      const a6 = await sembrarA(e, { cierreId: cEscritorio, mensajeroId: mA, visitaReal: false }); // NO: escritorio
      const a7 = await sembrarA(e, { cierreId: cFutura, mensajeroId: mA, fecha: MANANA }); // NO: futura
      const a8 = await sembrarA(e, { cierreId: cAyer, mensajeroId: mA, fecha: AYER }); // retenida: vencida de ayer
      const a9 = await sembrarA(e, { cierreId: cBorrada, mensajeroId: mA, borrada: true }); // NO: borrada
      const a10 = await sembrarA(e, { cierreId: cBodega, mensajeroId: mA, estatus: "en_bodega_central" }); // NO: ya en bodega
      const a12 = await sembrarA(e, { cierreId: cAnulada, mensajeroId: mA, anulada: true }); // NO: anulada (sin vigente)
      // A11: dos gestiones vivas. (i) vieja con cierre solicitado, NUEVA con cierre aprobado -> NO cuenta.
      const a11i = await e.sembrarOrden({ estatus: "reprogramado", mensajeroId: mA, zona: "central" });
      await gestionA(e, { ordenId: a11i.ordenId, mensajeroId: mA, fecha: HOY, visitaReal: true, cierreId: cViejo, createdAt: hace2h });
      await gestionA(e, { ordenId: a11i.ordenId, mensajeroId: mA, fecha: HOY, visitaReal: true, cierreId: cNuevoApr, createdAt: hace1h });
      // (ii) vieja con cierre aprobado, NUEVA con cierre solicitado -> cuenta, y bajo el NUEVO.
      const a11ii = await e.sembrarOrden({ estatus: "reprogramado", mensajeroId: mA, zona: "central" });
      await gestionA(e, { ordenId: a11ii.ordenId, mensajeroId: mA, fecha: HOY, visitaReal: true, cierreId: cViejoApr, createdAt: hace2h });
      await gestionA(e, { ordenId: a11ii.ordenId, mensajeroId: mA, fecha: HOY, visitaReal: true, cierreId: cNuevoSol, createdAt: hace1h });
      // A13: cierre con destino SATELITE -> ambito zona (R44).
      const a13 = await sembrarA(e, { cierreId: cSat, mensajeroId: mSat, zona: "satelite" });

      // ── Forma B (orden en `en_reparto`, gestion PENDIENTE) ──
      const b1 = await sembrarB(e, { cierreId: null, mensajeroId: mSinCierreB, zona: "satelite" }); // sin cierre -> grupo (ambito zona)
      const b2 = await sembrarB(e, { cierreId: cBSol, mensajeroId: mB }); // retenida
      const b3 = await sembrarB(e, { cierreId: cBApr, mensajeroId: mB }); // NO: cierre aprobado
      const b4 = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: mB, zona: "central" }); // NO: sin gestion pendiente (mutacion 4)
      const b5 = await sembrarB(e, { cierreId: cBEnt, mensajeroId: mB, resultado: "entregado", fecha: null }); // NO: entregado (mutacion 3)
      const b6 = await sembrarB(e, { cierreId: cBFut, mensajeroId: mB, fecha: MANANA }); // NO: futura (mutacion 1)
      const b7 = await sembrarB(e, { cierreId: cBAnu, mensajeroId: mB, anulada: true }); // NO: anulada
      const b8 = await sembrarB(e, { cierreId: cBLeg, mensajeroId: mB, conEvento: false }); // NO: legada (sin evento) -> no pendiente (R4)
      // B9: dos pendientes. (i) vieja reprogramado + NUEVA entregado -> NO (mutacion 5).
      const b9i = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: mB, zona: "central" });
      await gestionB(e, { ordenId: b9i.ordenId, mensajeroId: mB, resultado: "reprogramado", fecha: HOY, cierreId: cBViejo, conEvento: true, createdAt: hace2h });
      await gestionB(e, { ordenId: b9i.ordenId, mensajeroId: mB, resultado: "entregado", fecha: null, cierreId: cBNuevo, conEvento: true, createdAt: hace1h });
      // (ii) vieja entregado + NUEVA reprogramado -> cuenta, bajo el cierre de la nueva.
      const b9ii = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: mB, zona: "central" });
      await gestionB(e, { ordenId: b9ii.ordenId, mensajeroId: mB, resultado: "entregado", fecha: null, cierreId: cBViejo, conEvento: true, createdAt: hace2h });
      await gestionB(e, { ordenId: b9ii.ordenId, mensajeroId: mB, resultado: "reprogramado", fecha: HOY, cierreId: cBNuevo, conEvento: true, createdAt: hace1h });
      const b10 = await sembrarB(e, { cierreId: cBBorr, mensajeroId: mB, borrada: true }); // NO: borrada (mutacion 10)
      const b11 = await sembrarB(e, { cierreId: cBAyer, mensajeroId: mB, fecha: AYER }); // retenida: ayer
      const b12 = await sembrarB(e, { cierreId: cBRec, mensajeroId: mB }); // retenida: rechazado
      const b13 = await sembrarB(e, { cierreId: cBSat, mensajeroId: mSat, zona: "satelite" }); // ambito zona
      const b14 = await sembrarB(e, { cierreId: cBSol, mensajeroId: mB, estatus: "entregado" }); // NO: no esta en en_reparto

      // ── Medicion 1: las dos formas, en su fuente ──
      const liberacionRepo = new LiberacionReprogramadaRepository(e.cliente);
      const retenidasRepo = new ReprogramadaRetenidaRepository(e.cliente);
      const candidatasA = await liberacionRepo.findOrdenesLiberables(HOY);
      const formaA = new Set(candidatasA.filter((o) => !puedeLiberarse(o)).map((o) => o.id));
      const liberablesA = new Set(candidatasA.filter((o) => puedeLiberarse(o)).map((o) => o.id));
      const filasB = await retenidasRepo.findRetenidasEnReparto(HOY);
      const formaB = new Map(filasB.map((f) => [f.ordenId, f]));

      // ── Medicion 2: el servicio ENTERO, con el ensamblaje real ──
      const service = buildReprogramadasRetenidasService(e.cliente);
      const resumen = await service.resumen(HOY);
      const misCierres = [
        cSol, cVen, cRec, cApr, cEscritorio, cFutura, cAyer, cBorrada, cBodega, cAnulada, cViejo, cNuevoApr,
        cViejoApr, cNuevoSol, cSat, cBSol, cBApr, cBRec, cBEnt, cBFut, cBAnu, cBLeg, cBViejo, cBNuevo, cBBorr,
        cBAyer, cBSat, cVincular,
      ];
      const marca = await service.contarPorCierre(HOY, misCierres);
      const cifraCentral = await service.contar(HOY, { tipo: "central" });
      const cifraSatelite = await service.contar(HOY, { tipo: "zona", zonaId: e.zonaSateliteId });
      const central = recortarPorAmbito(resumen, { tipo: "central" });
      const satelite = recortarPorAmbito(resumen, { tipo: "zona", zonaId: e.zonaSateliteId });

      // ── Medicion 3 (R55): el script de produccion, sobre la MISMA siembra ──
      const script = await e.tx.$queryRawUnsafe<FilaScript[]>(SCRIPT);

      // ── Medicion 4 (R3): el reloj, sobre la MISMA base. Libera lo liberable; el resto queda. ──
      const reloj = new LiberacionReprogramadaService(liberacionRepo, e.s.zonaRepo, e.s.ordenRepo, { warn: () => {} });
      const corrida = await reloj.ejecutarLiberacion(HOY);
      const a4TrasReloj = await e.estadoDe(a4.ordenId);
      const a1TrasReloj = await e.estadoDe(a1.ordenId);

      // ── Medicion 5: los casos DINAMICOS (R45/R46/R47), releyendo despues de cada cambio ──
      // R47: la gestion sin cierre de a5 se vincula a un cierre -> pasa del grupo al cierre.
      await e.tx.gestionOrden.update({ where: { id: a5.gestionId }, data: { cierreId: cVincular } });
      const trasVincular = await service.resumen(HOY);
      // R45: la futura (a7) se corrige a HOY -> cuenta bajo su cierre.
      await e.tx.gestionOrden.update({ where: { id: a7.gestionId }, data: { fechaReprogramacion: HOY } });
      const trasCorregirAHoy = await service.contarPorCierre(HOY, [cFutura]);
      // R46: a1 se corrige a MAÑANA -> deja de contar.
      await e.tx.gestionOrden.update({ where: { id: a1.gestionId }, data: { fechaReprogramacion: MANANA } });
      const trasCorregirAFuturo = await service.contarPorCierre(HOY, [cSol]);

      return {
        ids: {
          a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11i, a11ii, a12, a13,
          b1, b2, b3, b4, b5, b6, b7, b8, b9i, b9ii, b10, b11, b12, b13, b14,
          mSinCierreA, mSinCierreB, mA, mB, mSat,
          cSol, cVen, cRec, cApr, cEscritorio, cFutura, cAyer, cBorrada, cBodega, cAnulada, cViejo, cNuevoApr,
          cViejoApr, cNuevoSol, cSat, cBSol, cBApr, cBRec, cBEnt, cBFut, cBAnu, cBLeg, cBViejo, cBNuevo, cBBorr,
          cBAyer, cBSat, cVincular, zonaSateliteId: e.zonaSateliteId,
        },
        formaA,
        liberablesA,
        formaB,
        resumen,
        marca,
        cifraCentral,
        cifraSatelite,
        central,
        satelite,
        script,
        corrida,
        a4TrasReloj,
        a1TrasReloj,
        trasVincular,
        trasCorregirAHoy,
        trasCorregirAFuturo,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    m = await medir();
  }, 180_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  const sinCierreDe = (r: ResumenRetenidas, mensajeroId: string) =>
    r.sinCierre.filter((g) => g.mensajeroId === mensajeroId);

  it("precondicion: la siembra existe y las dos fuentes la ven (anti-vacuidad)", () => {
    expect(m.formaA.size).toBeGreaterThanOrEqual(7);
    expect(m.formaB.size).toBeGreaterThanOrEqual(6);
    expect(m.resumen.total).toBeGreaterThanOrEqual(13);
    expect(m.script.length).toBeGreaterThan(0);
  });

  describe("Forma A — `!puedeLiberarse` sobre las candidatas del reloj (R1/R2/R3)", () => {
    it("retiene: cierre solicitado, vencido, rechazado, sin cierre, y la vencida de AYER", () => {
      for (const c of [m.ids.a1, m.ids.a2, m.ids.a3, m.ids.a5, m.ids.a8]) {
        expect(m.formaA.has(c.ordenId)).toBe(true);
      }
    });

    it("NO retiene: cierre APROBADO aunque siga en `reprogramado` (R40) — es LIBERABLE, no retenida", () => {
      expect(m.formaA.has(m.ids.a4.ordenId)).toBe(false);
      expect(m.liberablesA.has(m.ids.a4.ordenId)).toBe(true); // mutacion 2: contarla => ROJO
    });

    it("NO retiene: reprogramacion de ESCRITORIO (no es visita real, R2)", () => {
      expect(m.formaA.has(m.ids.a6.ordenId)).toBe(false);
      expect(m.liberablesA.has(m.ids.a6.ordenId)).toBe(true); // el reloj la libera sin esperar (276/R14)
    });

    it("NO retiene: fecha FUTURA (R2/R46), orden BORRADA (R2, mutacion 10), ya en BODEGA (R2), gestion ANULADA (R2)", () => {
      for (const c of [m.ids.a7, m.ids.a9, m.ids.a10, m.ids.a12]) {
        expect(m.formaA.has(c.ordenId)).toBe(false);
        expect(m.liberablesA.has(c.ordenId)).toBe(false); // ni siquiera son candidatas
      }
    });

    it("dos gestiones vivas: SOLO la vigente decide (R43, mutacion 5: tomar la vieja => ROJO)", () => {
      // (i) la NUEVA tiene cierre aprobado -> no retenida, aunque la vieja tenga uno solicitado.
      expect(m.formaA.has(m.ids.a11i.ordenId)).toBe(false);
      // (ii) la NUEVA tiene cierre solicitado -> retenida, y atribuida al cierre NUEVO, no al viejo.
      expect(m.formaA.has(m.ids.a11ii.ordenId)).toBe(true);
      expect(m.marca.get(m.ids.cNuevoSol)).toBe(1);
      expect(m.marca.has(m.ids.cViejoApr)).toBe(false);
      expect(m.marca.has(m.ids.cViejo)).toBe(false);
    });

    it("⭑ R3: la Forma A del servicio ES el `esperandoCierre` del reloj sobre la misma base", () => {
      expect(m.corrida.esperandoCierre).toBeGreaterThan(0); // anti-vacuidad
      expect(m.resumen.porForma.reprogramado).toBe(m.corrida.esperandoCierre);
      // Y el reloj hizo lo suyo: libero la del cierre aprobado y dejo quieta la retenida (R48).
      expect(m.a4TrasReloj).toBe("en_bodega_central");
      expect(m.a1TrasReloj).toBe("reprogramado");
    });
  });

  describe("Forma B — la gestion PENDIENTE mas reciente, `reprogramado`, fecha <= hoy (R1/R2/R4)", () => {
    it("retiene: sin cierre, cierre solicitado, cierre rechazado, y la de AYER", () => {
      for (const c of [m.ids.b1, m.ids.b2, m.ids.b12, m.ids.b11]) {
        expect(m.formaB.has(c.ordenId)).toBe(true);
      }
      expect(m.formaB.get(m.ids.b1.ordenId)?.cierreId).toBeNull();
      expect(m.formaB.get(m.ids.b2.ordenId)?.cierreId).toBe(m.ids.cBSol);
      expect(m.formaB.get(m.ids.b2.ordenId)?.gestionId).toBe(m.ids.b2.gestionId);
    });

    it("NO retiene: cierre APROBADO (R2)", () => {
      expect(m.formaB.has(m.ids.b3.ordenId)).toBe(false);
    });

    it("NO retiene: `en_reparto` SIN gestion pendiente (mutacion 4 => ROJO)", () => {
      expect(m.formaB.has(m.ids.b4.ordenId)).toBe(false);
    });

    it("NO retiene: pendiente con resultado `entregado` (mutacion 3 => ROJO)", () => {
      expect(m.formaB.has(m.ids.b5.ordenId)).toBe(false);
    });

    it("NO retiene: fecha de MAÑANA (mutacion 1: quitar `<= hoy` => ROJO)", () => {
      expect(m.formaB.has(m.ids.b6.ordenId)).toBe(false);
    });

    it("NO retiene: gestion ANULADA, gestion LEGADA sin evento (R4), orden BORRADA (mutacion 10), orden que no esta en `en_reparto`", () => {
      for (const c of [m.ids.b7, m.ids.b8, m.ids.b10, m.ids.b14]) {
        expect(m.formaB.has(c.ordenId)).toBe(false);
      }
    });

    it("dos pendientes: SOLO la mas reciente decide (R43, mutacion 5 => ROJO)", () => {
      expect(m.formaB.has(m.ids.b9i.ordenId)).toBe(false); // la nueva es `entregado`
      expect(m.formaB.has(m.ids.b9ii.ordenId)).toBe(true); // la nueva es `reprogramado`
      expect(m.formaB.get(m.ids.b9ii.ordenId)?.cierreId).toBe(m.ids.cBNuevo);
      expect(m.marca.get(m.ids.cBNuevo)).toBe(1);
      expect(m.marca.has(m.ids.cBViejo)).toBe(false);
    });
  });

  describe("el servicio entero: atribucion (R5), ambito (R6/R44) y consistencia (R7)", () => {
    it("cada cierre que retiene lleva SU cifra; los que no retienen no aparecen (R28)", () => {
      expect(m.marca.get(m.ids.cSol)).toBe(1);
      expect(m.marca.get(m.ids.cVen)).toBe(1);
      expect(m.marca.get(m.ids.cRec)).toBe(1);
      expect(m.marca.get(m.ids.cAyer)).toBe(1);
      expect(m.marca.get(m.ids.cSat)).toBe(1);
      expect(m.marca.get(m.ids.cBSol)).toBe(1); // b14 esta en `entregado`: no suma
      expect(m.marca.get(m.ids.cBRec)).toBe(1);
      expect(m.marca.get(m.ids.cBAyer)).toBe(1);
      expect(m.marca.get(m.ids.cBSat)).toBe(1);
      for (const c of [
        m.ids.cApr, m.ids.cEscritorio, m.ids.cFutura, m.ids.cBorrada, m.ids.cBodega, m.ids.cAnulada,
        m.ids.cBApr, m.ids.cBEnt, m.ids.cBFut, m.ids.cBAnu, m.ids.cBLeg, m.ids.cBBorr, m.ids.cVincular,
      ]) {
        expect(m.marca.has(c), `el cierre ${c} no deberia retener`).toBe(false);
      }
    });

    it("las SIN cierre se agrupan por su mensajero, con el ambito de la zona de la ORDEN (R5, decision 8)", () => {
      expect(sinCierreDe(m.resumen, m.ids.mSinCierreA)).toEqual([
        expect.objectContaining({ ambito: { tipo: "central" }, cuantas: 1 }),
      ]);
      expect(sinCierreDe(m.resumen, m.ids.mSinCierreB)).toEqual([
        expect.objectContaining({ ambito: { tipo: "zona", zonaId: m.ids.zonaSateliteId }, cuantas: 1 }),
      ]);
      expect(sinCierreDe(m.resumen, m.ids.mSinCierreA)[0]?.mensajeroNombre).toMatch(/mensajero 454/);
    });

    it("⭑ ambito: los cierres con destino SATELITE cuentan para su zona y NO para el central (R6/R44, mutacion 6 => ROJO)", () => {
      const idsCentral = new Set(m.central.cierres.map((c) => c.cierreId));
      const idsSatelite = new Set(m.satelite.cierres.map((c) => c.cierreId));
      expect(idsSatelite).toEqual(new Set([m.ids.cSat, m.ids.cBSat]));
      expect(idsCentral.has(m.ids.cSat)).toBe(false);
      expect(idsCentral.has(m.ids.cBSat)).toBe(false);
      for (const c of [m.ids.cSol, m.ids.cVen, m.ids.cRec, m.ids.cAyer, m.ids.cBSol, m.ids.cBRec, m.ids.cBAyer]) {
        expect(idsCentral.has(c)).toBe(true);
      }
      // La zona satelite es NUEVA en esta tx: su cifra es EXACTA (2 con cierre + 1 sin cierre).
      expect(m.cifraSatelite).toBe(3);
      expect(m.satelite.total).toBe(3);
      // La cifra del central es la suma de lo suyo, jamas el total del sistema (R6).
      expect(m.cifraCentral).toBe(m.central.total);
      expect(m.cifraCentral).toBeLessThan(m.resumen.total);
      expect(m.central.total + m.satelite.total).toBeLessThanOrEqual(m.resumen.total);
    });

    it("⭑ R7: `contar`, `contarPorCierre` y `recortarPorAmbito` cuentan lo mismo", () => {
      const sumaMarcaCentral = m.central.cierres.reduce((acc, c) => acc + (m.marca.get(c.cierreId) ?? c.cuantas), 0);
      const sumaSinCierreCentral = m.central.sinCierre.reduce((acc, g) => acc + g.cuantas, 0);
      expect(m.cifraCentral).toBe(sumaMarcaCentral + sumaSinCierreCentral);
      expect(m.resumen.porForma.reprogramado + m.resumen.porForma.enReparto).toBe(m.resumen.total);
      expect(m.resumen.cierres.every((c) => c.estado !== "aprobado")).toBe(true);
    });

    it("la lista de cierres viene ordenada: mas retenidas primero", () => {
      const cuantas = m.resumen.cierres.map((c) => c.cuantas);
      expect(cuantas).toEqual([...cuantas].sort((a, b) => b - a));
    });
  });

  describe("casos borde dinamicos (R45/R46/R47)", () => {
    it("R47: al vincular la gestion sin cierre a un cierre, la retenida pasa del grupo al cierre", () => {
      expect(sinCierreDe(m.trasVincular, m.ids.mSinCierreA)).toEqual([]);
      expect(m.trasVincular.cierres.find((c) => c.cierreId === m.ids.cVincular)?.cuantas).toBe(1);
      expect(m.trasVincular.total).toBe(m.resumen.total); // ni una mas ni una menos
    });

    it("R45: corregir la fecha de una futura a HOY la hace contar en la siguiente lectura", () => {
      expect(m.marca.has(m.ids.cFutura)).toBe(false); // antes
      expect(m.trasCorregirAHoy.get(m.ids.cFutura)).toBe(1); // despues
    });

    it("R46: corregir la fecha a un dia FUTURO la saca del conteo", () => {
      expect(m.marca.get(m.ids.cSol)).toBe(1); // antes
      expect(m.trasCorregirAFuturo.has(m.ids.cSol)).toBe(false); // despues
    });
  });

  describe("⭑ R55: el script de produccion da EL MISMO numero que el servicio", () => {
    it("`SUM(retenidas)` = `resumen.total`, y las formas coinciden", () => {
      const suma = m.script.reduce((acc, f) => acc + Number(f.retenidas), 0);
      const formaA = m.script.reduce((acc, f) => acc + Number(f.forma_a), 0);
      const formaB = m.script.reduce((acc, f) => acc + Number(f.forma_b), 0);
      expect(suma).toBe(m.resumen.total);
      expect(formaA).toBe(m.resumen.porForma.reprogramado);
      expect(formaB).toBe(m.resumen.porForma.enReparto);
    });

    it("fila a fila: cada cierre sembrado tiene en el script la misma cifra que en `contarPorCierre`", () => {
      const porCierre = new Map(m.script.filter((f) => f.cierre_id !== null).map((f) => [f.cierre_id as string, Number(f.retenidas)]));
      for (const [cierreId, cuantas] of m.marca) {
        expect(porCierre.get(cierreId), `cierre ${cierreId}`).toBe(cuantas);
      }
      // Y el grupo «sin cierre» del script (cierre_id NULL) suma lo mismo que el del servicio.
      const sinCierreScript = m.script.filter((f) => f.cierre_id === null).reduce((acc, f) => acc + Number(f.retenidas), 0);
      expect(sinCierreScript).toBe(m.resumen.sinCierre.reduce((acc, g) => acc + g.cuantas, 0));
    });

    it("el script es de SOLO LECTURA: una sola sentencia `WITH … SELECT`, sin escrituras", () => {
      const sinComentarios = SCRIPT.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      expect(sinComentarios.trim()).toMatch(/^WITH\s/);
      expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
      expect(sinComentarios.trim().split(";").filter((s) => s.trim().length > 0)).toHaveLength(1);
      // Y las familias de visita real son las del archivo real, no una lista inventada.
      expect(sinComentarios).toContain("('gestion', 'gestion_tienda_ayuda')");
    });
  });
});
