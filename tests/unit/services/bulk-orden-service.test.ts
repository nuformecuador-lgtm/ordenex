import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ITarifaVigenteRepository } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

// Feature 98: la via sesion (`cargarMasiva`) NO usa el resolver de tarifa (R9). Stub neutro
// para el 2do parametro requerido del constructor; estos tests no lo ejercitan.
// Feature 274/R37: la interfaz colapso a DOS metodos (`resolveTarifa` + `resolveTarifas`); el
// stub los expone vacios porque la via sesion sigue sin consultarlos (R39: su comportamiento
// ante la falta de tarifa no cambia).
const tarifaRepoStub: ITarifaVigenteRepository = {
  resolveTarifa: vi.fn(async () => null),
  resolveTarifas: vi.fn(async () => new Map()),
};

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function buildRepo(overrides: Partial<IOrdenRepository> = {}): IOrdenRepository {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    // Feature 260 (B3): hidratacion por lote de ids. No la ejercita este servicio.
    findListItemsByIds: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-preparacion"),
    // Feature 27: por defecto la tienda NO tiene fulfillment -> en_preparacion (R17/R22).
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([
      { id: "p1", nombre: "Pichincha" },
    ]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([
      { id: "c1", nombre: "Quito", provinciaId: "p1" },
    ]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([
      { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1" },
    ]),
    createManyOrdenes: vi.fn().mockResolvedValue({ inserted: 0, cargaId: null }), // feature 141
    // Feature 88: persistencia con guia inmediata (carga por API). Por defecto vacio;
    // los tests de cargarViaApi lo sobreescriben para devolver las guias asignadas.
    // Feature 141 (R47/R48): persistencia de las URLs de descarga de etiquetas.
    setCargaDownloadUrl: vi.fn(async () => {}),
    setOrdenesDownloadUrl: vi.fn(async () => {}),
    createManyOrdenesConGuia: vi.fn().mockResolvedValue({ creadas: [], cargaId: null }), // feature 88/141
    // Feature 16: resumen del lote (solo lectura), no ejercitado por la carga
    // masiva (feature 15) pero exigido por la interfaz IOrdenRepository.
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    // Feature 17: metodos de "Generar guia"/asignacion, no ejercitados por la
    // carga masiva (feature 15) pero exigidos por la interfaz IOrdenRepository.
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
    // Feature 32: etiqueta de guia, exigida por la interfaz IOrdenRepository.
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
    findParaHabilitacionApi: vi.fn().mockResolvedValue(null), // feature 266/T3.1: lectura scoped por owner del canal por API key
    incrementarIntentoContacto: vi.fn().mockResolvedValue(0),
    // Feature 236: los dos metodos del listado pasan a llevar el GRUPO en la firma.
    countNovedadesByTienda: vi.fn().mockResolvedValue(0),
    findNovedadesByTienda: vi.fn().mockResolvedValue([]),
    findFechaSolicitudAyuda: vi.fn().mockResolvedValue(new Map()),
    // Feature 92 (R8/R35): metodos nuevos de lectura de `IOrdenRepository`. Estos
    // tests no ejercitan el gate de coordenadas ni la ruta: devuelven vacio.
    findParaAsignabilidad: vi.fn(async () => []),
    findParadasEnReparto: vi.fn(async () => []),
    findCausasDevueltaVigentes: vi.fn().mockResolvedValue(new Map()),
    // Feature 106: canal integrador (API por key), no ejercitado aqui.
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
    // Feature 262: writer de la correccion del dia de reparto, exigido por IOrdenRepository.
    corregirDiaRepartoLote: vi.fn(async () => []),
    // Feature 41: bloqueo derivado (por defecto nadie bloqueado / bodega libre).
    findMensajerosBloqueadosPorCierres: vi.fn(async (): Promise<Set<string>> => new Set()),
    // Feature 271: el contador N/V y el detalle del bloqueo son parte del puerto.
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
    findZonasConMensajeroBloqueado: vi.fn(async (): Promise<Set<string>> => new Set()),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    ...overrides,
  };
}

// Feature 142 — la via sesion recibe la geografia en la columna unica
// `direccion_destinatario` (`Pais / Provincia / Canton (Distrito) / Direccion`).
// Este helper la arma para que cada test exprese que parte quiere alterar.
function dir(
  partes: { provincia?: string; canton?: string; distrito?: string; direccion?: string } = {},
): string {
  const {
    provincia = "Pichincha",
    canton = "Quito",
    distrito = "La Mariscal",
    direccion = "",
  } = partes;
  return `Ecuador / ${provincia} / ${canton} (${distrito}) / ${direccion}`;
}

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    direccion_destinatario: dir(),
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    ...overrides,
  };
}

