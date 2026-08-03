import { describe, it, expect, vi } from "vitest";
import {
  crearPlantillaAction,
  actualizarPlantillaAction,
  setActivaPlantillaAction,
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

function plantilla(): GastoFijoPlantillaDTO {
  return {
    id: UUID,
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-13",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
  };
}

function fakeService(overrides: Partial<IGastoFijoPlantillaService> = {}): IGastoFijoPlantillaService {
  return {
    crearPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    actualizarPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    setActivaPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    listarPlantillas: vi.fn(async () => ({ status: "ok" as const, plantillas: [plantilla()] })),
    // Feature 170 (T I.1): el doble sigue implementando la interfaz COMPLETA.
    listarPlantillasPaginado: vi.fn(async () => ({
      status: "ok" as const,
      items: [plantilla()],
      page: 1,
      pageSize: 25,
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

// ---------------------------------------------------------------------------
// Regresion: fecha de cobro INEXISTENTE (dia rodado)
// ---------------------------------------------------------------------------
// `fechaCobro` solo comprobaba el regex `^\d{4}-\d{2}-\d{2}$`, que mide la FORMA. Un dia
// desbordado la cumple, y `new Date("2026-02-31T00:00:00.000Z")` NO es `Invalid Date`: en V8
// RUEDA al 3 de marzo (solo el MES fuera de rango invalida). Asi que el "31 de febrero" pasaba
// el borde, el repositorio lo convertia en Date con `fechaCobroAColumna` y se PERSISTIA como 3
// de marzo en la columna `@db.Date`. Y `fechaCobro` es el ANCLA del ciclo: el desvio no ocurre
// una vez, se repite en cada cobro que deriva el cron de la 45.
//
// Se prueba por la ACCION y no por el schema suelto porque lo que importa es que la fecha
// rodada no llegue NUNCA al service (y de ahi al repositorio): la asercion de que el doble no
// se llamo es la mitad del test.
describe("fecha de cobro inexistente -> validation_error, sin tocar el service", () => {
  it("V8 rueda el dia desbordado en vez de invalidarlo (el porque de este bloque)", () => {
    expect(new Date("2026-02-31T00:00:00.000Z").toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(new Date("2026-04-31T00:00:00.000Z").toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(new Date("2027-02-29T00:00:00.000Z").toISOString().slice(0, 10)).toBe("2027-03-01");
  });

  it.each([
    ["31 de febrero (rodaba a 2026-03-03)", "2026-02-31"],
    ["31 de abril (rodaba a 2026-05-01)", "2026-04-31"],
    ["29 de febrero de ano NO bisiesto (rodaba a 2027-03-01)", "2027-02-29"],
  ])("crear con %s se rechaza en el borde", async (_caso, fechaCobro) => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00", fechaCobro },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crearPlantilla).not.toHaveBeenCalled();
  });

  it.each([
    ["31 de febrero", "2026-02-31"],
    ["31 de abril", "2026-04-31"],
    ["29 de febrero de ano NO bisiesto", "2027-02-29"],
  ])("actualizar con %s se rechaza en el borde", async (_caso, fechaCobro) => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "80000.00", fechaCobro },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizarPlantilla).not.toHaveBeenCalled();
  });

  it("el 29 de febrero de un ano BISIESTO se acepta y llega al service tal cual", async () => {
    // Contrapeso: sin esto, "rechazar todo 29 de febrero" pasaria el bloque entero.
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00", fechaCobro: "2028-02-29" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    expect(service.crearPlantilla).toHaveBeenCalledWith(
      expect.objectContaining({ fechaCobro: "2028-02-29" }),
      MAESTRO,
    );
  });

  it("omitir fechaCobro sigue tomando el default (hoy en CR), que es una fecha valida", async () => {
    // El `.refine` va ANTES del `.default()`: si lo rompiera, la entrada sin fecha —la que
    // manda hoy la UI de la 85— dejaria de parsear.
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    const enviado = (service.crearPlantilla as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(enviado.fechaCobro).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
      { id: "no-uuid", concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizarPlantilla).not.toHaveBeenCalled();
  });

  it("not_found se propaga desde el service", async () => {
    const service = fakeService({ actualizarPlantilla: vi.fn(async () => ({ status: "not_found" as const })) });
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "not_found" });
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
