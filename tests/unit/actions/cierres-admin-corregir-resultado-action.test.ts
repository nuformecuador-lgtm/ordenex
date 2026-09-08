import { describe, it, expect, vi } from "vitest";

import { corregirResultadoGestion } from "@/lib/actions/cierres-admin";
import type { ICierresAdminService } from "@/lib/interfaces/services/ICierresAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// 💰 FICHA 398 (T3.3) — EL BORDE de la correccion en sitio, como Server Action.
//
// QUE DECIDE ESTE BORDE Y QUE NO. Decide DOS cosas: que no hay sesion (`unauthenticated`) y que la
// FORMA es la del contrato (`validation_error` de zod, incluido el `.strict()` que rechaza un
// `nuevoResultado` colado). Todo lo demas —el rol, el alcance, el estado del cierre y el resultado
// vigente— lo decide el servicio, que es el unico que puede mirar la base. Un borde que decidiera
// el rol tendria una segunda tabla de permisos.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const GESTION = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const MOTIVO = "el cliente rechazo el paquete";

const TOTALES = {
  efectivo: "6000.00",
  simpe: "4000.00",
  transferencia: "0.00",
  general: "10000.00",
};

function fakeService() {
  return {
    corregirResultadoGestion: vi.fn(async () => ({
      status: "ok" as const,
      gestionId: GESTION,
      totales: TOTALES,
    })),
  } as unknown as ICierresAdminService;
}

describe("398/T3.3 — la Server Action de la correccion del resultado", () => {
  it("sin sesion es `unauthenticated` y el servicio NO se toca", async () => {
    const service = fakeService();
    const r = await corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.corregirResultadoGestion).not.toHaveBeenCalled();
  });

  it("con sesion, delega en el servicio con el payload PARSEADO y el actor", async () => {
    const service = fakeService();
    const r = await corregirResultadoGestion(
      { gestionId: GESTION, motivo: `  ${MOTIVO}  ` },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "ok", gestionId: GESTION, totales: TOTALES });
    expect(service.corregirResultadoGestion).toHaveBeenCalledTimes(1);
    // Lo que llega al servicio es la salida de zod (motivo RECORTADO), no el input crudo.
    expect(vi.mocked(service.corregirResultadoGestion).mock.calls[0]).toEqual([
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    ]);
  });

  it("⭑ un `nuevoResultado` colado es `validation_error` y el servicio NO se toca", async () => {
    // El caso que sostiene el contrato de la ficha: esta correccion concede UNA pareja. Si el
    // destino llegara desde el cliente, quedarian abiertas las demas por accidente.
    const service = fakeService();
    const r = await corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO, nuevoResultado: "devuelta" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.corregirResultadoGestion).not.toHaveBeenCalled();
  });

  it.each([
    ["gestionId no uuid", { gestionId: "g-1", motivo: MOTIVO }],
    ["motivo vacio", { gestionId: GESTION, motivo: "   " }],
    ["sin motivo", { gestionId: GESTION }],
    ["sin gestionId", { motivo: MOTIVO }],
    ["payload que no es objeto", "corrige la 50337523"],
    ["payload nulo", null],
  ])("%s es `validation_error` y el servicio NO se toca", async (_nombre, input) => {
    const service = fakeService();
    const r = await corregirResultadoGestion(input, {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.corregirResultadoGestion).not.toHaveBeenCalled();
  });

  it("los cuatro desenlaces del servicio cruzan TAL CUAL, sin traducirse", async () => {
    // El borde no re-interpreta el dominio: la pantalla trata los cinco estados con el mismo
    // codigo que ya tiene para la correccion del desglose.
    for (const salida of [
      { status: "forbidden" as const },
      { status: "no_encontrada" as const },
      { status: "conflict" as const },
      { status: "validation_error" as const, fieldErrors: { motivo: ["x"] } },
    ]) {
      const service = {
        corregirResultadoGestion: vi.fn(async () => salida),
      } as unknown as ICierresAdminService;
      const r = await corregirResultadoGestion(
        { gestionId: GESTION, motivo: MOTIVO },
        { service, getActor: async () => MAESTRO },
      );
      expect(r).toEqual(salida);
    }
  });

  it("💰 R14: los totales viajan como STRING de escala 2, jamas como `number`", async () => {
    const service = fakeService();
    const r = await corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    const totales = (r as unknown as { totales: Record<string, unknown> }).totales;
    for (const [clave, valor] of Object.entries(totales)) {
      expect(typeof valor, `${clave} no es string`).toBe("string");
      expect(valor as string, `${clave} no tiene escala 2`).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});
