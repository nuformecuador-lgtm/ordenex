import { describe, expect, it, vi } from "vitest";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type {
  CreatePlantillaData,
  IPlantillaMensajeRepository,
  PlantillaPublica,
  UpdatePlantillaData,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { Actor } from "@/lib/interfaces/services/IPlantillaMensajeService";

// Ficha 474 (T5.1) — plantillas de informe: R3 (declarar), R6 (documento solo donde aplica),
// R7 (inmutables tras salir a Meta) y R10 (no desactivar/eliminar con un envio encendido).

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

function plantilla(o: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "informe_diario",
    cuerpo: "Buenos días {{destinatario_nombre}}",
    variables: ["destinatario_nombre"],
    variablesNombres: {},
    estado: "saved_not_aprobation",
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: null,
    templateIdioma: null,
    informeClave: null,
    llevaDocumento: false,
    createdBy: "m1",
    createdAt: new Date("2026-10-05"),
    updatedAt: new Date("2026-10-05"),
    ...o,
  };
}

function repo(actual: PlantillaPublica = plantilla()) {
  const dobles = {
    create: vi.fn(async (d: CreatePlantillaData) => plantilla({ ...(d as Partial<PlantillaPublica>) })),
    findById: vi.fn(async () => actual),
    findByNombre: vi.fn(async () => null),
    update: vi.fn(async (_id: string, d: UpdatePlantillaData) => ({ ...actual, ...(d as Partial<PlantillaPublica>) })),
    updateEstado: vi.fn(async () => actual),
    softDelete: vi.fn(async () => true),
  };
  return dobles as unknown as IPlantillaMensajeRepository & typeof dobles;
}

describe("474/R3 — declarar una plantilla de informe", () => {
  it("crear con un informe del catalogo guarda informeClave", async () => {
    const r = repo();
    const s = new PlantillaMensajeService(r);
    const out = await s.crear(
      { nombre: "x", cuerpo: "{{fecha}}", plantillaTienda: false, informeClave: "prueba_envio" },
      MAESTRO,
    );
    expect(out.status).toBe("ok");
    expect(r.create).toHaveBeenCalledWith(expect.objectContaining({ informeClave: "prueba_envio" }));
  });

  it("sin informeClave: el create NO recibe la clave (plantilla de orden, sin cambios)", async () => {
    const r = repo();
    await new PlantillaMensajeService(r).crear({ nombre: "x", cuerpo: "Hola", plantillaTienda: false }, MAESTRO);
    const data = r.create.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect("informeClave" in data).toBe(false);
    expect("llevaDocumento" in data).toBe(false);
  });

  it("un informe que no existe -> validation_error en informeClave", async () => {
    const out = await new PlantillaMensajeService(repo()).crear(
      { nombre: "x", cuerpo: "c", plantillaTienda: false, informeClave: "no_existe" },
      MAESTRO,
    );
    expect(out).toEqual({ status: "validation_error", fieldErrors: { informeClave: ["Ese informe no existe"] } });
  });

  it("de tienda Y de informe a la vez -> validation_error", async () => {
    const out = await new PlantillaMensajeService(repo()).crear(
      { nombre: "x", cuerpo: "c", plantillaTienda: true, informeClave: "prueba_envio" },
      MAESTRO,
    );
    expect(out.status).toBe("validation_error");
  });
});

describe("474/R6 — documento adjunto solo en informes que generan documento", () => {
  it("plantilla de ORDEN con documento -> validation_error en llevaDocumento", async () => {
    const r = repo();
    const out = await new PlantillaMensajeService(r).crear(
      { nombre: "x", cuerpo: "c", plantillaTienda: false, llevaDocumento: true },
      MAESTRO,
    );
    expect(out).toEqual({
      status: "validation_error",
      fieldErrors: { llevaDocumento: ["Solo una plantilla de informe puede llevar documento adjunto"] },
    });
    expect(r.create).not.toHaveBeenCalled();
  });

  it("informe que NO genera documento (aviso_interno) con documento -> validation_error", async () => {
    const out = await new PlantillaMensajeService(repo()).crear(
      { nombre: "x", cuerpo: "c", plantillaTienda: false, informeClave: "aviso_interno", llevaDocumento: true },
      MAESTRO,
    );
    expect(out).toEqual({ status: "validation_error", fieldErrors: { llevaDocumento: ["Ese informe no genera documento"] } });
  });

  it("informe que SI genera documento (prueba_envio) con documento -> ok", async () => {
    const out = await new PlantillaMensajeService(repo()).crear(
      { nombre: "x", cuerpo: "c", plantillaTienda: false, informeClave: "prueba_envio", llevaDocumento: true },
      MAESTRO,
    );
    expect(out.status).toBe("ok");
  });

  it("editar: quitar el informe dejando el documento -> validation_error", async () => {
    const actual = plantilla({ informeClave: "prueba_envio", llevaDocumento: true });
    const out = await new PlantillaMensajeService(repo(actual)).actualizar("pl-1", { informeClave: null }, MAESTRO);
    expect(out.status).toBe("validation_error");
  });
});

