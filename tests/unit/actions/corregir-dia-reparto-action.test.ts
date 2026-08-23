import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import { corregirDiaReparto } from "@/lib/actions/corregir-dia-reparto";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICorreccionDiaRepartoService } from "@/lib/interfaces/services/ICorreccionDiaRepartoService";

// FEATURE 262 (B7) — EL BORDE de «corregir el dia de reparto»: sesion + zod + delegacion.
//
// Lo que se prueba aqui es EL BORDE y solo el borde. La logica de negocio (rol, zona, estados) vive
// en `tests/unit/services/correccion-dia-reparto.test.ts`, y el `WHERE` en el de integracion.

const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const OTRA_ORDEN = "22222222-2222-4222-8222-222222222222";
const MOTIVO = "la bodega marco el lote para el dia siguiente por error";
const MAESTRO: Actor = { usuarioId: "u-1", rol: "maestro" as RolValue };

function fakeService() {
  const corregir = vi.fn(async () => ({ status: "ok" as const, corregidas: 1, dia: "hoy" as const }));
  return { service: { corregir } as unknown as ICorreccionDiaRepartoService, corregir };
}

function deps(overrides: { actor?: Actor | null } = {}) {
  const { service, corregir } = fakeService();
  return {
    deps: {
      service,
      getActor: async () => ("actor" in overrides ? overrides.actor ?? null : MAESTRO),
    },
    corregir,
  };
}

describe("262/B7 — la sesion se resuelve ANTES de validar y de tocar nada", () => {
  it("sin sesion => `unauthenticated`, y el service NO se llama", async () => {
    const { deps: d, corregir } = deps({ actor: null });

    const r = await corregirDiaReparto(
      { ordenIds: [ORDEN_ID], dia: "hoy", motivo: MOTIVO },
      d,
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(corregir).not.toHaveBeenCalled();
  });
});

describe("262/R2 — el `dia` es OBLIGATORIO: sin `.default`, y eso es la decision D3", () => {
  it("⭑ una llamada SIN `dia` FALLA en el borde, no mueve el lote a hoy", async () => {
    // ⚠️ ESTE ES EL TEST QUE MATA M-t. Los dos schemas de ASIGNACION si tienen `.default("hoy")`
    // (246/R4) porque alli el default significa «como antes de la feature». Aqui significaria que
    // una llamada sin campo mueve el lote a HOY sin que nadie lo eligiera — y la mitad de las
    // correcciones reales son «mañana -> hoy». El campo es obligatorio.
    const { deps: d, corregir } = deps();

    const r = await corregirDiaReparto({ ordenIds: [ORDEN_ID], motivo: MOTIVO }, d);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(Object.keys(r.fieldErrors)).toContain("dia");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("R3/R56: un `dia` que no es uno de los DOS tokens falla — el pasado no es expresable", async () => {
    // No hay ningun `if (fecha < hoy)` que relajar: el contrato solo admite «hoy» y «manana». Una
    // fecha, un desplazamiento o un tercer valor mueren aqui.
    const { deps: d, corregir } = deps();
    for (const dia of ["2026-08-20", "ayer", "pasado_manana", -1, null]) {
      const r = await corregirDiaReparto({ ordenIds: [ORDEN_ID], dia, motivo: MOTIVO }, d);
      expect(r.status, `«${String(dia)}» deberia morir en el borde`).toBe("validation_error");
    }
    expect(corregir).not.toHaveBeenCalled();
  });

  it("los dos tokens validos SI pasan y llegan al service tal cual", async () => {
    for (const dia of ["hoy", "manana"] as const) {
      const { deps: d, corregir } = deps();
      const r = await corregirDiaReparto({ ordenIds: [ORDEN_ID], dia, motivo: MOTIVO }, d);
      expect(r.status).toBe("ok");
      expect(corregir).toHaveBeenCalledWith(
        { ordenIds: [ORDEN_ID], dia, motivo: MOTIVO },
        MAESTRO,
      );
    }
  });
});

describe("262/R21 — el motivo es obligatorio y se valida EN EL BORDE", () => {
  it("un motivo de SOLO ESPACIOS falla por `min(10)` DESPUES del `trim`", async () => {
    const { deps: d, corregir } = deps();

    const r = await corregirDiaReparto(
      { ordenIds: [ORDEN_ID], dia: "hoy", motivo: "              " },
      d,
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(Object.keys(r.fieldErrors)).toContain("motivo");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("un motivo corto falla, y uno de mas de 300 tambien", async () => {
    const { deps: d } = deps();
    expect((await corregirDiaReparto({ ordenIds: [ORDEN_ID], dia: "hoy", motivo: "corto" }, d)).status).toBe(
      "validation_error",
    );
    expect(
      (await corregirDiaReparto({ ordenIds: [ORDEN_ID], dia: "hoy", motivo: "x".repeat(301) }, d))
        .status,
    ).toBe("validation_error");
  });

  it("el motivo llega al service YA RECORTADO (es lo que queda escrito en el rastro)", async () => {
    const { deps: d, corregir } = deps();

    await corregirDiaReparto({ ordenIds: [ORDEN_ID], dia: "hoy", motivo: `   ${MOTIVO}   ` }, d);

    expect(corregir).toHaveBeenCalledWith(
      { ordenIds: [ORDEN_ID], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
    );
  });
});

describe("262/B7 — el lote y sus identificadores", () => {
  it("un lote VACIO falla en el borde", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirDiaReparto({ ordenIds: [], dia: "hoy", motivo: MOTIVO }, d);
    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("un identificador que no es uuid falla en el borde", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirDiaReparto({ ordenIds: ["no-soy-un-uuid"], dia: "hoy", motivo: MOTIVO }, d);
    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("un lote de varios uuid pasa entero", async () => {
    const { deps: d, corregir } = deps();
    const r = await corregirDiaReparto(
      { ordenIds: [ORDEN_ID, OTRA_ORDEN], dia: "manana", motivo: MOTIVO },
      d,
    );
    expect(r.status).toBe("ok");
    expect(corregir).toHaveBeenCalledWith(
      { ordenIds: [ORDEN_ID, OTRA_ORDEN], dia: "manana", motivo: MOTIVO },
      MAESTRO,
    );
  });
});

describe("262/B7 — el borde NO decide nada de negocio: devuelve lo que el service dijo", () => {
  it.each([
    [{ status: "forbidden" as const }],
    [{ status: "sin_zona" as const }],
    [{ status: "conflict" as const, detalle: [{ ordenId: ORDEN_ID, motivo: "orden borrada" }] }],
  ])("propaga %j tal cual", async (resultado) => {
    const corregir = vi.fn(async () => resultado);
    const r = await corregirDiaReparto(
      { ordenIds: [ORDEN_ID], dia: "hoy", motivo: MOTIVO },
      {
        service: { corregir } as unknown as ICorreccionDiaRepartoService,
        getActor: async () => MAESTRO,
      },
    );
    expect(r).toEqual(resultado);
  });
});
