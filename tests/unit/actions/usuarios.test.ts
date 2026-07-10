import { describe, it, expect, vi } from "vitest";
import {
  crearUsuario,
  listarUsuarios,
  obtenerUsuario,
  actualizarUsuario,
  cambiarEstadoUsuario,
  listarTiposIdentificacion,
  listarRoles,
} from "@/lib/actions/usuarios";
import type { Actor, IUsuarioService } from "@/lib/interfaces/services/IUsuarioService";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const getActor = (actor: Actor) => async (): Promise<Actor | null> => actor;
const noActor = async (): Promise<Actor | null> => null;

function usuario(overrides: Partial<UsuarioPublico> = {}): UsuarioPublico {
  return {
    id: "usr-1",
    nombre: "Ana Torres",
    email: "ana@example.com",
    telefono: "099",
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-1",
    fulfillment: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function fakeService(overrides: Partial<IUsuarioService> = {}): IUsuarioService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    listar: vi
      .fn()
      .mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 25, total: 0 }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    cambiarEstado: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    listarTiposIdentificacion: vi
      .fn()
      .mockResolvedValue({ status: "ok", tipos: [{ id: "tipo-1", value: "cedula" }] }),
    listarRoles: vi
      .fn()
      .mockResolvedValue({ status: "ok", roles: [{ id: "rol-1", value: "maestro" }] }),
    ...overrides,
  };
}

const validCrearManual = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
  passwordMode: "manual",
  password: "Abcdef1!",
};
const validCrearGenerate = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
  passwordMode: "generate",
};

describe("R2: sin sesion -> unauthenticated sin tocar el service", () => {
  it("todas las acciones rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { usuarioService: service, getActor: noActor };
    expect((await crearUsuario(validCrearManual, deps)).status).toBe("unauthenticated");
    expect((await listarUsuarios({}, deps)).status).toBe("unauthenticated");
    expect((await obtenerUsuario("usr-1", deps)).status).toBe("unauthenticated");
    expect((await actualizarUsuario("usr-1", { nombre: "N" }, deps)).status).toBe("unauthenticated");
    expect((await cambiarEstadoUsuario("usr-1", { estado: "inactivo" }, deps)).status).toBe(
      "unauthenticated",
    );
    expect((await listarTiposIdentificacion(deps)).status).toBe("unauthenticated");
    expect((await listarRoles(deps)).status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("R5/R6: input invalido -> validation_error con fieldErrors sin llamar al service", () => {
  it("crear modo manual con password debil -> validation_error (R6)", async () => {
    const service = fakeService();
    const r = await crearUsuario(
      { ...validCrearManual, password: "debil" },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("password");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con email invalido -> validation_error (R5)", async () => {
    const service = fakeService();
    const r = await crearUsuario(
      { ...validCrearGenerate, email: "no-email" },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("email");
    expect(service.crear).not.toHaveBeenCalled();
  });
});

describe("R33: crearUsuario modo generate propaga generatedPassword del service", () => {
  it("propaga el generatedPassword", async () => {
    const service = fakeService({
      crear: vi
        .fn()
        .mockResolvedValue({ status: "ok", usuario: usuario(), generatedPassword: "Gen3rada!X" }),
    });
    const r = await crearUsuario(validCrearGenerate, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.generatedPassword).toBe("Gen3rada!X");
  });
});

describe("R28: delega en el service y adapta resultados de dominio", () => {
  it("propaga forbidden del service", async () => {
    const service = fakeService({ listar: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await listarUsuarios({}, { usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  it("propaga conflict con campo del service (R10/R11)", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "conflict", campo: "email" }),
    });
    const r = await crearUsuario(validCrearManual, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.campo).toBe("email");
  });

  it("propaga not_found del service", async () => {
    const service = fakeService({
      cambiarEstado: vi.fn().mockResolvedValue({ status: "not_found" }),
    });
    const r = await cambiarEstadoUsuario(
      "x",
      { estado: "activo" },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("not_found");
  });

  it("listarRoles delega en el service y devuelve id/value", async () => {
    const service = fakeService();
    const r = await listarRoles({ usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.roles).toEqual([{ id: "rol-1", value: "maestro" }]);
    expect(service.listarRoles).toHaveBeenCalledWith(MAESTRO);
  });

  it("listarRoles propaga forbidden del service", async () => {
    const service = fakeService({
      listarRoles: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await listarRoles({ usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  it("crear valido delega con actor y datos parseados", async () => {
    const service = fakeService();
    const r = await crearUsuario(validCrearManual, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    expect(service.crear).toHaveBeenCalledWith(expect.objectContaining({ email: "ana@example.com" }), MAESTRO);
  });
});

describe("id invalido -> validation_error con clave id", () => {
  it("obtenerUsuario con id vacio", async () => {
    const service = fakeService();
    const r = await obtenerUsuario("", { usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    expect(service.obtener).not.toHaveBeenCalled();
  });
});
