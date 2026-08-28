import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import {
  PlantillaDuplicadaError,
  type IPlantillaMensajeRepository,
  type PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { Actor } from "@/lib/interfaces/services/IPlantillaMensajeService";

// Feature 107 — T5. Service con repo mock.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function plantilla(overrides: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "Bienvenida",
    cuerpo: "Hola {{usuario}}",
    variables: ["usuario"],
    variablesNombres: {},
    estado: "pending",
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: null,
    templateIdioma: null,
    createdBy: "m1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function buildRepo(overrides: Partial<IPlantillaMensajeRepository> = {}): IPlantillaMensajeRepository {
  return {
    create: vi.fn().mockResolvedValue(plantilla()),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    count: vi.fn().mockResolvedValue(0),
    findById: vi.fn().mockResolvedValue(plantilla()),
    findByNombre: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(plantilla()),
    updateEstado: vi.fn().mockResolvedValue(plantilla({ estado: "inactivo" })),
    softDelete: vi.fn().mockResolvedValue(true),
    marcarWelcomeMessage: vi.fn().mockResolvedValue(plantilla({ welcomeMessage: true })),
    setTemplate: vi.fn().mockResolvedValue(undefined),
    sincronizarTemplatePorNombre: vi.fn().mockResolvedValue(true),
    crearDesdeMeta: vi.fn().mockResolvedValue(true),
    listarEnviables: vi.fn().mockResolvedValue([]),
    findEnviableById: vi.fn().mockResolvedValue(null),
    findWelcomeMessage: vi.fn().mockResolvedValue(null),
    listarUsablesParaTexto: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

let repo: IPlantillaMensajeRepository;
let service: PlantillaMensajeService;

beforeEach(() => {
  vi.clearAllMocks();
  repo = buildRepo();
  service = new PlantillaMensajeService(repo);
});

describe("R5: forbidden si el actor no es maestro", () => {
  it("todas las operaciones rechazan a un rol distinto de maestro", async () => {
    for (const actor of [ADMIN, DESCONOCIDO]) {
      expect((await service.crear({ nombre: "N", cuerpo: "c", plantillaTienda: false }, actor)).status).toBe("forbidden");
      expect((await service.listar({ page: 1, pageSize: 25 }, actor)).status).toBe("forbidden");
      expect((await service.actualizar("pl-1", { nombre: "N" }, actor)).status).toBe("forbidden");
      expect((await service.cambiarEstado("pl-1", { estado: "inactivo" }, actor)).status).toBe(
        "forbidden",
      );
      expect((await service.eliminar("pl-1", actor)).status).toBe("forbidden");
      expect((await service.preview("c", actor)).status).toBe("forbidden");
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("R8/R12/R15: crea con nombre y cuerpo validos, persiste variables, nace pending", () => {
  it("deriva las variables del cuerpo y las pasa al repo", async () => {
    const r = await service.crear({ nombre: "Aviso", cuerpo: "Hola {{usuario}} y {{cod}}", plantillaTienda: false }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: "Aviso",
        variables: ["usuario", "cod"], // R15
        createdBy: "m1",
      }),
    );
    if (r.status === "ok") expect(r.plantilla.estado).toBe("pending"); // R12
  });
});

describe("R16: validation_error de cuerpo por llave malformada", () => {
  it("crear con {{}} -> validation_error sin llamar al repo", async () => {
    const r = await service.crear({ nombre: "X", cuerpo: "Hola {{}}", plantillaTienda: false }, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("cuerpo");
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("R10: crear devuelve conflict si el nombre existe", () => {
  it("mapea PlantillaDuplicadaError a conflict(nombre)", async () => {
    repo = buildRepo({ create: vi.fn().mockRejectedValue(new PlantillaDuplicadaError("nombre")) });
    service = new PlantillaMensajeService(repo);
    const r = await service.crear({ nombre: "Dup", cuerpo: "c", plantillaTienda: false }, MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.campo).toBe("nombre");
  });
});

describe("R20: actualiza nombre y cuerpo y recalcula variables", () => {
  it("recalcula variables cuando cambia el cuerpo", async () => {
    await service.actualizar("pl-1", { cuerpo: "Nuevo {{cod}}" }, MAESTRO);
    expect(repo.update).toHaveBeenCalledWith(
      "pl-1",
      expect.objectContaining({ cuerpo: "Nuevo {{cod}}", variables: ["cod"] }),
    );
  });
});

describe("R21: actualizar inexistente -> not_found", () => {
  it("findById null -> not_found sin update", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new PlantillaMensajeService(repo);
    const r = await service.actualizar("nope", { nombre: "N" }, MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("R22: unicidad excluye la propia plantilla", () => {
  it("mismo nombre en la misma fila NO es conflicto", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(plantilla({ id: "pl-1", nombre: "Bienvenida" })),
      findByNombre: vi.fn().mockResolvedValue(plantilla({ id: "pl-1", nombre: "Bienvenida" })),
    });
    service = new PlantillaMensajeService(repo);
    const r = await service.actualizar("pl-1", { nombre: "Bienvenida" }, MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("nombre de OTRA plantilla -> conflict", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(plantilla({ id: "pl-1", nombre: "Bienvenida" })),
      findByNombre: vi.fn().mockResolvedValue(plantilla({ id: "pl-2", nombre: "Otra" })),
    });
    service = new PlantillaMensajeService(repo);
    const r = await service.actualizar("pl-1", { nombre: "Otra" }, MAESTRO);
    expect(r.status).toBe("conflict");
  });
});

describe("R24: desactivar mueve la plantilla a inactivo (unica transicion del front)", () => {
  it("fija estado inactivo", async () => {
    const r = await service.cambiarEstado("pl-1", { estado: "inactivo" }, MAESTRO);
    expect(repo.updateEstado).toHaveBeenCalledWith("pl-1", "inactivo");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.plantilla.estado).toBe("inactivo");
  });
});

describe("R26: cambiar estado inexistente/borrada -> not_found", () => {
  it("updateEstado null -> not_found", async () => {
    repo = buildRepo({ updateEstado: vi.fn().mockResolvedValue(null) });
    service = new PlantillaMensajeService(repo);
    const r = await service.cambiarEstado("nope", { estado: "inactivo" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("R27/R29: eliminar marca deletedAt (soft) y no borra; inexistente -> not_found", () => {
  it("softDelete true -> ok", async () => {
    const r = await service.eliminar("pl-1", MAESTRO);
    expect(repo.softDelete).toHaveBeenCalledWith("pl-1");
    expect(r.status).toBe("ok");
  });

  it("softDelete false (inexistente/ya borrada) -> not_found", async () => {
    repo = buildRepo({ softDelete: vi.fn().mockResolvedValue(false) });
    service = new PlantillaMensajeService(repo);
    const r = await service.eliminar("nope", MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("R18: preview resuelve las variables con los ejemplos del catalogo", () => {
  // El marcador en MAYUSCULAS que esta prueba exigia quedo DEROGADO por la feature 288/T5
  // (design.md 4.3, «Contradiccion resuelta»): `preview` pasa por `previewConEjemplos`, que
  // resuelve TODA clave extraida, y una clave fuera del catalogo cae a cadena vacia. La
  // preview ensena asi EL HUECO REAL que le llegaria al cliente en vez de un `USUARIO` que
  // el cliente nunca veria. Quien avisa de esa clave es `clavesSinCampo`, no el marcador.
  it("una clave fuera del catalogo se ve como el hueco vacio que recibiria el cliente", async () => {
    const r = await service.preview("Hola {{usuario}}, orden {{cod}}", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.texto).toBe("Hola , orden ");
  });

  // Exacto contra el `ejemplo` que el catalogo declara para `cliente`, como su hermano de
  // arriba. Un `not.toContain("{{")` se satisfacia tambien con la cadena vacia —justo el
  // desenlace que el test de al lado documenta para una clave AUSENTE—, asi que no
  // distinguia «resuelto» de «no resuelto».
  it("una clave DEL catalogo se ve con su valor de ejemplo formateado", async () => {
    const r = await service.preview("Hola {{cliente}}", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.texto).toBe("Hola María Rodríguez");
  });

  it("cuerpo malformado -> validation_error", async () => {
    const r = await service.preview("Hola {{}}", MAESTRO);
    expect(r.status).toBe("validation_error");
  });
});