// Feature 155: la via sesion persiste por UNA de dos rutas segun la rama que resuelva el flag
// `fulfillment` de la tienda — `createManyOrdenes` (rama a, sin guia) o
// `createManyOrdenesConGuia` (rama b, con guia). Los helpers preguntan por "lo persistido" sin
// casarse con la ruta, para que los tests ortogonales a la bifurcacion (geografia, dedup,
// monto, direccion...) sigan diciendo lo que dicen.
function rutasDePersistencia(repo: IOrdenRepository) {
  return [
    repo.createManyOrdenes as ReturnType<typeof vi.fn>,
    repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>,
  ];
}

/** Filas que el service mando a persistir, por la ruta que haya usado. */
function createManyArg(repo: IOrdenRepository) {
  const usada = rutasDePersistencia(repo).find((m) => m.mock.calls.length > 0);
  if (!usada) throw new Error("no se persistio por ninguna de las dos rutas");
  return usada.mock.calls[0][0];
}

/** Numero total de llamadas de persistencia (debe ser 0 o 1: una ruta y un solo camino). */
function vecesPersistido(repo: IOrdenRepository): number {
  return rutasDePersistencia(repo).reduce((acc, m) => acc + m.mock.calls.length, 0);
}

/** Asercion de "no se escribio NADA": ninguna de las dos rutas fue llamada. */
function expectSinPersistir(repo: IOrdenRepository) {
  expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
}

describe("BulkOrdenService.cargarMasiva — autorizacion (R11)", () => {
  it.each([MAESTRO, ADMIN, MENSAJERO, DESCONOCIDO])(
    "rol %o distinto de adminTienda -> forbidden sin tocar datos",
    async (actor) => {
      const repo = buildRepo();
      const service = new BulkOrdenService(repo, tarifaRepoStub);

      const r = await service.cargarMasiva([row()], actor);

      expect(r.status).toBe("forbidden");
      expect(repo.findExistingRemisiones).not.toHaveBeenCalled();
      expect(repo.findAllProvincias).not.toHaveBeenCalled();
      expectSinPersistir(repo);
    },
  );

  it("adminTienda si es autorizado", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
  });
});

describe("BulkOrdenService.cargarMasiva — tienda del actor (R24)", () => {
  it("fija tienda_id=actor.usuarioId en todas las ordenes creadas", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva([row({ num_remision: "REM-A" }), row({ num_remision: "REM-B" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg).toHaveLength(2);
    expect(arg[0].tiendaId).toBe("store1");
    expect(arg[1].tiendaId).toBe("store1");
  });
});

describe("BulkOrdenService.cargarMasiva — campos obligatorios (R18)", () => {
  it("fila sin destinatario -> error de fila, sin abortar el resto", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ destinatario: "" })], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[0].errores).toHaveProperty("destinatario");
    }
    expectSinPersistir(repo);
  });
});

