import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import { OrdenService } from "@/lib/services/OrdenService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { listarOrdenesSchema, type SenalesGestionDTO } from "@/lib/types/orden";
import { listarOrdenesBodegaPaginadoSchema } from "@/lib/types/recepcion-satelite";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, crearEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (R29, BLOQUEO-1 de la fase 2, 2026-09-24) — LAS SEÑALES DE LA GESTION PENDIENTE Y LA
 * AYUDA ABIERTA EN LOS LECTORES DE LAS PANTALLAS INTERNAS, contra Postgres real y por los SERVICIOS
 * reales (repositorios reales sobre la tx del test).
 *
 * Lectores medidos, los tres con la misma forma por fila:
 *   `gestionPendiente: { resultado, registradaAt } | null` y `ayudaAbierta: boolean`
 *   L1 — `/ordenes`: `OrdenService.listar` (maestro, admin, adminTienda).
 *   L2 — «Órdenes de la bodega» del adminSatelite: `RecepcionSateliteService.listarOrdenesBodegaPaginado`
 *        (y la consulta de grupos `findRecepcionSateliteByZona`, que comparte la anotacion).
 *   L3 — el detalle (drawer de la linea de tiempo): `OrdenHistorialService.obtenerHistorial`.
 *
 * Casos, una orden cada uno (zona satelite del escenario, con paso por la bodega en el historial):
 *   A  gestion `rechazada` registrada, sin cierre            → pendiente «rechazada», sin ayuda
 *   B  en mano, nada                                          → null, sin ayuda
 *   C  ayuda pedida                                           → null, ayuda ABIERTA
 *   D  ayuda pedida y RECUPERADA (rescatada)                  → null, sin ayuda
 *   E  gestion registrada y ANULADA (deshacer)                → null, sin ayuda
 *   F  LEGADA: gestion sin evento `gestion_registrada`        → null, sin ayuda
 *   G  gestion de un cierre APROBADO, la orden aun en reparto → null, sin ayuda
 *   H  gestion `entregada` de un cierre SOLICITADO            → pendiente «entregada» (control de G)
 *   I  gestion registrada sin cierre, pero la orden la MOVIO otra via (ya no esta en reparto) → null
 * Y una orden de OTRA tienda y OTRA zona (escenario hermano) con gestion pendiente, para el alcance.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Caso = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
