import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.9, design §10, DA; R45) — LA SEGUNDA VIA DE LA 6.ª CONDICION DE INTENTOS, contra
 * Postgres real.
 *
 * Con la 454 una `devuelta` de calle no escribe historial al registrarse y, al aprobar, su transicion
 * lleva la familia `anclaje_devolucion`, que NO esta en `ORIGEN_TIPOS_VISITA_REAL`. Lo que la hace
 * contar es su evento `gestion_registrada` (segunda via). Se mide:
 *   - la `devuelta` nueva del mensajero: 0 intentos con el cierre `solicitado`, 1 tras aprobarlo;
 *   - la `reprogramada` de la TIENDA desde una ayuda (237): igual, 0 → 1 con el cierre del mensajero;
 *   - una gestion SINTETICA (escalado por plazo, sin evento) en un cierre APROBADO: 0, siempre;
 *   - una gestion con SOLO historial `anclaje_devolucion` y sin evento en un cierre aprobado: 0 (la
 *     familia de la aplicacion no basta por si sola: la que cuenta es la del registro de calle).
 * El conteo individual y el de lote dicen lo mismo (el listado lee el de lote).
 *
 * Es DINERO: el conteo decide el tope de intentos y el cobro del rechazo. Mutacion registrada en
 * `progress/impl_454_backend.md` (§Mutaciones T1.9).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.9 — intentos: la segunda via (evento de registro) (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const contar = (id: string) => e.s.historialService.contarIntentos(id);

      // (1) `devuelta` de calle del mensajero.
      const dev = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(dev.ordenId, "devuelta");
      // (2) la tienda reprograma desde una ayuda del mismo mensajero.
      const ayu = await e.sembrarOrden({ estatus: "en_reparto" });
      const ayuda = await e.pedirAyuda(ayu.ordenId);
      const desdeAyuda = await e.gestionarDesdeAyuda(ayu.ordenId, "reprogramada");
      // (3) sintetica: escalado por plazo en un cierre APROBADO, sin evento.
      const sin = await e.sembrarOrden({ estatus: "rechazada" });
      await e.sembrarIntentoPasado(sin.ordenId, { resultado: "rechazada", origenTipo: "escalado_devuelta_sla" });
      // (4) solo familia de aplicacion (`anclaje_devolucion`), sin evento, en un cierre APROBADO.
      const anc = await e.sembrarOrden({ estatus: "devuelta" });
      const g4 = await e.sembrarIntentoPasado(anc.ordenId, { resultado: "devuelta" });
      await e.tx.ordenHistorialEstado.updateMany({
        where: { gestionOrdenId: g4.gestionId },
        data: { origenTipo: "anclaje_devolucion", estatusDestinoId: e.id("devuelta") },
      });

      const cierreId = await e.solicitarCierreOk();
      const antes = { dev: await contar(dev.ordenId), ayu: await contar(ayu.ordenId) };
      const aprobacion = await e.aprobar(cierreId);
      const despues = {
        dev: await contar(dev.ordenId),
        ayu: await contar(ayu.ordenId),
        sin: await contar(sin.ordenId),
        anc: await contar(anc.ordenId),
      };
      const lote = await e.s.historialService.contarIntentosEnLote([dev.ordenId, ayu.ordenId, sin.ordenId, anc.ordenId]);
      const origenDev = (await e.historialDe(dev.ordenId)).map((h) => h.origenTipo);
      const eventos = await e.tx.ordenEvento.findMany({
        where: { ordenId: { in: [dev.ordenId, ayu.ordenId] }, tipo: "gestion_registrada" },
        select: { ordenId: true, familiaAplicacion: true },
      });
      return {
        ayuda: ayuda.status,
        desdeAyuda: desdeAyuda.status,
        aprobacion: aprobacion.status,
        antes,
        despues,
        lote: {
          dev: lote.get(dev.ordenId) ?? 0,
          ayu: lote.get(ayu.ordenId) ?? 0,
          sin: lote.get(sin.ordenId) ?? 0,
          anc: lote.get(anc.ordenId) ?? 0,
        },
        origenDev,
        familiaDeAyuda: eventos.find((ev) => ev.ordenId === ayu.ordenId)?.familiaAplicacion ?? null,
        eventosDeCalle: eventos.length,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  });
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("anti-vacuidad: la ayuda, la gestion de la tienda y la aprobacion ocurren; hay dos registros de calle", () => {
    expect(r.ayuda).toBe("ok");
    expect(r.desdeAyuda).toBe("ok");
    expect(r.aprobacion).toBe("ok");
    expect(r.eventosDeCalle).toBe(2);
    expect(r.familiaDeAyuda).toBe("gestion_tienda_ayuda");
  });

  it("la `devuelta` nueva se aplica con `anclaje_devolucion` (la 1.ª via NO la veria)", () => {
    expect(r.origenDev).toEqual(["anclaje_devolucion"]);
  });

  it("R45: antes de aprobar su cierre, ninguna gestion de calle cuenta", () => {
    expect(r.antes).toEqual({ dev: 0, ayu: 0 });
  });

  it("R45/DA: tras aprobar, la `devuelta` del mensajero y la reprogramada de la tienda cuentan 1", () => {
    expect(r.despues.dev).toBe(1);
    expect(r.despues.ayu).toBe(1);
  });

  it("DA: una sintetica sin evento no cuenta nunca, ni la sola familia `anclaje_devolucion`", () => {
    expect(r.despues.sin).toBe(0);
    expect(r.despues.anc).toBe(0);
  });

  it("el conteo en lote dice lo mismo que el individual", () => {
    expect(r.lote).toEqual(r.despues);
  });
});