describe("BulkOrdenService.cargarMasiva — geografia (R19/R20/R21)", () => {
  it("provincia inexistente -> error de fila con fieldError geografico", async () => {
    const repo = buildRepo({ findAllProvincias: vi.fn().mockResolvedValue([]) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("provincia");
    }
  });

  it("canton ambiguo dentro de la provincia -> error de fila", async () => {
    const repo = buildRepo({
      findCantonesByProvinciaIds: vi.fn().mockResolvedValue([
        { id: "c1", nombre: "Quito", provinciaId: "p1" },
        { id: "c2", nombre: "Quito", provinciaId: "p1" },
      ]),
    });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("canton");
    }
  });

  it("canton no encontrado dentro de la provincia -> error de fila", async () => {
    const repo = buildRepo({ findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ direccion_destinatario: dir({ canton: "Otro" }) })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("canton");
    }
  });

  it("deriva zonaId desde el distrito resuelto", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva([row()], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].zonaId).toBe("z1");
    expect(arg[0].provinciaId).toBe("p1");
    expect(arg[0].cantonId).toBe("c1");
    expect(arg[0].distritoId).toBe("d1");
  });

  // Feature 142/R19 (D2): en la via sesion "sin distrito" ya no llega a resolveGeo:
  // el parser rechaza el valor antes, con la clave `direccion_destinatario`. La
  // rama "distrito requerido" de resolveGeo sigue viva para la via API key.
  it("R19: sin parentesis de distrito -> error de fila en direccion_destinatario (la zona se deriva del distrito)", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva(
      [row({ direccion_destinatario: "Ecuador / Pichincha / Quito / Av. Amazonas" })],
      TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("direccion_destinatario");
    }
    expectSinPersistir(repo);
  });

  it("distrito sin zona asignada -> error de fila", async () => {
    const repo = buildRepo({
      // distrito.zona_id null -> sin zona asignada.
      findDistritosByCantonIds: vi.fn().mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: null },
      ]),
    });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      const errores = r.summary.filas[0].errores as Record<string, string[]>;
      expect(errores).toHaveProperty("distrito");
      expect(errores.distrito.join(" ")).toContain("no tiene zona asignada");
    }
    expectSinPersistir(repo);
  });

  it("distrito provisto pero inexistente en el canton -> error de fila", async () => {
    const repo = buildRepo({ findDistritosByCantonIds: vi.fn().mockResolvedValue([]) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva(
      [row({ direccion_destinatario: dir({ distrito: "La Mariscal" }) })],
      TIENDA,
    );

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("distrito");
    }
  });

  // Feature 142/R27: el parser NO normaliza; la insensibilidad a acentos, mayusculas
  // y espacios repetidos sigue siendo exclusiva de resolverGeografia.
  it("R27/R33: acentos y mayusculas en la columna unica resuelven la misma geografia", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva(
      [row({ direccion_destinatario: "ecuador / PICHINCHA / quito (la  mariscál) / X" })],
      TIENDA,
    );

    const arg = createManyArg(repo);
    expect(arg[0]).toMatchObject({ provinciaId: "p1", cantonId: "c1", distritoId: "d1", zonaId: "z1" });
  });
});

