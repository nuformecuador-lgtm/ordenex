import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { PostulacionMensajeroService } from "@/lib/services/PostulacionMensajeroService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";
import type { IPostulacionRepository } from "@/lib/interfaces/repositories/IPostulacionRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { PostularMensajeroCommand } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CargaMasivaNotificador,
  CierreNotificador,
} from "@/lib/notificaciones/notificadores";

// Feature 146 — B14/B15/B16 (wiring) y B17 (guardia de alcance). Verifica que cada operacion
// de negocio DISPARA su productor y que un productor que LANZA no cambia el resultado de la
// operacion (R25). Cubre R22, R23, R24, R25 y R26.

const ROOT = path.join(__dirname, "..", "..", "..");

// ---------------------------------------------------------------------------
// B14 — postulacion de mensajero
// ---------------------------------------------------------------------------

function repoPostulacion(overrides: Partial<IPostulacionRepository> = {}): IPostulacionRepository {
  return {
    emailExiste: vi.fn().mockResolvedValue(false),
    cedulaExiste: vi.fn().mockResolvedValue(false),
    findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
    tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
    vehiculoExiste: vi.fn().mockResolvedValue(true),
    crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    ...overrides,
  };
}

function storageFake(): IFileStorage {
  return {
    upload: vi.fn().mockImplementation(async ({ path: p }: { path: string }) => p),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function comandoPostulacion(): PostularMensajeroCommand {
  const documentos = Object.fromEntries(
    DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1]) }]),
  ) as PostularMensajeroCommand["documentos"];
  return {
    nombre: "Ana",
    primerApellido: "Perez",
    segundoApellido: "Gomez",
    email: "ana@example.com",
    telefono: "0991234567",
    tipoIdentificacionId: "tipo-1",
    cedula: "1710034065",
    vehiculoId: "veh-1",
    placa: "ABC123",
    password: "Abcdef1!",
    documentos,
  };
}

