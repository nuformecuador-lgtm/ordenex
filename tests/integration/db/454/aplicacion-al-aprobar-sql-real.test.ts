import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS, clienteConSavepoint } from "../_postgres-real";
import {
  conEscenario,
  diaCR,
  montarServicios,
  prepararMundo,
  type Escenario,
  type Mundo,
} from "./_escenario";

/**
 * FICHA 454 (T1.7, design §7) — LA APLICACION DE LAS GESTIONES AL APROBAR, contra Postgres real.
 *
 * Es el punto de dinero de la ficha: la gestion ya no mueve la orden al registrarse, y es ESTA
 * transaccion la que la lleva a su estado real (y con el, al reloj del plazo de la tienda, a la
 * devolucion de la 139 y al conteo de intentos). Aqui se mide lo que ningun doble puede: el
 * `UPDATE … WHERE estatus_id = en_reparto … RETURNING` ejecutado de verdad, el orden frente a la 139
 * y la atomicidad.
 *
 *   R7   aplica cada gestion de calle vigente del cierre, dentro de la tx de la aprobacion.
 *   R8   familia y actor por resultado, enlazando la gestion.
 *   R9   una orden que ya no esta `en_reparto` no se mueve, y la aprobacion sigue.
 *   R10  la `rechazada` aplicada llega a `por_devolver*` en ESA MISMA aprobacion (139 va despues).
 *   R11  si la aprobacion falla, no queda NADA de la aplicacion.
 *   R12  re-aprobar no aplica otra vez ni escribe historial.
 *   R14  una gestion LEGADA (sin evento de registro) no se re-aplica.
 *   R57  con dos gestiones de calle vigentes, solo aplica la MAS RECIENTE.
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.7).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Filas de historial de la orden escritas por la APLICACION (las familias de la aplicacion). */
async function filasDeAplicacion(e: Escenario, ordenId: string) {
  return (await e.historialDe(ordenId)).filter((h) =>
    ["gestion", "incidente", "anclaje_devolucion", "gestion_tienda_ayuda"].includes(h.origenTipo),
  );
}