// Feature 142 — parseo de la columna unica `direccion_destinatario` en la via sesion.
describe("BulkOrdenService.cargarMasiva — direccion_destinatario (R9, R29, R30, R31, R32, R37)", () => {
  it("R29: fila imparseable -> resultado error con la clave direccion_destinatario y mensaje accionable", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ direccion_destinatario: "Pichincha Quito" })], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      const errores = r.summary.filas[0].errores as Record<string, string[]>;
      expect(errores).toHaveProperty("direccion_destinatario");
      expect(errores.direccion_destinatario.join(" ")).toContain("Formato esperado");
    }
    expectSinPersistir(repo);
  });

  it.each([
    ["ausente", undefined],
    ["vacia", ""],
    ["solo espacios", "   "],
    ["parentesis vacio", "Ecuador / Pichincha / Quito () / X"],
    ["parentesis sin cerrar", "Ecuador / Pichincha / Quito (La Mariscal / X"],
    ["texto tras el parentesis", "Ecuador / Pichincha / Quito (La Mariscal) extra / X"],
    ["provincia vacia", "Ecuador /  / Quito (La Mariscal) / X"],
    ["canton vacio", "Ecuador / Pichincha / (La Mariscal) / X"],
  ])("R29: %s -> error de fila bajo direccion_destinatario, sin crear la orden", async (_caso, valor) => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ direccion_destinatario: valor })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("error");
      expect(r.summary.filas[0].errores).toHaveProperty("direccion_destinatario");
    }
    expectSinPersistir(repo);
  });

  it("R30/R32: un lote mixto crea las validas y cuenta las imparseables en conError", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva(
      [
        row({ num_remision: "REM-A" }),
        row({ num_remision: "REM-B", direccion_destinatario: "sin barras" }),
        row({ num_remision: "REM-C" }),
        row({ num_remision: "REM-D", direccion_destinatario: "Ecuador / Pichincha / Quito / X" }),
      ],
      TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary).toMatchObject({ total: 4, creadas: 2, duplicadas: 0, conError: 2 });
      // R32: ambas fallan bajo la MISMA clave -> el chip las agrupa por tipo de mensaje.
      const claves = r.summary.filas
        .filter((f) => f.resultado === "error")
        .map((f) => Object.keys(f.errores ?? {}));
      expect(claves).toEqual([["direccion_destinatario"], ["direccion_destinatario"]]);
    }
    const arg = createManyArg(repo);
    expect(arg.map((d: { numRemision: string }) => d.numRemision)).toEqual(["REM-A", "REM-C"]);
  });

  it("R31: dryRun y carga en firme clasifican igual las filas imparseables", async () => {
    const rows = [
      row({ num_remision: "REM-A" }),
      row({ num_remision: "REM-B", direccion_destinatario: "Ecuador / Pichincha / Quito / X" }),
      row({ num_remision: "REM-A" }),
    ];

    const real = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva(rows, TIENDA);
    const dry = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva(rows, TIENDA, {
      dryRun: true,
    });

    if (real.status === "ok" && dry.status === "ok") {
      expect(dry.summary).toEqual(real.summary);
      expect(real.summary).toMatchObject({ total: 3, creadas: 1, duplicadas: 1, conError: 1 });
    }
  });

  it("R31: el mismo archivo troceado en dos lotes clasifica igual que en uno solo", async () => {
    const rows = [
      row({ num_remision: "REM-A" }),
      row({ num_remision: "REM-B", direccion_destinatario: "Ecuador / Pichincha / Quito / X" }),
    ];

    const unico = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva(rows, TIENDA);
    const lote1 = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva([rows[0]], TIENDA);
    const lote2 = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva([rows[1]], TIENDA);

    if (unico.status === "ok" && lote1.status === "ok" && lote2.status === "ok") {
      expect(unico.summary.filas.map((f) => f.resultado)).toEqual(["creada", "error"]);
      expect(lote1.summary.filas[0].resultado).toBe("creada");
      expect(lote2.summary.filas[0].resultado).toBe("error");
      expect(lote2.summary.filas[0].errores).toEqual(unico.summary.filas[1].errores);
    }
  });

  it("R37: la direccion literal se persiste en el campo direccion de la orden", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva(
      [row({ direccion_destinatario: dir({ direccion: "Av. Amazonas / N33-12, casa  verde" }) })],
      TIENDA,
    );

    expect(createManyArg(repo)[0].direccion).toBe("Av. Amazonas / N33-12, casa  verde");
  });

  it("R26/R37: direccion literal vacia -> la fila se crea y persiste direccion null", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ direccion_destinatario: dir({ direccion: "  " }) })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(0);
    }
    expect(createManyArg(repo)[0].direccion).toBeNull();
  });

  it("R9: las columnas viejas presentes en el archivo se ignoran (no hay modo compatibilidad)", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    // Fila con la geografia VIEJA correcta pero sin direccion_destinatario: no hay
    // camino de codigo que la use en la via sesion -> error, no orden creada.
    const r = await service.cargarMasiva(
      [
        row({
          direccion_destinatario: "",
          provincia: "Pichincha",
          canton: "Quito",
          distrito: "La Mariscal",
          direccion: "Av. Amazonas",
        }),
      ],
      TIENDA,
    );

    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.filas[0].errores).toHaveProperty("direccion_destinatario");
    }
    expectSinPersistir(repo);
  });

  it("R9/R39: la columna direccion vieja NO se usa como direccion literal", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva(
      [row({ direccion_destinatario: dir({ direccion: "Nueva" }), direccion: "Vieja" })],
      TIENDA,
    );

    expect(createManyArg(repo)[0].direccion).toBe("Nueva");
  });
});

