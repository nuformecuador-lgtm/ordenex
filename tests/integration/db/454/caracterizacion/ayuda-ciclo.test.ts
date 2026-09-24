import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { OrdenHabilitacionApiRepository } from "@/lib/repositories/OrdenHabilitacionApiRepository";
import { ApiHabilitacionService } from "@/lib/services/ApiHabilitacionService";
import { HabilitarNovedadService } from "@/lib/services/HabilitarNovedadService";
import { NovedadesService } from "@/lib/services/NovedadesService";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C22 (R21-R28, R65). EL CICLO ENTERO DE LA AYUDA A LA TIENDA, sobre HOY.
 *
 * Todo por los servicios reales: pedir ayuda (`SolicitudAyudaService`), la pestaña de ayuda de
 * `/novedades` (`NovedadesService`), el hilo (`OrdenNotaService`), «Recuperar», «Habilitar»
 * (`HabilitarNovedadService`), la habilitacion por API key (`ApiHabilitacionService`, ramas A y B),
 * la gestion de la tienda desde ayuda (237) y el corte nocturno.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C22 — ciclo de la ayuda a la tienda (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof ciclo>>;
  let corte: Awaited<ReturnType<typeof cicloCorte>>;

  function ciclo() {
    return conEscenario(mundo, async (e) => {
      const otraTiendaId = await e.crearUsuario("adminTienda", null);
      const otraTienda: Actor = { usuarioId: otraTiendaId, rol: "adminTienda", zonaId: null };
      const novedades = new NovedadesService(e.s.ordenRepo, e.s.historialService);
      const notas = new OrdenNotaService(e.s.notaRepo);
      const habilitar = new HabilitarNovedadService(notas, e.s.ordenRepo, e.s.notaRepo);
      const api = new ApiHabilitacionService(e.s.ordenRepo, new OrdenHabilitacionApiRepository(e.cliente));
      const idsAyuda = async (actor: Actor) => {
        const l = await novedades.listar({ page: 1, pageSize: 100, grupo: "ayuda" }, actor);
        return l.status === "ok" ? l.items.map((i) => (i as { id: string }).id) : null;
      };

      const a1 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const a2 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const a3 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const a4 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const a5 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const b = await e.sembrarOrden({ estatus: "novedad", montoCobrar: 1000 });
      for (const o of [a1, a2, a3, a4, a5]) {
        const p = await e.pedirAyuda(o.ordenId);
        if (p.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(p)}`);
      }

      // Con ayuda abierta (A1).
      const pestanaDuena = await idsAyuda(e.actorTienda);
      const pestanaOtra = await idsAyuda(otraTienda);
      const lista = await e.s.misAsignaciones.listarMisAsignaciones(e.actorMensajero);
      const conAyuda = lista.status === "ok" ? lista.conAyuda.map((o) => o.id) : null;
      const gestionarConAyuda = await e.gestionar(a1.ordenId, "entregado", { monto: 1000 });
      const cierreConAyuda = await e.solicitarCierre();
      const hiloDuena = await notas.publicar({ ordenId: a1.ordenId, cuerpo: "La llamo ya" }, e.actorTienda);
      const hiloOtra = await notas.publicar({ ordenId: a1.ordenId, cuerpo: "hola" }, otraTienda);

      // Salidas: Recuperar (A2), Habilitar (A3), API rama A (A4) y rama B (B).
      const recuperado = await e.recuperar(a2.ordenId);
      const habilitado = await habilitar.habilitar({ ordenId: a3.ordenId, nota: "Ya confirme la direccion" }, e.actorTienda);
      const porApi = await api.habilitarLote({ usuarioId: e.tiendaId, rol: "adminTienda" }, [
        { num_guia: a4.numGuia, nota: "habilitada por integracion" },
        { num_guia: b.numGuia, nota: "habilitada por integracion" },
      ]);

      // La tienda reprograma A5 desde ayuda.
      const reprogramada = await e.gestionarDesdeAyuda(a5.ordenId, "reprogramado", {
        fechaReprogramacion: fechaRepartoComoTexto(diaCR(2)),
      });

      // Todas las rescatadas vuelven a ser gestionables.
      await e.recuperar(a1.ordenId);
      const gestionables = {
        a1: (await e.gestionar(a1.ordenId, "entregado", { monto: 1000 })).status,
        a2: (await e.gestionar(a2.ordenId, "entregado", { monto: 1000 })).status,
        a3: (await e.gestionar(a3.ordenId, "entregado", { monto: 1000 })).status,
        a4: (await e.gestionar(a4.ordenId, "entregado", { monto: 1000 })).status,
      };

      const solicitud = await e.solicitarCierre();
      const cierreId = solicitud.status === "ok" ? (solicitud.cierreId ?? null) : null;
      const g5 = await e.tx.gestionOrden.findFirstOrThrow({
        where: { ordenId: a5.ordenId },
        select: { cierreId: true, mensajeroId: true },
      });
      const intentosAntes = await e.s.historialService.contarIntentos(a5.ordenId);
      const aprobacion = cierreId === null ? { status: "sin_cierre" } : await e.aprobar(cierreId);
      const intentosDespues = await e.s.historialService.contarIntentos(a5.ordenId);
      return {
        ids: { a1: a1.ordenId },
        mensajeroId: e.mensajeroId,
        pestanaDuena,
        pestanaOtra,
        conAyuda,
        gestionarConAyuda: gestionarConAyuda.status,
        cierreConAyuda: cierreConAyuda.status,
        hiloDuena: hiloDuena.status,
        hiloOtra: hiloOtra.status,
        recuperado: recuperado.status,
        habilitado: habilitado.status,
        porApi: porApi.resultados.map((x) => `${x.resultado}:${x.estado ?? ""}`),
        reprogramado: reprogramada.status,
        gestionables,
        solicitud: solicitud.status,
        cierreId,
        g5,
        intentosAntes,
        aprobacion: aprobacion.status,
        intentosDespues,
      };
    });
  }

  function cicloCorte() {
    return conEscenario(mundo, async (e) => {
      const a = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const p = await e.pedirAyuda(a.ordenId);
      if (p.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(p)}`);
      const estadoConAyuda = await e.estadoDe(a.ordenId);
      await e.correrCorte(new Date());
      const vencido = await e.tx.cierreDia.findFirst({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        select: { sinGestion: { select: { ordenId: true } } },
      });
      return {
        ordenId: a.ordenId,
        estadoConAyuda,
        tras: await e.estadoDe(a.ordenId),
        barridas: vencido?.sinGestion.map((s) => s.ordenId) ?? null,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await ciclo();
    corte = await cicloCorte();
  }, 180_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  describe("invariantes", () => {
    it("pedir ayuda la pone en la pestaña de ayuda de la tienda DUEÑA, y no en la de otra", () => {
      expect(r.pestanaDuena).toContain(r.ids.a1);
      expect(r.pestanaOtra ?? []).not.toContain(r.ids.a1);
    });

    it("el mensajero la ve en `conAyuda`, no la puede gestionar y no puede solicitar el cierre", () => {
      expect(r.conAyuda).toContain(r.ids.a1);
      expect(r.gestionarConAyuda).toBe("conflict");
      expect(r.cierreConAyuda).toBe("conflict");
    });

    it("el hilo lo escribe la tienda duena y no otra", () => {
      expect(r.hiloDuena).toBe("ok");
      expect(r.hiloOtra).toBe("forbidden");
    });

    it("Recuperar, Habilitar y la API (rama A) la devuelven a gestionable; la rama B no cambia estado", () => {
      expect(r.recuperado).toBe("ok");
      expect(r.habilitado).toBe("ok");
      expect(r.porApi).toEqual(["habilitada:en_reparto", "habilitada_sin_cambio_de_estado:novedad"]);
      expect(r.gestionables).toEqual({ a1: "ok", a2: "ok", a3: "ok", a4: "ok" });
    });

    it("la reprogramacion de la tienda desde ayuda va al cierre del mensajero y cuenta intento tras aprobar", () => {
      expect(r.reprogramado).toBe("ok");
      expect(r.solicitud).toBe("ok");
      expect(r.g5).toEqual({ cierreId: r.cierreId, mensajeroId: r.mensajeroId });
      expect(r.intentosAntes).toBe(0);
      expect(r.aprobacion).toBe("ok");
      expect(r.intentosDespues).toBe(1);
    });

    it("el corte nocturno barre la orden con ayuda a `novedad_interna` y la vincula al vencido", () => {
      expect(corte.tras).toBe("novedad_interna");
      expect(corte.barridas).toEqual([corte.ordenId]);
    });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R21): AQUI DECIA «hoy, pedir ayuda mueve la orden al estado `ayuda_tienda`». La
    // ayuda es un hecho (`orden_evento`): la orden sigue `en_reparto`.
    it("pedir ayuda NO cambia el estado: la orden sigue `en_reparto`", () => {
      expect(corte.estadoConAyuda).toBe("en_reparto");
    });
  });
});
