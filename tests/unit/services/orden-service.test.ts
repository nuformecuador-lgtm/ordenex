import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { OrdenService } from "@/lib/services/OrdenService";
import {
  NumRemisionDuplicadoError,
  type IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO, OrdenListItemDTO } from "@/lib/types/orden";
import {
  fakeIntentosEnLote,
  llamadasIntentos,
  type IntentosSvcDoble,
} from "@/tests/fixtures/intentos-entrega";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const OTRA_TIENDA_ID = "store2";
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function dto(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 1,
    numRemision: "REM-1",
    estatusId: "os-bodega",
    estatusValue: "en_bodega_central",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// R25/R26: elemento del listado = OrdenDTO + tiendaNombre (nombre legible tienda).
function listItem(overrides: Partial<OrdenListItemDTO> = {}): OrdenListItemDTO {
  return { ...dto(), tiendaNombre: "Tienda Uno", ...overrides };
}

// Fixtures de geografia (R14b): por defecto zona->provincia->canton existen, para
// poder ejercitar la creacion (FKs NOT NULL contra tablas creadas vacias).
function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [listItem()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    softDelete: vi.fn().mockResolvedValue(true),
    existsEstatus: vi.fn().mockResolvedValue(true),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false), // feature 27
    existsGeo: vi
      .fn()
      .mockResolvedValue({ zona: true, provincia: true, canton: true, distrito: true }),
    // Feature 15: metodos batch de carga masiva, no ejercitados por el CRUD
    // (feature 6) pero exigidos por la interfaz IOrdenRepository.
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([]),
    createManyOrdenes: vi.fn().mockResolvedValue({ inserted: 0, cargaId: null }), // feature 141
    createManyOrdenesConGuia: vi.fn().mockResolvedValue({ creadas: [], cargaId: null }), // feature 88/141
    // Feature 141 (R47/R48): persistencia de las URLs de descarga de etiquetas.
    setCargaDownloadUrl: vi.fn(async () => {}),
    setOrdenesDownloadUrl: vi.fn(async () => {}),
    // Feature 16: resumen del lote (solo lectura), no ejercitado por el CRUD
    // (feature 6) pero exigido por la interfaz IOrdenRepository.
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    // Feature 17: metodos de "Generar guia"/asignacion, no ejercitados por el
    // CRUD (feature 6) pero exigidos por la interfaz IOrdenRepository.
    findByIdsForTransicion: vi.fn().mockResolvedValue([]),
    findByNumGuiaForTransicion: vi.fn().mockResolvedValue(null),
    findMensajeroIdsValidos: vi.fn().mockResolvedValue(new Set()),
    findAllMensajeros: vi.fn().mockResolvedValue([]),
    listOrderStatus: vi.fn().mockResolvedValue([]),
    generarGuiaLote: vi.fn().mockResolvedValue([]),
    asignarBodegaLote: vi.fn().mockResolvedValue(0),
    findMensajerosByZona: vi.fn().mockResolvedValue([]),
    findMensajeroIdsValidosByZona: vi.fn().mockResolvedValue(new Set()),
    rutearBodegaSateliteLote: vi.fn().mockResolvedValue(0),
    // Feature 41: bloqueo derivado (por defecto nadie bloqueado / bodega libre).
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
    findZonasConMensajeroBloqueado: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    // Feature 32: etiqueta de guia, no ejercitada por el CRUD (feature 6) pero
    // exigida por la interfaz IOrdenRepository.
    findEtiquetasByIds: vi.fn().mockResolvedValue([]),
    findEtiquetaByNumGuia: vi.fn().mockResolvedValue(null),
    // Feature 148: stubs del manifiesto (READ derivado, no lo ejercita este test).
    findManifiestoByIds: vi.fn().mockResolvedValue([]),
    findManifiestoByRemisiones: vi.fn().mockResolvedValue([]),
    findUsuarioNombre: vi.fn().mockResolvedValue(null),
    // Feature 33: recepcion en bodega satelite, no ejercitada aqui pero exigida
    // por la interfaz IOrdenRepository.
    findUsuarioZonaId: vi.fn().mockResolvedValue(null),
    findUsuarioVehiculoId: vi.fn().mockResolvedValue(null), // feature 39: exigido por IOrdenRepository
    findRecepcionSateliteByZona: vi.fn().mockResolvedValue([]),
    recibirEnSatelite: vi.fn().mockResolvedValue(false),
    recibirEnOrigen: vi.fn().mockResolvedValue(false),
    recibirEnBodegaCentral: vi.fn().mockResolvedValue(false),
    // feature 157: recoleccion en tienda (asignacion sin transicion + confirmacion por QR)
    asignarRecoleccionLote: vi.fn().mockResolvedValue(0),
    // feature 157: regla de dedicacion (reparto y recoleccion no se mezclan)
    findMensajerosConOrdenesEn: vi.fn().mockResolvedValue(new Set()),
    recolectarEnTienda: vi.fn().mockResolvedValue(false),
    recibirLoteEnSatelite: vi.fn().mockResolvedValue(0),
    asignarSateliteLote: vi.fn().mockResolvedValue(0),
    // Feature 87: lista de novedades, no ejercitada aqui pero exigida por IOrdenRepository.
    countDevueltasByTienda: vi.fn().mockResolvedValue(0),
    findDevueltasByTienda: vi.fn().mockResolvedValue([]),
    // Feature 92 (R8/R35): metodos nuevos de lectura de `IOrdenRepository`. Estos
    // tests no ejercitan el gate de coordenadas ni la ruta: devuelven vacio.
    findParaAsignabilidad: vi.fn(async () => []),
    findParadasEnReparto: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn().mockResolvedValue(new Map()),
    // Feature 106: canal integrador (API por key), no ejercitado por el CRUD.
    listByOwner: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findDetalleByNumGuiaForOwner: vi.fn().mockResolvedValue(null),
    cancelarViaApi: vi.fn().mockResolvedValue({ status: "not_found" }),
    // Feature 102: rechazos por SLA de la tienda, exigidos por IOrdenRepository.
    countRechazadasSlaByTienda: vi.fn().mockResolvedValue(0),
    findRechazadasSlaByTienda: vi.fn().mockResolvedValue([]),
    // Feature 149: writer de la reversion de asignacion, exigido por IOrdenRepository.
    deshacerAsignacionLote: vi.fn(async () => 0),
    ...overrides,
  };
}

