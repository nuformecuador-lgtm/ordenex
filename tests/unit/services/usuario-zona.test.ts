import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsuarioService } from "@/lib/services/UsuarioService";
import {
  type IUserRepository,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

// Feature 24/R27/R28: asignacion de zona a usuarios mensajero/adminSatelite.

vi.mock("@/lib/utils/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hash(${p})`),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/utils/password-generator", () => ({
  generateStrongPassword: vi.fn(() => "Gen3rada!X"),
}));

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ROLES = [
  { id: "rol-msg", value: "mensajero" as const },
  { id: "rol-sat", value: "adminSatelite" as const },
  { id: "rol-admin", value: "admin" as const },
];

function usuario(over: Partial<UsuarioPublico> = {}): UsuarioPublico {
  return {
    id: "usr-1",
    nombre: "Ana",
    email: "ana@example.com",
    telefono: "099",
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-msg",
    fulfillment: false,
    zonaId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

function buildRepo(over: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn().mockResolvedValue(usuario()),
    findByEmail: vi.fn(),
    create: vi.fn().mockResolvedValue(usuario()),
    updatePasswordHash: vi.fn(),
    listByRol: vi.fn().mockResolvedValue([]),
    listMensajeros: vi.fn(),
    listAdminTiendas: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue(usuario()),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn().mockResolvedValue(ROLES),
    ...over,
  };
}

function buildZonaRepo(exists: boolean): IZonaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(exists ? { id: "z1", nombre: "GAM", pagoEntrega: 0, pagoRechazo: 0, esGam: false, distritosCount: 0 } : null),
    findByNombreKey: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    setGam: vi.fn(),
    listLight: vi.fn(),
    findGamZonaId: vi.fn().mockResolvedValue(null),
  };
}

const baseCrear = {
  nombre: "Ana",
  email: "ana@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  passwordMode: "manual" as const,
  password: "Abcdef1!",
};

let repo: IUserRepository;
beforeEach(() => {
  vi.clearAllMocks();
  repo = buildRepo();
});

describe("crear — zona por rol (R27/R28)", () => {
  it("mensajero con zonaId existente lo persiste (R27)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    const r = await svc.crear({ ...baseCrear, rolId: "rol-msg", zonaId: "z1" }, MAESTRO);
    expect(r.status).toBe("ok");
    expect((repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0].zonaId).toBe("z1");
  });

  it("adminSatelite con zonaId existente lo persiste (R27)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    await svc.crear({ ...baseCrear, rolId: "rol-sat", zonaId: "z1" }, MAESTRO);
    expect((repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0].zonaId).toBe("z1");
  });

  it("rol no aplicable (admin) fuerza zonaId=null aunque se envie (R27)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    await svc.crear({ ...baseCrear, rolId: "rol-admin", zonaId: "z1" }, MAESTRO);
    expect((repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0].zonaId).toBeNull();
  });

  it("zonaId inexistente para un rol aplicable -> validation_error (R28)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(false));
    const r = await svc.crear({ ...baseCrear, rolId: "rol-msg", zonaId: "no-existe" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("zonaId");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("sin zonaId -> null (R27)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    await svc.crear({ ...baseCrear, rolId: "rol-msg" }, MAESTRO);
    expect((repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0].zonaId).toBeNull();
  });
});

describe("actualizar — zona por rol (R27/R28)", () => {
  it("editar zonaId de un mensajero valido lo aplica", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-msg" })) });
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    const r = await svc.actualizar("usr-1", { zonaId: "z1" }, MAESTRO);
    expect(r.status).toBe("ok");
    expect((repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1].zonaId).toBe("z1");
  });

  it("editar zonaId inexistente -> validation_error (R28)", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-msg" })) });
    const svc = new UsuarioService(repo, buildZonaRepo(false));
    const r = await svc.actualizar("usr-1", { zonaId: "no-existe" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("no enviar zonaId no toca la zona (preserva el campo)", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-msg" })) });
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    await svc.actualizar("usr-1", { nombre: "Otro" }, MAESTRO);
    expect((repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty("zonaId");
  });
});