// Feature 142/R39 — `peso` sigue en la plantilla y sigue SIN persistirse (deuda
// preexistente que esta feature no abre).
describe("BulkOrdenService.cargarMasiva — peso fuera de alcance (R39)", () => {
  it("R39: la columna peso del archivo no se persiste (peso null)", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva([row({ peso: "1.5" })], TIENDA);

    expect(createManyArg(repo)[0].peso).toBeNull();
  });
});

describe("BulkOrdenService.cargarMasiva — mensajero sugerido retirado", () => {
  it("una columna mensajero_sugerido_id en el archivo se ignora: ni se valida ni se persiste", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    // Un id que ANTES habria sido rechazado por no existir: ahora la columna es
    // texto libre sobrante y la fila se crea sin mas.
    const r = await service.cargarMasiva([row({ mensajero_sugerido_id: "no-existe" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].resultado).toBe("creada");
    }
    const arg = createManyArg(repo);
    expect(arg[0]).not.toHaveProperty("mensajeroSugeridoId");
  });

  it("R6: el RowResult es EXACTAMENTE el de la misma fila sin la clave", async () => {
    // R6 dice "exactamente el mismo RowResult", no "también resulta creada": se
    // comparan las dos filas enteras (resultado + estatus + numGuia + errores).
    const conClave = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva(
      [row({ mensajero_sugerido_id: "no-existe" })],
      TIENDA,
    );
    const sinClave = await new BulkOrdenService(buildRepo(), tarifaRepoStub).cargarMasiva(
      [row()],
      TIENDA,
    );

    expect(conClave.status).toBe("ok");
    expect(sinClave.status).toBe("ok");
    if (conClave.status === "ok" && sinClave.status === "ok") {
      expect(conClave.summary.filas).toEqual(sinClave.summary.filas);
      expect(conClave.summary).toEqual(sinClave.summary);
    }
  });

  it("R7: procesar un lote NO consulta el catalogo de mensajeros", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      TIENDA,
    );

    // Las cuatro lecturas del catalogo que la interfaz sigue exponiendo (las usan
    // "Generar guia" y la asignacion satelite). Reintroducir cualquiera de ellas en
    // la carga masiva —una consulta por lote que ya no hace falta— rompe este test.
    expect(repo.findAllMensajeros).not.toHaveBeenCalled();
    expect(repo.findMensajeroIdsValidos).not.toHaveBeenCalled();
    expect(repo.findMensajerosByZona).not.toHaveBeenCalled();
    expect(repo.findMensajeroIdsValidosByZona).not.toHaveBeenCalled();
  });
});

describe("BulkOrdenService.cargarMasiva — monto_cobrar (R23)", () => {
  it("vacio -> persiste null", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva([row({ monto_cobrar: "" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].montoCobrar).toBeNull();
  });

  it("numerico valido -> se persiste como number", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva([row({ monto_cobrar: "12.50" })], TIENDA);

    const arg = createManyArg(repo);
    expect(arg[0].montoCobrar).toBe(12.5);
  });

  it("no numerico -> error de fila", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ monto_cobrar: "abc" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
  });

  it("negativo -> error de fila", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ monto_cobrar: "-5" })], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].errores).toHaveProperty("monto_cobrar");
    }
  });
});

