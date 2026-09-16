import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import { resolverRevisionSinpePendiente } from "@/lib/auth/revision-sinpe-pendiente";
import type {
  IZonaRepository,
  SinpeZonaRow,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T18 — LA REVISION OBLIGATORIA DEL PRIMER INICIO DE SESION (R26, R30, R31).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Este resolvedor se llama desde el layout del portal, o sea EN CADA CARGA DE CADA PAGINA. Dos
// cosas se miden y no se suponen: a QUIEN se le pide la revision, y quien NO PAGA NI UNA CONSULTA.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL.

const NUM = "80000000";
const NOMBRE = "Titular de Prueba";

const CENTRAL: SinpeZonaRow = {
  id: "z-central",
  nombre: "GAM",
  esCentral: true,
  sinpeNumero: NUM,
  sinpeNombre: NOMBRE,
  sinpeRevisadoAt: null,
};

const SATELITE: SinpeZonaRow = {
  id: "z-satelite",
  nombre: "Guanacaste",
  esCentral: false,
  sinpeNumero: "70000001",
  sinpeNombre: "Otro Titular de Prueba",
  sinpeRevisadoAt: null,
};

const ZONAS = new Map([
  [CENTRAL.id, CENTRAL],
  [SATELITE.id, SATELITE],
]);

function buildRepo(overrides: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    listLite: vi.fn(),
    update: vi.fn(),
    hardDelete: vi.fn(),
    countExistingDistritos: vi.fn(),
    countExistingVehiculos: vi.fn(),
    findCentralZonaId: vi.fn().mockResolvedValue(CENTRAL.id),
    contarOrdenesVivasPorZona: vi.fn(),
    listarSinpe: vi.fn(),
    findSinpeByZona: vi.fn().mockImplementation(async (id: string) => ZONAS.get(id) ?? null),
    zonaIdDeUsuario: vi.fn().mockResolvedValue(SATELITE.id),
    guardarSinpe: vi.fn(),
    confirmarSinpe: vi.fn(),
    ...overrides,
  };
}

const actor = (rol: RolValue, usuarioId = "u-1"): Actor => ({ usuarioId, rol, zonaId: null });

describe("429/R26 — a quien se le pone el SINPE delante", () => {
  it("⭑ `adminSatelite` de una bodega SIN revisar lo recibe, con el par de SU bodega", async () => {
    const repo = buildRepo();
    const r = await resolverRevisionSinpePendiente(actor("adminSatelite"), repo);
    expect(r).not.toBeNull();
    expect(r?.zonaId).toBe(SATELITE.id);
    expect(r?.numero).toBe(SATELITE.sinpeNumero);
    expect(r?.nombre).toBe(SATELITE.sinpeNombre);
    // R27: quien recibe el aviso SIEMPRE puede corregirlo en el sitio.
    expect(r?.editable).toBe(true);
    // Y la zona sale de la BASE por `usuarioId`, no de la sesion (R20).
    expect(repo.zonaIdDeUsuario).toHaveBeenCalledWith("u-1");
  });

  it.each(["admin", "maestro"] as const)(
    "⭑ `%s` recibe el de LA CENTRAL — el hueco que nadie mas cierra",
    async (rol) => {
      // En GAM no hay `adminSatelite`: alli nadie tiene un login que se lo exija y la revision
      // «depende de que un admin entre a configuracion». Es ademas la bodega mas grande.
      const repo = buildRepo();
      const r = await resolverRevisionSinpePendiente(actor(rol), repo);
      expect(r?.zonaId).toBe(CENTRAL.id);
      expect(r?.esCentral).toBe(true);
      expect(repo.findCentralZonaId).toHaveBeenCalled();
      // Y NO se les pregunta por su zona: `admin` y `maestro` no estan acotados por zona.
      expect(repo.zonaIdDeUsuario).not.toHaveBeenCalled();
    },
  );

  it("`revisadoAt` viaja como `null`: por construccion, si tuviera fecha no habria aviso", async () => {
    const r = await resolverRevisionSinpePendiente(actor("adminSatelite"), buildRepo());
    expect(r?.revisadoAt).toBeNull();
  });
});

