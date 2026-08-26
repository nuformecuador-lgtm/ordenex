import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsuarioService } from "@/lib/services/UsuarioService";
import {
  type IUserRepository,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

// Feature 21: asociacion de un vehiculo del catalogo al usuario `mensajero`.
// El vehiculo es OPCIONAL para el rol (a diferencia de la zona) y se fuerza a null
// para cualquier otro rol, sin confiar en lo que envie la UI.

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
    zonaId: "z1",
    vehiculoId: null,
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
    listMensajeros: vi.fn(),
    listMensajerosParaFiltro: vi.fn(),
    listByRol: vi.fn().mockResolvedValue([]),
    listCuentasTienda: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue(usuario()),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn().mockResolvedValue(ROLES),
    ...over,
  };
}

// La zona es obligatoria para mensajero/adminSatelite: se inyecta un repo que
// siempre resuelve para que estos tests midan SOLO el vehiculo.
function buildZonaRepo(): IZonaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue({
      id: "z1",
      nombre: "GAM",
      cobroVehiculo: false,
      distritosCount: 0,
      esCentral: false,
    }),
    list: vi.fn(),
    listLite: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    hardDelete: vi.fn(),
    countExistingDistritos: vi.fn(),
    countExistingVehiculos: vi.fn(),
    findCentralZonaId: vi.fn().mockResolvedValue(null),
  };
}

function buildVehiculoRepo(exists: boolean): IVehiculoRepository {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(exists ? { id: "v1", name: "moto" } : null),
    findByName: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    contarUsos: vi.fn().mockResolvedValue(0),
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

function creado(repo: IUserRepository) {
  return (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
}
function actualizado(repo: IUserRepository) {
  return (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
}

let repo: IUserRepository;
beforeEach(() => {
  vi.clearAllMocks();
  repo = buildRepo();
});

describe("crear — vehiculo por rol (feature 21)", () => {
  it("mensajero con vehiculoId existente lo persiste", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    const r = await svc.crear(
      { ...baseCrear, rolId: "rol-msg", zonaId: "z1", vehiculoId: "v1" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(creado(repo).vehiculoId).toBe("v1");
  });

  it("mensajero SIN vehiculo -> validation_error (es obligatorio para el rol)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    const r = await svc.crear({ ...baseCrear, rolId: "rol-msg", zonaId: "z1" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.vehiculoId).toBeDefined();
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rol no aplicable (adminSatelite) fuerza vehiculoId=null aunque se envie", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    await svc.crear(
      { ...baseCrear, rolId: "rol-sat", zonaId: "z1", vehiculoId: "v1" },
      MAESTRO,
    );
    expect(creado(repo).vehiculoId).toBeNull();
  });

  it("vehiculoId inexistente -> validation_error sin tocar la base", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(false));
    const r = await svc.crear(
      { ...baseCrear, rolId: "rol-msg", zonaId: "z1", vehiculoId: "fantasma" },
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.vehiculoId).toBeDefined();
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("actualizar — vehiculo por rol (feature 21)", () => {
  it("asocia un vehiculo existente a un mensajero", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    const r = await svc.actualizar("usr-1", { vehiculoId: "v1" }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(actualizado(repo).vehiculoId).toBe("v1");
  });

  it("vehiculoId=null en un mensajero -> validation_error (no se puede dejar sin vehiculo)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    const r = await svc.actualizar("usr-1", { vehiculoId: null }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("no toca el vehiculo si no se envia ni cambia el rol", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    await svc.actualizar("usr-1", { nombre: "Ana B" }, MAESTRO);
    expect(actualizado(repo)).not.toHaveProperty("vehiculoId");
  });

  it("cambiar a un rol sin vehiculo limpia el vehiculo heredado", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(usuario({ vehiculoId: "v1" })),
    });
    const svc = new UsuarioService(repo, buildZonaRepo(), buildVehiculoRepo(true));
    await svc.actualizar("usr-1", { rolId: "rol-admin" }, MAESTRO);
    expect(actualizado(repo).vehiculoId).toBeNull();
  });
});
