import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  notificadorNoOp,
  notificarCargaMasivaTerminadaCon,
  notificarCierreDiaPorAprobarCon,
  notificarPostulacionPendienteCon,
} from "@/lib/notificaciones/notificadores";
import { PostulacionMensajeroService } from "@/lib/services/PostulacionMensajeroService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPostulacionRepository } from "@/lib/interfaces/repositories/IPostulacionRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { PostularMensajeroCommand } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";

// Feature 146 — camino REAL de los notificadores best-effort (R22, R23, R24, R25).
//
// ⚠️ 2026-08-23: eran TRES cuando se escribio este archivo; hoy son CINCO (la 253 anadio el de
// la postulacion de recurso y la 262 el del dia de reparto corregido). Los casos de emision de
// abajo siguen cubriendo los tres originales; el censo del final —«el camino real esta CABLEADO
// en el composition root»— cubre los cinco y se contrasta contra el arbol.
//
// El default del constructor de cada uno de esos services es el NO-OP, y el notificador real se
// cablea en el composition root. Esto es lo que permite que este archivo pruebe el camino que corre en
// produccion: se construye `notificar*Con(repoDoble)` —la MISMA funcion que usa el binding real,
// solo que con el repositorio inyectado— y se verifica que emite lo esperado, y que un fallo se
// absorbe y se registra en vez de propagarse.

const ROOT = path.join(__dirname, "..", "..", "..");

/** Repositorio doble: registra lo creado, sin dedupe previa. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  async crear(input: CrearNotificacionInput): Promise<boolean> {
    this.creadas.push(input);
    return true;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

/** Repositorio que revienta al crear: modela la base caida en el camino real. */
class RepoQueFalla extends RepoDoble {
  override async crear(): Promise<boolean> {
    throw new Error("base caida");
  }
}

describe("R23 — camino real del notificador de postulacion", () => {
  it("emite las dos filas de maestro y admin contra el repositorio inyectado", async () => {
    const repo = new RepoDoble();

    await notificarPostulacionPendienteCon(repo)({ postulanteId: "u-9", nombre: "Ana Pérez" });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
    expect(repo.creadas[0].descripcion).toBe(
      "Una postulación de mensajero está pendiente de aprobación.",
    );
  });

  it("R25: absorbe el fallo del repositorio y lo registra, sin propagarlo", async () => {
    const logError = vi.fn();

    await expect(
      notificarPostulacionPendienteCon(new RepoQueFalla(), { logError })({
        postulanteId: "u-9",
        nombre: "Ana",
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("postulacion_mensajero_pendiente");
    expect((registrado.cause as Error).message).toBe("base caida");
  });
});

describe("R24 — camino real del notificador de cierre por aprobar", () => {
  it("emite las tres filas, la tercera acotada a la zona destino", async () => {
    const repo = new RepoDoble();

    await notificarCierreDiaPorAprobarCon(repo)({
      cierreId: "c-1",
      zonaId: "zona-3",
      mensajeroNombre: "Luis",
    });

    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
      { tipo: "rol", rol: "adminSatelite", zonaId: "zona-3" },
    ]);
  });

  it("R25: absorbe el fallo del repositorio y lo registra", async () => {
    const logError = vi.fn();

    await expect(
      notificarCierreDiaPorAprobarCon(new RepoQueFalla(), { logError })({
        cierreId: "c-1",
        zonaId: null,
        mensajeroNombre: null,
      }),
    ).resolves.toBeUndefined();

    expect((logError.mock.calls[0][0] as Error).message).toContain("cierre_dia_por_aprobar");
  });
});

describe("R22 — camino real del notificador de carga masiva", () => {
  it("emite una fila box dirigida al ejecutor con los contadores del lote", async () => {
    const repo = new RepoDoble();

    await notificarCargaMasivaTerminadaCon(repo)({
      usuarioId: "api-user-1",
      creadas: 128,
      total: 130,
      loteId: "lote-1",
    });

    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0]).toMatchObject({
      tipo: "box",
      evento: "carga_masiva_terminada",
      entidadTipo: "carga",
      entidadId: "lote-1",
      destinatario: { tipo: "usuario", usuarioId: "api-user-1" },
    });
    expect(repo.creadas[0].descripcion).toBe("Carga masiva terminada: 128 órdenes cargadas.");
  });

  it("R25: absorbe el fallo del repositorio y lo registra", async () => {
    const logError = vi.fn();

    await expect(
      notificarCargaMasivaTerminadaCon(new RepoQueFalla(), { logError })({
        usuarioId: "u-1",
        creadas: 1,
        total: 1,
        loteId: "lote-1",
      }),
    ).resolves.toBeUndefined();

    expect((logError.mock.calls[0][0] as Error).message).toContain("carga_masiva_terminada");
  });
});