describe("429/R30 — una vez revisada, no vuelve para NADIE de esa bodega", () => {
  it("⭑ con fecha de revision, el resolvedor devuelve «nada que pedir»", async () => {
    const repo = buildRepo({
      findSinpeByZona: vi
        .fn()
        .mockResolvedValue({ ...SATELITE, sinpeRevisadoAt: new Date("2026-09-15T12:00:00Z") }),
    });
    expect(await resolverRevisionSinpePendiente(actor("adminSatelite"), repo)).toBeNull();
  });

  it("⭑ y no vuelve para el OTRO administrador de la misma bodega: la marca es de la BODEGA", async () => {
    // D2. Si la marca fuera de la persona, el segundo acceso volveria a pedir lo mismo y la gente
    // aprenderia a cerrarlo por reflejo.
    const repo = buildRepo({
      findSinpeByZona: vi.fn().mockResolvedValue({ ...SATELITE, sinpeRevisadoAt: new Date() }),
    });
    expect(await resolverRevisionSinpePendiente(actor("adminSatelite", "u-1"), repo)).toBeNull();
    expect(await resolverRevisionSinpePendiente(actor("adminSatelite", "u-2"), repo)).toBeNull();
  });
});

describe("429/R31 — a quien NO se le pide nada, y a que coste", () => {
  it.each(["mensajero", "adminTienda"] as const)(
    "⭑ `%s` no recibe aviso Y NO EMITE NINGUNA CONSULTA",
    async (rol) => {
      // Este resolvedor corre en CADA carga de CADA pagina del portal. Una consulta de mas para
      // quien no puede hacer nada con ella se paga en todas. Se mide contando llamadas, no leyendo
      // el codigo.
      const repo = buildRepo();
      expect(await resolverRevisionSinpePendiente(actor(rol), repo)).toBeNull();
      expect(repo.zonaIdDeUsuario).not.toHaveBeenCalled();
      expect(repo.findCentralZonaId).not.toHaveBeenCalled();
      expect(repo.findSinpeByZona).not.toHaveBeenCalled();
    },
  );

  it("sin sesion (`actor === null`) tampoco se consulta nada", async () => {
    const repo = buildRepo();
    expect(await resolverRevisionSinpePendiente(null, repo)).toBeNull();
    expect(repo.findSinpeByZona).not.toHaveBeenCalled();
  });

  it("⭑ un `adminSatelite` SIN zona devuelve `null` y NO LANZA", async () => {
    // Estado REPRESENTABLE: `usuario.zona_id` es nullable. Que una carga de pagina reviente por
    // esto seria cambiar un aviso que no se pinta por un portal que no abre.
    const repo = buildRepo({ zonaIdDeUsuario: vi.fn().mockResolvedValue(null) });
    await expect(resolverRevisionSinpePendiente(actor("adminSatelite"), repo)).resolves.toBeNull();
    expect(repo.findSinpeByZona).not.toHaveBeenCalled();
  });

  it("si no hay zona central, `admin` no recibe nada y no revienta", async () => {
    // `findCentralZonaId` devuelve `null` cuando ninguna zona la tiene (feature 54/R8).
    const repo = buildRepo({ findCentralZonaId: vi.fn().mockResolvedValue(null) });
    await expect(resolverRevisionSinpePendiente(actor("admin"), repo)).resolves.toBeNull();
  });

  it("si la zona se borro entre las dos lecturas, devuelve `null` en vez de romper la pagina", async () => {
    const repo = buildRepo({ findSinpeByZona: vi.fn().mockResolvedValue(null) });
    await expect(resolverRevisionSinpePendiente(actor("adminSatelite"), repo)).resolves.toBeNull();
  });
});
