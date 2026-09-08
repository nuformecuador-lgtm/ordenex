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
    listMensajeros: vi.fn(),
    listMensajerosParaFiltro: vi.fn(),
    listByRol: vi.fn().mockResolvedValue([]), // exigido por IUserRepository; no ejercitado aqui
    listCuentasTienda: vi.fn().mockResolvedValue([]), // exigido por IUserRepository (feature 144); no ejercitado aqui
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue(usuario()),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn().mockResolvedValue(ROLES),
    contarAdminSatelitesActivos: vi.fn().mockResolvedValue(0), // ficha 379: exigido por IUserRepository
    restablecerContrasena: vi.fn(), // ficha 362
    ...over,
  };
}

function buildZonaRepo(exists: boolean): IZonaRepository {
  return {
    create: vi.fn(),
    // Feature 54: ZonaDTO nuevo (esCentral, sin pagos); findById(id, includeTarifas).
    findById: vi
      .fn()
      .mockResolvedValue(
        exists ? { id: "z1", nombre: "GAM", cobroVehiculo: false, distritosCount: 0, esCentral: false } : null,
      ),
    list: vi.fn(),
    listLite: vi.fn().mockResolvedValue([]), // feature 144; no ejercitado aqui
    update: vi.fn(),
    hardDelete: vi.fn(),
    countExistingDistritos: vi.fn(),
    countExistingVehiculos: vi.fn(),
    findCentralZonaId: vi.fn().mockResolvedValue(null),
    // FICHA 376 (Q4): lectura de solo lectura; este archivo no la ejercita.
    contarOrdenesVivasPorZona: vi.fn().mockResolvedValue([]),
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
    // feature 21: el mensajero tambien exige vehiculo; se pasa para aislar la
    // aserción a la zona (sin `vehiculoRepo` inyectado no se valida su existencia).
    const r = await svc.crear(
      { ...baseCrear, rolId: "rol-msg", zonaId: "z1", vehiculoId: "v1" },
      MAESTRO,
    );
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

  it("mensajero sin zonaId -> validation_error (zona obligatoria, R27)", async () => {
    const svc = new UsuarioService(repo, buildZonaRepo(true));
    const r = await svc.crear({ ...baseCrear, rolId: "rol-msg" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("zonaId");
    expect(repo.create).not.toHaveBeenCalled();
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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // FICHA 379 — BLOQUE A: LA ZONA SIGUE AL ROL (R1-R4/R7)
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // El defecto que cierran estos cuatro casos: `actualizar` solo recalculaba la zona cuando la
  // peticion TRAIA el campo, y el formulario lo OMITE cuando el rol nuevo no lleva zona. Un
  // adminSatelite degradado a admin conservaba su `zona_id`, y con el dinero de esa bodega
  // atrapado: solo un adminSatelite CUYA ZONA VIVA sea Z puede consolidar sus cierres.
  //
  // El campo hermano —el vehiculo— ya hacia esto bien doce lineas mas abajo del mismo metodo.

  it("R1 · cambiar el rol de adminSatelite a admin deja la zona en null aunque no se envie zonaId", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-sat", zonaId: "z1" })),
    });
    const svc = new UsuarioService(repo, buildZonaRepo(true));

    // La peticion NO lleva `zonaId`: es exactamente lo que manda el formulario al pasar a un
    // rol sin zona (spread condicional `...(esRolConZona ? { zonaId } : {})`).
    const r = await svc.actualizar("usr-1", { rolId: "rol-admin" }, MAESTRO);

    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // `toHaveProperty` con valor, no `.zonaId === null`: hace falta que la clave VIAJE, porque
    // es su presencia la que hace que el repositorio escriba `usuario_zona_cambiada` (R5).
    expect(data).toHaveProperty("zonaId", null);
  });

  it("R2 · cambiar el rol de mensajero a adminSatelite sin enviar zonaId conserva la zona actual", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-msg", zonaId: "z1" })),
    });
    const svc = new UsuarioService(repo, buildZonaRepo(true));

    const r = await svc.actualizar("usr-1", { rolId: "rol-sat" }, MAESTRO);

    expect(r.status).toBe("ok");
    // El rol nuevo SI lleva zona: la que ya tenia se conserva (y se revalida contra el catalogo),
    // no se borra por el hecho de no venir en la peticion.
    expect((repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1].zonaId).toBe("z1");
  });

  it("R3 · cambiar a un rol con zona sin tener ninguna -> validation_error en zonaId y no escribe", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-admin", zonaId: null })),
    });
    const svc = new UsuarioService(repo, buildZonaRepo(true));

    const r = await svc.actualizar("usr-1", { rolId: "rol-sat" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("zonaId");
    // Y NADA se escribe: la alternativa seria un adminSatelite sin zona, que es otra forma del
    // mismo dato sucio que esta ficha quita.
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R4 · alta y edicion resuelven la MISMA zona efectiva para el mismo par (rol, zona)", async () => {
    // ⚠️ NO son tres casos escritos a mano: se RECORRE el catalogo de roles del fixture y se
    // comparan las dos SALIDAS. Es la asercion que caza una segunda copia de la regla —que es
    // literalmente el defecto que esta ficha arregla: la zona y el vehiculo llevaban dos—.
    //
    // `undefined` = «la peticion no trae el campo»; en los dos caminos se parte de un usuario
    // SIN zona, para que «no se pidio zona» signifique lo mismo en el alta y en la edicion.
    async function zonaEfectivaDeAlta(rolId: string, zonaId: string | null | undefined) {
      const local = buildRepo();
      const svc = new UsuarioService(local, buildZonaRepo(true));
      const r = await svc.crear({ ...baseCrear, rolId, zonaId, vehiculoId: "v1" }, MAESTRO);
      if (r.status !== "ok") return { estado: r.status };
      return {
        estado: "ok",
        zonaId: (local.create as ReturnType<typeof vi.fn>).mock.calls[0][0].zonaId,
      };
    }

    async function zonaEfectivaDeEdicion(rolId: string, zonaId: string | null | undefined) {
      const local = buildRepo({
        findById: vi.fn().mockResolvedValue(usuario({ rolId: "rol-admin", zonaId: null })),
      });
      const svc = new UsuarioService(local, buildZonaRepo(true));
      const r = await svc.actualizar("usr-1", { rolId, zonaId, vehiculoId: "v1" }, MAESTRO);
      if (r.status !== "ok") return { estado: r.status };
      return {
        estado: "ok",
        zonaId: (local.update as ReturnType<typeof vi.fn>).mock.calls[0][1].zonaId,
      };
    }

    for (const rol of ROLES) {
      for (const pedida of ["z1", undefined] as const) {
        const alta = await zonaEfectivaDeAlta(rol.id, pedida);
        const edicion = await zonaEfectivaDeEdicion(rol.id, pedida);
        expect(
          edicion,
          `rol ${rol.value} con zona pedida ${String(pedida)}: el alta resolvio ` +
            `${JSON.stringify(alta)} y la edicion ${JSON.stringify(edicion)}`,
        ).toEqual(alta);
      }
    }
  });
});