const CASOS: readonly Caso[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

const EN_REPOSO: SenalesGestionDTO = { gestionPendiente: null, ayudaAbierta: false };

function senales(fila: { gestionPendiente?: unknown; ayudaAbierta?: unknown }) {
  return { gestionPendiente: fila.gestionPendiente, ayudaAbierta: fila.ayudaAbierta };
}

describeSiHayBase("454/R29 — señales de gestion pendiente y ayuda en los lectores internos (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      /** La orden paso por la bodega satelite y salio a reparto (historial ANTERIOR a todo lo demas). */
      const enCalleDeSatelite = async (esc: Escenario, ordenId: string) => {
        await esc.tx.ordenHistorialEstado.create({
          data: {
            ordenId,
            estatusDestinoId: esc.id("en_bodega_satelite"),
            origenTipo: "recepcion_satelite",
            createdAt: new Date(Date.now() - 2 * 3600_000),
          },
        });
        await esc.tx.ordenHistorialEstado.create({
          data: {
            ordenId,
            estatusDestinoId: esc.id("en_reparto"),
            origenTipo: "asignacion_satelite",
            createdAt: new Date(Date.now() - 3600_000),
          },
        });
      };
      const sembrar = async (esc: Escenario) => {
        const o = await esc.sembrarOrden({ estatus: "en_reparto", zona: "satelite" });
        await enCalleDeSatelite(esc, o.ordenId);
        return o.ordenId;
      };
      const cierre = (esc: Escenario, estado: "aprobado" | "solicitado") =>
        esc.tx.cierreDia.create({
          data: {
            mensajeroId: esc.mensajeroId,
            estado,
            destinoTipo: "bodega_satelite",
            destinoZonaId: esc.zonaSateliteId,
            solicitadoAt: new Date(),
          },
          select: { id: true },
        });

      const ids = {} as Record<Caso, string>;
      for (const c of CASOS) ids[c] = await sembrar(e);

      const gA = await e.gestionarOk(ids.A, "rechazada");
      const ayudaC = (await e.pedirAyuda(ids.C)).status;
      const ayudaD = (await e.pedirAyuda(ids.D)).status;
      const recuperadaD = (await e.recuperar(ids.D)).status;
      const gE = await e.gestionarOk(ids.E, "entregada");
      const deshacerE = (await e.s.cierreDia.deshacerGestion(gE, e.actorMensajero)).status;
      // F — LEGADA: la gestion existe (sin cierre, no anulada) pero NO tiene evento de registro.
      await e.tx.gestionOrden.create({
        data: { ordenId: ids.F, mensajeroId: e.mensajeroId, resultado: "entregada" },
      });
      // G/H — la gestion se registra por el servicio real y luego se vincula a un cierre sembrado.
      // G: cierre APROBADO sin que la aplicacion moviera la orden (sigue `en_reparto`): lo que
      // tiene que apagar la señal es la condicion «cierre no aprobado», no el estado.
      const gG = await e.gestionarOk(ids.G, "entregada");
      const gH = await e.gestionarOk(ids.H, "entregada");
      const cG = await cierre(e, "aprobado");
      const cH = await cierre(e, "solicitado");
      await e.tx.gestionOrden.update({ where: { id: gG }, data: { cierreId: cG.id } });
      await e.tx.gestionOrden.update({ where: { id: gH }, data: { cierreId: cH.id } });
      // I — la gestion sigue sin cierre y sin anular, pero la orden ya no esta `en_reparto`.
      await e.gestionarOk(ids.I, "entregada");
      await e.tx.orden.update({ where: { id: ids.I }, data: { estatusId: e.id("entregada") } });

      // El escenario HERMANO: otra tienda, otra zona, con su propia gestion pendiente.
      const otro = await crearEscenario(e.mundo, e.tx, e.cliente);
      const ajena = await sembrar(otro);
      await otro.gestionarOk(ajena, "devuelta");

      const registrada = async (gestionId: string) =>
        (
          await e.tx.gestionOrden.findUniqueOrThrow({
            where: { id: gestionId },
            select: { createdAt: true },
          })
        ).createdAt.toISOString();
      const esperadoA = { resultado: "rechazada", registradaAt: await registrada(gA) };
      const esperadoH = { resultado: "entregada", registradaAt: await registrada(gH) };

      // --- L1: /ordenes -------------------------------------------------------------------------
      const adminId = await e.crearUsuario("admin", null);
      const actorAdmin: Actor = { usuarioId: adminId, rol: "admin", zonaId: null };
      const ordenes = new OrdenService(e.s.ordenRepo, e.s.historialService);
      const listar = async (actor: Actor) => {
        const res = await ordenes.listar(
          listarOrdenesSchema.parse({
            pageSize: 50,
            filter: { tienda_id: [e.tiendaId, otro.tiendaId] },
          }),
          actor,
        );
        if (res.status !== "ok") throw new Error(`listar(${actor.rol}) no fue ok: ${res.status}`);
        return new Map(res.items.map((i) => [i.id, i]));
      };
      const l1 = {
        maestro: await listar(e.actorMaestro),
        admin: await listar(actorAdmin),
        tienda: await listar(e.actorTienda),
      };

      // --- L2: bodega satelite -------------------------------------------------------------------
      const satelite = new RecepcionSateliteService(e.s.ordenRepo, e.s.historialService);
      const pagina = await satelite.listarOrdenesBodegaPaginado(
        listarOrdenesBodegaPaginadoSchema.parse({ page: 1, pageSize: 50 }),
        e.actorAdminSatelite,
      );
      if (pagina.status !== "ok") throw new Error(`satelite no fue ok: ${pagina.status}`);
      const l2 = new Map(pagina.items.map((i) => [i.id, i]));
      const grupos = new Map(
        (await e.s.ordenRepo.findRecepcionSateliteByZona(e.zonaSateliteId, ["en_reparto", "entregada"])).map((i) => [
          i.id,
          i,
        ]),
      );

      // --- L3: el detalle -------------------------------------------------------------------------
      const detalle = async (ordenId: string, actor: Actor) => {
        const d = await e.s.historialService.obtenerHistorial(ordenId, actor);
        return d.status === "ok" ? { status: d.status, ...senales(d) } : { status: d.status };
      };
      const l3 = {} as Record<Caso, unknown>;
      for (const c of CASOS) l3[c] = await detalle(ids[c], e.actorMaestro);
      const l3Tienda = await detalle(ids.A, e.actorTienda);
      const l3TiendaAjena = await detalle(ajena, e.actorTienda);
      const l3Satelite = await detalle(ids.C, e.actorAdminSatelite);

      return {
        ids,
        ajena,
        esperadoA,
        esperadoH,
        precondiciones: { ayudaC, ayudaD, recuperadaD, deshacerE },
        l1,
        l2,
        grupos,
        l3,
        l3Tienda,
        l3TiendaAjena,
        l3Satelite,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 180_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  /** Lo que cada caso tiene que decir, igual en los tres lectores. */
  function esperado(c: Caso): SenalesGestionDTO | Record<string, unknown> {
    if (c === "A") return { gestionPendiente: r.esperadoA, ayudaAbierta: false };
    if (c === "C") return { gestionPendiente: null, ayudaAbierta: true };
    if (c === "H") return { gestionPendiente: r.esperadoH, ayudaAbierta: false };
    return EN_REPOSO;
  }

  it("precondiciones: las ayudas se pidieron, la de D se recupero y la gestion de E se anulo", () => {
    expect(r.precondiciones).toEqual({ ayudaC: "ok", ayudaD: "ok", recuperadaD: "ok", deshacerE: "ok" });
  });

  describe("L1 — /ordenes (`OrdenService.listar`)", () => {
    for (const rol of ["maestro", "admin", "tienda"] as const) {
      it(`${rol}: cada caso trae sus dos señales exactas`, () => {
        for (const c of CASOS) {
          const fila = r.l1[rol].get(r.ids[c]);
          expect(fila, `${rol}/${c} no esta en el listado`).toBeDefined();
          expect(senales(fila!), `${rol}/${c}`).toEqual(esperado(c));
        }
      });
    }

    it("maestro y admin ven tambien la orden AJENA con su pendiente (`devuelta`)", () => {
      for (const rol of ["maestro", "admin"] as const) {
        expect(r.l1[rol].get(r.ajena)?.gestionPendiente?.resultado, rol).toBe("devuelta");
      }
    });

    it("alcance: la tienda NO recibe la orden de otra tienda aunque la pida por filtro", () => {
      expect(r.l1.tienda.has(r.ajena)).toBe(false);
      expect([...r.l1.tienda.keys()].sort()).toEqual(CASOS.map((c) => r.ids[c]).sort());
    });
  });

  describe("L2 — bodega satelite", () => {
    it("pagina: cada caso trae sus dos señales exactas", () => {
      for (const c of CASOS) {
        const fila = r.l2.get(r.ids[c]);
        expect(fila, `${c} no esta en la bodega`).toBeDefined();
        expect(senales(fila!), c).toEqual(esperado(c));
      }
    });

    it("alcance: la bodega NO ve la orden de otra zona", () => {
      expect(r.l2.has(r.ajena)).toBe(false);
      expect(r.grupos.has(r.ajena)).toBe(false);
    });

    it("la consulta de grupos (`findRecepcionSateliteByZona`) lleva las mismas señales", () => {
      for (const c of CASOS) {
        const fila = r.grupos.get(r.ids[c]);
        expect(fila, `${c} no esta en los grupos`).toBeDefined();
        expect(senales(fila!), c).toEqual(esperado(c));
      }
    });
  });

  describe("L3 — el detalle (`obtenerHistorial`)", () => {
    it("maestro: cada caso trae sus dos señales exactas", () => {
      for (const c of CASOS) expect(r.l3[c], c).toEqual({ status: "ok", ...esperado(c) });
    });

    it("la tienda dueña ve la señal de SU orden; la ajena no le llega (not_found, sin señales)", () => {
      expect(r.l3Tienda).toEqual({ status: "ok", ...esperado("A") });
      expect(r.l3TiendaAjena).toEqual({ status: "not_found" });
    });

    it("el adminSatelite de la zona ve la ayuda abierta", () => {
      expect(r.l3Satelite).toEqual({ status: "ok", ...esperado("C") });
    });
  });
});
