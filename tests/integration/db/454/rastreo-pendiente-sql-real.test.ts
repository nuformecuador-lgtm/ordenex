import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { hitoDeEstatus } from "@/lib/types/rastreo-publico";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.19, design §12.3; R31) — EL RASTREO PUBLICO Y LA GESTION PENDIENTE, contra Postgres
 * real y por el servicio real (repositorio real sobre la tx).
 *
 * La gestion pendiente se ve AL INSTANTE como ultimo hito, marcada `pendiente`, con el hito de su
 * resultado y su instante; SIN actor, motivo ni mensajero (frontera de la 229). Se recorre la vida
 * entera: aparece al registrarse, desaparece al anularse, muestra el resultado CORREGIDO, y al aprobar
 * la sustituye el hito confirmado (sin marca).
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.19).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const TELEFONO = "88880000";

describeSiHayBase("454/T1.19 — rastreo publico con gestion pendiente (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const rastreo = new RastreoPublicoService(new RastreoPublicoRepository(e.cliente), {
        RATE_MAX: 100,
        RATE_WINDOW_MINUTES: 10,
        DIGITOS_SEGUNDO_FACTOR: 4,
        ZONA_HORARIA: "America/Costa_Rica",
      });
      const consultar = async (numGuia: number) => {
        const c = await rastreo.consultar(numGuia, TELEFONO);
        if (c.estado !== "ok") throw new Error(`rastreo no encontro la guia ${numGuia}`);
        return c.envio;
      };
      /** La fila de «salio a reparto» que toda orden en calle ya tiene: la base de la linea. */
      const enReparto = async (ordenId: string) =>
        e.tx.ordenHistorialEstado.create({
          data: {
            ordenId,
            estatusDestinoId: e.id("en_reparto"),
            origenTipo: "asignacion_satelite",
            createdAt: new Date(Date.now() - 3600_000),
          },
        });

      // P — se registra y se DESHACE.
      const p = await e.sembrarOrden({ estatus: "en_reparto" });
      await enReparto(p.ordenId);
      const antes = await consultar(p.numGuia);
      const gP = await e.gestionarOk(p.ordenId, "entregado");
      const conPendiente = await consultar(p.numGuia);
      const deshacer = await e.s.cierreDia.deshacerGestion(gP, e.actorMensajero);
      const trasDeshacer = await consultar(p.numGuia);

      // C — se registra `entregada`, se CORRIGE a `rechazada` y se APRUEBA.
      const central = await e.mensajeroCentral();
      const c = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 4000, mensajeroId: central.mensajeroId });
      await enReparto(c.ordenId);
      const gC = await e.gestionarOk(c.ordenId, "entregado", { monto: 4000, actor: central.actor });
      const cierreId = await e.solicitarCierreOk(central.actor);
      const conCierreSolicitado = await consultar(c.numGuia);
      const correccion = await e.s.cierresAdmin.corregirResultadoGestion(
        { gestionId: gC, motivo: "MOTIVO-INTERNO-QUE-NO-SE-PUBLICA" },
        e.actorMaestro,
      );
      const trasCorregir = await consultar(c.numGuia);
      const aprobacion = await e.aprobar(cierreId, e.actorMaestro);
      const trasAprobar = await consultar(c.numGuia);
      const estadoFinalC = await e.estadoDe(c.ordenId);
      // C vuelve a la calle en un ciclo NUEVO: su gestion (de un cierre APROBADO) no es pendiente.
      await e.tx.orden.update({ where: { id: c.ordenId }, data: { estatusId: e.id("en_reparto") } });
      const nuevoCicloC = await consultar(c.numGuia);

      // X — gestion pendiente, pero la orden la MOVIO otra via (ya no esta `en_reparto`): sin marca.
      const x = await e.sembrarOrden({ estatus: "en_reparto" });
      await enReparto(x.ordenId);
      await e.gestionarOk(x.ordenId, "novedad");
      await e.tx.orden.update({ where: { id: x.ordenId }, data: { estatusId: e.id("novedad_interna") } });
      const movidaX = await consultar(x.numGuia);
      return {
        nuevoCicloC,
        movidaX,
        deshacer: deshacer.status,
        correccion: correccion.status,
        aprobacion: aprobacion.status,
        antes,
        conPendiente,
        trasDeshacer,
        conCierreSolicitado,
        trasCorregir,
        trasAprobar,
        estadoFinalC,
        secretos: [central.mensajeroId, e.mensajeroId, "MOTIVO-INTERNO-QUE-NO-SE-PUBLICA", "No aparece"],
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

  const ultima = <T>(xs: readonly T[]) => xs[xs.length - 1];

  it("anti-vacuidad: el deshacer, la correccion y la aprobacion ocurren", () => {
    expect(r.deshacer).toBe("ok");
    expect(r.correccion).toBe("ok");
    expect(r.aprobacion).toBe("ok");
  });

  it("R31: al registrar, el ultimo hito es el del resultado, MARCADO pendiente, y es el vigente", () => {
    expect(r.conPendiente.linea).toHaveLength(r.antes.linea.length + 1);
    // FICHA 454 (decision del humano 2026-09-24): la entrada pendiente lleva ademas el NOMBRE del
    // resultado, texto y no codigo. Se añade al literal (es el contrato), no se relaja el `toEqual`.
    expect(ultima(r.conPendiente.linea)).toEqual({
      hito: "entregado",
      fecha: expect.any(String),
      pendiente: true,
      nombreResultado: "Entregada",
    });
    expect(r.conPendiente.hitoVigente).toBe("entregado");
    // Y la linea de antes no tenia ninguna marca.
    expect(r.antes.linea.some((h) => "pendiente" in h)).toBe(false);
  });

  it("R31: con el cierre SOLICITADO (aun sin aprobar) la marca sigue", () => {
    expect(ultima(r.conCierreSolicitado.linea)).toEqual({
      hito: "entregado",
      fecha: expect.any(String),
      pendiente: true,
      nombreResultado: "Entregada",
    });
  });

  it("R31: al anularse, desaparece — la linea vuelve a ser la de antes", () => {
    expect(r.trasDeshacer).toEqual(r.antes);
  });

  it("R31: al corregirse, muestra el resultado CORREGIDO (sigue pendiente)", () => {
    // El nombre es el del resultado CORREGIDO («Rechazada»), no el hito compartido «No entregado».
    expect(ultima(r.trasCorregir.linea)).toEqual({
      hito: "no_entregado",
      fecha: expect.any(String),
      pendiente: true,
      nombreResultado: "Rechazada",
    });
  });

  it("R31: al aprobar lo sustituye el hito CONFIRMADO del historial, sin marca", () => {
    expect(r.trasAprobar.linea.some((h) => "pendiente" in h)).toBe(false);
    expect(r.trasAprobar.linea.some((h) => "nombreResultado" in h)).toBe(false);
    expect(r.trasAprobar.hitoVigente).toBe(hitoDeEstatus(r.estadoFinalC));
    expect(r.trasAprobar.linea.map((h) => h.hito)).toContain("no_entregado");
  });

  it("R31: la gestion de un cierre APROBADO no se marca aunque la orden vuelva a `en_reparto`", () => {
    expect(r.nuevoCicloC.linea.some((h) => "pendiente" in h)).toBe(false);
  });

  it("R31: una orden que ya no esta `en_reparto` no se marca aunque su gestion siga sin cierre", () => {
    expect(r.movidaX.linea.some((h) => "pendiente" in h)).toBe(false);
  });

  it("frontera 229: ninguna respuesta lleva ids de mensajero ni motivos", () => {
    const todo = JSON.stringify([r.conPendiente, r.conCierreSolicitado, r.trasCorregir, r.trasAprobar]);
    for (const s of r.secretos) expect(todo).not.toContain(s);
  });
});
