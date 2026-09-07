import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { ZonaService } from "@/lib/services/ZonaService";
import type {
  IZonaRepository,
  UpdateZonaResult,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type { ActualizarZonaInput, CrearZonaInput, ZonaDTO } from "@/lib/types/zona";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "x", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "t", rol: "adminTienda" };
const DESCONOCIDO: Actor = { usuarioId: "z", rol: "invitado" as RolValue };
const NO_MAESTROS = [ADMIN, MENSAJERO, TIENDA, DESCONOCIDO];

function dto(overrides: Partial<ZonaDTO> = {}): ZonaDTO {
  return { id: "z1", nombre: "GAM", cobroVehiculo: false, distritosCount: 1, esCentral: false, ...overrides };
}

/**
 * FICHA 366: `update` ya no devuelve el DTO pelado, sino el DTO MAS el conteo de R12.
 * FICHA 376: y el desenlace viaja NOMBRADO en `estado`, porque ahora hay DOS formas de no guardar.
 */
function resultadoUpdate(zona: ZonaDTO = dto(), ordenesReconciliadas = 0): UpdateZonaResult {
  return { estado: "ok", zona, ordenesReconciliadas };
}

function buildRepo(overrides: Partial<IZonaRepository> = {}): IZonaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [dto()], total: 1 }),
    listLite: vi.fn().mockResolvedValue([]), // feature 144; no ejercitado aqui
    update: vi.fn().mockResolvedValue(resultadoUpdate()),
    hardDelete: vi.fn().mockResolvedValue("ok"),
    // por defecto: todos los ids existen.
    countExistingDistritos: vi.fn(async (ids: string[]) => ids.length),
    countExistingVehiculos: vi.fn(async (ids: string[]) => ids.length),
    findCentralZonaId: vi.fn().mockResolvedValue(null), // feature 54
    // FICHA 376 (Q4): por defecto, cero ordenes vivas en cada zona pedida.
    contarOrdenesVivasPorZona: vi.fn(async (ids: string[]) =>
      ids.map((zonaId) => ({ zonaId, ordenesVivas: 0 })),
    ),
    ...overrides,
  };
}

function crearInput(overrides: Partial<CrearZonaInput> = {}): CrearZonaInput {
  return {
    nombre: "GAM",
    cobroVehiculo: false,
    esCentral: false, // feature 54
    distritoIds: ["d1"],
    tarifas: [],
    ...overrides,
  };
}

let repo: IZonaRepository;
let service: ZonaService;

beforeEach(() => {
  repo = buildRepo();
  service = new ZonaService(repo);
});

