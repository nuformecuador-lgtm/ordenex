import { describe, it, expect, vi, afterEach } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  IGestionOrdenRepository,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { MSG_TOPE_INTENTOS_GESTION } from "@/lib/services/mensajes-bloqueo";
import { reintentosConfig } from "@/lib/config/reintentos";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import { SIN_BLOQUEO, type BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";

/**
 * FEATURE 273 (T4) — LA PUERTA DEL TOPE EN EL PANEL DEL MENSAJERO. R1, R2, R5, R6, R7, R11.
 *
 * 💰 Esta ruta acaba en `cobroRechazado` (56, dinero real). Lo que este archivo prueba con dobles
 * es la DECISION del servicio; lo que NO puede probar es ningun `WHERE` —los dobles no ven el
 * SQL—, y por eso el conteo de intentos tiene su propia prueba contra Postgres en la 215 y la
 * liberacion diferida la suya en `liberacion-reprogramada-cierre-real.test.ts`.
 *
 * EL CASO QUE DE VERDAD IMPORTA es el 5: el rechazo NO puede dejar efectos. Si alguien moviera la
 * guarda por debajo de `subirEvidenciasCompensadas`, el `expect(storage.upload).not...` cae. Sin
 * ese caso, colocar la guarda en el sitio equivocado seguiria pasando los otros seis.
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

/** El umbral REAL de la configuracion. Ningun caso escribe `3`: el numero sale de aqui. */
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  por_recoger: "os-espera",
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  reprogramada: "os-reprogramada",
  devolucion_por_confirmar: "os-devolucion-por-confirmar",
  rechazada: "os-rechazada",
  incidente: "os-incidente",
  ayuda_tienda: "os-ayuda-tienda",
};

function gestionRow(over: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "en_reparto",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 100,
    zonaId: "z1",
    fechaReparto: null,
    ...over,
  };
}

function fakeRepo(over: Partial<IGestionOrdenRepository> = {}): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => []),
    findMisAsignacionesByIds: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarGestionadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    crearGestionDesdeAyuda: vi.fn(async () => "g-ayuda"),
    rechazarDesdeDevuelta: vi.fn(async () => true),
    ...over,
  };
}

function fakeStorage(): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
}

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
  };
}

function fakeOrdenRepo(): Pick<IOrdenRepository, "findEstatusIdByValue" | "findBloqueoDetalle"> {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
  };
}

function fakeRutaRepo(): Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> {
  return { findByMensajero: vi.fn(async () => null), upsertOrigen: vi.fn(async () => {}) };
}

function fakeMetaRepo(): Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero"> {
  return { findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()) };
}

/** Monta el servicio con el conteo de intentos que se le quiera dar a la orden `o1`. */
function montar(intentos: number, repoOver: Partial<IGestionOrdenRepository> = {}) {
  const repo = fakeRepo(repoOver);
  const storage = fakeStorage();
  const historial = fakeIntentosEnLote({ o1: intentos });
  const service = new MisAsignacionesService(
    repo,
    fakeOrdenRepo(),
    storage,
    fakeSignedUrls(),
    fakeRutaRepo(),
    fakeMetaRepo(),
    historial,
  );
  return { service, repo, storage, historial };
}

const FOTO = { contentType: "image/jpeg" as const, bytes: new Uint8Array([1]) };

/**
 * Los cinco `GestionarInput` posibles, cada uno con SUS campos obligatorios. Se escriben uno a uno
 * y no con un `Partial<>` mas un cast: `GestionarInput` es una UNION DISCRIMINADA, y el cast la
 * aplanaria — un test podria mandar una `reprogramada` sin fecha y el typecheck no diria nada,
 * que es justo lo que la union existe para impedir.
 */
const ENTRADA = {
  reprogramada: (): GestionarInput => ({
    ordenId: "o1",
    resultado: "reprogramada",
    fechaReprogramacion: "2026-09-01",
    motivo: "el cliente pidio otro dia",
  }),
  devuelta: (): GestionarInput => ({
    ordenId: "o1",
    resultado: "devuelta",
    causaDevolucion: "not_found",
    motivo: "nadie en el domicilio",
    evidencias: [FOTO],
  }),
  entregada: (): GestionarInput => ({
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: 100,
    metodoPago: "efectivo",
    pagos: [{ metodo: "efectivo", monto: 100 }],
    evidencias: [FOTO],
  }),
  rechazada: (): GestionarInput => ({
    ordenId: "o1",
    resultado: "rechazada",
    motivo: "no la quiso",
    evidencias: [FOTO],
  }),
  incidente: (): GestionarInput => ({
    ordenId: "o1",
    resultado: "incidente",
    causaIncidente: "danado",
    motivo: "paquete aplastado",
    evidencias: [FOTO],
  }),
} as const;

