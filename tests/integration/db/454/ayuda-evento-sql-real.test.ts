import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { conAyudaAbiertaDe } from "@/lib/repositories/ayuda-abierta";
import { OrdenHabilitacionApiRepository } from "@/lib/repositories/OrdenHabilitacionApiRepository";
import { ApiHabilitacionService } from "@/lib/services/ApiHabilitacionService";
import { HabilitarNovedadService } from "@/lib/services/HabilitarNovedadService";
import { OrdenNotaService } from "@/lib/services/OrdenNotaService";
import { TraspasoMensajeroService } from "@/lib/services/TraspasoMensajeroService";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.15, design §4.2; R21-R28) — LA AYUDA A LA TIENDA COMO HECHO, por los servicios
 * reales y contra Postgres real. Lo que C22 (caracterizacion) ya afirma de pantallas y permisos no se
 * repite: aqui se mide QUE queda escrito en `orden_evento` por cada operacion y que la derivacion
 * «ayuda abierta» responde a esos hechos.
 *
 *   A  pedir ayuda (R21): nota, evento `ayuda_solicitada` del mensajero, SIN transicion ni historial,
 *      puntero de gestion liberado. «Recuperar» (R23): evento `ayuda_rescatada` del mensajero.
 *   B  «Habilitar» de la tienda (R23): evento `ayuda_rescatada` con actor la tienda.
 *   C  habilitar por API key (R24): evento `ayuda_habilitada_api`, fila de `orden_habilitacion_api`
 *      sin cambio de estado, respuesta `ayudaCerrada`.
 *   D  la tienda reprograma desde la ayuda (R25): gestion pendiente atribuida al mensajero, ayuda
 *      cerrada.
 *   E  traspaso a otro mensajero (R28): la ayuda SIGUE abierta.
 *   F  el corte la barre (R26/R27) y la ayuda se cierra sola; un NUEVO ciclo en `en_reparto` NO la
 *      reabre (la reapertura imposible).
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.15).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.15 — la ayuda como evento (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const abiertas = async (ids: string[]) => [...(await conAyudaAbiertaDe(e.cliente, ids))].sort();
      const eventos = (ordenId: string) =>
        e.tx.ordenEvento.findMany({
          where: { ordenId, tipo: { in: ["ayuda_solicitada", "ayuda_rescatada", "ayuda_habilitada_api"] } },
          orderBy: { createdAt: "asc" },
          select: { tipo: true, actorUsuarioId: true, actorRol: true, mensajeroId: true },
        });
      const quien = (id: string | null) =>
        id === e.mensajeroId ? "mensajero" : id === e.tiendaId ? "tienda" : id === e.mensajero2Id ? "mensajero2" : id;
      const eventosLegibles = async (ordenId: string) =>
        (await eventos(ordenId)).map((v) => `${v.tipo}:${quien(v.actorUsuarioId)}:${v.actorRol}`);

      const [a, b, c, d, eo, f] = [
        await e.sembrarOrden({ estatus: "en_reparto" }),
        await e.sembrarOrden({ estatus: "en_reparto" }),
        await e.sembrarOrden({ estatus: "en_reparto" }),
        await e.sembrarOrden({ estatus: "en_reparto" }),
        // E en la zona del satelite: el traspaso exige que el destino cubra la zona de la orden (C14).
        await e.sembrarOrden({ estatus: "en_reparto", zona: "satelite" }),
        await e.sembrarOrden({ estatus: "en_reparto" }),
      ];
      const todas = [a, b, c, d, eo, f].map((o) => o.ordenId);

      // A — el mensajero la ESCOGE (puntero) y pide ayuda.
      await e.s.misAsignaciones.escogerParaGestion(a.ordenId, e.actorMensajero);
      const punteroAntes = await e.s.gestionRepo.getOrdenEnGestion(e.mensajeroId);
      const notasAntes = await e.tx.ordenNota.count({ where: { ordenId: a.ordenId } });
      const pedidas = [];
      for (const o of [a, b, c, d, eo, f]) pedidas.push((await e.pedirAyuda(o.ordenId)).status);
      const trasPedir = {
        estadoA: await e.estadoDe(a.ordenId),
        historialA: await e.historialDe(a.ordenId),
        punteroA: await e.s.gestionRepo.getOrdenEnGestion(e.mensajeroId),
        notasA: (await e.tx.ordenNota.count({ where: { ordenId: a.ordenId } })) - notasAntes,
        abiertas: await abiertas(todas),
      };

      // Las salidas.
      const recuperada = await e.recuperar(a.ordenId);
      const notas = new OrdenNotaService(e.s.notaRepo);
      const habilitada = await new HabilitarNovedadService(notas, e.s.ordenRepo, e.s.notaRepo).habilitar(
        { ordenId: b.ordenId, nota: "Ya confirme la direccion" },
        e.actorTienda,
      );
      const api = await new ApiHabilitacionService(e.s.ordenRepo, new OrdenHabilitacionApiRepository(e.cliente)).habilitarLote(
        { usuarioId: e.tiendaId, rol: "adminTienda" },
        [{ num_guia: c.numGuia, nota: "habilitada por integracion" }],
      );
      const filaApi = await e.tx.ordenHabilitacionApi.findMany({
        where: { ordenId: c.ordenId },
        select: { cambioDeEstado: true, estadoResultante: true },
      });
      const reprogramada = await e.gestionarDesdeAyuda(d.ordenId, "reprogramado");
      const gestionD = await e.tx.gestionOrden.findFirstOrThrow({
        where: { ordenId: d.ordenId },
        select: { mensajeroId: true, cierreId: true, eventos: { select: { tipo: true, familiaAplicacion: true } } },
      });
      // El destino necesita vehiculo (regla del traspaso, como en C14).
      const vehiculo = await e.tx.vehiculo.findFirstOrThrow({ select: { id: true } });
      await e.tx.usuario.update({ where: { id: e.mensajero2Id }, data: { vehiculoId: vehiculo.id } });
      const traspaso = await new TraspasoMensajeroService(e.s.ordenRepo).traspasar(
        { ordenIds: [eo.ordenId], mensajeroDestinoId: e.mensajero2Id, motivo: "reparto" },
        e.actorMaestro,
      );
      const trasSalidas = {
        abiertas: await abiertas(todas),
        estados: {
          a: await e.estadoDe(a.ordenId),
          b: await e.estadoDe(b.ordenId),
          c: await e.estadoDe(c.ordenId),
          d: await e.estadoDe(d.ordenId),
          e: await e.estadoDe(eo.ordenId),
        },
        mensajeroE: (await e.ordenDe(eo.ordenId)).mensajeroAsignadoId === e.mensajero2Id,
      };

      // F — el corte la barre; despues, un ciclo NUEVO la devuelve a `en_reparto`.
      await e.correrCorte(new Date(), [e.mensajeroId]);
      const trasCorte = { estadoF: await e.estadoDe(f.ordenId), abiertaF: (await abiertas([f.ordenId])).length };
      await e.tx.orden.update({ where: { id: f.ordenId }, data: { estatusId: e.id("en_reparto") } });
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: f.ordenId,
          estatusOrigenId: e.id("novedad_interna"),
          estatusDestinoId: e.id("en_reparto"),
          origenTipo: "ajuste_estado",
          createdAt: new Date(Date.now() + 60_000),
        },
      });
      const nuevoCiclo = { abiertaF: (await abiertas([f.ordenId])).length };

      return {
        punteroAntes,
        pedidas,
        trasPedir,
        recuperada: recuperada.status,
        habilitada: habilitada.status,
        api: api.resultados,
        filaApi,
        reprogramado: reprogramada.status,
        gestionD,
        traspaso: traspaso.status,
        trasSalidas,
        trasCorte,
        nuevoCiclo,
        ids: { a: a.ordenId, eo: eo.ordenId, f: f.ordenId, todas: [...todas].sort() },
        eventos: {
          a: await eventosLegibles(a.ordenId),
          b: await eventosLegibles(b.ordenId),
          c: await eventosLegibles(c.ordenId),
          d: await eventosLegibles(d.ordenId),
          e: await eventosLegibles(eo.ordenId),
        },
        mensajeroId: e.mensajeroId,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("anti-vacuidad: las seis ayudas se piden y cada salida responde ok", () => {
    expect(r.pedidas).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(r.punteroAntes).toBe(r.ids.a);
    expect(r.recuperada).toBe("ok");
    expect(r.habilitada).toBe("ok");
    expect(r.reprogramado).toBe("ok");
    expect(r.traspaso).toBe("ok");
  });

  it("R21: pedir ayuda publica la nota, NO cambia el estado ni escribe historial, y libera el puntero", () => {
    expect(r.trasPedir.estadoA).toBe("en_reparto");
    expect(r.trasPedir.historialA).toEqual([]);
    expect(r.trasPedir.punteroA).toBeNull();
    expect(r.trasPedir.notasA).toBe(1);
    expect(r.trasPedir.abiertas).toEqual(r.ids.todas);
  });

  it("R21/R23: A deja `ayuda_solicitada` y `ayuda_rescatada`, las dos del mensajero", () => {
    expect(r.eventos.a).toEqual(["ayuda_solicitada:mensajero:mensajero", "ayuda_rescatada:mensajero:mensajero"]);
  });

  it("R23: «Habilitar» de la tienda deja `ayuda_rescatada` con actor la tienda", () => {
    expect(r.eventos.b).toEqual(["ayuda_solicitada:mensajero:mensajero", "ayuda_rescatada:tienda:adminTienda"]);
  });

  it("R24: la API deja `ayuda_habilitada_api`, su fila sin cambio de estado y responde `ayudaCerrada`", () => {
    expect(r.eventos.c).toEqual(["ayuda_solicitada:mensajero:mensajero", "ayuda_habilitada_api:tienda:adminTienda"]);
    expect(r.filaApi).toEqual([{ cambioDeEstado: false, estadoResultante: "en_reparto" }]);
    expect(r.api).toEqual([expect.objectContaining({ resultado: "habilitada", estado: "en_reparto", ayudaCerrada: true })]);
  });

  it("R25: la reprogramacion de la tienda es una gestion PENDIENTE atribuida al mensajero y cierra la ayuda", () => {
    expect(r.gestionD).toEqual({
      mensajeroId: r.mensajeroId,
      cierreId: null,
      eventos: [{ tipo: "gestion_registrada", familiaAplicacion: "gestion_tienda_ayuda" }],
    });
    expect(r.eventos.d).toEqual(["ayuda_solicitada:mensajero:mensajero"]);
  });

  it("R23-R25/R28: tras las salidas solo siguen abiertas la traspasada (E) y la del corte (F); ninguna cambio de estado", () => {
    expect(r.trasSalidas.abiertas).toEqual([r.ids.eo, r.ids.f].sort());
    expect(r.trasSalidas.estados).toEqual({ a: "en_reparto", b: "en_reparto", c: "en_reparto", d: "en_reparto", e: "en_reparto" });
    expect(r.trasSalidas.mensajeroE).toBe(true);
    expect(r.eventos.e).toEqual(["ayuda_solicitada:mensajero:mensajero"]);
  });

  it("R26/R27: el corte la barre a `novedad_interna` y la ayuda se cierra sola", () => {
    expect(r.trasCorte).toEqual({ estadoF: "novedad_interna", abiertaF: 0 });
  });

  it("R26: un ciclo NUEVO en `en_reparto` no reabre la ayuda", () => {
    expect(r.nuevoCiclo.abiertaF).toBe(0);
  });
});
