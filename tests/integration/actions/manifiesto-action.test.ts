import { describe, it, expect, vi } from "vitest";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";
import type { ManifiestoFilaDTO } from "@/lib/types/manifiesto";

// Feature 148 (T18) — borde de la Server Action de lectura del manifiesto.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const getActor = (actor: Actor | null) => async (): Promise<Actor | null> => actor;

function fakeManifiestoService(overrides: Partial<IManifiestoService> = {}): IManifiestoService {
  return {
    armar: vi.fn().mockResolvedValue({ status: "ok", filas: [], omitidas: [] }),
    ...overrides,
  };
}

function fila(): ManifiestoFilaDTO {
  return {
    numGuia: 501,
    numRemision: "REM-1",
    destinatario: "Juan Perez",
    telefono: "88880000",
    direccion: "Av. Siempre Viva 742",
    zona: "Cartago",
    producto: "Camiseta talla M",
    monto: 25.5,
    intentos: 0, // feature 160/R28a: dato de la orden, numerico y no nullable
    origen: "Bodega Central GAM",
    destino: "Cartago",
    responsable: "Ana Maestra",
    fecha: "2026-07-15",
  };
}

describe("R28 — sin sesion valida no se devuelve dato alguno", () => {
  it("devuelve unauthenticated y no consulta el service sin sesion", async () => {
    const service = fakeManifiestoService();

    const r = await obtenerManifiesto(
      { flujo: "ruteo_satelite", ordenIds: ["o1"] },
      { manifiestoService: service, getActor: getActor(null) },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.armar).not.toHaveBeenCalled();
  });

  it("la sesion se exige ANTES de validar la entrada (ni siquiera con input valido hay datos)", async () => {
    const service = fakeManifiestoService({
      armar: vi.fn().mockResolvedValue({ status: "ok", filas: [fila()], omitidas: [] }),
    });

    const r = await obtenerManifiesto(
      { flujo: "carga_masiva", numRemisiones: ["REM-1"] },
      { manifiestoService: service, getActor: getActor(null) },
    );

    expect(r.status).toBe("unauthenticated");
    expect(JSON.stringify(r)).not.toContain("REM-1");
    expect(service.armar).not.toHaveBeenCalled();
  });
});

describe("R30 — entrada invalida -> validation_error sin devolver datos", () => {
  const invalidos: Array<[string, unknown]> = [
    ["seleccion vacia (ordenIds)", { flujo: "ruteo_satelite", ordenIds: [] }],
    ["seleccion vacia (numRemisiones)", { flujo: "carga_masiva", numRemisiones: [] }],
    ["identificador malformado (string vacio)", { flujo: "ruteo_satelite", ordenIds: [""] }],
    ["flujo desconocido", { flujo: "flujo_inventado", ordenIds: ["o1"] }],
    ["flujo ausente", { ordenIds: ["o1"] }],
    ["sin seleccion", { flujo: "ruteo_satelite" }],
    ["ordenIds no-array", { flujo: "ruteo_satelite", ordenIds: "o1" }],
    ["numRemisiones en un flujo que no es carga masiva", { flujo: "envio_tienda", numRemisiones: ["REM-1"] }],
    ["input no-objeto", "o1"],
  ];

  for (const [caso, input] of invalidos) {
    it(`devuelve validation_error con ${caso}, sin tocar el service`, async () => {
      const service = fakeManifiestoService();

      const r = await obtenerManifiesto(input, {
        manifiestoService: service,
        getActor: getActor(MAESTRO),
      });

      expect(r.status).toBe("validation_error");
      if (r.status !== "validation_error") throw new Error("unreachable");
      expect(r).not.toHaveProperty("filas");
      expect(service.armar).not.toHaveBeenCalled();
    });
  }
});

describe("R24 — la accion es un READ puro", () => {
  it("no ejecuta ninguna mutacion: solo delega en armar() y devuelve su resultado", async () => {
    const armar = vi.fn().mockResolvedValue({
      status: "ok",
      filas: [fila()],
      omitidas: [{ ref: "o2", motivo: "no_encontrada" }],
    });
    const service = fakeManifiestoService({ armar });

    const r = await obtenerManifiesto(
      { flujo: "generacion_guia", ordenIds: ["o1", "o2"] },
      { manifiestoService: service, getActor: getActor(MAESTRO) },
    );

    // El service expuesto a la accion tiene UN solo metodo, de lectura (R24): no hay
    // superficie de escritura que invocar. Se verifica ademas que se llamo una vez.
    expect(Object.keys(service)).toEqual(["armar"]);
    expect(armar).toHaveBeenCalledTimes(1);
    expect(armar).toHaveBeenCalledWith(
      { flujo: "generacion_guia", ordenIds: ["o1", "o2"] },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toEqual([fila()]);
    expect(r.omitidas).toEqual([{ ref: "o2", motivo: "no_encontrada" }]);
  });

  it("la via de carga masiva pasa las remisiones tal cual, con el actor resuelto", async () => {
    const service = fakeManifiestoService();

    await obtenerManifiesto(
      { flujo: "carga_masiva", numRemisiones: ["REM-1", "REM-2"] },
      { manifiestoService: service, getActor: getActor(ADMIN_TIENDA) },
    );

    expect(service.armar).toHaveBeenCalledWith(
      { flujo: "carga_masiva", numRemisiones: ["REM-1", "REM-2"] },
      ADMIN_TIENDA,
    );
  });

  it("propaga forbidden del service sin transformarlo", async () => {
    const service = fakeManifiestoService({
      armar: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });

    const r = await obtenerManifiesto(
      { flujo: "envio_tienda", ordenIds: ["o1"] },
      { manifiestoService: service, getActor: getActor(MAESTRO) },
    );

    expect(r).toEqual({ status: "forbidden" });
  });
});
