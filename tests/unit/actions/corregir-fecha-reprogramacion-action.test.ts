import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import { corregirFechaReprogramacion } from "@/lib/actions/corregir-fecha-reprogramacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICorreccionFechaReprogramacionService } from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";
import { fechaCalendarioCR, mananaCalendarioCR } from "@/lib/utils/fecha-cr";

// FICHA 371 — EL BORDE de «corregir la fecha de una reprogramacion»: sesion + zod + delegacion.
//
// Lo que se prueba aqui es EL BORDE y solo el borde. La logica de negocio (rol, ventana de estado,
// desenlace de la liberacion) vive en `tests/unit/services/correccion-fecha-reprogramacion.test.ts`
// y el `WHERE` en `tests/integration/db/correccion-fecha-reprogramacion.int.test.ts`.
//
// ⚠️ LAS FECHAS DE ESTE ARCHIVO SALEN DEL RELOJ REAL (`fechaCalendarioCR()`), no de literales: el
// borde valida con el reloj del proceso y una constante escrita a mano caducaria al dia siguiente.

const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const MOTIVO = "se cambio la ruta para manana";
const MAESTRO: Actor = { usuarioId: "u-1", rol: "maestro" as RolValue };

const HOY = fechaCalendarioCR();
const MANANA = mananaCalendarioCR();
const AYER = fechaCalendarioCR(new Date(Date.now() - 24 * 60 * 60 * 1000));

function deps(overrides: { actor?: Actor | null } = {}) {
  const corregir = vi.fn(async () => ({
    status: "ok" as const,
    ordenId: ORDEN_ID,
    gestionId: "g-1",
    fechaAnterior: "2026-09-04",
    fechaNueva: HOY,
    liberacion: "liberada" as const,
  }));
  return {
    deps: {
      service: { corregir } as unknown as ICorreccionFechaReprogramacionService,
      getActor: async () => ("actor" in overrides ? (overrides.actor ?? null) : MAESTRO),
    },
    corregir,
  };
}

describe("371 — la sesion se resuelve ANTES de validar y de tocar nada", () => {
  it("sin sesion => `unauthenticated`, y el service NO se llama", async () => {
    const { deps: d, corregir } = deps({ actor: null });

    const r = await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: MOTIVO },
      d,
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(corregir).not.toHaveBeenCalled();
  });
});

describe("371 — el borde de la FECHA admite HOY (y ahi esta la ficha entera)", () => {
  it("⭑ HOY pasa el borde: es el caso real que la origina", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: MOTIVO },
      d,
    );
    expect(r).toMatchObject({ status: "ok" });
    expect(corregir).toHaveBeenCalledWith(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: MOTIVO },
      MAESTRO,
    );
  });

  it("mañana tambien", async () => {
    const { deps: d, corregir } = deps();
    await corregirFechaReprogramacion({ ordenId: ORDEN_ID, fecha: MANANA, motivo: MOTIVO }, d);
    expect(corregir).toHaveBeenCalledWith(expect.objectContaining({ fecha: MANANA }), MAESTRO);
  });

  it.each([
    ["ayer", () => AYER],
    ["un dia inexistente", () => "2026-02-31"],
    ["otro formato", () => "02/09/2026"],
    ["vacia", () => ""],
  ])("%s muere en el borde, sin construir el service", async (_nombre, fecha) => {
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: fecha(), motivo: MOTIVO },
      d,
    );
    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("sin `fecha` falla: no hay default que mueva la orden a un dia que nadie eligio", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion({ ordenId: ORDEN_ID, motivo: MOTIVO }, d);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(Object.keys(r.fieldErrors)).toContain("fecha");
    expect(corregir).not.toHaveBeenCalled();
  });
});

describe("371 — el MOTIVO es obligatorio, con la MISMA regla que reprogramar", () => {
  it.each([
    ["ausente", undefined],
    ["vacio", ""],
    ["en blanco", "   "],
  ])("motivo %s => `validation_error` y el service NO se llama", async (_nombre, motivo) => {
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion({ ordenId: ORDEN_ID, fecha: HOY, motivo }, d);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(Object.keys(r.fieldErrors)).toContain("motivo");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("⭑ un motivo corto VALE: la regla es `motivoSchema`, no el min(10) de la 262", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: "dia mal" },
      d,
    );
    expect(r).toMatchObject({ status: "ok" });
    expect(corregir).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: "dia mal" }),
      MAESTRO,
    );
  });

  it("el motivo llega RECORTADO al service", async () => {
    const { deps: d, corregir } = deps();
    await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: `  ${MOTIVO}  ` },
      d,
    );
    expect(corregir).toHaveBeenCalledWith(expect.objectContaining({ motivo: MOTIVO }), MAESTRO);
  });
});

describe("371 — el resto del borde", () => {
  it("un `ordenId` que no es uuid muere aqui", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion({ ordenId: "o-1", fecha: HOY, motivo: MOTIVO }, d);
    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("⭑ una clave desconocida es `validation_error`, no un descarte mudo (`.strict()`)", async () => {
    // Leccion de la 352: un campo que se ignora en silencio le enseña al usuario un resultado que
    // no es el que pidio. Aqui, ademas, podria ser alguien intentando colar `ordenIds` en plural.
    const { deps: d, corregir } = deps();
    const r = await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: MOTIVO, liberar: true },
      d,
    );
    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("el resultado del service cruza TAL CUAL, con su discriminante de liberacion", async () => {
    const corregir = vi.fn(async () => ({
      status: "ok" as const,
      ordenId: ORDEN_ID,
      gestionId: "g-1",
      fechaAnterior: "2026-09-04",
      fechaNueva: HOY,
      liberacion: "espera_cierre" as const,
    }));
    const r = await corregirFechaReprogramacion(
      { ordenId: ORDEN_ID, fecha: HOY, motivo: MOTIVO },
      {
        service: { corregir } as unknown as ICorreccionFechaReprogramacionService,
        getActor: async () => MAESTRO,
      },
    );
    // La pantalla necesita este campo para no dejar al coordinador mirando una orden quieta.
    expect(r).toMatchObject({ status: "ok", liberacion: "espera_cierre" });
  });
});