describe("474/R7 — inmutables en cuanto la plantilla salio hacia Meta", () => {
  it("con templateId: cambiar el informe -> validation_error y no escribe", async () => {
    const actual = plantilla({ informeClave: "prueba_envio", templateId: "tpl", estado: "activo" });
    const r = repo(actual);
    const out = await new PlantillaMensajeService(r).actualizar("pl-1", { informeClave: "aviso_interno" }, MAESTRO);
    expect(out).toEqual({
      status: "validation_error",
      fieldErrors: { informeClave: ["No se puede cambiar: la plantilla ya se envió a Meta. Crea una plantilla nueva."] },
    });
    expect(r.update).not.toHaveBeenCalled();
  });

  it("en `pending` sin templateId: cambiar el documento -> validation_error", async () => {
    const actual = plantilla({ informeClave: "prueba_envio", estado: "pending" });
    const out = await new PlantillaMensajeService(repo(actual)).actualizar("pl-1", { llevaDocumento: true }, MAESTRO);
    expect(out.status).toBe("validation_error");
  });

  it("mandar el MISMO valor no es un cambio: ok", async () => {
    const actual = plantilla({ informeClave: "prueba_envio", templateId: "tpl", estado: "activo" });
    const out = await new PlantillaMensajeService(repo(actual)).actualizar(
      "pl-1",
      { informeClave: "prueba_envio", llevaDocumento: false, nombre: "otro" },
      MAESTRO,
    );
    expect(out.status).toBe("ok");
  });

  it("borrador nunca enviado: SI se puede cambiar", async () => {
    const r = repo(plantilla());
    const out = await new PlantillaMensajeService(r).actualizar(
      "pl-1",
      { informeClave: "prueba_envio", llevaDocumento: true },
      MAESTRO,
    );
    expect(out.status).toBe("ok");
    expect(r.update).toHaveBeenCalledWith("pl-1", { informeClave: "prueba_envio", llevaDocumento: true });
  });
});

describe("474/R10 — en uso por un envio encendido", () => {
  const envios = { nombresEncendidosConPlantilla: vi.fn(async () => ["Informe 05:00", "Picking"]) };

  it("desactivar -> en_uso con los nombres, sin tocar el estado", async () => {
    const r = repo();
    const out = await new PlantillaMensajeService(r, undefined, { envios }).cambiarEstado(
      "pl-1",
      { estado: "inactivo" },
      MAESTRO,
    );
    expect(out).toEqual({ status: "en_uso", envios: ["Informe 05:00", "Picking"] });
    expect(r.updateEstado).not.toHaveBeenCalled();
  });

  it("eliminar -> en_uso, sin soft delete", async () => {
    const r = repo();
    const out = await new PlantillaMensajeService(r, undefined, { envios }).eliminar("pl-1", MAESTRO);
    expect(out).toEqual({ status: "en_uso", envios: ["Informe 05:00", "Picking"] });
    expect(r.softDelete).not.toHaveBeenCalled();
  });

  it("sin envios encendidos: desactiva normalmente", async () => {
    const r = repo();
    const ninguno = { nombresEncendidosConPlantilla: vi.fn(async () => []) };
    const out = await new PlantillaMensajeService(r, undefined, { envios: ninguno }).cambiarEstado(
      "pl-1",
      { estado: "inactivo" },
      MAESTRO,
    );
    expect(out.status).toBe("ok");
    expect(ninguno.nombresEncendidosConPlantilla).toHaveBeenCalledWith("pl-1");
  });

  it("R1/R5: un no-maestro ni consulta los envios", async () => {
    const out = await new PlantillaMensajeService(repo(), undefined, { envios }).eliminar("pl-1", {
      usuarioId: "a",
      rol: "admin",
    });
    expect(out.status).toBe("forbidden");
  });
});
