import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { IUserRepository, UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";
import type {
  IZonaRepository,
  UpdateZonaResult,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";
import { GeografiaService } from "@/lib/services/GeografiaService";
import { UsuarioService } from "@/lib/services/UsuarioService";
import { ZonaService } from "@/lib/services/ZonaService";
import type { ActualizarZonaInput, CrearZonaInput, ZonaDTO } from "@/lib/types/zona";

// ⭑ FICHA 392 — EL NOMBRE DE LA TIENDA Y LOS DE LA GEOGRAFIA TAMBIEN SE IMPRIMEN.
//
// La etiqueta pone en el papel diez datos (`datosDeEtiqueta`). La ficha 383 cerro los que vienen
// de la ORDEN y dejo fuera, a proposito, los dos que vienen del CATALOGO: `tiendaNombre`
// (`usuario.nombre`) y `ubicacion` (zona / provincia / canton / distrito, unidos por
// `geografiaLegible`). Este archivo cubre las CINCO escrituras que producen esos nombres.
//
// ⚠️ LOS MENSAJES ESPERADOS SON LITERALES. No se componen con las funciones que los generan —eso
// esta siempre verde—, y sus caracteres invisibles van escapados.
//
// ⚠️ «NO SE GUARDA» SE AFIRMA SOBRE EL DOBLE DEL REPOSITORIO, no sobre el `status` devuelto: un
// test de servicio con dobles no ve lo que se escribe en la columna, asi que lo unico que puede
// afirmar de verdad es que NADIE le pidio escribir.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

/** El nombre irreparable: un emoji. Ninguna normalizacion lo vuelve imprimible. */
const NOMBRE_EMOJI = "Tienda \u{1F642}";
const MSG_EMOJI =
  "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1F642}\u2069» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.";

/** El nombre reparable: el double-struck del caso medido en produccion por la 382. */
const NOMBRE_DOUBLE_STRUCK = "\u{1D54B}ienda Feliz";
const MSG_DOUBLE_STRUCK =
  "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1D54B}\u2069» (U+1D54B). Escríbelo así: «Tienda Feliz».";

// ── Tienda: `usuario.nombre` ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/utils/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hash(${plain})`),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/utils/password-generator", () => ({
  generateStrongPassword: vi.fn(() => "Gen3rada!X"),
}));

function usuarioDTO(): UsuarioPublico {
  return {
    id: "usr-1",
    nombre: "Tienda Feliz",
    email: "tienda@example.com",
    telefono: "099",
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-tienda",
    fulfillment: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function repoUsuarios(): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn().mockResolvedValue(usuarioDTO()),
    findByEmail: vi.fn(),
    create: vi.fn().mockResolvedValue(usuarioDTO()),
    updatePasswordHash: vi.fn(),
    listMensajeros: vi.fn(),
    listMensajerosParaFiltro: vi.fn(),
    listByRol: vi.fn().mockResolvedValue([]),
    listCuentasTienda: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue(usuarioDTO()),
    setEstado: vi.fn().mockResolvedValue(usuarioDTO()),
    listTiposIdentificacion: vi.fn().mockResolvedValue([{ id: "tipo-1", value: "cedula" }]),
    listRoles: vi.fn().mockResolvedValue([{ id: "rol-tienda", value: "adminTienda" }]),
    contarAdminSatelitesActivos: vi.fn().mockResolvedValue(0),
    restablecerContrasena: vi.fn(),
  } as unknown as IUserRepository;
}

const altaTienda = {
  email: "tienda@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-tienda",
  passwordMode: "manual" as const,
  password: "Abcdef1!",
};

