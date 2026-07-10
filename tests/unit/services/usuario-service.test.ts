import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { UsuarioService } from "@/lib/services/UsuarioService";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
  type IUserRepository,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

// Mock del hash: determinista para verificar que se persiste el hash, no el claro.
vi.mock("@/lib/utils/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hash(${plain})`),
  verifyPassword: vi.fn(),
}));
// Mock del generador: valor fuerte conocido para las aserciones.
vi.mock("@/lib/utils/password-generator", () => ({
  generateStrongPassword: vi.fn(() => "Gen3rada!X"),
}));

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

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
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function buildRepo(overrides: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn().mockResolvedValue(usuario()),
    findByEmail: vi.fn(),
    create: vi.fn().mockResolvedValue(usuario()),
    updatePasswordHash: vi.fn(),
    listMensajeros: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue(usuario()),
    setEstado: vi.fn().mockResolvedValue(usuario({ estado: "inactivo" })),
    listTiposIdentificacion: vi.fn().mockResolvedValue([{ id: "tipo-1", value: "cedula" }]),
    ...overrides,
  };
}

const baseCrear = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
};
const crearManual = { ...baseCrear, passwordMode: "manual" as const, password: "Abcdef1!" };
const crearGenerate = { ...baseCrear, passwordMode: "generate" as const };

let repo: IUserRepository;
let service: UsuarioService;

beforeEach(() => {
  vi.clearAllMocks();
  repo = buildRepo();
  service = new UsuarioService(repo);
});

describe("autorizacion — solo maestro (R3/R4)", () => {
  it("admin/mensajero/desconocido -> forbidden en todas las operaciones (R3/R4)", async () => {
    for (const actor of [ADMIN, MENSAJERO, DESCONOCIDO]) {
      expect((await service.crear(crearManual, actor)).status).toBe("forbidden");
      expect((await service.listar({ page: 1, pageSize: 20, sortBy: "createdAt", sortDir: "desc" }, actor)).status).toBe("forbidden");
      expect((await service.obtener("usr-1", actor)).status).toBe("forbidden");
      expect((await service.actualizar("usr-1", { nombre: "N" }, actor)).status).toBe("forbidden");
      expect((await service.cambiarEstado("usr-1", { estado: "inactivo" }, actor)).status).toBe("forbidden");
      expect((await service.listarTiposIdentificacion(actor)).status).toBe("forbidden");
    }
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.setEstado).not.toHaveBeenCalled();
  });
});

describe("crear (R7/R8/R9/R10/R11/R12/R32/R33/R34/R35)", () => {
  it("crear modo manual hashea la password del input y no retorna generatedPassword (R7/R35)", async () => {
    const r = await service.crear(crearManual, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.generatedPassword).toBeUndefined();
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.passwordHash).toBe("hash(Abcdef1!)");
    expect(arg).not.toHaveProperty("password");
  });

  it("crear modo generate genera password fuerte, la hashea y la retorna una vez (R32/R33/R34)", async () => {
    const r = await service.crear(crearGenerate, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.generatedPassword).toBe("Gen3rada!X");
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.passwordHash).toBe("hash(Gen3rada!X)"); // R34: solo se persiste el hash
  });

  it("crear fija estado activo (R8)", async () => {
    await service.crear(crearManual, MAESTRO);
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.estado).toBe("activo");
  });

  it("crear con email duplicada -> conflict con campo email (R10)", async () => {
    repo = buildRepo({ create: vi.fn().mockRejectedValue(new UsuarioDuplicadoError("email")) });
    service = new UsuarioService(repo);
    const r = await service.crear(crearManual, MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.campo).toBe("email");
  });

  it("crear con cedula duplicada -> conflict con campo cedula (R11)", async () => {
    repo = buildRepo({ create: vi.fn().mockRejectedValue(new UsuarioDuplicadoError("cedula")) });
    service = new UsuarioService(repo);
    const r = await service.crear(crearManual, MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.campo).toBe("cedula");
  });

  it("crear con catalogo FK inexistente -> validation_error (R9)", async () => {
    repo = buildRepo({
      create: vi.fn().mockRejectedValue(new CatalogoInvalidoError("rolId", "x")),
    });
    service = new UsuarioService(repo);
    const r = await service.crear(crearManual, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("rolId");
  });

  it("crear no retorna passwordHash (R12/R24)", async () => {
    const r = await service.crear(crearGenerate, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.usuario).not.toHaveProperty("passwordHash");
  });
});

describe("actualizar (R16/R17/R18/R19)", () => {
  it("aplica solo campos editables y delega", async () => {
    const r = await service.actualizar("usr-1", { nombre: "Nuevo", rolId: "rol-2" }, MAESTRO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ nombre: "Nuevo", rolId: "rol-2" });
  });

  it("actualizar de usuario inexistente -> not_found (R17)", async () => {
    repo = buildRepo({ update: vi.fn().mockResolvedValue(null) });
    service = new UsuarioService(repo);
    const r = await service.actualizar("x", { nombre: "N" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("catalogo FK invalido en edicion -> validation_error (R18)", async () => {
    repo = buildRepo({
      update: vi.fn().mockRejectedValue(new CatalogoInvalidoError("tipoIdentificacionId", "x")),
    });
    service = new UsuarioService(repo);
    const r = await service.actualizar("usr-1", { tipoIdentificacionId: "x" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("tipoIdentificacionId");
    }
  });
});

describe("cambiarEstado (R20/R21/R22)", () => {
  it("cambiarEstado inactiva (baja logica) sin borrado fisico (R20)", async () => {
    const r = await service.cambiarEstado("usr-1", { estado: "inactivo" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.usuario.estado).toBe("inactivo");
    expect(repo.setEstado).toHaveBeenCalledWith("usr-1", "inactivo");
  });

  it("cambiarEstado de inexistente -> not_found (R22)", async () => {
    repo = buildRepo({ setEstado: vi.fn().mockResolvedValue(null) });
    service = new UsuarioService(repo);
    const r = await service.cambiarEstado("x", { estado: "activo" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("listar / listarTiposIdentificacion", () => {
  it("listar calcula skip y devuelve page/pageSize/total (R13)", async () => {
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 5 }) });
    service = new UsuarioService(repo);
    const r = await service.listar(
      { page: 2, pageSize: 10, sortBy: "createdAt", sortDir: "desc" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.page).toBe(2);
      expect(r.total).toBe(5);
    }
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
  });

  it("listarTiposIdentificacion devuelve el catalogo (R29)", async () => {
    const r = await service.listarTiposIdentificacion(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tipos).toEqual([{ id: "tipo-1", value: "cedula" }]);
  });
});
