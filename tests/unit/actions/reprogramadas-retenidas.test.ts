import { describe, it, expect, vi } from "vitest";

import { resumenReprogramadasRetenidasCentral } from "@/lib/actions/reprogramadas-retenidas";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ResumenRetenidas } from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// FICHA 462 (T2.10, R36/R37/R38/R44) — LA LECTURA DE LA FRANJA DE `/ordenes`, con dobles.
//
// Lo que se afirma: quien puede (maestro y admin) recibe `ok` con el resumen YA recortado al ambito
// central; el `adminTienda` recibe `forbidden` sin que se consulte nada (mutacion 13 del design:
// quitar `esAccesoTotal` => ROJO); sin sesion, `unauthenticated`; y el «hoy» se resuelve EN EL
// SERVIDOR con el reloj inyectado, en la convencion `@db.Date`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin", zonaId: null };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda", zonaId: null };
const MENSAJERO: Actor = { usuarioId: "u-men", rol: "mensajero", zonaId: "z-sat" };
const SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: "z-sat" };

/** 07:00 CR del 25/09/2026 = 13:00Z. */
const AHORA = new Date("2026-09-25T13:00:00.000Z");

/** Un resumen con lo central Y lo de una zona satelite mezclados, como lo devuelve el servicio. */
const RESUMEN_MEZCLADO: ResumenRetenidas = {
  diaCR: "2026-09-25",
  total: 5,
  porForma: { reprogramado: 3, enReparto: 2 },
  cierres: [
    { cierreId: "c-central", mensajeroId: "m1", mensajeroNombre: "Ana", estado: "solicitado", jornadaCR: "2026-09-24", ambito: { tipo: "central" }, cuantas: 2 },
    { cierreId: "c-sat", mensajeroId: "m2", mensajeroNombre: "Sat", estado: "vencido", jornadaCR: null, ambito: { tipo: "zona", zonaId: "z-sat" }, cuantas: 1 },
  ],
  sinCierre: [
    { mensajeroId: "m3", mensajeroNombre: "Beto", ambito: { tipo: "central" }, cuantas: 1 },
    { mensajeroId: "m4", mensajeroNombre: "Zona", ambito: { tipo: "zona", zonaId: "z-sat" }, cuantas: 1 },
  ],
};

function servicioDoble(resumen: ResumenRetenidas = RESUMEN_MEZCLADO) {
  return { resumen: vi.fn<(hoyCR: Date) => Promise<ResumenRetenidas>>(async () => resumen) };
}

describe("462/R36 — solo el acceso total lee la franja", () => {
  it("maestro y admin -> `ok`, y el servicio se consulta UNA vez por lectura", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const service = servicioDoble();
      const r = await resumenReprogramadasRetenidasCentral({ service, getActor: async () => actor, now: () => AHORA });
      expect(r.status).toBe("ok");
      expect(service.resumen).toHaveBeenCalledTimes(1);
    }
  });

  it("⭑ adminTienda -> `forbidden` SIN consultar nada (mutacion 13: quitar `esAccesoTotal` => ROJO)", async () => {
    const service = servicioDoble();
    const r = await resumenReprogramadasRetenidasCentral({ service, getActor: async () => TIENDA, now: () => AHORA });
    expect(r).toEqual({ status: "forbidden" });
    expect(service.resumen).not.toHaveBeenCalled();
  });

  it("mensajero y adminSatelite tampoco ganan acceso por esta ficha: `forbidden`, sin consultar", async () => {
    for (const actor of [MENSAJERO, SATELITE]) {
      const service = servicioDoble();
      const r = await resumenReprogramadasRetenidasCentral({ service, getActor: async () => actor, now: () => AHORA });
      expect(r).toEqual({ status: "forbidden" });
      expect(service.resumen).not.toHaveBeenCalled();
    }
  });

  it("sin sesion -> `unauthenticated`, sin consultar", async () => {
    const service = servicioDoble();
    const r = await resumenReprogramadasRetenidasCentral({ service, getActor: async () => null, now: () => AHORA });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.resumen).not.toHaveBeenCalled();
  });
});

describe("462/R44 — el resultado viene RECORTADO al ambito central", () => {
  it("⭑ ni un cierre ni un grupo «sin cierre» de la zona satelite cruzan; el total es el del recorte", async () => {
    const r = await resumenReprogramadasRetenidasCentral({ service: servicioDoble(), getActor: async () => ADMIN, now: () => AHORA });
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(r.resumen.cierres.map((c) => c.cierreId)).toEqual(["c-central"]);
    expect(r.resumen.sinCierre.map((m) => m.mensajeroId)).toEqual(["m3"]);
    expect(r.resumen.total).toBe(3); // 2 + 1, NO los 5 del sistema (R6)
    expect(r.resumen.diaCR).toBe("2026-09-25");
    // Y nada del satelite en TODO el objeto (ni el id del cierre, ni el nombre de su mensajero).
    expect(JSON.stringify(r.resumen)).not.toContain("c-sat");
    expect(JSON.stringify(r.resumen)).not.toContain("z-sat");
  });

  it("R35: sin retenidas en el central, `ok` con total 0 y listas vacias (la franja no se pinta)", async () => {
    const soloSatelite: ResumenRetenidas = {
      ...RESUMEN_MEZCLADO,
      total: 2,
      cierres: RESUMEN_MEZCLADO.cierres.filter((c) => c.ambito.tipo === "zona"),
      sinCierre: RESUMEN_MEZCLADO.sinCierre.filter((m) => m.ambito.tipo === "zona"),
    };
    const r = await resumenReprogramadasRetenidasCentral({ service: servicioDoble(soloSatelite), getActor: async () => MAESTRO, now: () => AHORA });
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.resumen.total).toBe(0);
    expect(r.resumen.cierres).toEqual([]);
    expect(r.resumen.sinCierre).toEqual([]);
  });
});

describe("462/R38 — el dia CR se resuelve en el SERVIDOR, en la convencion @db.Date", () => {
  it("con el reloj a las 07:00 CR del 25/09, el servicio recibe la medianoche UTC del 25/09", async () => {
    const service = servicioDoble();
    await resumenReprogramadasRetenidasCentral({ service, getActor: async () => ADMIN, now: () => AHORA });
    expect(service.resumen.mock.calls[0][0].toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("a las 19:00 CR del 25/09 (01:00Z del 26) sigue siendo el 25: no se usa `toISOString().slice`", async () => {
    const service = servicioDoble();
    await resumenReprogramadasRetenidasCentral({ service, getActor: async () => ADMIN, now: () => new Date("2026-09-26T01:00:00.000Z") });
    expect(service.resumen.mock.calls[0][0].toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });
});

describe("462/R8/R37 — la accion es de solo lectura y sin zod porque no hay entrada", () => {
  it("el fuente no escribe ni encola nada, y autoriza con `esAccesoTotal`", () => {
    const codigo = codigoSinComentarios("lib/actions/reprogramadas-retenidas.ts");
    for (const verbo of [".update(", ".create(", ".delete(", ".upsert(", "$executeRaw", "encolar", "enqueue"]) {
      expect(codigo, `la accion contiene ${verbo}`).not.toContain(verbo);
    }
    expect(codigo).toContain("esAccesoTotal(actor.rol)");
    expect(codigo).toContain('recortarPorAmbito(resumen, { tipo: "central" })');
    expect(codigo).toContain("buildReprogramadasRetenidasService(");
  });
});