describe("BulkOrdenService.cargarMasiva — deduplicacion (R25/R26)", () => {
  it("R25: remision existente en DB -> duplicada con el estatus de la orden existente", async () => {
    const repo = buildRepo({
      findExistingRemisiones: vi.fn().mockResolvedValue(new Map([["REM-1", "entregada"]])),
    });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.duplicadas).toBe(1);
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.filas[0]).toMatchObject({ resultado: "duplicada", estatus: "entregada" });
    }
    expectSinPersistir(repo);
  });

  it("R26: duplicado intra-archivo -> una creada (primera), el resto duplicada", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row(), row(), row()], TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.duplicadas).toBe(2);
      expect(r.summary.filas[0].resultado).toBe("creada");
      expect(r.summary.filas[1].resultado).toBe("duplicada");
      expect(r.summary.filas[2].resultado).toBe("duplicada");
      // R30: la duplicada intra-archivo tambien expone estatus (el de la ganadora), que desde
      // la 155 es el que resuelve la bifurcacion del lote (aqui, la rama por defecto: b).
      expect(r.summary.filas[1].estatus).toBe("por_recolectar_en_tienda");
    }
    const arg = createManyArg(repo);
    expect(arg).toHaveLength(1);
  });
});

describe("BulkOrdenService.cargarMasiva — estatus por defecto (R7)", () => {
  // Feature 155: el fixture por defecto tiene `fulfillment = false` (el default de la columna),
  // asi que la rama por defecto de este archivo es la (b).
  it("resuelve por_recolectar_en_tienda como estatus de las filas creadas (rama b)", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("por_recolectar_en_tienda");
    }
    const arg = createManyArg(repo);
    expect(arg[0].estatusId).toBe("os-preparacion");
  });

  it("estatus inicial no disponible -> todas las filas quedan en error, sin persistir", async () => {
    const repo = buildRepo({ findEstatusIdByValue: vi.fn().mockResolvedValue(null) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.conError).toBe(1);
    }
    expectSinPersistir(repo);
  });
});

// Feature 155 (R1/R4/R7/R16/R17/R18) — BIFURCACION POR BODEGA en la carga masiva por UI. El
// describe de la feature 27 sigue vivo: cambia el ESTADO al que mapea cada rama del flag y,
// sobre todo, que la rama (b) numera. Lo que NO cambia es que el predicado se lee UNA vez por
// lote sobre la tienda del actor.
describe("BulkOrdenService.cargarMasiva — bifurcacion por bodega (feature 27 + 155/R16/R17/R18)", () => {
  it("R16: tienda con fulfillment=true -> nace en en_preparacion, SIN guia", async () => {
    const repo = buildRepo({
      findUsuarioFulfillment: vi.fn().mockResolvedValue(true),
      findEstatusIdByValue: vi.fn().mockResolvedValue("os-preparacion"),
    });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    if (r.status === "ok") {
      // R16: se reporta, por cada fila creada, el estado inicial resuelto.
      expect(r.summary.filas[0].estatus).toBe("en_preparacion");
    }
    expect(createManyArg(repo)[0].estatusId).toBe("os-preparacion");
    // La rama (a) NO consume la secuencia de guias.
    expect(repo.createManyOrdenes).toHaveBeenCalledTimes(1);
    expect(repo.createManyOrdenesConGuia).not.toHaveBeenCalled();
  });

  it("R16: tienda con fulfillment=false -> nace en por_recolectar_en_tienda, CON guia", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("por_recolectar_en_tienda");
    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("por_recolectar_en_tienda");
    }
    // La rama (b) numera en la MISMA tx de la creacion.
    expect(repo.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    expect(repo.createManyOrdenes).not.toHaveBeenCalled();
  });

  it("R4/R15/R18: lee fulfillment de la tienda del actor UNA vez por LOTE, no por fila", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva(
      [row({ num_remision: "A" }), row({ num_remision: "B" }), row({ num_remision: "C" })],
      TIENDA,
    );

    expect(repo.findUsuarioFulfillment).toHaveBeenCalledTimes(1); // R4/R18
    expect(repo.findUsuarioFulfillment).toHaveBeenCalledWith("store1"); // R15: actor.usuarioId
  });

  it("R1: solo el flag decide; una columna `estatus` en el archivo no altera nada", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row({ estatus: "entregada" })], TIENDA);

    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_preparacion");
    expect(repo.findEstatusIdByValue).not.toHaveBeenCalledWith("entregada");
    if (r.status === "ok") expect(r.summary.filas[0].estatus).toBe("en_preparacion");
  });

  it("R18: el estatus resuelto se reporta tambien en duplicadas intra-archivo, sin numerar", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row(), row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.filas[0].estatus).toBe("por_recolectar_en_tienda");
      expect(r.summary.filas[1]).toMatchObject({
        resultado: "duplicada",
        estatus: "por_recolectar_en_tienda",
      });
    }
    // R18: la duplicada NO llega al repositorio, asi que no consume guia ni deja historial.
    expect(createManyArg(repo)).toHaveLength(1);
  });

  it("R7/R20: el value de la rama resuelta no esta en el catalogo -> 0 creadas y error que lo NOMBRA", async () => {
    const repo = buildRepo({
      findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
      findEstatusIdByValue: vi.fn().mockResolvedValue(null),
    });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA);

    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(0);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.filas[0].errores?.estatus?.[0]).toContain("por_recolectar_en_tienda");
    }
    expectSinPersistir(repo);
  });

  it("R17: el dryRun de la rama (b) NO consume ninguna guia (no toca el repositorio)", async () => {
    const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const r = await service.cargarMasiva([row()], TIENDA, { dryRun: true });

    // Reporta igualmente el estado inicial que corresponderia...
    if (r.status === "ok") {
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.filas[0].estatus).toBe("por_recolectar_en_tienda");
    }
    // ...pero no persiste nada, asi que la secuencia de guias no avanza.
    expectSinPersistir(repo);
  });
});