function crearInput(overrides: Record<string, unknown> = {}) {
  return {
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    peso: 1.5,
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    tiendaId: "store1",
    ...overrides,
  };
}

let repo: IOrdenRepository;
let service: OrdenService;
// Feature 160: derivador de intentos EN LOTE, dependencia REQUERIDA del constructor. Por
// defecto devuelve el Map vacio, que ejerce el `?? 0` del servicio (R14).
let intentos: IntentosSvcDoble;

beforeEach(() => {
  repo = buildRepo();
  intentos = fakeIntentosEnLote();
  service = new OrdenService(repo, intentos);
});

describe("crear — matriz de autorizacion", () => {
  it("R20: maestro/admin crean cualquier orden", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await service.crear(crearInput({ tiendaId: "storeX" }), actor);
      expect(r.status).toBe("ok");
    }
  });

  it("R21: adminTienda crea forzando tiendaId=actor.usuarioId", async () => {
    const r = await service.crear(crearInput({ tiendaId: undefined }), TIENDA);
    expect(r.status).toBe("ok");
    const data = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.tiendaId).toBe("store1");
  });

  it("R22: adminTienda con tiendaId ajeno -> forbidden y no crea", async () => {
    const r = await service.crear(crearInput({ tiendaId: OTRA_TIENDA_ID }), TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R23: mensajero no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R24: rol no reconocido -> forbidden", async () => {
    const r = await service.crear(crearInput(), DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("maestro/admin sin tiendaId -> validation_error (R11)", async () => {
    const r = await service.crear(crearInput({ tiendaId: undefined }), MAESTRO);
    expect(r.status).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 155 — BIFURCACION POR BODEGA en el alta manual. El estado inicial ya no sale de una
// constante de configuracion ni del payload: sale del flag `fulfillment` de la tienda DUEÑA.
// ---------------------------------------------------------------------------------------------
describe("155/R1/R2/R3/R13/R14 — alta manual: donde nace la orden", () => {
  function argsDeCreate() {
    const llamada = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0];
    return { data: llamada[0], historial: llamada[1], opciones: llamada[2] };
  }

  it("R14: adminTienda con fulfillment=false -> nace en por_recolectar_en_tienda CON guia", async () => {
    repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput(), TIENDA);

    expect(r.status).toBe("ok");
    // R14: el predicado se evalua sobre la tienda que su rol le fuerza (el actor).
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith("store1");
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    expect(argsDeCreate().opciones).toEqual({ conGuia: true });
  });

  it("R2: adminTienda con fulfillment=true -> nace en en_preparacion SIN guia", async () => {
    repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput(), TIENDA);

    expect(r.status).toBe("ok");
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    expect(argsDeCreate().opciones).toEqual({ conGuia: false });
  });

  it("R13: maestro creando PARA una tienda evalua el flag de ESA tienda, no el suyo", async () => {
    repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput({ tiendaId: OTRA_TIENDA_ID }), MAESTRO);

    expect(r.status).toBe("ok");
    // El actor es `m1` (maestro) y la tienda dueña es `store2`: se pregunta por la DUEÑA.
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith(OTRA_TIENDA_ID);
    expect(repo.findUsuarioFulfillment).not.toHaveBeenCalledWith("m1");
    expect(argsDeCreate().data.tiendaId).toBe(OTRA_TIENDA_ID);
  });

  it("R13: admin creando para una tienda sin fulfillment tambien cae en la rama con guia", async () => {
    repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput({ tiendaId: OTRA_TIENDA_ID }), ADMIN);

    expect(r.status).toBe("ok");
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith(OTRA_TIENDA_ID);
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    expect(argsDeCreate().opciones).toEqual({ conGuia: true });
  });

  it("R5: un estatusId arbitrario en la entrada NO altera donde nace la orden", async () => {
    repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(
      crearInput({ estatusId: "os-entregada-inyectado" }),
      TIENDA,
    );

    expect(r.status).toBe("ok");
    // Manda el flag, no el payload: ni se consulta el id recibido ni se usa.
    expect(repo.existsEstatus).not.toHaveBeenCalled();
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    expect(argsDeCreate().data.estatusId).toBe("os-bodega");
    expect(argsDeCreate().data.estatusId).not.toBe("os-entregada-inyectado");
  });

  it("R9: la creacion NUNCA asigna mensajero (en ninguna de las dos ramas)", async () => {
    for (const fulfillment of [true, false]) {
      repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(fulfillment) });
      service = new OrdenService(repo, intentos);
      await service.crear(crearInput(), TIENDA);
      expect(argsDeCreate().data).not.toHaveProperty("mensajeroAsignadoId");
    }
  });

  it("R10: deja historial de creacion con la familia de la via (creacion_manual)", async () => {
    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("ok");
    expect(argsDeCreate().historial).toEqual({
      actorUsuarioId: "store1",
      origenTipo: "creacion_manual",
    });
  });

  it("R7: catalogo sin el value de la rama resuelta -> validation_error que lo NOMBRA, sin crear", async () => {
    repo = buildRepo({
      findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
      findEstatusIdByValue: vi.fn().mockResolvedValue(null),
    });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput(), TIENDA);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.estatusId?.[0]).toContain("por_recolectar_en_tienda");
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("crear — validacion de FKs y defaults", () => {

  it("R26/R12: geografia inexistente -> validation_error por campo, no crea", async () => {
    repo = buildRepo({
      existsGeo: vi
        .fn()
        .mockResolvedValue({ zona: false, provincia: true, canton: false, distrito: true }),
    });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("zonaId");
      expect(r.fieldErrors).toHaveProperty("cantonId");
      expect(r.fieldErrors).not.toHaveProperty("provinciaId");
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  // Feature 155/R5/R15: el caso "estatusId provisto inexistente" DEJO DE EXISTIR como camino
  // (la entrada ya no expone estatus inicial). Se conserva su contraparte: una entrada con un
  // `estatusId` que no existe en el catalogo YA NO produce validation_error — se ignora — y la
  // orden nace donde manda el flag. El resto de resultados de dominio del alta manual (entrada
  // invalida, rol no autorizado, duplicado) NO cambia: sus tests siguen vivos en este archivo.
  it("R5/R15: un estatusId inexistente en la entrada se IGNORA y la orden se crea igual", async () => {
    repo = buildRepo({ existsEstatus: vi.fn().mockResolvedValue(false) });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput({ estatusId: "os-x" }), TIENDA);
    expect(r.status).toBe("ok");
    expect(repo.existsEstatus).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("R28: num_remision duplicado -> conflict", async () => {
    repo = buildRepo({
      create: vi.fn().mockRejectedValue(new NumRemisionDuplicadoError("REM-1")),
    });
    service = new OrdenService(repo, intentos);

    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("conflict");
  });
});

describe("obtener", () => {
  it("R20: maestro obtiene cualquier orden", async () => {
    const r = await service.obtener("ord-1", MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("R21: adminTienda obtiene la suya", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store1" })) });
    service = new OrdenService(repo, intentos);
    const r = await service.obtener("ord-1", TIENDA);
    expect(r.status).toBe("ok");
  });

  it("R21/R29: adminTienda con orden ajena -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store2" })) });
    service = new OrdenService(repo, intentos);
    const r = await service.obtener("ord-1", TIENDA);
    expect(r.status).toBe("not_found");
  });

  it("R29/R34: inexistente o borrada -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new OrdenService(repo, intentos);
    const r = await service.obtener("x", MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R24: rol desconocido -> forbidden", async () => {
    const r = await service.obtener("ord-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });
});

describe("listar", () => {
  it("R30: devuelve items/page/pageSize/total", async () => {
    const r = await service.listar(
      { page: 2, pageSize: 10, sortBy: "created_at", sortDir: "desc" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.page).toBe(2);
      expect(r.pageSize).toBe(10);
      expect(r.total).toBe(1);
    }
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.skip).toBe(10); // (page-1)*pageSize
    expect(arg.take).toBe(10);
  });

  it("R21: adminTienda inyecta su tiendaId en el where", async () => {
    await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1");
  });

  it("seguridad: mensajero se acota a SUS asignadas (where.mensajeroAsignadoId)", async () => {
    await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      { usuarioId: "msg1", rol: "mensajero" },
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.mensajeroAsignadoId).toBe("msg1");
    // No se filtra por tienda (eso es de adminTienda).
    expect(arg.where.tiendaId).toBeUndefined();
  });

  it("R25/R26: propaga tiendaNombre de los items sin re-filtrar (R22 intacto)", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [listItem({ tiendaNombre: "Tienda Uno" })],
        total: 1,
      }),
    });
    service = new OrdenService(repo, intentos);

    const r = await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items[0].tiendaNombre).toBe("Tienda Uno");
    }
    // R22: la autorizacion por rol NO cambia; adminTienda sigue forzando su tiendaId.
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1");
  });

  it("R31: propaga filtro estatusId y orden al repo", async () => {
    await service.listar(
      { page: 1, pageSize: 20, estatusId: "os-entregada", sortBy: "num_guia", sortDir: "asc" },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-entregada");
    expect(arg.sortBy).toBe("num_guia");
    expect(arg.sortDir).toBe("asc");
  });

  it("R24: rol desconocido -> forbidden", async () => {
    const r = await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      DESCONOCIDO,
    );
    expect(r.status).toBe("forbidden");
  });
});

