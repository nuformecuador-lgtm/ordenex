import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import type { EntradaLineaPublica } from "@/lib/types/rastreo-publico";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../454/_escenario";

/**
 * FICHA 455 (2026-09-24, recorrido T3.2 F9) — EL TRAMO RETIRADO Y LA GESTION PENDIENTE DEL MISMO
 * INSTANTE, contra Postgres real y por el servicio y el repositorio reales.
 *
 * El caso medido en el recorrido (guia 990012): antes de la 454, registrar una gestion movia la orden a
 * `devolucion_por_confirmar`; la migracion 454 la devolvio a `en_reparto` DESPUES (fila nueva, fecha de
 * la migracion) y la gestion quedo PENDIENTE de confirmar. El rastreo publicaba:
 *   «En reparto» · «Novedad» (la fila retirada plegada, R34) · «En reparto» (la migracion) ·
 *   «Novedad · pendiente de confirmación» (la gestion, con la fecha de la fila retirada)
 * — la misma gestion dos veces, la ultima entrada con fecha ANTERIOR a la penultima, y en la pagina
 * dos hijos con la misma clave `Novedad-<fecha>`.
 *
 * Invariante: mientras la gestion siga pendiente, la fila retirada del MISMO instante no se publica
 * (la entrada pendiente la sustituye), la racha de «En reparto» se funde, la linea queda en orden
 * cronologico y sin dos entradas con el mismo nombre, fecha y marca. Sin gestion pendiente (anulada),
 * la fila retirada vuelve a verse como «Novedad» (R34): el descarte es CONDICIONAL.
 *
 * Mutacion registrada en `progress/impl_455_fix.md`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const TELEFONO = "88880000";
const HORA = 3600_000;

const clave = (e: EntradaLineaPublica) => `${e.nombre}|${e.fecha}|${e.pendiente === true ? "p" : "c"}`;

describeSiHayBase("455/F9 — rastreo: tramo retirado y gestion pendiente del mismo instante (Postgres real)", () => {
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

      await e.asegurarRetirados();
      const ahora = Date.now();
      const o = await e.sembrarOrden({ estatus: "en_reparto" });
      // 1) salio a reparto.
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: o.ordenId,
          estatusDestinoId: e.id("en_reparto"),
          origenTipo: "asignacion_satelite",
          createdAt: new Date(ahora - 3 * HORA),
        },
      });
      // 2) la gestion (hoy pendiente), llevada al instante de la era anterior a la 454.
      const gestionId = await e.gestionarOk(o.ordenId, "novedad");
      const instanteGestion = new Date(ahora - 2 * HORA);
      await e.tx.gestionOrden.update({ where: { id: gestionId }, data: { createdAt: instanteGestion } });
      // 3) la fila que la era anterior escribia al registrar esa gestion: el estado RETIRADO.
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: o.ordenId,
          estatusOrigenId: e.id("en_reparto"),
          estatusDestinoId: e.id("devolucion_por_confirmar"),
          origenTipo: "gestion",
          gestionOrdenId: gestionId,
          createdAt: instanteGestion,
        },
      });
      // 4) la migracion 454 devuelve la orden a `en_reparto`, DESPUES.
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: o.ordenId,
          estatusOrigenId: e.id("devolucion_por_confirmar"),
          estatusDestinoId: e.id("en_reparto"),
          origenTipo: "ajuste_estado",
          motivo: "migracion 454: retiro de devolucion_por_confirmar",
          createdAt: new Date(ahora - 1 * HORA),
        },
      });
      const conPendiente = await consultar(o.numGuia);
      const estado = await e.estadoDe(o.ordenId);

      // Control: sin gestion pendiente (se anula), la fila retirada se vuelve a publicar (R34).
      const deshacer = await e.s.cierreDia.deshacerGestion(gestionId, e.actorMensajero);
      const sinPendiente = await consultar(o.numGuia);

      return { conPendiente, sinPendiente, estado, deshacer: deshacer.status };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("precondiciones: la orden sigue `en_reparto` y el deshacer ocurre", () => {
    expect(r.estado).toBe("en_reparto");
    expect(r.deshacer).toBe("ok");
    expect(r.sinPendiente.linea.length).toBeGreaterThan(0);
  });

  it("F9: la gestion sale UNA vez, como pendiente, y la racha de «En reparto» se funde", () => {
    expect(r.conPendiente.linea.map((l) => [l.nombre, l.pendiente === true])).toEqual([
      ["En reparto", false],
      ["Novedad", true],
    ]);
    expect(r.conPendiente.nombreVigente).toBe("Novedad");
  });

  it("F9: la linea queda en orden cronologico", () => {
    const fechas = r.conPendiente.linea.map((l) => Date.parse(l.fecha));
    expect(fechas.every((f) => !Number.isNaN(f))).toBe(true);
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it("F9: ninguna entrada se repite (nombre, fecha y marca): la pagina no puede duplicar claves", () => {
    const claves = r.conPendiente.linea.map(clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("control (R34): sin gestion pendiente, la fila retirada se publica como «Novedad»", () => {
    expect(r.sinPendiente.linea.map((l) => l.nombre)).toEqual(["En reparto", "Novedad", "En reparto"]);
    expect(r.sinPendiente.linea.some((l) => l.pendiente === true)).toBe(false);
  });
});