describe("BulkOrdenService.cargarMasiva — exito parcial (R29)", () => {
  it("filas invalidas no bloquean la persistencia de las validas", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const rows = [
      row({ num_remision: "REM-A" }),
      row({ num_remision: "REM-B", destinatario: "" }), // invalida
    ];
    const r = await service.cargarMasiva(rows, TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.total).toBe(2);
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(1);
    }
    const arg = createManyArg(repo);
    expect(arg).toHaveLength(1);
    expect(arg[0].numRemision).toBe("REM-A");
  });
});

describe("BulkOrdenService.cargarMasiva — dry-run (validación previa)", () => {
  it("dryRun=true clasifica todas las filas SIN persistir", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    const rows = [
      row({ num_remision: "REM-A" }), // válida -> creada
      row({ num_remision: "REM-B", destinatario: "" }), // inválida -> error
      row({ num_remision: "REM-A" }), // duplicada intra-archivo
    ];
    const r = await service.cargarMasiva(rows, TIENDA, { dryRun: true });

    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.summary.total).toBe(3);
      expect(r.summary.creadas).toBe(1);
      expect(r.summary.conError).toBe(1);
      expect(r.summary.duplicadas).toBe(1);
    }
    // La validación previa NO escribe en la DB (esencia del dry-run).
    expectSinPersistir(repo);
  });

  it("dryRun devuelve el MISMO summary que la carga real (misma clasificación)", async () => {
    const rows = [
      row({ num_remision: "REM-A" }),
      row({ num_remision: "REM-B", direccion_destinatario: dir({ provincia: "Inexistente" }) }),
    ];

    const repoReal = buildRepo({
      findAllProvincias: vi
        .fn()
        .mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]),
    });
    const real = await new BulkOrdenService(repoReal, tarifaRepoStub).cargarMasiva(rows, TIENDA);

    const repoDry = buildRepo({
      findAllProvincias: vi
        .fn()
        .mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]),
    });
    const dry = await new BulkOrdenService(repoDry, tarifaRepoStub).cargarMasiva(rows, TIENDA, {
      dryRun: true,
    });

    expect(real.status).toBe("ok");
    expect(dry.status).toBe("ok");
    if (real.status === "ok" && dry.status === "ok") {
      expect(dry.summary).toEqual(real.summary);
    }
    // La real persiste la válida; la dry-run no (por ninguna de las dos rutas).
    expect(vecesPersistido(repoReal)).toBe(1);
    expectSinPersistir(repoDry);
  });

  it("dryRun=false persiste con normalidad (no-regresión)", async () => {
    const repo = buildRepo();
    const service = new BulkOrdenService(repo, tarifaRepoStub);

    await service.cargarMasiva([row()], TIENDA, { dryRun: false });

    expect(vecesPersistido(repo)).toBe(1);
  });
});