describe("el notificador real, cableado en un service, emite de punta a punta", () => {
  function repoPostulacion(): IPostulacionRepository {
    return {
      emailExiste: vi.fn().mockResolvedValue(false),
      cedulaExiste: vi.fn().mockResolvedValue(false),
      findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
      tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
      vehiculoExiste: vi.fn().mockResolvedValue(true),
      crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    };
  }
  function storageFake(): IFileStorage {
    return {
      upload: vi.fn().mockImplementation(async ({ path: p }: { path: string }) => p),
      remove: vi.fn().mockResolvedValue(undefined),
    };
  }
  function comando(): PostularMensajeroCommand {
    const documentos = Object.fromEntries(
      DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1]) }]),
    ) as PostularMensajeroCommand["documentos"];
    return {
      nombre: "Ana",
      primerApellido: "Perez",
      segundoApellido: undefined,
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

  it("postular con el notificador REAL cableado crea las dos filas en el repositorio", async () => {
    const notificaciones = new RepoDoble();
    const service = new PostulacionMensajeroService(
      repoPostulacion(),
      storageFake(),
      notificarPostulacionPendienteCon(notificaciones),
    );

    expect(await service.postular(comando())).toEqual({ status: "ok" });
    expect(notificaciones.creadas).toHaveLength(2);
    expect(notificaciones.creadas[0].anexo).toBe("Ana Perez");
  });

  it("cargarViaApi con el notificador REAL cableado crea la fila del ejecutor", async () => {
    const notificaciones = new RepoDoble();
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
    const service = new BulkOrdenService(
      repo as never,
      { resolveTarifaPorTienda: vi.fn().mockResolvedValue(null) } as never,
      notificarCargaMasivaTerminadaCon(notificaciones),
    );
    const actor: Actor = { usuarioId: "api-user-1", rol: "apiKey", zonaId: null };

    expect((await service.cargarViaApi([{ num_remision: "R1" }], actor)).status).toBe("ok");
    expect(notificaciones.creadas).toHaveLength(1);
    expect(notificaciones.creadas[0].destinatario).toEqual({
      tipo: "usuario",
      usuarioId: "api-user-1",
    });
  });
});

describe("el DEFAULT de un service con notificador es inocuo POR CONSTRUCCION", () => {
  it("notificadorNoOp no hace nada y no lanza", async () => {
    await expect(notificadorNoOp({} as never)).resolves.toBeUndefined();
  });

  it("un service construido sin cablear el notificador no puede emitir nada", async () => {
    // Se construye tal y como lo hacen los dobles de las suites ajenas: sin tercer argumento.
    const service = new PostulacionMensajeroService(repoPostulacionSinCablear(), storageSinCablear());
    // No hay forma de observar una emision porque el default NO tiene repositorio detras.
    // Lo que se fija aqui es que el camino termina en `ok` sin tocar nada externo.
    expect(await service.postular(comandoMinimo())).toEqual({ status: "ok" });
  });

  function repoPostulacionSinCablear(): IPostulacionRepository {
    return {
      emailExiste: vi.fn().mockResolvedValue(false),
      cedulaExiste: vi.fn().mockResolvedValue(false),
      findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
      tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
      vehiculoExiste: vi.fn().mockResolvedValue(true),
      crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    };
  }
  function storageSinCablear(): IFileStorage {
    return {
      upload: vi.fn().mockImplementation(async ({ path: p }: { path: string }) => p),
      remove: vi.fn().mockResolvedValue(undefined),
    };
  }
  function comandoMinimo(): PostularMensajeroCommand {
    const documentos = Object.fromEntries(
      DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1]) }]),
    ) as PostularMensajeroCommand["documentos"];
    return {
      nombre: "Ana",
      primerApellido: "Perez",
      segundoApellido: undefined,
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

  it("CierreDiaService sin cablear tampoco emite", async () => {
    const repo = {
      existeCierreVencido: vi.fn().mockResolvedValue(true),
      transicionarVencidoASolicitado: vi.fn().mockResolvedValue(true),
      findCierreSolicitado: vi
        .fn()
        .mockResolvedValue({ id: "c-1", destinoZonaId: null, mensajeroNombre: null }),
    };
    const service = new CierreDiaService(
      repo as never,
      { findCentralZonaId: vi.fn() } as never,
      { findUsuarioZonaId: vi.fn(), findMensajerosBloqueadosParaGestion: vi.fn() } as never,
      { createSignedUrls: vi.fn() } as never,
      { resolvePagoTarifa: vi.fn() } as never,
    );

    const r = await service.solicitarCierre({
      usuarioId: "men-1",
      rol: "mensajero",
      zonaId: "z-1",
    });

    expect(r).toMatchObject({ status: "ok", via: "vencido_solicitado" });
  });
});

