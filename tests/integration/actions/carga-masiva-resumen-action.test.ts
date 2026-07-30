import { describe, it, expect, vi } from "vitest";
import { resumenCargaMasiva } from "@/lib/actions/carga-masiva-resumen";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IResumenCargaMasivaService } from "@/lib/interfaces/services/IResumenCargaMasivaService";

// Feature 16 / 159 R22(g) — el borde (Server Action) del resumen del lote:
// autenticacion, validacion de entrada y traduccion del rechazo por rol.
//
// Procedencia: estos casos vivian en `tests/integration/actions/mensajeros-action.test.ts`,
// que la feature 159 borro entero. Se recuperan los tres del resumen
// (`unauthenticated` / `validation_error` / `ok` + `forbidden`) y se descartan los de
// las otras dos acciones, que ya no existen (design.md §7).

const ACTOR: Actor = { usuarioId: "store1", rol: "adminTienda" };
const getActor = async (): Promise<Actor | null> => ACTOR;
const noActor = async (): Promise<Actor | null> => null;

function fakeService(
  overrides: Partial<IResumenCargaMasivaService> = {},
): IResumenCargaMasivaService {
  return {
    resumenCargaMasiva: vi.fn().mockResolvedValue({ status: "ok", ordenes: [] }),
    ...overrides,
  };
}

describe("R4/R17: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("resumenCargaMasiva", async () => {
    const service = fakeService();
    const r = await resumenCargaMasiva(
      { numRemisiones: ["REM-1"] },
      { resumenService: service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.resumenCargaMasiva).not.toHaveBeenCalled();
  });
});

describe("R22(g): rol no autorizado -> forbidden propagado del service (R5/R11)", () => {
  it("resumenCargaMasiva forbidden", async () => {
    const service = fakeService({
      resumenCargaMasiva: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await resumenCargaMasiva(
      { numRemisiones: ["REM-1"] },
      { resumenService: service, getActor },
    );
    expect(r.status).toBe("forbidden");
  });
});

describe("R19: input invalido -> validation_error sin llamar al service", () => {
  it("resumenCargaMasiva con numRemisiones vacio", async () => {
    const service = fakeService();
    const r = await resumenCargaMasiva(
      { numRemisiones: [] },
      { resumenService: service, getActor },
    );
    expect(r.status).toBe("validation_error");
    expect(service.resumenCargaMasiva).not.toHaveBeenCalled();
  });

  it("resumenCargaMasiva con una remision vacia en la lista", async () => {
    const service = fakeService();
    const r = await resumenCargaMasiva(
      { numRemisiones: [""] },
      { resumenService: service, getActor },
    );
    expect(r.status).toBe("validation_error");
    expect(service.resumenCargaMasiva).not.toHaveBeenCalled();
  });
});

describe("exito: propaga el resultado del service sin filtrar internals", () => {
  it("resumenCargaMasiva ok", async () => {
    const service = fakeService({
      resumenCargaMasiva: vi.fn().mockResolvedValue({
        status: "ok",
        ordenes: [
          {
            id: "ord-1",
            numGuia: 1,
            numRemision: "REM-1",
            destinatario: "Ana",
            telefonoDest: "099",
            producto: "Caja",
            montoCobrar: null,
            direccion: null,
            zonaId: "z1",
            zonaNombre: "Norte",
          },
        ],
      }),
    });
    const r = await resumenCargaMasiva(
      { numRemisiones: ["REM-1"] },
      { resumenService: service, getActor },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.ordenes).toHaveLength(1);
      expect(r.ordenes[0]).not.toHaveProperty("deletedAt");
    }
    expect(service.resumenCargaMasiva).toHaveBeenCalledWith({ numRemisiones: ["REM-1"] }, ACTOR);
  });
});
