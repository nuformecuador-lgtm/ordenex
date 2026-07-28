import { describe, it, expect, vi } from "vitest";
import { deshacerAsignacion } from "@/lib/actions/deshacer-asignacion";
import type {
  DeshacerAsignacionInput,
  IDeshacerAsignacionService,
} from "@/lib/interfaces/services/IDeshacerAsignacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 149 — T4.11 (R7/R22/R24): el BORDE. El motivo es obligatorio y se valida con zod
// ANTES de construir el service; sin sesion se responde `unauthenticated` sin tocar dato alguno.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const ORDEN_ID_2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e";

function deps(opts: { actor?: Actor | null } = {}) {
  const deshacer = vi.fn(async (_input: DeshacerAsignacionInput, _actor: Actor) => ({
    status: "ok" as const,
    resultados: [],
  }));
  const service: IDeshacerAsignacionService = { deshacer };
  return {
    deshacer,
    d: {
      service,
      getActor: vi.fn(async () => (opts.actor === undefined ? MAESTRO : opts.actor)),
    },
  };
}

describe("R7 — sin sesion", () => {
  it("responde unauthenticated sin construir ni invocar el service", async () => {
    const { d, deshacer } = deps({ actor: null });
    const r = await deshacerAsignacion({ ordenIds: [ORDEN_ID], motivo: "motivo suficiente" }, d);
    expect(r).toEqual({ status: "unauthenticated" });
    expect(deshacer).not.toHaveBeenCalled();
  });

  it("la sesion se comprueba ANTES que el schema (un input invalido sin sesion sigue siendo 401)", async () => {
    const { d, deshacer } = deps({ actor: null });
    const r = await deshacerAsignacion({ ordenIds: [], motivo: "x" }, d);
    expect(r).toEqual({ status: "unauthenticated" });
    expect(deshacer).not.toHaveBeenCalled();
  });
});

describe("R22 — motivo obligatorio (10..300 tras recortar)", () => {
  it.each([
    ["ausente", undefined],
    ["vacio", ""],
    ["solo espacios", "   "],
    ["9 caracteres", "123456789"],
    ["301 caracteres", "a".repeat(301)],
  ])("motivo %s -> validation_error en el campo `motivo`, sin invocar el service", async (_n, motivo) => {
    const { d, deshacer } = deps();
    const r = await deshacerAsignacion({ ordenIds: [ORDEN_ID], motivo }, d);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toContain("motivo");
      expect(r.fieldErrors.motivo.length).toBeGreaterThan(0);
    }
    expect(deshacer).not.toHaveBeenCalled();
  });

  it.each([
    ["10 caracteres exactos", "1234567890"],
    ["300 caracteres exactos", "a".repeat(300)],
  ])("motivo de %s es VALIDO (bordes inclusivos)", async (_n, motivo) => {
    const { d, deshacer } = deps();
    const r = await deshacerAsignacion({ ordenIds: [ORDEN_ID], motivo }, d);
    expect(r.status).toBe("ok");
    expect(deshacer).toHaveBeenCalledTimes(1);
  });

  it("el motivo llega al service RECORTADO", async () => {
    const { d, deshacer } = deps();
    await deshacerAsignacion(
      { ordenIds: [ORDEN_ID], motivo: "   se asigno al mensajero equivocado   " },
      d,
    );
    const arg = deshacer.mock.calls[0][0] as unknown as DeshacerAsignacionInput;
    expect(arg.motivo).toBe("se asigno al mensajero equivocado");
  });
});

describe("R24 — UN motivo por invocacion, para todas las ordenes del lote", () => {
  it("el lote entero viaja en UNA llamada con el mismo motivo", async () => {
    const { d, deshacer } = deps();
    await deshacerAsignacion(
      { ordenIds: [ORDEN_ID, ORDEN_ID_2], motivo: "reasignacion del lote de la ruta norte" },
      d,
    );
    expect(deshacer).toHaveBeenCalledTimes(1); // no un loop por orden
    const arg = deshacer.mock.calls[0][0] as unknown as DeshacerAsignacionInput;
    expect(arg.ordenIds).toEqual([ORDEN_ID, ORDEN_ID_2]);
    expect(arg.motivo).toBe("reasignacion del lote de la ruta norte");
  });

  it("el actor viaja resuelto de la SESION, nunca del cliente", async () => {
    const { d, deshacer } = deps();
    await deshacerAsignacion(
      { ordenIds: [ORDEN_ID], motivo: "motivo suficientemente largo", actor: { rol: "maestro" } },
      d,
    );
    expect(deshacer.mock.calls[0][1]).toEqual(MAESTRO);
  });
});

describe("borde — forma del input", () => {
  it.each([
    ["lote vacio", { ordenIds: [], motivo: "motivo suficientemente largo" }],
    ["ordenId no uuid", { ordenIds: ["no-es-uuid"], motivo: "motivo suficientemente largo" }],
    ["ordenIds ausente", { motivo: "motivo suficientemente largo" }],
  ])("%s -> validation_error sin invocar el service", async (_n, input) => {
    const { d, deshacer } = deps();
    const r = await deshacerAsignacion(input, d);
    expect(r.status).toBe("validation_error");
    expect(deshacer).not.toHaveBeenCalled();
  });

  it("los resultados de dominio del service se devuelven tal cual", async () => {
    const deshacer = vi.fn(async (_input: DeshacerAsignacionInput, _actor: Actor) => ({
      status: "conflict" as const,
      detalle: [{ ordenId: ORDEN_ID, motivo: "orden borrada" }],
    }));
    const r = await deshacerAsignacion(
      { ordenIds: [ORDEN_ID], motivo: "motivo suficientemente largo" },
      { service: { deshacer }, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: ORDEN_ID, motivo: "orden borrada" }],
    });
  });
});
