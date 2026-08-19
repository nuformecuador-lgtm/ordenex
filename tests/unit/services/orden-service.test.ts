import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { OrdenService } from "@/lib/services/OrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO, OrdenListItemDTO } from "@/lib/types/orden";
import {
  fakeIntentosEnLote,
  llamadasIntentos,
  type IntentosSvcDoble,
} from "@/tests/fixtures/intentos-entrega";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const OTRA_TIENDA_ID = "store2";
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
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [listItem()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false), // feature 27
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
    // Feature 170 (T K.1/T K.2): la pagina del listado satelite y el catalogo de sus filtros.
    findRecepcionSatelitePaginada: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findRecepcionSateliteGeoByZona: vi.fn().mockResolvedValue([]),
    // Feature 184 (T A.1/T A.2): el conjunto completo del listado y la vigencia de ids.
    findRecepcionSateliteCompleta: vi.fn().mockResolvedValue([]),
    findIdsVigentesEnBodega: vi.fn().mockResolvedValue([]),
    recibirEnSatelite: vi.fn().mockResolvedValue(false),
    recibirEnOrigen: vi.fn().mockResolvedValue(false),
    recibirEnBodegaCentral: vi.fn().mockResolvedValue(false),
    // feature 157: recoleccion en tienda (asignacion sin transicion + confirmacion por QR)
    asignarRecoleccionLote: vi.fn().mockResolvedValue(0),
    desasignarRecoleccionLote: vi.fn().mockResolvedValue(0),
    // feature 157: regla de dedicacion (reparto y recoleccion no se mezclan)
    findMensajerosConOrdenesEn: vi.fn().mockResolvedValue(new Set()),
    recolectarEnTienda: vi.fn().mockResolvedValue(false),
    recibirLoteEnSatelite: vi.fn().mockResolvedValue(0),
    asignarSateliteLote: vi.fn().mockResolvedValue(0),
    // Feature 87: lista de novedades, no ejercitada aqui pero exigida por IOrdenRepository.
    // Solicitud de ayuda (2026-08-18): exigidos por la interfaz, no ejercitados aqui.
    // Feature 235: los tres metodos de la bandera (`marcarAyuda`/`desmarcarAyuda`/
    // `habilitarNovedad`) colapsaron en UN punto de escritura guardado por estado.
    transicionarAyuda: vi.fn().mockResolvedValue(true),
    incrementarIntentoContacto: vi.fn().mockResolvedValue(0),
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
    // Feature 177: consulta por identificador libre + PDF de etiquetas, no ejercitada aqui.
    findByGuiaORemisionForOwner: vi.fn().mockResolvedValue([]),
    findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue(null),
    findDownloadStoragePathByOrdenForOwner: vi.fn().mockResolvedValue(null),
    setOrdenDownloadStoragePath: vi.fn(async () => {}),
    findCargaConOrdenesForOwner: vi.fn().mockResolvedValue(null),
    setCargaDownloadStoragePath: vi.fn(async () => {}),
    // Feature 102: rechazos por SLA de la tienda, exigidos por IOrdenRepository.
    countRechazadasSlaByTienda: vi.fn().mockResolvedValue(0),
    findRechazadasSlaByTienda: vi.fn().mockResolvedValue([]),
    // Feature 149: writer de la reversion de asignacion, exigido por IOrdenRepository.
    deshacerAsignacionLote: vi.fn(async () => 0),
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

// BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivian los bloques de
// `crear` (matriz de autorizacion R20-R24, alta manual de la feature 155, validacion de FKs) y
// de `obtener`. Los metodos se retiraron de `OrdenService` al quedarse sin llamador. NO se
// pierde ninguna regla viva, y se comprobo una a una antes de borrar:
//
//   - la bifurcacion por bodega de la 155 (donde NACE la orden) tiene TRES testigos vivos:
//     `bulk-orden-service.test.ts` (R16, las dos ramas), `bulk-orden-service.carga-api.test.ts`
//     (la via API key) y `destino-creacion.test.ts` (la funcion de decision, aislada);
//   - «adminSatelite no puede crear» sigue afirmada sobre `BulkOrdenService.cargarMasiva` en
//     `rol-admin-satelite-authz.test.ts`, que es la via VIVA de creacion;
//   - R24 (rol desconocido -> forbidden) conserva su testigo en el bloque de `listar`, abajo.

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

// BORRADO 2026-08-07 (tanda 2): aqui vivian los bloques de `actualizar` y `borrar`, retirados
// de `OrdenService` con sus Server Actions. Las ediciones reales de una orden pasan por los
// servicios de dominio —guia, asignacion, recepcion, devoluciones, incidencias—, cada uno con
// su propia suite y su propia matriz de autorizacion. R21 (adminTienda solo las suyas) y R24
// conservan testigo en el bloque de `listar`.
