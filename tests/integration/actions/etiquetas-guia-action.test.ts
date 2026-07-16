import { describe, it, expect, vi } from "vitest";
import { generarEtiquetas, obtenerEtiquetaPorGuia } from "@/lib/actions/etiquetas-guia";
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
    obtenerEtiquetaPorGuia: vi.fn().mockResolvedValue({ status: "no_encontrada" }),
    ...overrides,
  };
}

function etiquetaDTO() {
  return {
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
    qrValue: "501",
    barcodeValue: "501",
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
        etiquetas: [etiquetaDTO()],
        omitidas: [{ ordenId: "o2", motivo: "sin_guia" }],
      }),
    });

    const r = await generarEtiquetas(
      { ordenIds: ["o1", "o2"] },
      { etiquetaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiquetas).toHaveLength(1);
    expect(r.omitidas).toEqual([{ ordenId: "o2", motivo: "sin_guia" }]);
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

describe("obtenerEtiquetaPorGuia — borde de /paquete/<numGuia>", () => {
  it("R14: sin sesion valida -> unauthenticated, sin llamar al service", async () => {
    const service = fakeEtiquetaService();
    const r = await obtenerEtiquetaPorGuia(
      { numGuia: 501 },
      { etiquetaService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(service.obtenerEtiquetaPorGuia).not.toHaveBeenCalled();
  });

  it("R15: numGuia no entero positivo -> validation_error sin tocar el service", async () => {
    const service = fakeEtiquetaService();
    for (const input of [{ numGuia: 0 }, { numGuia: -3 }, { numGuia: 1.5 }, { numGuia: "501" }, {}]) {
      const r = await obtenerEtiquetaPorGuia(input, {
        etiquetaService: service,
        getActor: getActor(MAESTRO),
      });
      expect(r.status).toBe("validation_error");
    }
    expect(service.obtenerEtiquetaPorGuia).not.toHaveBeenCalled();
  });

  it("camino ok: delega con el numGuia + actor y devuelve la etiqueta tal cual", async () => {
    const service = fakeEtiquetaService({
      obtenerEtiquetaPorGuia: vi.fn().mockResolvedValue({ status: "ok", etiqueta: etiquetaDTO() }),
    });

    const r = await obtenerEtiquetaPorGuia(
      { numGuia: 501 },
      { etiquetaService: service, getActor: getActor(ADMIN) },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.etiqueta.numGuia).toBe(501);
    expect(r.etiqueta.qrValue).toBe("501");
    expect(service.obtenerEtiquetaPorGuia).toHaveBeenCalledWith(501, ADMIN);
  });

  it("guia inexistente -> no_encontrada (passthrough del service)", async () => {
    const service = fakeEtiquetaService();
    const r = await obtenerEtiquetaPorGuia(
      { numGuia: 999 },
      { etiquetaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({ status: "no_encontrada" });
  });
});
