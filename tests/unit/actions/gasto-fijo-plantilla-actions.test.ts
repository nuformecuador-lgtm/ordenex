import { describe, it, expect, vi } from "vitest";
import {
  crearPlantillaAction,
  actualizarPlantillaAction,
  setActivaPlantillaAction,
  eliminarPlantillaAction,
  listarPlantillasAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoPlantillaService } from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R17/R18/R24/R25/R26) — tests unit de las Server Actions de plantillas. Sin sesion
// -> unauthenticated (R18); rol no autorizado -> forbidden (lo decide el service, R17); zod en
// el borde -> validation_error (concepto vacio / monto <=0, R24). DTOs STRING (R12).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };
const UUID = "11111111-1111-4111-8111-111111111111";

// Feature 85 (R1): el ciclo VIGENTE que el dialogo reenvia al editar. Los tres valores estan
// elegidos para que NINGUNO coincida con los defaults del schema de crear (`meses`/`1`/hoy-CR):
// asi un test que pase por culpa de un default no puede pasar por casualidad.
const CICLO_VIGENTE = {
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-03-31",
} as const;

function plantilla(): GastoFijoPlantillaDTO {
  return {
    id: UUID,
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-13",
    requiereAprobacion: true, // ficha 333/R1
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
  };
}

function fakeService(overrides: Partial<IGastoFijoPlantillaService> = {}): IGastoFijoPlantillaService {
  return {
    crearPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    actualizarPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    setActivaPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    // Ficha 332: el borrado. `ok` NO lleva payload (no hay fila que devolver).
    eliminarPlantilla: vi.fn(async () => ({ status: "ok" as const })),
    listarPlantillas: vi.fn(async () => ({ status: "ok" as const, plantillas: [plantilla()] })),
    // Feature 170 (T I.1): el doble sigue implementando la interfaz COMPLETA.
    listarPlantillasPaginado: vi.fn(async () => ({
      status: "ok" as const,
      items: [plantilla()],
      page: 1,
      pageSize: 25,
      total: 1,
    })),
    // Feature 184 (Tanda G): idem. El conjunto del archivo lo ejercita
    // `wallet-listados-descarga-action.test.ts`.
    listarPlantillasCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [plantilla()],
      total: 1,
    })),
    ...overrides,
  };
}

describe("crearPlantillaAction (R17/R18/R24)", () => {
  it("R18: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.crearPlantilla).not.toHaveBeenCalled();
  });

  it("R17: rol no autorizado -> forbidden (lo decide el service)", async () => {
    const service = fakeService({ crearPlantilla: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => OTRO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R24: concepto vacio -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "   ", monto: "80000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crearPlantilla).not.toHaveBeenCalled();
  });

  it("R24: monto no positivo -> validation_error", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "0" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
  });

  it("R24: maestro con datos validos -> ok, plantilla con monto STRING", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantilla.monto).toBe("string");
  });
});

describe("actualizarPlantillaAction (R18/R25)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("id no-uuid -> validation_error", async () => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      // Feature 85: el resto del payload va COMPLETO y valido a proposito, para que el
      // validation_error solo pueda venir del id.
      { id: "no-uuid", concepto: "Alquiler", monto: "85000.00", ...CICLO_VIGENTE },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(r.fieldErrors.id).toBeDefined();
    expect(service.actualizarPlantilla).not.toHaveBeenCalled();
  });

  it("not_found se propaga desde el service", async () => {
    const service = fakeService({ actualizarPlantilla: vi.fn(async () => ({ status: "not_found" as const })) });
    const r = await actualizarPlantillaAction(
      // Feature 85 (R1): el ciclo es OBLIGATORIO al actualizar; sin el, este caso moriria en el
      // borde con validation_error y nunca llegaria al service que devuelve el not_found.
      { id: UUID, concepto: "Alquiler", monto: "85000.00", ...CICLO_VIGENTE },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "not_found" });
  });

  // ── Feature 85 (R1) — LA guardia del fallo mudo que abre esta ficha ──
  //
  // Hasta la 85, `actualizarGastoFijoPlantillaSchema` heredaba de `crear` los defaults
  // `meses`/`1`/hoy-CR, asi que ESTE MISMO payload —el que mandaba `GastoFijoPlantillaDialog`—
  // pasaba el borde entero y el servicio escribia un ciclo INVENTADO encima del que la plantilla
  // ya tenia: periodicidad a mensual y ancla movida al dia de la edicion, sin un solo aviso.
  it("actualizar sin periodicidad devuelve validation_error en los tres campos y no llama al servicio", async () => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(r.fieldErrors.periodicidadUnidad).toBeDefined();
    expect(r.fieldErrors.periodicidadCantidad).toBeDefined();
    expect(r.fieldErrors.fechaCobro).toBeDefined();
    expect(service.actualizarPlantilla).not.toHaveBeenCalled();
  });

  it("R5/R6: una fecha de cobro inexistente o una cantidad 0 mueren en el borde", async () => {
    const service = fakeService();

    const fechaImposible = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00", ...CICLO_VIGENTE, fechaCobro: "2026-02-31" },
      { service, getActor: async () => MAESTRO },
    );
    expect(fechaImposible.status).toBe("validation_error");

    const cantidadCero = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00", ...CICLO_VIGENTE, periodicidadCantidad: 0 },
      { service, getActor: async () => MAESTRO },
    );
    expect(cantidadCero.status).toBe("validation_error");

    expect(service.actualizarPlantilla).not.toHaveBeenCalled();
  });

  it("con el ciclo completo, el servicio lo recibe TAL CUAL (nada se reescribe en el borde)", async () => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "999.00", ...CICLO_VIGENTE },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    // Literales fijos: NO se comparan contra CICLO_VIGENTE por spread ni contra los defaults del
    // schema, que es justamente lo que un test verde-por-construccion haria.
    expect(service.actualizarPlantilla).toHaveBeenCalledWith(
      {
        id: UUID,
        concepto: "Alquiler",
        monto: "999.00",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
        // Ficha 333 (R2): el borde resuelve el default del interruptor, igual que resuelve los
        // tres de la periodicidad. La entrada de arriba NO lo manda, asi que este `true` es
        // exactamente lo que el schema pone -- y que aparezca aqui, literal, es la prueba.
        requiereAprobacion: true,
      },
      MAESTRO,
    );
  });
});