describe("el camino real esta CABLEADO en el composition root, no en el default", () => {
  const leer = (...partes: string[]) => fs.readFileSync(path.join(ROOT, ...partes), "utf8");

  it("lib/actions/postulacion-mensajero.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "postulacion-mensajero.ts")).toContain(
      "notificarPostulacionPendienteReal",
    );
  });

  it("lib/actions/cierre-dia.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "cierre-dia.ts")).toContain("notificarCierreDiaPorAprobarReal");
  });

  it("app/api/ordenes/api-key/carga/route.ts inyecta el notificador real", () => {
    expect(leer("app", "api", "ordenes", "api-key", "carga", "route.ts")).toContain(
      "notificarCargaMasivaTerminadaReal",
    );
  });

  // ⚠️ 2026-08-23 (feature 262, F6) — ESTE CENSO DECIA «TRES» Y EN EL ARBOL HABIA CINCO.
  // La 253 anadio `PostulacionRecursoService` y la 262 anadio `CorreccionDiaRepartoService`, los
  // dos con su notificador best-effort y su default no-op, y NINGUNO entraba aqui: un service
  // que se cablease con el notificador real en su propio constructor —o que se olvidase de
  // cablearlo en el composition root— no habria puesto rojo nada. El censo se AMPLIA, no se
  // relaja: la lista sigue siendo LITERAL por el mismo motivo que la del enum de eventos
  // (`notificacion-productores-wiring.test.ts`), y debajo hay una comprobacion que la contrasta
  // contra el arbol para que un SEXTO service no pueda quedarse fuera en silencio.
  const SERVICES_CON_NOTIFICADOR = [
    "PostulacionMensajeroService.ts",
    "CierreDiaService.ts",
    "BulkOrdenService.ts",
    "PostulacionRecursoService.ts", // feature 253 / D6
    "CorreccionDiaRepartoService.ts", // feature 262 / D7
  ] as const;

  it("lib/actions/postulacion-recurso.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "postulacion-recurso.ts")).toContain(
      "notificarPostulacionRecursoPendienteReal",
    );
  });

  it("lib/actions/corregir-dia-reparto.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "corregir-dia-reparto.ts")).toContain(
      "notificarDiaRepartoCorregidoReal",
    );
  });

  it("los defaults de los CINCO services son el no-op, no el notificador real", () => {
    for (const servicio of SERVICES_CON_NOTIFICADOR) {
      const fuente = leer("lib", "services", servicio);
      expect(fuente).toMatch(/Notificador = notificadorNoOp/);
      expect(fuente).not.toMatch(/Notificador = notificar\w*Real/);
    }
  });

  it("el censo esta COMPLETO: no hay ningun otro service con notificador por constructor", () => {
    // Contra el ARBOL, no contra la propia lista: es lo unico que convierte «son estos cinco» en
    // una afirmacion que se puede romper. Si manana entra un sexto service con notificador y
    // nadie lo apunta arriba, este test lo nombra.
    const dir = path.join(ROOT, "lib", "services");
    const conNotificador = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .filter((n) => /Notificador = notificadorNoOp/.test(fs.readFileSync(path.join(dir, n), "utf8")))
      .sort();
    expect(conNotificador).toEqual([...SERVICES_CON_NOTIFICADOR].sort());
  });

  it("ningun modulo de lib/ ni app/ apaga la emision segun el entorno de test", () => {
    const sospechosos: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          recorrer(completo);
          continue;
        }
        if (!/\.tsx?$/.test(entrada.name)) continue;
        const fuente = fs.readFileSync(completo, "utf8");
        if (/process\.env\.VITEST|NODE_ENV\s*===\s*["']test["']/.test(fuente)) {
          sospechosos.push(completo);
        }
      }
    };
    recorrer(path.join(ROOT, "lib"));
    recorrer(path.join(ROOT, "app"));
    expect(sospechosos).toEqual([]);
  });
});