// Feature 160 (T8) — el conteo de intentos viaja en el DTO del listado, resuelto EN LOTE.
// Este listado alimenta 5 superficies de UI: si el merge se rompe, el dato desaparece de todas.
describe("listar — intentos de entrega en lote (160/R11/R12/R13/R14/R15)", () => {
  const PAGINA = { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" } as const;

  it("R11/R14: cada item sale con `intentosEntrega` numerico, el `0` INCLUIDO", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [listItem({ id: "o1" }), listItem({ id: "o2" }), listItem({ id: "o3" })],
        total: 3,
      }),
    });
    // `o3` no aparece en el mapa: no tiene intentos.
    intentos = fakeIntentosEnLote({ o1: 2, o2: 0 });
    service = new OrdenService(repo, intentos);

    const r = await service.listar(PAGINA, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items.map((i) => i.intentosEntrega)).toEqual([2, 0, 0]);
    // R14: `0` es un valor CONOCIDO, no ausencia de dato. Nada de `undefined` ni `null`.
    for (const item of r.items) expect(typeof item.intentosEntrega).toBe("number");
  });

  it("R12: UNA sola llamada al derivador por listado, con TODOS los ids de la pagina", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [listItem({ id: "o1" }), listItem({ id: "o2" })],
        total: 2,
      }),
    });
    intentos = fakeIntentosEnLote();
    service = new OrdenService(repo, intentos);

    await service.listar(PAGINA, MAESTRO);

    expect(intentos.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(llamadasIntentos(intentos)).toEqual([["o1", "o2"]]);
  });

  it("R13: pagina vacia -> el derivador recibe un lote vacio (y no consulta)", async () => {
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    intentos = fakeIntentosEnLote();
    service = new OrdenService(repo, intentos);

    const r = await service.listar(PAGINA, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toEqual([]);
    expect(llamadasIntentos(intentos)).toEqual([[]]);
  });

  // R15: sin regla de permisos nueva. Los ids del lote son EXACTAMENTE los que el `where` por
  // rol ya devolvio: nunca se pide el conteo de una orden que el actor no puede leer.
  it("R15: los ids del lote son los del listado YA acotado por el rol (adminTienda)", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [listItem({ id: "propia-1", tiendaId: "store1" })],
        total: 1,
      }),
    });
    intentos = fakeIntentosEnLote();
    service = new OrdenService(repo, intentos);

    await service.listar(PAGINA, TIENDA);

    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1"); // alcance impuesto server-side
    expect(llamadasIntentos(intentos)).toEqual([["propia-1"]]);
  });

  it("R32: el resto del item (paginacion, total y campos previos) no cambia", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [listItem({ id: "o1", tiendaNombre: "Tienda Uno" })],
        total: 57,
      }),
    });
    intentos = fakeIntentosEnLote({ o1: 1 });
    service = new OrdenService(repo, intentos);

    const r = await service.listar({ ...PAGINA, page: 3 }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.total).toBe(57);
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(20);
    expect(r.items[0].tiendaNombre).toBe("Tienda Uno");
    expect(r.items[0].id).toBe("o1");
  });
});

