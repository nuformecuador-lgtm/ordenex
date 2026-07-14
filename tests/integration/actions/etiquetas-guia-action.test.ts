import { describe, it, expect, vi } from "vitest";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEtiquetaGuiaService } from "@/lib/interfaces/services/IEtiquetaGuiaService";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const getActor = (actor: Actor | null) => async (): Promise<Actor | null> => actor;

function fakeEtiquetaService(
  overrides: Partial<IEtiquetaGuiaService> = {},
): IEtiquetaGuiaService {
  return {
    generarEtiquetas: vi.fn().mockResolvedValue({ status: "ok", etiquetas: [], omitidas: [] }),
    ...overrides,
  };
}

describe("R14: sin sesion valida -> unauthenticated antes de tocar el service", () => {
  it("generarEtiquetas sin actor -> unauthenticated, sin llamar al service", async () => {
    const service = fakeEtiquetaService();
    const r = await generarEtiquetas(
      { ordenIds: ["o1"] },
      { etiquetaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.generarEtiquetas).not.toHaveBeenCalled();
  });
});

describe("R15: validacion de entrada (zod) -> validation_error sin tocar el service", () => {
  it("R15: lista vacia -> validation_error", async () => {
    const service = fakeEtiquetaService();
    const r = await generarEtiquetas(
      { ordenIds: [] },
      { etiquetaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.generarEtiquetas).not.toHaveBeenCalled();
  });

  it("R15: id malformado (string vacio) -> validation_error", async () => {
    const service = fakeEtiquetaService();
    const r = await generarEtiquetas(
      { ordenIds: [""] },
      { etiquetaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.generarEtiquetas).not.toHaveBeenCalled();
  });

  it("R15: ordenIds ausente / no-array -> validation_error", async () => {
    const service = fakeEtiquetaService();
    const r = await generarEtiquetas(
      { ordenIds: "no-es-array" },
      { etiquetaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.generarEtiquetas).not.toHaveBeenCalled();
  });
});

describe("generarEtiquetas — passthrough del resultado de dominio del service", () => {
  it("camino ok delega al service con el actor resuelto y devuelve su resultado tal cual", async () => {
    const service = fakeEtiquetaService({
      generarEtiquetas: vi.fn().mockResolvedValue({
        status: "ok",
        etiquetas: [
          {
            ordenId: "o1",
            numGuia: 501,
            numRemision: "REM-1",
            destinatario: "Juan Perez",
            telefonoDest: "0999999999",
            direccion: "Av. 1",
            producto: "Caja",
            montoCobrar: 25.5,
            tiendaNombre: "Tienda Uno",
            zonaNombre: "GAM",
            provinciaNombre: "San Jose",
            cantonNombre: "Central",
            distritoNombre: "Carmen",
            qrValue: "o1",
            barcodeValue: "501",
          },
        ],
        omitidas: [{ ordenId: "o2", motivo: "no_encontrada" }],
      }),
    });

    const r = await generarEtiquetas(
      { ordenIds: ["o1", "o2"] },
      { etiquetaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toHaveLength(1);
    expect(r.omitidas).toEqual([{ ordenId: "o2", motivo: "no_encontrada" }]);
    expect(service.generarEtiquetas).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] }, MAESTRO);
  });

  it("R13: rol no autorizado -> forbidden (delegado al service, sin transformar)", async () => {
    const service = fakeEtiquetaService({
      generarEtiquetas: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });

    const r = await generarEtiquetas(
      { ordenIds: ["o1"] },
      { etiquetaService: service, getActor: getActor(ADMIN) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(service.generarEtiquetas).toHaveBeenCalledWith({ ordenIds: ["o1"] }, ADMIN);
  });
});