describe("setActivaPlantillaAction (R18/R25)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await setActivaPlantillaAction(
      { id: UUID, activa: false },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("activa no booleana -> validation_error", async () => {
    const service = fakeService();
    const r = await setActivaPlantillaAction(
      { id: UUID, activa: "no" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.setActivaPlantilla).not.toHaveBeenCalled();
  });

  it("R25: desactivar -> ok", async () => {
    const service = fakeService();
    const r = await setActivaPlantillaAction(
      { id: UUID, activa: false },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
  });
});

// ── Ficha 332 (R4/R5/R6) — el BORDE del borrado ──
//
// Lo que este bloque afirma es lo que decide el borde y NADA mas: sin sesion no se llega al
// servicio, una entrada que no identifica una plantilla con un id valido tampoco, y `forbidden`
// no lo inventa la accion —lo devuelve el servicio, que es quien conoce el rol—.
describe("eliminarPlantillaAction (ficha 332, R4/R5/R6)", () => {
  it("R5: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await eliminarPlantillaAction({ id: UUID }, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.eliminarPlantilla).not.toHaveBeenCalled();
  });

  it("R6: id que no es uuid -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await eliminarPlantillaAction(
      { id: "no-uuid" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(r.fieldErrors.id).toBeDefined();
    expect(service.eliminarPlantilla).not.toHaveBeenCalled();
  });

  it("R6: sin id -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await eliminarPlantillaAction({}, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    expect(service.eliminarPlantilla).not.toHaveBeenCalled();
  });

  it("R6: una clave DESCONOCIDA muere en el borde (`.strict()`), aunque el id sea valido", async () => {
    // El id va bien a proposito: el unico motivo posible del rojo es la clave de mas. Sin
    // `.strict()` este caso pasaria al servicio y borraria igual, callado.
    const service = fakeService();
    const r = await eliminarPlantillaAction(
      { id: UUID, borrarTambienElHistorico: true },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.eliminarPlantilla).not.toHaveBeenCalled();
  });

  it("R4: forbidden lo decide el SERVICE (el borde no conoce el rol)", async () => {
    const service = fakeService({
      eliminarPlantilla: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await eliminarPlantillaAction({ id: UUID }, { service, getActor: async () => OTRO });
    expect(r).toEqual({ status: "forbidden" });
    expect(service.eliminarPlantilla).toHaveBeenCalledWith({ id: UUID }, OTRO);
  });

  it("R7: not_found se propaga desde el service", async () => {
    const service = fakeService({
      eliminarPlantilla: vi.fn(async () => ({ status: "not_found" as const })),
    });
    const r = await eliminarPlantillaAction({ id: UUID }, { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "not_found" });
  });

  it("R2: con sesion, id valido y permiso -> ok, y el service recibe `{ id }` y el actor", async () => {
    const service = fakeService();
    const r = await eliminarPlantillaAction({ id: UUID }, { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "ok" });
    expect(service.eliminarPlantilla).toHaveBeenCalledWith({ id: UUID }, MAESTRO);
  });
});

describe("listarPlantillasAction (R17/R18/R26)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarPlantillasAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R17: rol no autorizado -> forbidden", async () => {
    const service = fakeService({ listarPlantillas: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarPlantillasAction({ service, getActor: async () => OTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R26: maestro -> ok con plantillas (monto STRING)", async () => {
    const service = fakeService();
    const r = await listarPlantillasAction({ service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantillas[0].monto).toBe("string");
  });
});