describe("R23 — registrar una postulacion dispara su aviso", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifica con el postulante y su nombre tras la escritura atomica", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const service = new PostulacionMensajeroService(
      repoPostulacion(),
      storageFake(),
      notificar,
    );

    const r = await service.postular(comandoPostulacion());

    expect(r).toEqual({ status: "ok" });
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(notificar.mock.calls[0][0]).toMatchObject({ nombre: "Ana Perez" });
    expect(typeof notificar.mock.calls[0][0].postulanteId).toBe("string");
  });

  it("NO notifica cuando la postulacion no llega a crearse", async () => {
    const notificar = vi.fn();
    const service = new PostulacionMensajeroService(
      repoPostulacion({ emailExiste: vi.fn().mockResolvedValue(true) }),
      storageFake(),
      notificar,
    );

    expect(await service.postular(comandoPostulacion())).toEqual({
      status: "conflict",
      field: "email",
    });
    expect(notificar).not.toHaveBeenCalled();
  });

  it("tampoco notifica si la escritura atomica falla por duplicado", async () => {
    const notificar = vi.fn();
    const service = new PostulacionMensajeroService(
      repoPostulacion({
        crearMensajeroConDocumentos: vi.fn().mockRejectedValue(new UsuarioDuplicadoError("cedula")),
      }),
      storageFake(),
      notificar,
    );

    expect(await service.postular(comandoPostulacion())).toMatchObject({ status: "conflict" });
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("R25 — un aviso que falla no tumba la postulacion", () => {
  it("la postulacion sigue devolviendo ok y no se limpian los documentos subidos", async () => {
    const notificar = vi.fn().mockRejectedValue(new Error("aviso caido"));
    const storage = storageFake();
    const service = new PostulacionMensajeroService(repoPostulacion(), storage, notificar);

    expect(await service.postular(comandoPostulacion())).toEqual({ status: "ok" });
    expect(storage.remove).not.toHaveBeenCalled(); // R24 no se dispara por un aviso
  });
});

// ---------------------------------------------------------------------------
// B15 — cierre del dia por aprobar (los TRES caminos de exito)
// ---------------------------------------------------------------------------

const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero", zonaId: "zona-1" };

const GESTION_PENDIENTE = {
  gestionId: "g-1",
  ordenId: "o-1",
  numGuia: 1,
  numRemision: "REM-1",
  destinatario: "D",
  direccion: null,
  zonaNombre: null,
  provinciaNombre: null,
  cantonNombre: null,
  distritoNombre: null,
  resultado: "entregada" as const,
  metodoPago: null,
  montoRecibido: null,
  evidenciaStoragePath: null,
  observacion: null,
  causaDevolucion: null,
  pagoMensajero: null,
  ingresoBodegaRechazo: null,
  pagos: [], // feature 212/R21: gestion sin cobro -> cero lineas de desglose
  createdAt: new Date("2026-07-27T10:00:00.000Z"),
};

function cierreRepo(overrides: Record<string, unknown> = {}) {
  return {
    existeCierreVencido: vi.fn().mockResolvedValue(false),
    existeCierreRechazado: vi.fn().mockResolvedValue(false),
    existeCierreSolicitado: vi.fn().mockResolvedValue(false),
    contarOrdenesPendientesGestion: vi.fn().mockResolvedValue(0),
    findGestionesPendientes: vi.fn().mockResolvedValue([GESTION_PENDIENTE]),
    transicionarVencidoASolicitado: vi.fn().mockResolvedValue(true),
    transicionarRechazadoASolicitado: vi.fn().mockResolvedValue(true),
    crearCierre: vi.fn().mockResolvedValue("c-1"),
    findCierreSolicitado: vi
      .fn()
      .mockResolvedValue({ id: "c-1", destinoZonaId: "zona-1", mensajeroNombre: "Luis" }),
    findCierresByMensajero: vi.fn().mockResolvedValue([]),
    findGestionParaDeshacer: vi.fn(),
    findUltimaGestionNoAnuladaId: vi.fn(),
    anularGestionYDevolverAGestion: vi.fn(),
    ...overrides,
  };
}

function cierreService(repo: ReturnType<typeof cierreRepo>, notificar: CierreNotificador) {
  return new CierreDiaService(
    repo as never,
    { findCentralZonaId: vi.fn().mockResolvedValue("zona-central") } as never,
    {
      findUsuarioZonaId: vi.fn().mockResolvedValue("zona-1"),
      findUsuarioVehiculoId: vi.fn().mockResolvedValue("veh-1"),
      findEstatusIdByValue: vi.fn(),
      findMensajerosBloqueadosParaGestion: vi.fn().mockResolvedValue([]),
    } as never,
    { createSignedUrls: vi.fn().mockResolvedValue({}) } as never,
    { resolvePagoTarifa: vi.fn().mockResolvedValue(null) } as never,
    notificar,
  );
}

describe("R24 — los TRES caminos de exito de solicitar cierre avisan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("camino de creacion (crearCierre)", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const r = await cierreService(cierreRepo(), notificar).solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(notificar).toHaveBeenCalledWith({
      cierreId: "c-1",
      zonaId: "zona-1",
      mensajeroNombre: "Luis",
    });
  });

  it("camino vencido -> solicitado", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const repo = cierreRepo({ existeCierreVencido: vi.fn().mockResolvedValue(true) });

    const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "vencido_solicitado" });
    expect(notificar).toHaveBeenCalledTimes(1);
  });

  it("camino rechazado -> solicitado", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const repo = cierreRepo({ existeCierreRechazado: vi.fn().mockResolvedValue(true) });

    const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "rechazado_solicitado" });
    expect(notificar).toHaveBeenCalledTimes(1);
  });

  it("propaga la zona destino del cierre como alcance del aviso", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const repo = cierreRepo({
      findCierreSolicitado: vi
        .fn()
        .mockResolvedValue({ id: "c-9", destinoZonaId: "zona-7", mensajeroNombre: null }),
    });

    await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(notificar.mock.calls[0][0]).toMatchObject({ cierreId: "c-9", zonaId: "zona-7" });
  });

  it("NO avisa cuando la solicitud termina en conflicto", async () => {
    const notificar = vi.fn();
    const repo = cierreRepo({ existeCierreSolicitado: vi.fn().mockResolvedValue(true) });

    const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(notificar).not.toHaveBeenCalled();
  });

  it("no inventa un aviso si el cierre solicitado no se puede resolver", async () => {
    const notificar = vi.fn();
    const repo = cierreRepo({ findCierreSolicitado: vi.fn().mockResolvedValue(null) });

    const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(r.status).toBe("ok");
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("R25 — un aviso que falla no tumba el cierre", () => {
  it("solicitarCierre sigue devolviendo ok cuando el notificador lanza", async () => {
    const notificar = vi.fn().mockRejectedValue(new Error("aviso caido"));

    const r = await cierreService(cierreRepo(), notificar).solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
  });
});

// ---------------------------------------------------------------------------
// B16 — carga masiva por API key
// ---------------------------------------------------------------------------

const ACTOR_API: Actor = { usuarioId: "api-user-1", rol: "apiKey", zonaId: null };

function bulkService(notificar: CargaMasivaNotificador) {
  const repo = {
    findEstatusIdByValue: vi.fn().mockResolvedValue("est-1"),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([]),
    // Feature 155: `cargarViaApi` resuelve el estado inicial con el flag de la tienda
    // dueña de la key, asi que el doble del repositorio debe exponerlo.
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    createManyOrdenesConGuia: vi.fn().mockResolvedValue([]),
  };
  const tarifas = { resolveTarifaPorTienda: vi.fn().mockResolvedValue(null) };
  return new BulkOrdenService(repo as never, tarifas as never, notificar);
}

describe("R22 — la carga por API key notifica al ejecutor al cerrar el lote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emite una sola vez, al usuario de la key, con los contadores del resumen", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);

    // fila sin geografia -> resultado `error`: no se crea nada, pero el LOTE termina igual y
    // el aviso se emite con los contadores del resumen.
    const r = await bulkService(notificar).cargarViaApi([{ num_remision: "R1" }], ACTOR_API);

    expect(r.status).toBe("ok");
    expect(notificar).toHaveBeenCalledTimes(1);
    const ctx = notificar.mock.calls[0][0];
    expect(ctx.usuarioId).toBe("api-user-1");
    expect(ctx.total).toBe(1);
    expect(typeof ctx.loteId).toBe("string");
  });

  it("no notifica cuando el rol no esta autorizado", async () => {
    const notificar = vi.fn();

    const r = await bulkService(notificar).cargarViaApi(
      [{ num_remision: "R1" }],
      { usuarioId: "u-1", rol: "adminTienda", zonaId: null },
    );

    expect(r.status).toBe("forbidden");
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("R25 — un aviso que falla no tumba la carga masiva", () => {
  it("cargarViaApi sigue devolviendo el resumen cuando el notificador lanza", async () => {
    const notificar = vi.fn().mockRejectedValue(new Error("aviso caido"));

    const r = await bulkService(notificar).cargarViaApi([{ num_remision: "R1" }], ACTOR_API);

    expect(r.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// B17 — guardia de alcance (R26 / D2)
// ---------------------------------------------------------------------------

describe("R26 — la feature no introduce ningun trabajo programado", () => {
  it("vercel.json no gana ninguna entrada de cron de notificaciones", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
      crons?: { path: string }[];
    };
    for (const cron of vercel.crons ?? []) {
      expect(cron.path).not.toMatch(/notificacion/i);
    }
  });

  it("el enum JobTipo no gana ningun valor de notificacion", () => {
    const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
    const jobTipo = /enum JobTipo \{([\s\S]*?)\}/.exec(schema);
    expect(jobTipo).not.toBeNull();
    expect(jobTipo![1]).not.toMatch(/notificacion/i);
  });

  it("no existe ninguna ruta de cron ni route handler de notificaciones bajo app/", () => {
    const encontrados: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          if (/notificacion/i.test(entrada.name)) encontrados.push(completo);
          recorrer(completo);
        }
      }
    };
    recorrer(path.join(ROOT, "app"));
    expect(encontrados).toEqual([]);
  });

  it("la migracion de la feature no toca la tabla `jobs` ni su enum", () => {
    const dir = fs
      .readdirSync(path.join(ROOT, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((n) => n.endsWith("_notificacion"))!;
    const sql = fs.readFileSync(path.join(ROOT, "db", "migrations", dir, "migration.sql"), "utf8");
    expect(sql).not.toMatch(/"jobs"/);
    expect(sql).not.toMatch(/job_tipo/);
  });

  it("el enum de eventos es el inventario CERRADO de D1: exactamente cuatro", () => {
    const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
    const eventos = /enum NotificacionEvento \{([\s\S]*?)\n\}/.exec(schema)![1];
    const valores = eventos
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual([
      "orden_rechazada",
      "carga_masiva_terminada",
      "postulacion_mensajero_pendiente",
      "cierre_dia_por_aprobar",
    ]);
  });
});