describe("autorizacion — solo maestro (feature 24)", () => {
  it("crear: maestro OK", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
  });

  it.each(NO_MAESTROS)("crear: rol %o -> forbidden y no persiste", async (actor) => {
    const r = await service.crear(crearInput(), actor);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  // `arbol` salio de esta lista el 2026-08-07 al borrarse la cadena entera; el gate maestro
  // de las cinco operaciones que quedan se sigue probando igual.
  it("listar/obtener/actualizar/borrar: no-maestro -> forbidden", async () => {
    expect((await service.listar({ page: 1, pageSize: 25 }, ADMIN)).status).toBe("forbidden");
    expect((await service.obtener("z1", ADMIN)).status).toBe("forbidden");
    expect((await service.actualizar("z1", crearInput(), ADMIN)).status).toBe("forbidden");
    expect((await service.borrar("z1", ADMIN)).status).toBe("forbidden");
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });
});

describe("crear — validacion de existencia", () => {
  it("distritoId inexistente -> validation_error", async () => {
    repo = buildRepo({ countExistingDistritos: vi.fn().mockResolvedValue(0) });
    service = new ZonaService(repo);
    const r = await service.crear(crearInput({ distritoIds: ["dX"] }), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("distritoIds");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("vehiculoId inexistente -> validation_error", async () => {
    repo = buildRepo({ countExistingVehiculos: vi.fn().mockResolvedValue(0) });
    service = new ZonaService(repo);
    const input = crearInput({
      cobroVehiculo: true,
      tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "vX" }],
    });
    const r = await service.crear(input, MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("tarifas");
  });

  it("deduplica distritoIds antes de crear", async () => {
    await service.crear(crearInput({ distritoIds: ["d1", "d1", "d2"] }), MAESTRO);
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.distritoIds).toEqual(["d1", "d2"]);
  });

  it("mapea vehiculoId undefined -> null hacia el repo", async () => {
    await service.crear(crearInput({ cobroVehiculo: false, tarifas: [{ cobroEntregado: 1, cobroRechazado: 2 }] }), MAESTRO);
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.tarifas[0].vehiculoId).toBeNull();
  });
});

describe("borrar", () => {
  it("hardDelete ok -> ok", async () => {
    expect((await service.borrar("z1", MAESTRO)).status).toBe("ok");
  });
  it("hardDelete not_found -> not_found", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("not_found") });
    service = new ZonaService(repo);
    expect((await service.borrar("zX", MAESTRO)).status).toBe("not_found");
  });
  it("hardDelete referenced -> conflict con motivo `en_uso`", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("referenced") });
    service = new ZonaService(repo);
    const r = await service.borrar("z1", MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toBe("en_uso");
  });

  // ⭑ FICHA 376 / R11 — los DOS conflictos tienen que ser distinguibles SIN inferirlo.
  it("⭑ R11: hardDelete `es_central` -> conflict con motivo `es_central`, distinto de `en_uso`", async () => {
    // Antes de esta ficha los dos rechazos habrian llegado como el MISMO `{ status: "conflict" }` y
    // la pantalla habria dicho «la zona esta en uso» para un caso en el que no hay nada en uso: la
    // salida no es vaciar la zona, es marcar OTRA zona como central.
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("es_central") });
    service = new ZonaService(repo);
    const r = await service.borrar("z1", MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.motivo).toBe("es_central");
      expect(r.motivo).not.toBe("en_uso");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 376 — la guarda «siempre tiene que haber una central», traducida hacia fuera
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("376 — el desenlace `sin_zona_central` del repositorio", () => {
  /**
   * ⚠️ LO QUE ESTE BLOQUE **NO** MIDE, y esta dicho a proposito: que la guarda FUNCIONE. Eso vive
   * en un `WHERE`/un `if` DENTRO de la transaccion del repositorio, y con un doble el service ve
   * lo que el doble quiera devolver. La guarda se mide contra Postgres real en
   * `tests/integration/db/zona-central-guarda-y-rastro.test.ts`. Aqui se mide SOLO la traduccion:
   * que el desenlace no se pierda ni se confunda con `not_found`.
   */
  it("⭑ R6: `sin_zona_central` -> validation_error con el motivo colgado de `esCentral`", async () => {
    repo = buildRepo({ update: vi.fn().mockResolvedValue({ estado: "sin_zona_central" }) });
    service = new ZonaService(repo);

    const r = await service.actualizar("z1", crearInput({ esCentral: false }), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      // R6: señala EL CAMPO de la marca, para que la pantalla lo pinte junto a la casilla (R23).
      expect(Object.keys(r.fieldErrors)).toEqual(["esCentral"]);
      // LITERAL a proposito, y no la constante que lo genera: ESE texto es el contrato con la
      // persona que esta guardando. Comparar contra su propia fuente dejaria pasar cualquier
      // reescritura del mensaje, incluida una que no diga que hacer.
      expect(r.fieldErrors.esCentral).toEqual([
        "Tiene que haber una zona central. Para quitarle la marca a ésta, márcala en otra zona.",
      ]);
      // Y es DISTINGUIBLE de los otros errores de validacion de la zona (R6): ninguno de los dos
      // que ya existian cuelga de este campo.
      expect(r.fieldErrors).not.toHaveProperty("distritoIds");
      expect(r.fieldErrors).not.toHaveProperty("tarifas");
    }
  });

  it("R6: `sin_zona_central` NO se confunde con `not_found`", async () => {
    repo = buildRepo({ update: vi.fn().mockResolvedValue({ estado: "sin_zona_central" }) });
    service = new ZonaService(repo);
    expect((await service.actualizar("z1", crearInput(), MAESTRO)).status).not.toBe("not_found");
  });

  it("⭑ R1: `esCentral` AUSENTE llega al repositorio como `undefined`, no como `false`", async () => {
    // El defecto que abre la ficha, en el unico punto donde el service podia reintroducirlo: un
    // `?? false` aqui volveria a apagar la marca por omision, y ningun test de arriba lo veria.
    const { esCentral: _omitida, ...sinMarca } = crearInput();
    void _omitida;
    await service.actualizar("z1", sinMarca as ActualizarZonaInput, MAESTRO);

    const datos = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(datos).toHaveProperty("esCentral");
    expect(datos.esCentral).toBeUndefined();
    // Y el resto del guardado SI viaja (R4): esto no es un payload vacio.
    expect(datos.nombre).toBe("GAM");
    expect(datos.distritoIds).toEqual(["d1"]);
  });

  it("R3: un `false` EXPLICITO llega al repositorio como `false`, no como `undefined`", async () => {
    // La otra mitad de R1/R3: «no lo mandé» y «lo mandé apagado» tienen que seguir siendo cosas
    // distintas cuando llegan al repositorio, porque una se ignora y la otra se rechaza CON MOTIVO.
    await service.actualizar("z1", crearInput({ esCentral: false }), MAESTRO);
    const datos = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(datos.esCentral).toBe(false);
  });
});

