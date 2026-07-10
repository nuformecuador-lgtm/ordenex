import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostulacionMensajeroService } from "@/lib/services/PostulacionMensajeroService";
import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";
import type { IPostulacionRepository } from "@/lib/interfaces/repositories/IPostulacionRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { PostularMensajeroCommand } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";
import { verifyPassword } from "@/lib/utils/password";

// Feature 21 / R3, R9, R12, R13, R14, R15, R16, R19, R20, R24.

function buildRepo(overrides: Partial<IPostulacionRepository> = {}): IPostulacionRepository {
  return {
    emailExiste: vi.fn().mockResolvedValue(false),
    cedulaExiste: vi.fn().mockResolvedValue(false),
    findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
    tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
    vehiculoExiste: vi.fn().mockResolvedValue(true),
    crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    ...overrides,
  };
}

function buildStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn().mockImplementation(async ({ path }: { path: string }) => path),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildCommand(overrides: Partial<PostularMensajeroCommand> = {}): PostularMensajeroCommand {
  const documentos = Object.fromEntries(
    DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }]),
  ) as PostularMensajeroCommand["documentos"];
  return {
    nombre: "Ana",
    primerApellido: "Perez",
    segundoApellido: "Gomez",
    email: "ana@example.com",
    telefono: "0991234567",
    tipoIdentificacionId: "tipo-1",
    cedula: "1710034065",
    vehiculoId: "veh-1",
    placa: "ABC123",
    password: "Abcdef1!",
    documentos,
    ...overrides,
  };
}

describe("PostulacionMensajeroService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("R12/R15: resuelve rol mensajero y crea la cuenta (sin sobrescribir estado)", async () => {
    const repo = buildRepo();
    const service = new PostulacionMensajeroService(repo, buildStorage());

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "ok" });
    expect(repo.findRolIdByValue).toHaveBeenCalledWith("mensajero");
    const [usuario] = (repo.crearMensajeroConDocumentos as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(usuario.rolId).toBe("rol-mensajero");
    expect(usuario).not.toHaveProperty("estado"); // R12: no fuerza estado, default pendiente
  });

  it("R13: persiste apellidos, vehiculo y placa", async () => {
    const repo = buildRepo();
    const service = new PostulacionMensajeroService(repo, buildStorage());

    await service.postular(buildCommand());

    const [usuario] = (repo.crearMensajeroConDocumentos as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(usuario).toMatchObject({
      primerApellido: "Perez",
      segundoApellido: "Gomez",
      vehiculoId: "veh-1",
      placa: "ABC123",
    });
  });

  it("R14: persiste hash bcrypt, nunca el texto plano", async () => {
    const repo = buildRepo();
    const service = new PostulacionMensajeroService(repo, buildStorage());

    await service.postular(buildCommand());

    const [usuario] = (repo.crearMensajeroConDocumentos as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(usuario.passwordHash).not.toBe("Abcdef1!");
    expect(await verifyPassword("Abcdef1!", usuario.passwordHash)).toBe(true);
  });

  it("R15: rol mensajero inexistente -> error, no crea", async () => {
    const repo = buildRepo({ findRolIdByValue: vi.fn().mockResolvedValue(null) });
    const service = new PostulacionMensajeroService(repo, buildStorage());

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "error" });
    expect(repo.crearMensajeroConDocumentos).not.toHaveBeenCalled();
  });

  it("R9: vehiculo inexistente -> validation_error en vehiculo_id, no crea", async () => {
    const repo = buildRepo({ vehiculoExiste: vi.fn().mockResolvedValue(false) });
    const service = new PostulacionMensajeroService(repo, buildStorage());

    const result = await service.postular(buildCommand());

    expect(result.status).toBe("validation_error");
    if (result.status === "validation_error") {
      expect(result.fieldErrors.vehiculo_id).toBeDefined();
    }
    expect(repo.crearMensajeroConDocumentos).not.toHaveBeenCalled();
  });

  it("R9: tipo_identificacion inexistente -> validation_error en ese campo", async () => {
    const repo = buildRepo({ tipoIdentificacionExiste: vi.fn().mockResolvedValue(false) });
    const service = new PostulacionMensajeroService(repo, buildStorage());

    const result = await service.postular(buildCommand());

    expect(result.status).toBe("validation_error");
    if (result.status === "validation_error") {
      expect(result.fieldErrors.tipo_identificacion_id).toBeDefined();
    }
  });

  it("R16: sube 5 documentos y crea 5 filas con storage_path bajo el usuarioId", async () => {
    const repo = buildRepo();
    const storage = buildStorage();
    const service = new PostulacionMensajeroService(repo, storage);

    await service.postular(buildCommand());

    expect(storage.upload).toHaveBeenCalledTimes(5);
    const [, documentos] = (repo.crearMensajeroConDocumentos as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(documentos).toHaveLength(5);
    expect(new Set(documentos.map((d: { tipo: string }) => d.tipo))).toEqual(
      new Set(DOCUMENTO_TIPOS),
    );
    // Todos los paths comparten el mismo prefijo usuarioId (id generado antes de subir).
    const prefijos = new Set(
      documentos.map((d: { storagePath: string }) => d.storagePath.split("/")[0]),
    );
    expect(prefijos.size).toBe(1);
  });

  it("R19: email duplicado -> conflict('email'), no sube ni crea", async () => {
    const repo = buildRepo({ emailExiste: vi.fn().mockResolvedValue(true) });
    const storage = buildStorage();
    const service = new PostulacionMensajeroService(repo, storage);

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "conflict", field: "email" });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearMensajeroConDocumentos).not.toHaveBeenCalled();
  });

  it("R20: cedula duplicada -> conflict('cedula'), no crea", async () => {
    const repo = buildRepo({ cedulaExiste: vi.fn().mockResolvedValue(true) });
    const service = new PostulacionMensajeroService(repo, buildStorage());

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "conflict", field: "cedula" });
    expect(repo.crearMensajeroConDocumentos).not.toHaveBeenCalled();
  });

  it("R21/R19: carrera -> el constraint DB (P2002 mapeado) devuelve conflict y limpia archivos", async () => {
    const repo = buildRepo({
      crearMensajeroConDocumentos: vi.fn().mockRejectedValue(new UsuarioDuplicadoError("email")),
    });
    const storage = buildStorage();
    const service = new PostulacionMensajeroService(repo, storage);

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "conflict", field: "email" });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    const [paths] = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(paths).toHaveLength(5); // limpia los 5 subidos (R24)
  });

  it("R24: fallo al crear -> limpia archivos subidos y no deja cuenta parcial", async () => {
    const repo = buildRepo({
      crearMensajeroConDocumentos: vi.fn().mockRejectedValue(new Error("db caida")),
    });
    const storage = buildStorage();
    const service = new PostulacionMensajeroService(repo, storage);

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "error" });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    const [paths] = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(paths).toHaveLength(5);
  });

  it("R24: fallo al subir un documento -> aborta antes de escribir en DB", async () => {
    const repo = buildRepo();
    const storage = buildStorage({
      upload: vi
        .fn()
        .mockResolvedValueOnce("usr/cedula_anverso.jpg")
        .mockRejectedValueOnce(new Error("storage caido")),
    });
    const service = new PostulacionMensajeroService(repo, storage);

    const result = await service.postular(buildCommand());

    expect(result).toEqual({ status: "error" });
    expect(repo.crearMensajeroConDocumentos).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(1); // limpia el que si subio
  });
});