describe("392 — el nombre de la TIENDA, que la etiqueta imprime como `tiendaNombre`", () => {
  let repo: IUserRepository;
  let service: UsuarioService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = repoUsuarios();
    service = new UsuarioService(repo);
  });

  it("alta con un caracter irreparable: `validation_error` y NO se crea la cuenta", async () => {
    const res = await service.crear({ ...altaTienda, nombre: NOMBRE_EMOJI }, MAESTRO);

    expect(res).toEqual({ status: "validation_error", fieldErrors: { nombre: [MSG_EMOJI] } });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("alta con un caracter REPARABLE: tampoco se crea; el texto bueno viaja como sugerencia", async () => {
    const res = await service.crear({ ...altaTienda, nombre: NOMBRE_DOUBLE_STRUCK }, MAESTRO);

    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { nombre: [MSG_DOUBLE_STRUCK] },
    });
    // A2 de la 383 aplicada aqui: Ordenex NO guarda un nombre que nadie tecleo.
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("edicion del nombre a uno no imprimible: `validation_error` y NO se escribe", async () => {
    const res = await service.actualizar("usr-1", { nombre: NOMBRE_EMOJI }, MAESTRO);

    expect(res).toEqual({ status: "validation_error", fieldErrors: { nombre: [MSG_EMOJI] } });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("una edicion que NO manda el nombre no lo evalua: se guarda el telefono y ya", async () => {
    const res = await service.actualizar("usr-1", { telefono: "088" }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it("un nombre imprimible sigue creando la cuenta exactamente igual que antes", async () => {
    const res = await service.crear({ ...altaTienda, nombre: "Tienda Feliz" }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("y un nombre con `₡`, `€` o `™` TAMBIEN se crea: la fuente los cubre", async () => {
    for (const nombre of ["Tienda ₡olones", "Bazar €uro", "Casa Mora™"]) {
      const res = await service.crear({ ...altaTienda, nombre }, MAESTRO);
      expect(res.status, nombre).toBe("ok");
    }
    expect(repo.create).toHaveBeenCalledTimes(3);
  });
});

// ── Zona: `zona.nombre`, la primera parte de `ubicacion` ─────────────────────────────────────

function zonaDTO(): ZonaDTO {
  return { id: "z1", nombre: "GAM", cobroVehiculo: false, distritosCount: 1, esCentral: false };
}

function repoZonas(): IZonaRepository {
  return {
    create: vi.fn().mockResolvedValue(zonaDTO()),
    findById: vi.fn().mockResolvedValue(zonaDTO()),
    list: vi.fn().mockResolvedValue({ items: [zonaDTO()], total: 1 }),
    listLite: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({
      estado: "ok",
      zona: zonaDTO(),
      ordenesReconciliadas: 0,
      ordenesRetenidasEnBodegaSatelite: 0,
    } satisfies UpdateZonaResult),
    hardDelete: vi.fn().mockResolvedValue("ok"),
    countExistingDistritos: vi.fn(async (ids: string[]) => ids.length),
    countExistingVehiculos: vi.fn(async (ids: string[]) => ids.length),
    findCentralZonaId: vi.fn().mockResolvedValue(null),
    contarOrdenesVivasPorZona: vi.fn(async (ids: string[]) =>
      ids.map((zonaId) => ({ zonaId, ordenesVivas: 0 })),
    ),
  } as unknown as IZonaRepository;
}

function crearZona(nombre: string): CrearZonaInput {
  return { nombre, cobroVehiculo: false, esCentral: false, distritoIds: ["d1"], tarifas: [] };
}

function actualizarZona(nombre: string): ActualizarZonaInput {
  return { nombre, cobroVehiculo: false, distritoIds: ["d1"], tarifas: [] };
}

describe("392 — el nombre de la ZONA, primera parte de `ubicacion` en la etiqueta", () => {
  let repo: IZonaRepository;
  let service: ZonaService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = repoZonas();
    service = new ZonaService(repo);
  });

  it("crear con un caracter irreparable: `validation_error` y NO se crea la zona", async () => {
    const res = await service.crear(crearZona(NOMBRE_EMOJI), MAESTRO);

    expect(res).toEqual({ status: "validation_error", fieldErrors: { nombre: [MSG_EMOJI] } });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("actualizar con un caracter REPARABLE: tampoco se escribe", async () => {
    const res = await service.actualizar("z1", actualizarZona(NOMBRE_DOUBLE_STRUCK), MAESTRO);

    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { nombre: [MSG_DOUBLE_STRUCK] },
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un nombre imprimible sigue creando y actualizando igual que antes", async () => {
    expect((await service.crear(crearZona("GAM"), MAESTRO)).status).toBe("ok");
    expect((await service.actualizar("z1", actualizarZona("GAM"), MAESTRO)).status).toBe("ok");
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});

// ── Geografia: provincia / canton / distrito ─────────────────────────────────────────────────

function repoGeo(): IGeoRepository {
  return {
    listProvinciasLite: vi.fn(async () => []),
    listCantonesLite: vi.fn(async () => []),
    listDistritosLite: vi.fn(async () => []),
    listGeografiaLitePorZona: vi.fn(async () => ({ provincias: [], cantones: [], distritos: [] })),
    listArbol: vi.fn(async () => []),
    findHermanos: vi.fn(async () => [] as { id: string; nombre: string }[] | null),
    crear: vi.fn(async () => "id-nuevo"),
    cambiarActivacion: vi.fn(async () => "cambiado" as const),
    findHermanosDeNodo: vi.fn(async () => [] as { id: string; nombre: string }[] | null),
    renombrar: vi.fn(async () => "renombrado" as const),
  } as unknown as IGeoRepository;
}

function repoOrdenes() {
  return { contarSinEntregarPorNodoGeografico: vi.fn(async () => 0) };
}

describe("392 — los nombres de la GEOGRAFIA, que la 375 hizo renombrables", () => {
  let repo: IGeoRepository;
  let service: GeografiaService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = repoGeo();
    service = new GeografiaService(repo, repoOrdenes());
  });

  it("alta de PROVINCIA con un caracter irreparable: `validation_error`, sin leer ni escribir", async () => {
    const res = await service.crear({ nivel: "provincia", nombre: NOMBRE_EMOJI }, MAESTRO);

    expect(res).toEqual({ status: "validation_error", fieldErrors: { nombre: [MSG_EMOJI] } });
    expect(repo.crear).not.toHaveBeenCalled();
    // Ni siquiera se consulta a los hermanos: la puerta va antes de la primera consulta.
    expect(repo.findHermanos).not.toHaveBeenCalled();
  });

  it("alta de CANTON con un caracter reparable: `validation_error` con la sugerencia", async () => {
    const res = await service.crear(
      { nivel: "canton", nombre: NOMBRE_DOUBLE_STRUCK, provinciaId: "p1" },
      MAESTRO,
    );

    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { nombre: [MSG_DOUBLE_STRUCK] },
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("alta de DISTRITO con un caracter irreparable: `validation_error`", async () => {
    const res = await service.crear(
      { nivel: "distrito", nombre: NOMBRE_EMOJI, cantonId: "c1" },
      MAESTRO,
    );

    expect(res).toEqual({ status: "validation_error", fieldErrors: { nombre: [MSG_EMOJI] } });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("RENOMBRAR un distrito a un nombre no imprimible: `validation_error` y no se renombra", async () => {
    const res = await service.renombrar(
      { nivel: "distrito", id: "d1", nombre: NOMBRE_EMOJI },
      MAESTRO,
    );

    expect(res).toEqual({ status: "validation_error", fieldErrors: { nombre: [MSG_EMOJI] } });
    expect(repo.renombrar).not.toHaveBeenCalled();
    expect(repo.findHermanosDeNodo).not.toHaveBeenCalled();
  });

  it("RENOMBRAR a un nombre reparable: tampoco se renombra; se devuelve la sugerencia", async () => {
    const res = await service.renombrar(
      { nivel: "canton", id: "c1", nombre: NOMBRE_DOUBLE_STRUCK },
      MAESTRO,
    );

    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { nombre: [MSG_DOUBLE_STRUCK] },
    });
    expect(repo.renombrar).not.toHaveBeenCalled();
  });

  it("un nombre imprimible sigue dando de alta y renombrando igual que antes", async () => {
    expect((await service.crear({ nivel: "provincia", nombre: "San José" }, MAESTRO)).status).toBe(
      "ok",
    );
    expect(
      (await service.renombrar({ nivel: "distrito", id: "d1", nombre: "Purral" }, MAESTRO)).status,
    ).toBe("ok");
    expect(repo.crear).toHaveBeenCalledTimes(1);
    expect(repo.renombrar).toHaveBeenCalledTimes(1);
  });

  it("el rol manda ANTES que el nombre: un no-maestro con nombre malo recibe `forbidden`", async () => {
    const res = await service.crear(
      { nivel: "provincia", nombre: NOMBRE_EMOJI },
      { usuarioId: "x", rol: "adminTienda" },
    );

    expect(res).toEqual({ status: "forbidden" });
  });
});

// ── La prueba de que la definicion es UNA ────────────────────────────────────────────────────

describe("392/R1 — las cinco escrituras comparten definicion Y redaccion", () => {
  it("el MISMO nombre produce el MISMO mensaje en tienda, zona y geografia", async () => {
    const usuarios = repoUsuarios();
    const zonas = repoZonas();
    const geo = repoGeo();

    const rTienda = await new UsuarioService(usuarios).crear(
      { ...altaTienda, nombre: NOMBRE_DOUBLE_STRUCK },
      MAESTRO,
    );
    const rZona = await new ZonaService(zonas).crear(crearZona(NOMBRE_DOUBLE_STRUCK), MAESTRO);
    const rGeo = await new GeografiaService(geo, repoOrdenes()).renombrar(
      { nivel: "distrito", id: "d1", nombre: NOMBRE_DOUBLE_STRUCK },
      MAESTRO,
    );

    const esperado = { status: "validation_error", fieldErrors: { nombre: [MSG_DOUBLE_STRUCK] } };
    expect(rTienda).toEqual(esperado);
    expect(rZona).toEqual(esperado);
    expect(rGeo).toEqual(esperado);
  });
});