/* -------------------------------------------------------------------------- */
/* 1 y 2 · Los DOS desenlaces prohibidos en el tope                            */
/* -------------------------------------------------------------------------- */

describe("273/T4 · R1 — en el tope no se acepta `reprogramada` ni `devuelta`", () => {
  it("1. `reprogramada` con `intentos = umbral - 1` -> conflict con el motivo compartido", async () => {
    const { service, repo } = montar(UMBRAL - 1);

    const r = await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    // R6: el motivo sale del SIMBOLO compartido, no de un literal gemelo escrito aqui. Si el
    // servicio reescribiera la frase, este caso cae.
    expect(r.motivo).toBe(MSG_TOPE_INTENTOS_GESTION);
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("2. `devuelta` con `intentos = umbral - 1` -> el MISMO conflict", async () => {
    const { service, repo } = montar(UMBRAL - 1);

    const r = await service.gestionar(ENTRADA.devuelta(), MENSAJERO);

    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_GESTION });
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · Los TRES permitidos siguen pasando, sin condicion nueva                 */
/* -------------------------------------------------------------------------- */

describe("273/T4 · R2 — en el tope, los tres permitidos llegan al repositorio", () => {
  // El de `incidente` es el que blinda la DECISION 3 DEL HUMANO (2026-08-24): reportar un
  // incidente NO es un desenlace de entrega, asi que el tope no lo toca. Si alguien "limpiara" la
  // lista de permitidos dejando solo `entregada` y `rechazada`, este caso cae.
  const PERMITIDOS = ["entregada", "rechazada", "incidente"] as const;

  for (const resultado of PERMITIDOS) {
    it(`3.${resultado} — pasa con intentos = umbral - 1`, async () => {
      const { service, repo } = montar(UMBRAL - 1);

      const r = await service.gestionar(ENTRADA[resultado](), MENSAJERO);

      expect(r.status).toBe("ok");
      expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
    });
  }

  it("3.bis — con los permitidos NI SIQUIERA se consulta el contador", async () => {
    // La guarda pregunta el numero SOLO cuando el resultado esta prohibido. No es una
    // optimizacion cosmetica: es lo que garantiza R2 «sin ninguna condicion nueva» — si el
    // contador se consultara siempre, una caida de esa lectura romperia una entrega.
    const { service, historial } = montar(UMBRAL + 5);

    await service.gestionar(ENTRADA.entregada(), MENSAJERO);

    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · La puerta no se cierra antes de tiempo                                  */
/* -------------------------------------------------------------------------- */

describe("273/T4 · R1 — por debajo del tope nada cambia", () => {
  it("4. `reprogramada` con `intentos = umbral - 2` pasa", async () => {
    const { service, repo } = montar(UMBRAL - 2);

    const r = await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    expect(r.status).toBe("ok");
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("4.bis — y con `intentos` POR ENCIMA del umbral sigue bloqueada (`>=`, no `===`)", async () => {
    // Los datos heredados pueden estar por encima: la ficha nace de una orden con 3 intentos que
    // seguia circulando. Con `===` en `alcanzaElTope` este caso se escaparia por el hueco.
    const { service, repo } = montar(UMBRAL + 4);

    const r = await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_GESTION });
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · R5 — EL RECHAZO NO DEJA NADA. El caso que fija DONDE va la guarda.      */
/* -------------------------------------------------------------------------- */

describe("273/T4 · R5 — el rechazo por tope no produce NINGUN efecto", () => {
  it("5. cero subidas a Storage y cero escrituras en el repositorio", async () => {
    // `devuelta` es de los resultados que SI suben evidencia (feature 75), asi que si la guarda
    // viviera por debajo de `subirEvidenciasCompensadas` este doble habria recibido la foto y se
    // habria quedado huerfana en el bucket apuntando a una gestion que no existe.
    const { service, repo, storage } = montar(UMBRAL - 1);

    const r = await service.gestionar(
      {
        ordenId: "o1",
        resultado: "devuelta",
        causaDevolucion: "wrong_address",
        motivo: "direccion equivocada",
        evidencias: [FOTO, FOTO],
      },
      MENSAJERO,
    );

    expect(r.status).toBe("conflict");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled(); // ni siquiera hubo que compensar
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
    expect(repo.setOrdenEnGestion).not.toHaveBeenCalled();
    expect(repo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("5.bis — tampoco toca el puntero de «orden activa»: la guarda va ANTES", async () => {
    const { service, repo } = montar(UMBRAL - 1);

    await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    // `getOrdenEnGestion` es la guarda SIGUIENTE. Que no se haya llamado demuestra que el corte
    // ocurrio antes, no que el resultado coincidiera por casualidad.
    expect(repo.getOrdenEnGestion).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 6 · R7 — el umbral sale de la configuracion, no de un `3` a mano            */
/* -------------------------------------------------------------------------- */

describe("273/T4 · R7 — el umbral es configurable de verdad", () => {
  const ANTES = process.env.REINTENTOS_MIN_INTENTOS;

  afterEach(() => {
    if (ANTES === undefined) delete process.env.REINTENTOS_MIN_INTENTOS;
    else process.env.REINTENTOS_MIN_INTENTOS = ANTES;
    vi.resetModules();
  });

  /**
   * `reintentosConfig` se congela AL IMPORTAR (`lib/config/reintentos.ts`), asi que mover el env
   * no basta: hay que re-importar el modulo. `vi.resetModules()` + `await import(...)` es la unica
   * forma honesta de medir esto; cambiar el servicio para que lea el env en cada llamada seria
   * cambiar produccion para que el test sea comodo.
   */
  async function montarConUmbral5(intentos: number) {
    process.env.REINTENTOS_MIN_INTENTOS = "5";
    vi.resetModules();
    const { MisAsignacionesService: Fresco } = await import(
      "@/lib/services/MisAsignacionesService"
    );
    const repo = fakeRepo();
    const service = new Fresco(
      repo,
      fakeOrdenRepo(),
      fakeStorage(),
      fakeSignedUrls(),
      fakeRutaRepo(),
      fakeMetaRepo(),
      fakeIntentosEnLote({ o1: intentos }),
    );
    return { service, repo };
  }

  it("6a. con umbral 5 e `intentos = 3`, reprogramar PASA", async () => {
    // Con el umbral por defecto (3) este mismo caso estaria bloqueado: 3 >= 3-1. Que pase es la
    // prueba de que el numero salio de la configuracion.
    const { service, repo } = await montarConUmbral5(3);

    const r = await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    expect(r.status).toBe("ok");
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("6b. con umbral 5 e `intentos = 4`, reprogramar NO pasa", async () => {
    const { service, repo } = await montarConUmbral5(4);

    const r = await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 7 · R11 — el servidor rechaza aunque la interfaz no haya ocultado nada      */
/* -------------------------------------------------------------------------- */

describe("273/T4 · R11 — la decision no depende de lo que mande el cliente", () => {
  it("7. el input llega tal cual lo mandaria un cliente que ignore la UI, y se rechaza igual", async () => {
    // No hay ningun campo del input que diga «estoy en el tope»: el servicio lo DERIVA de la base.
    // Este caso manda el `GestionarInput` completo, con su fecha de reprogramacion y sus fotos,
    // exactamente como lo armaria un `curl` contra la Server Action.
    const { service, repo, storage } = montar(UMBRAL - 1);

    const r = await service.gestionar(
      {
        ordenId: "o1",
        resultado: "reprogramada",
        fechaReprogramacion: "2026-12-31",
        motivo: "el cliente pidio otro dia",
      },
      MENSAJERO,
    );

    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_GESTION });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("7.bis — el orden de guardas NO se invierte: el bloqueo por cierres gana al tope", async () => {
    // Primero «no puedes gestionar nada», despues «esta orden solo admite tres desenlaces». Si se
    // invirtiera, un mensajero bloqueado leeria un motivo que no es el suyo.
    const repo = fakeRepo();
    const ordenRepo = fakeOrdenRepo();
    const CIERRE_VIEJO = {
      cierreId: "c1",
      estado: "vencido" as const,
      solicitadoAt: "2026-08-20T10:00:00.000Z",
      jornadaCR: "2026-08-19",
      resuelve: "mensajero" as const,
    };
    const bloqueado: BloqueoDetalle = {
      bloqueado: true,
      cierresAbiertos: 2,
      cierresPorReenviar: 1,
      aResolverPrimero: CIERRE_VIEJO,
      aReenviarPrimero: CIERRE_VIEJO,
    };
    ordenRepo.findBloqueoDetalle = vi.fn(async () => bloqueado);
    const service = new MisAsignacionesService(
      repo,
      ordenRepo,
      fakeStorage(),
      fakeSignedUrls(),
      fakeRutaRepo(),
      fakeMetaRepo(),
      fakeIntentosEnLote({ o1: UMBRAL - 1 }),
    );

    const r = await service.gestionar(ENTRADA.reprogramada(), MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(r.motivo).not.toBe(MSG_TOPE_INTENTOS_GESTION);
    expect(r.motivo).toMatch(/cierre/i);
  });
});