// Feature 88/R14 + 155/R1/R6 — la vía sesión y la vía API dejan de diferenciarse por el CANAL.
// Lo que decide la ruta de persistencia es la RAMA (el flag de la tienda), y es la misma regla
// para las dos vías: el canal por el que entra un dato no dice nada sobre dónde está el paquete.
describe("BulkOrdenService.cargarMasiva — la ruta la decide la rama, no el canal (88/R14 + 155/R6)", () => {
  it("la ruta de persistencia la elige el flag, no la vía: cada rama usa la suya", async () => {
    const repoA = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(true) });
    await new BulkOrdenService(repoA, tarifaRepoStub).cargarMasiva([row()], TIENDA);
    expect(repoA.createManyOrdenes).toHaveBeenCalledTimes(1);
    expect(repoA.createManyOrdenesConGuia).not.toHaveBeenCalled();

    const repoB = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(false) });
    await new BulkOrdenService(repoB, tarifaRepoStub).cargarMasiva([row()], TIENDA);
    expect(repoB.createManyOrdenesConGuia).toHaveBeenCalledTimes(1);
    expect(repoB.createManyOrdenes).not.toHaveBeenCalled();
  });

  it("155/R22: la vía sesión NUNCA crea en en_ruta_bodega_central (el viejo estado fijo de la API)", async () => {
    for (const fulfillment of [true, false]) {
      const repo = buildRepo({ findUsuarioFulfillment: vi.fn().mockResolvedValue(fulfillment) });
      await new BulkOrdenService(repo, tarifaRepoStub).cargarMasiva([row()], TIENDA);
      expect(repo.findEstatusIdByValue).not.toHaveBeenCalledWith("en_ruta_bodega_central");
    }
  });

  it("sigue exigiendo adminTienda (la bifurcación no relaja la autorización)", async () => {
    const repo = buildRepo();
    const r = await new BulkOrdenService(repo, tarifaRepoStub).cargarMasiva([row()], MAESTRO);
    expect(r.status).toBe("forbidden");
    expectSinPersistir(repo);
  });
});

// Feature 98 (T11) — no-regresión de la vía sesión: cargarMasiva NO resuelve flete ni su
// BulkSummary gana costoEnvio (R9). El resolver de tarifa jamás se invoca en esta vía.
describe("BulkOrdenService.cargarMasiva — sin resolución de flete (feature 98/R9)", () => {
  it("no invoca el resolver de tarifa y el BulkSummary no expone costoEnvio", async () => {
    const repo = buildRepo();
    // Feature 274/R37: los DOS metodos que quedan en la interfaz (el resolver colapso). La
    // asercion no se debilita al renombrar: se espia lo que hoy EXISTE, y son ambos.
    const tarifaSpy: ITarifaVigenteRepository = {
      resolveTarifa: vi.fn(async () => null),
      resolveTarifas: vi.fn(async () => new Map()),
    };
    const r = await new BulkOrdenService(repo, tarifaSpy).cargarMasiva([row()], TIENDA);

    expect(tarifaSpy.resolveTarifa).not.toHaveBeenCalled();
    expect(tarifaSpy.resolveTarifas).not.toHaveBeenCalled();
    if (r.status === "ok") {
      // El BulkSummary de la vía sesión no tiene bloque `ordenes` ni costoEnvio en sus filas.
      expect(r.summary).not.toHaveProperty("ordenes");
      for (const f of r.summary.filas) expect(f).not.toHaveProperty("costoEnvio");
    }
  });
});