// Feature 63/B2 (R8/R9/R10): filtro generico `filter.status_id` -> where.estatusId.
describe("listar — filtro generico filter.status_id (feature 63, R8/R9/R10)", () => {
  it("R8: filter.status_id se traduce a where.estatusId", async () => {
    await service.listar(
      { page: 1, pageSize: 20, filter: { status_id: "os-entregada" }, sortBy: "created_at", sortDir: "desc" },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-entregada");
  });

  it("R9: filter.status_id compone con el alcance por rol de adminTienda", async () => {
    await service.listar(
      { page: 1, pageSize: 20, filter: { status_id: "os-entregada" }, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-entregada");
    expect(arg.where.tiendaId).toBe("store1"); // acotamiento por tienda intacto
    expect(arg.where.tiendaId).not.toBe(OTRA_TIENDA_ID);
  });

  it("R8: filter.status_id tiene precedencia sobre el estatusId escalar", async () => {
    await service.listar(
      {
        page: 1,
        pageSize: 20,
        estatusId: "os-escalar",
        filter: { status_id: "os-filter" },
        sortBy: "created_at",
        sortDir: "desc",
      },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-filter");
  });

  // Filtro MULTI-ESTADO (listado unico de /ordenes con selector de seleccion multiple):
  // `status_id` admite una LISTA de ids; el service la pasa tal cual y el repositorio la
  // traduce a `IN (...)`. El acotamiento por rol sigue componiendo con ella.
  it("filter.status_id como LISTA se traduce a where.estatusId con todos los ids", async () => {
    await service.listar(
      {
        page: 1,
        pageSize: 20,
        filter: { status_id: ["os-entregada", "os-devuelta"] },
        sortBy: "created_at",
        sortDir: "desc",
      },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toEqual(["os-entregada", "os-devuelta"]);
  });

  it("filter.status_id como LISTA compone con el alcance por rol de adminTienda", async () => {
    await service.listar(
      {
        page: 1,
        pageSize: 20,
        filter: { status_id: ["os-entregada", "os-devuelta"] },
        sortBy: "created_at",
        sortDir: "desc",
      },
      TIENDA,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toEqual(["os-entregada", "os-devuelta"]);
    expect(arg.where.tiendaId).toBe("store1"); // acotamiento por tienda intacto
  });

  it("R10: sin filter, el estatusId escalar sigue funcionando (sin regresion)", async () => {
    await service.listar(
      { page: 1, pageSize: 20, estatusId: "os-entregada", sortBy: "created_at", sortDir: "desc" },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-entregada");
  });

  it("R10: sin filter ni estatusId, where no fija estatusId (comportamiento previo)", async () => {
    await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      MAESTRO,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBeUndefined();
  });
});

// Feature 48/T10.1 (R12/R14): la tienda de origen ve sus ordenes `rechazada`/`devolviendo_a_tienda`
// reutilizando el scope server-side ya existente (where.tiendaId = actor.usuarioId). NO cambia
// la autz de las features 6/26; solo verifica que las ordenes retornadas viajan por ese filtro.
describe("listar — visibilidad de la tienda de origen (feature 48, R12/R14)", () => {
  it("adminTienda ve sus ordenes rechazada/devolviendo_a_tienda acotadas por where.tiendaId", async () => {
    repo = buildRepo({
      list: vi.fn().mockResolvedValue({
        items: [
          listItem({ id: "o-rech", estatusValue: "rechazada", tiendaId: "store1" }),
          listItem({ id: "o-dev", estatusValue: "devolviendo_a_tienda", tiendaId: "store1" }),
        ],
        total: 2,
      }),
    });
    service = new OrdenService(repo, intentos);

    const r = await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items.map((i) => i.estatusValue)).toEqual(["rechazada", "devolviendo_a_tienda"]);
    }
    // R12: el alcance server-side es la propia tienda (no un parametro del cliente).
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1");
  });

  it("orden de otra tienda no aparece: el where fuerza la tienda del actor (R12)", async () => {
    // La query se acota SIEMPRE a la tienda del actor; una orden de OTRA tienda queda fuera
    // del where y por tanto no puede aparecer, sin importar su estado.
    await service.listar(
      { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.tiendaId).toBe("store1");
    expect(arg.where.tiendaId).not.toBe(OTRA_TIENDA_ID);
  });

  it("filtro por estado devolviendo_a_tienda se pasa al where junto con el scope de la tienda", async () => {
    await service.listar(
      { page: 1, pageSize: 20, estatusId: "os-devuelta-origen", sortBy: "created_at", sortDir: "desc" },
      TIENDA,
    );
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.estatusId).toBe("os-devuelta-origen");
    expect(arg.where.tiendaId).toBe("store1");
  });
});

describe("actualizar", () => {
  it("R37: maestro aplica solo los campos presentes y delega", async () => {
    const r = await service.actualizar("ord-1", { producto: "Nuevo", notas: "x" }, MAESTRO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ producto: "Nuevo", notas: "x" });
  });

  it("R23/R41: mensajero solo estatusId -> ok", async () => {
    const r = await service.actualizar("ord-1", { estatusId: "os-entregada" }, MENSAJERO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ estatusId: "os-entregada" });
  });

  it("R23: mensajero con otro campo -> forbidden, no actualiza", async () => {
    const r = await service.actualizar(
      "ord-1",
      { estatusId: "os-entregada", producto: "Hack" },
      MENSAJERO,
    );
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R21: adminTienda actualiza la suya", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store1" })) });
    service = new OrdenService(repo, intentos);
    const r = await service.actualizar("ord-1", { producto: "N" }, TIENDA);
    expect(r.status).toBe("ok");
  });

  it("R21: adminTienda sobre orden ajena -> forbidden", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store2" })) });
    service = new OrdenService(repo, intentos);
    const r = await service.actualizar("ord-1", { producto: "N" }, TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R36/R40: orden inexistente/borrada -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new OrdenService(repo, intentos);
    const r = await service.actualizar("x", { producto: "N" }, MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R38: estatusId inexistente -> validation_error", async () => {
    repo = buildRepo({ existsEstatus: vi.fn().mockResolvedValue(false) });
    service = new OrdenService(repo, intentos);
    const r = await service.actualizar("ord-1", { estatusId: "os-x" }, MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("borrar", () => {
  it("R39: maestro borra (soft delete) -> ok", async () => {
    const r = await service.borrar("ord-1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.softDelete).toHaveBeenCalledWith("ord-1");
  });

  it("R41: mensajero no puede borrar -> forbidden", async () => {
    const r = await service.borrar("ord-1", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R21: adminTienda borra la suya", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store1" })) });
    service = new OrdenService(repo, intentos);
    const r = await service.borrar("ord-1", TIENDA);
    expect(r.status).toBe("ok");
  });

  it("R21: adminTienda sobre ajena -> forbidden", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(dto({ tiendaId: "store2" })) });
    service = new OrdenService(repo, intentos);
    const r = await service.borrar("ord-1", TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("R40: inexistente/borrada -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new OrdenService(repo, intentos);
    const r = await service.borrar("x", MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("R24: rol desconocido -> forbidden", async () => {
    const r = await service.borrar("ord-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });
});
