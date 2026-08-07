import { describe, it, expect, vi } from "vitest";
import {
  crearPlantilla,
  listarPlantillas,
  actualizarPlantilla,
  cambiarEstadoPlantilla,
  eliminarPlantilla,
  previewPlantilla,
} from "@/lib/actions/plantillas";
import type {
  Actor,
  IPlantillaMensajeService,
} from "@/lib/interfaces/services/IPlantillaMensajeService";
import type { PlantillaPublica } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

// Feature 107 — T6 (R4, R5, R25).

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const getActor = (actor: Actor) => async (): Promise<Actor | null> => actor;
const noActor = async (): Promise<Actor | null> => null;

function plantilla(overrides: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "Bienvenida",
    cuerpo: "Hola {{usuario}}",
    variables: ["usuario"],
    estado: "pending",
    templateId: null,
    templateIdioma: null,
    createdBy: "m1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function fakeService(overrides: Partial<IPlantillaMensajeService> = {}): IPlantillaMensajeService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", plantilla: plantilla() }),
    listar: vi
      .fn()
      .mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 25, total: 0 }),
    // Feature 170 (T B.1): el doble implementa la interfaz COMPLETA. Este archivo no
    // ejercita el modo sin paginacion (lo hace `plantillas-descarga-action.test.ts`); el
    // stub existe para que el doble siga siendo un `IPlantillaMensajeService` valido.
    listarCompleto: vi.fn().mockResolvedValue({ status: "ok", items: [], total: 0 }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", plantilla: plantilla() }),
    cambiarEstado: vi
      .fn()
      .mockResolvedValue({ status: "ok", plantilla: plantilla({ estado: "inactivo" }) }),
    eliminar: vi.fn().mockResolvedValue({ status: "ok" }),
    preview: vi.fn().mockResolvedValue({ status: "ok", texto: "Hola Juan" }),
    ...overrides,
  };
}

const validCrear = { nombre: "Bienvenida", cuerpo: "Hola {{usuario}}" };

describe("R4: sin sesion -> unauthenticated sin tocar el service", () => {
  it("todas las acciones rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { plantillaService: service, getActor: noActor };
    expect((await crearPlantilla(validCrear, deps)).status).toBe("unauthenticated");
    expect((await listarPlantillas({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarPlantilla("pl-1", { nombre: "N" }, deps)).status).toBe("unauthenticated");
    expect((await cambiarEstadoPlantilla("pl-1", { estado: "inactivo" }, deps)).status).toBe(
      "unauthenticated",
    );
    expect((await eliminarPlantilla("pl-1", deps)).status).toBe("unauthenticated");
    expect((await previewPlantilla("Hola", deps)).status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
    expect(service.eliminar).not.toHaveBeenCalled();
  });
});

describe("R5: propaga forbidden del service", () => {
  it("crear/listar propagan forbidden", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "forbidden" }),
      listar: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const deps = { plantillaService: service, getActor: getActor(MAESTRO) };
    expect((await crearPlantilla(validCrear, deps)).status).toBe("forbidden");
    expect((await listarPlantillas({}, deps)).status).toBe("forbidden");
  });
});

describe("R25: cambiarEstado rechaza destino distinto de inactivo", () => {
  it("activo -> validation_error sin tocar el service", async () => {
    const service = fakeService();
    const deps = { plantillaService: service, getActor: getActor(MAESTRO) };
    for (const estado of ["activo", "pending", "refused"]) {
      const r = await cambiarEstadoPlantilla("pl-1", { estado }, deps);
      expect(r.status).toBe("validation_error");
    }
    expect(service.cambiarEstado).not.toHaveBeenCalled();
  });

  it("inactivo -> ok, delega en el service", async () => {
    const service = fakeService();
    const deps = { plantillaService: service, getActor: getActor(MAESTRO) };
    const r = await cambiarEstadoPlantilla("pl-1", { estado: "inactivo" }, deps);
    expect(r.status).toBe("ok");
    expect(service.cambiarEstado).toHaveBeenCalledWith("pl-1", { estado: "inactivo" }, MAESTRO);
  });
});

describe("validaciones de borde y delegacion", () => {
  it("crear nombre vacio -> validation_error sin tocar el service (R9)", async () => {
    const service = fakeService();
    const r = await crearPlantilla(
      { nombre: "", cuerpo: "c" },
      { plantillaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  // REAPUNTADO 2026-08-07: se escribio sobre `obtenerPlantilla`, borrada por el chore de deuda
  // de superficie. Lo que afirma no es de obtener, sino del guard `idSchema` COMPARTIDO por las
  // cuatro acciones con id de este modulo: id vacio -> validation_error con SOLO la clave `id`,
  // sin tocar el service. `actualizarPlantilla` esta viva y lleva el mismo guard.
  it("id vacio -> validation_error con clave id, sin tocar el service", async () => {
    const service = fakeService();
    const r = await actualizarPlantilla("", { nombre: "N" }, {
      plantillaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    expect(service.actualizar).not.toHaveBeenCalled();
  });

  it("crear propaga conflict(nombre) del service (R10)", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "conflict", campo: "nombre" }),
    });
    const r = await crearPlantilla(validCrear, {
      plantillaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.campo).toBe("nombre");
  });

  it("eliminar delega en el service (R27)", async () => {
    const service = fakeService();
    const r = await eliminarPlantilla("pl-1", {
      plantillaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    expect(service.eliminar).toHaveBeenCalledWith("pl-1", MAESTRO);
  });

  it("preview delega y devuelve el texto (R18)", async () => {
    const service = fakeService();
    const r = await previewPlantilla("Hola {{usuario}}", {
      plantillaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.texto).toBe("Hola Juan");
  });
});