describeSiHayBase("454/T1.7 — la aplicacion de las gestiones al aprobar (Postgres real)", () => {
  let mundo: Mundo;

  beforeAll(async () => {
    mundo = await prepararMundo();
  });
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("R7/R8/R10/R14: aplica cada resultado con su familia y su actor; la legada no se toca", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const o = {
        entregado: await e.sembrarOrden({ estatus: "en_reparto" }),
        novedad: await e.sembrarOrden({ estatus: "en_reparto" }),
        devolucion_a_origen_por_rechazo: await e.sembrarOrden({ estatus: "en_reparto" }),
        incidente: await e.sembrarOrden({ estatus: "en_reparto" }),
        reprogramado: await e.sembrarOrden({ estatus: "en_reparto" }),
      };
      const g: Record<string, string> = {};
      for (const [resultado, orden] of Object.entries(o)) {
        g[resultado] = await e.gestionarOk(orden.ordenId, resultado as keyof typeof o);
      }
      // R14 — una gestion LEGADA (registrada antes del despliegue: sin evento `gestion_registrada`)
      // sobre una orden que HOY esta `en_reparto` (reservada para mañana, asi que no bloquea el
      // cierre). Si la aplicacion la re-aplicara, la llevaria a `entregada`.
      const legada = await e.sembrarOrden({ estatus: "en_reparto", fechaReparto: diaCR(1) });
      const gLegada = await e.tx.gestionOrden.create({
        data: { ordenId: legada.ordenId, mensajeroId: e.mensajeroId, resultado: "entregado" },
        select: { id: true },
      });

      const antes = Object.fromEntries(
        await Promise.all(Object.entries(o).map(async ([k, v]) => [k, await e.estadoDe(v.ordenId)])),
      );
      const cierreId = await e.solicitarCierreOk();
      // El incidente exige su monto de indemnizacion al aprobar (158): 0.00 es un monto valido.
      const aprobacion = await e.aprobar(cierreId, e.actorAdminSatelite, [
        { gestionId: g.incidente, monto: "0.00" },
      ]);

      const despues: Record<string, string> = {};
      const filas: Record<string, Awaited<ReturnType<typeof filasDeAplicacion>>> = {};
      for (const [k, v] of Object.entries(o)) {
        despues[k] = await e.estadoDe(v.ordenId);
        filas[k] = await filasDeAplicacion(e, v.ordenId);
      }
      return {
        antes,
        aprobacion: aprobacion.status,
        despues,
        filas,
        g,
        mensajeroId: e.mensajeroId,
        aprobadorId: e.adminSateliteId,
        legada: {
          estado: await e.estadoDe(legada.ordenId),
          historial: await e.historialDe(legada.ordenId),
          enCierre: (await e.gestionesDe(legada.ordenId)).find((x) => x.id === gLegada.id)?.cierreId,
        },
        cierreId,
        devolucion139: await e.historialDe(o.devolucion_a_origen_por_rechazo.ordenId),
      };
    });

    // R1: registrar no movio ninguna orden.
    expect(Object.values(r.antes)).toEqual(Array(5).fill("en_reparto"));
    expect(r.aprobacion).toBe("ok");

    // R7: cada una a su estado real...
    expect(r.despues.entregado).toBe("entregado");
    expect(r.despues.novedad).toBe("novedad");
    expect(r.despues.incidente).toBe("incidente");
    expect(r.despues.reprogramado).toBe("reprogramado");
    // ...y R10: la `rechazada` NO se queda en `rechazada`: la 139 la devuelve en ESTA aprobacion.
    expect(r.despues.devolucion_a_origen_por_rechazo).toBe("por_devolver_a_tienda");
    expect(r.devolucion139.map((h) => `${h.origen}->${h.destino}:${h.origenTipo}`)).toEqual([
      "en_reparto->devolucion_a_origen_por_rechazo:gestion",
      "devolucion_a_origen_por_rechazo->por_devolver_a_tienda:devolucion_rechazada",
    ]);

    // R8: UNA fila de aplicacion por orden, con su familia, su actor y la gestion enlazada.
    const una = (k: string) => {
      expect(r.filas[k], k).toHaveLength(1);
      return r.filas[k][0];
    };
    expect(una("entregado")).toMatchObject({
      origen: "en_reparto",
      destino: "entregado",
      origenTipo: "gestion",
      actorUsuarioId: r.mensajeroId,
      gestionOrdenId: r.g.entregado,
    });
    expect(una("novedad")).toMatchObject({
      origen: "en_reparto",
      destino: "novedad",
      origenTipo: "anclaje_devolucion", // D8: el reloj del plazo lee esta familia
      actorUsuarioId: r.aprobadorId, // D8: el APROBADOR
      gestionOrdenId: r.g.novedad,
    });
    expect(una("incidente")).toMatchObject({
      destino: "incidente",
      origenTipo: "incidente",
      actorUsuarioId: r.mensajeroId,
      gestionOrdenId: r.g.incidente,
    });
    expect(una("reprogramado")).toMatchObject({
      destino: "reprogramado",
      origenTipo: "gestion",
      gestionOrdenId: r.g.reprogramado,
    });

    // R14: la legada entro en el cierre (su dinero es de ese cierre) pero la orden NO se movio.
    expect(r.legada.enCierre).toBe(r.cierreId);
    expect(r.legada.estado).toBe("en_reparto");
    expect(r.legada.historial).toEqual([]);
  });

  it("R9: una orden que ya salio de `en_reparto` no se mueve, y la aprobacion sigue", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const fuera = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(fuera.ordenId, "novedad");
      // Otra via la saco de reparto antes de la aprobacion (sin pasar por el choke point: lo que se
      // mide es la GUARDA de la aplicacion, no quien la movio).
      await e.tx.orden.update({
        where: { id: fuera.ordenId },
        data: { estatusId: e.id("en_bodega_central") },
      });
      const testigo = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(testigo.ordenId, "entregado");

      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      return {
        aprobacion: aprobacion.status,
        fuera: await e.estadoDe(fuera.ordenId),
        filasFuera: await filasDeAplicacion(e, fuera.ordenId),
        testigo: await e.estadoDe(testigo.ordenId),
      };
    });

    expect(r.aprobacion).toBe("ok");
    expect(r.fuera).toBe("en_bodega_central"); // la guarda `estatus_id = en_reparto` la dejo fuera
    expect(r.filasFuera).toEqual([]);
    expect(r.testigo).toBe("entregado"); // control positivo en la MISMA aprobacion
  });

  it("R57: con dos gestiones de calle vigentes, aprobar el cierre de la VIEJA no mueve la orden", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const orden = await e.sembrarOrden({ estatus: "en_reparto" });
      const vieja = await e.gestionarOk(orden.ordenId, "novedad");
      const cierreId = await e.solicitarCierreOk();
      // La anomalia medida en produccion («dos gestiones vivas de la misma orden», 1 de 48): una
      // SEGUNDA gestion de calle vigente, mas reciente, fuera de este cierre. Se siembra directa
      // (el registro la rechazaria por R3) con su evento de registro.
      const nueva = await e.tx.gestionOrden.create({
        data: {
          ordenId: orden.ordenId,
          mensajeroId: e.mensajeroId,
          resultado: "entregado",
          createdAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      });
      await e.tx.ordenEvento.create({
        data: {
          ordenId: orden.ordenId,
          tipo: "gestion_registrada",
          gestionOrdenId: nueva.id,
          familiaAplicacion: "gestion",
          resultado: "entregado",
          mensajeroId: e.mensajeroId,
          actorUsuarioId: e.mensajeroId,
          actorRol: "mensajero",
        },
      });
      const aprobacion = await e.aprobar(cierreId);
      return {
        vieja,
        aprobacion: aprobacion.status,
        estado: await e.estadoDe(orden.ordenId),
        filas: await filasDeAplicacion(e, orden.ordenId),
      };
    });

    expect(r.aprobacion).toBe("ok"); // R9: la aprobacion continua sin error
    expect(r.estado).toBe("en_reparto"); // la vieja ya no es la vigente mas reciente
    expect(r.filas).toEqual([]);
  });

  it("R14/R57: una gestion LEGADA mas reciente NO le roba la aplicacion a la de calle", async () => {
    // La recencia se mide SOLO entre gestiones de calle (con evento de registro): una legada —que
    // ya transiciono al registrarse— no compite. Si compitiera, la gestion nueva de este cierre
    // dejaria de ser «la mas reciente» y la orden se quedaria `en_reparto` para siempre.
    const r = await conEscenario(mundo, async (e) => {
      const orden = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(orden.ordenId, "entregado");
      const cierreId = await e.solicitarCierreOk();
      await e.tx.gestionOrden.create({
        data: {
          ordenId: orden.ordenId,
          mensajeroId: e.mensajeroId,
          resultado: "reprogramado",
          createdAt: new Date(Date.now() + 60_000),
        },
      });
      const aprobacion = await e.aprobar(cierreId);
      return { aprobacion: aprobacion.status, estado: await e.estadoDe(orden.ordenId) };
    });

    expect(r.aprobacion).toBe("ok");
    expect(r.estado).toBe("entregado");
  });

  it("R12: re-aprobar el mismo cierre no aplica otra vez ni escribe historial", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const orden = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(orden.ordenId, "novedad");
      const cierreId = await e.solicitarCierreOk();
      const primera = await e.aprobar(cierreId);
      const filasTras1 = (await e.historialDe(orden.ordenId)).length;
      const segunda = await e.aprobar(cierreId);
      return {
        primera: primera.status,
        segunda: segunda.status,
        filasTras1,
        filasTras2: (await e.historialDe(orden.ordenId)).length,
        estado: await e.estadoDe(orden.ordenId),
      };
    });

    expect(r.primera).toBe("ok");
    expect(r.segunda).toBe("conflict");
    expect(r.estado).toBe("novedad");
    expect(r.filasTras1).toBe(1);
    expect(r.filasTras2).toBe(r.filasTras1);
  });

  it("R11: si un paso POSTERIOR de la aprobacion falla, no queda nada de la aplicacion", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const orden = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(orden.ordenId, "novedad");
      const cierreId = await e.solicitarCierreOk();
      // Los servicios REALES sobre un cliente cuyo `$transaction` abre un SAVEPOINT de verdad y cuyo
      // ULTIMO paso de la aprobacion (el registro de la decision, ficha 362) revienta. La aplicacion
      // ya corrio para entonces: si no fuera atomica, la orden quedaria `devuelta`.
      const rota = montarServicios(clienteConSavepoint(e.tx, true));
      const alcance = { destinoTipo: "bodega_satelite" as const, destinoZonaId: e.zonaSateliteId };
      const confirmacion = await e.confirmacionDe(cierreId, alcance);
      let error: unknown = null;
      try {
        await rota.cierresAdmin.aprobarCierre(cierreId, e.actorAdminSatelite, [], confirmacion);
      } catch (err) {
        error = err;
      }
      const cierre = await e.tx.cierreDia.findUniqueOrThrow({
        where: { id: cierreId },
        select: { estado: true },
      });
      return {
        error,
        estado: await e.estadoDe(orden.ordenId),
        historial: await e.historialDe(orden.ordenId),
        cierre: cierre.estado,
        movimientos: await e.tx.walletMovimiento.count({ where: { origenId: cierreId } }),
      };
    });

    expect(r.error).not.toBeNull(); // el fallo se propago (no se trago)
    expect(r.estado).toBe("en_reparto");
    expect(r.historial).toEqual([]);
    expect(r.cierre).toBe("solicitado");
    expect(r.movimientos).toBe(0);
  });

  it("R13: rechazar el cierre no mueve ninguna orden; la gestion sigue pendiente", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const orden = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(orden.ordenId, "entregado");
      const cierreId = await e.solicitarCierreOk();
      const rechazo = await e.rechazar(cierreId);
      return {
        rechazo: rechazo.status,
        estado: await e.estadoDe(orden.ordenId),
        historial: await e.historialDe(orden.ordenId),
      };
    });

    expect(r.rechazo).toBe("ok");
    expect(r.estado).toBe("en_reparto");
    expect(r.historial).toEqual([]);
  });
});