describe("376/Q4 — el impacto de mover la marca", () => {
  it("reenvia el conteo del repositorio TAL CUAL", async () => {
    repo = buildRepo({
      contarOrdenesVivasPorZona: vi.fn().mockResolvedValue([
        { zonaId: "z-gam", ordenesVivas: 850 },
        { zonaId: "z-nueva", ordenesVivas: 0 },
      ]),
    });
    service = new ZonaService(repo);

    const r = await service.impactoZonaCentral(["z-gam", "z-nueva"], MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.impacto).toEqual([
        { zonaId: "z-gam", ordenesVivas: 850 },
        { zonaId: "z-nueva", ordenesVivas: 0 },
      ]);
    }
    expect(repo.contarOrdenesVivasPorZona).toHaveBeenCalledWith(["z-gam", "z-nueva"]);
  });

  it("no-maestro -> forbidden y no consulta nada", async () => {
    const r = await service.impactoZonaCentral(["z1"], ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.contarOrdenesVivasPorZona).not.toHaveBeenCalled();
  });
});

describe("listar — include", () => {
  it("include ['tarifas'] -> pide includeTarifas=true al repo", async () => {
    await service.listar({ page: 1, pageSize: 25, include: ["tarifas"] }, MAESTRO);
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.includeTarifas).toBe(true);
  });
  it("sin include -> includeTarifas=false", async () => {
    await service.listar({ page: 1, pageSize: 25 }, MAESTRO);
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.includeTarifas).toBe(false);
  });
});

describe("actualizar", () => {
  it("update devuelve `not_found` -> not_found", async () => {
    // FICHA 376: el desenlace viaja nombrado, no como `null`. Sigue siendo el mismo caso.
    repo = buildRepo({ update: vi.fn().mockResolvedValue({ estado: "not_found" }) });
    service = new ZonaService(repo);
    expect((await service.actualizar("zX", crearInput(), MAESTRO)).status).toBe("not_found");
  });

  // ⭑ FICHA 366 (T6) — el service no calcula nada de esto: lo TRANSPORTA. Lo que se mide aqui es
  // que no lo pierde por el camino (el conteo) y que no llega al repositorio sin firma (el actor).
  it("⭑ R12: reenvia `ordenesReconciliadas` del repo TAL CUAL, sin tocarlo", async () => {
    repo = buildRepo({
      update: vi.fn().mockResolvedValue(resultadoUpdate(dto(), 5)),
    });
    service = new ZonaService(repo);

    const r = await service.actualizar("z1", crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.ordenesReconciliadas).toBe(5);
  });

  it("R14: cero se reenvia como cero (no como ausencia)", async () => {
    const r = await service.actualizar("z1", crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.ordenesReconciliadas).toBe(0);
  });

  it("⭑ R10: `actor.usuarioId` llega al repo como TERCER argumento de `update`", async () => {
    // Sin esto, cada fila del historial que produzca la reconciliacion quedaria firmada por EL
    // SISTEMA (`resolverActorCongelado(tx, null)`), y el rastro no diria quien la disparo.
    await service.actualizar("z1", crearInput(), MAESTRO);
    const llamada = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(llamada[0]).toBe("z1");
    expect(llamada[2]).toBe(MAESTRO.usuarioId);
  });
});

describe("esCentral — invariante 'una central' (feature 55/R3/R4/R6)", () => {
  it("crear segunda central: el repo reasigna y el service devuelve ok (sin filtrar P2002/500)", async () => {
    // ya existe otra central; el repo reasigna en su transaccion y devuelve la nueva central
    repo = buildRepo({
      findCentralZonaId: vi.fn().mockResolvedValue("z-old"),
      create: vi.fn().mockResolvedValue(dto({ id: "z-new", esCentral: true })),
    });
    service = new ZonaService(repo);

    const r = await service.crear(crearInput({ esCentral: true }), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.zona.esCentral).toBe(true); // R3
    // el flag esCentral=true se propaga tal cual al repo
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.esCentral).toBe(true);
  });

  it("editar a central existiendo otra: el repo reasigna y el service devuelve ok", async () => {
    repo = buildRepo({
      findCentralZonaId: vi.fn().mockResolvedValue("z-old"),
      update: vi.fn().mockResolvedValue(resultadoUpdate(dto({ id: "z1", esCentral: true }))),
    });
    service = new ZonaService(repo);

    const r = await service.actualizar("z1", crearInput({ esCentral: true }), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.zona.esCentral).toBe(true); // R3
  });

  it("⭑ 376/R12: `actor.usuarioId` llega al repo como SEGUNDO argumento de `create`", async () => {
    // Sin esto, las dos filas que produce crear una zona central quedarian firmadas por EL SISTEMA
    // (`resolverActorCongelado(tx, null)`) y el rastro no diria quien movio la marca.
    await service.crear(crearInput({ esCentral: true }), MAESTRO);
    expect((repo.create as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(MAESTRO.usuarioId);
  });

  it("crear con esCentral=false persiste false (R4)", async () => {
    repo = buildRepo({ create: vi.fn().mockResolvedValue(dto({ esCentral: false })) });
    service = new ZonaService(repo);
    const r = await service.crear(crearInput({ esCentral: false }), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.zona.esCentral).toBe(false);
    const arg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.esCentral).toBe(false);
  });
});
