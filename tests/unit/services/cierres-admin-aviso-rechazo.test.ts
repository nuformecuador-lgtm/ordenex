import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MensajeroBloqueadoNotificador } from "@/lib/notificaciones/notificadores";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import { bloqueoDe } from "@/tests/fixtures/bloqueo-cierre";

/**
 * FEATURE 271 (T6.6) — **R42: el RECHAZO de un cierre avisa al mensajero que quedo bloqueado.**
 *
 * Por que este aviso y no otro: el rechazo es la UNICA via por la que un mensajero llega a tener
 * DOS cierres re-solicitables (solicita el dia 1, solicita el dia 2, el admin rechaza los dos, S1
 * + S6 del spec). Sin este productor, el caso mas confuso de todos —el unico que produce `N=2,
 * V=2`— era justo el que llegaba mudo: el mensajero se enteraba de que le habian rechazado el
 * cierre al toparse con el bloqueo al dia siguiente.
 *
 * ⚠️ QUE MIDE ESTA SUITE Y QUE NO. Aqui todo son DOBLES: no ve una linea de SQL, asi que **no
 * prueba** ni la regla N/V (`tests/unit/utils/bloqueo-cierre.test.ts`, las 7 filas), ni el `WHERE`
 * que la deriva (`tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`, contra Postgres y con
 * contraprueba por mutacion), ni los TEXTOS del aviso (`tests/unit/notificaciones/
 * bloqueo-textos.test.ts`, los literales escritos a mano). Lo que mide es el CABLEADO, que es
 * exactamente lo que faltaba: quien dispara, con que entidad, en que orden y —sobre todo— que el
 * aviso NO puede tocar el desenlace del rechazo.
 */

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA_SAT = "z-cartago";
const MOTIVO = "Faltan evidencias de dos entregas.";

function resumenRow(overrides: Partial<CierreAdminResumenRow> = {}): CierreAdminResumenRow {
  return {
    cierreId: "c-rechazado",
    mensajeroId: "men-1",
    mensajeroNombre: "Ana Mensajera",
    estado: "rechazado",
    destinoTipo: "bodega_satelite",
    destinoZonaId: ZONA_SAT,
    destinoZonaNombre: "Cartago",
    totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
    totalPagoMensajero: "5.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-08-21T18:00:00.000Z",
    resueltoAt: "2026-08-23T15:00:00.000Z",
    motivoRechazo: MOTIVO,
    ...overrides,
  };
}

type Repo = ICierresAdminRepository;

/** Traza de llamadas, para poder afirmar el ORDEN sin depender de relojes. */
type Traza = string[];

function fakeRepo(traza: Traza, overrides: Partial<Repo> = {}): Repo {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => {
      traza.push("findCierreByIdEnAlcance");
      return { cierre: resumenRow(), gestiones: [], sinGestion: [], sinGestionRegistrado: true };
    }),
    resolverCierre: vi.fn(async () => {
      traza.push("resolverCierre");
      return "updated" as const;
    }),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    findGestionesRetornablesDelCierre: vi.fn(async () => []),
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [], mensajerosFiltro: [] })),
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
    ...overrides,
  };
}

function newService(
  opts: {
    repo?: Repo;
    traza?: Traza;
    notificar?: MensajeroBloqueadoNotificador;
    /** Lo que devuelve `findBloqueoDetalle` DESPUES del rechazo. Por defecto: N=1, V=1. */
    bloqueo?: ReturnType<typeof bloqueoDe>;
    zonaSatelite?: string | null;
    /** `true` = se construye SIN inyectar notificador (default no-op del constructor). */
    sinNotificador?: boolean;
  } = {},
) {
  const traza = opts.traza ?? [];
  const repo = opts.repo ?? fakeRepo(traza);
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const findBloqueoDetalle = vi.fn(async () => {
    traza.push("findBloqueoDetalle");
    return opts.bloqueo ?? bloqueoDe({ n: 1, v: 1, cierreId: "c-rechazado" });
  });
  const ordenRepo = {
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async () =>
      opts.zonaSatelite === undefined ? ZONA_SAT : opts.zonaSatelite,
    ),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
    findBloqueoDetalle,
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  const liquidacionRepo = {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  };
  // Feature 293 (T2.3): lectura de premios; "0.00" por id -> lo pagable no cambia.
  const premiosRepo = {
    sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
  };
  const notificar =
    opts.notificar ??
    (vi.fn(async () => {
      traza.push("notificar");
    }) as MensajeroBloqueadoNotificador);
  const service = opts.sinNotificador
    ? new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, liquidacionRepo, premiosRepo)
    : new CierresAdminService(
        repo,
        zonaRepo,
        ordenRepo,
        signedUrls,
        liquidacionRepo,
        premiosRepo,
        notificar,
      );
  return { service, repo, ordenRepo, findBloqueoDetalle, notificar, traza };
}

/** El mock del notificador, ya tipado para leerle las llamadas. */
const mockDe = (n: MensajeroBloqueadoNotificador) => n as unknown as ReturnType<typeof vi.fn>;

describe("R42 — rechazar un cierre avisa al mensajero de que quedo bloqueado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emite UNA vez, al mensajero de la fila y a la zona DESTINO del cierre", async () => {
    const { service, notificar } = newService();

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(mockDe(notificar)).toHaveBeenCalledTimes(1);
    expect(mockDe(notificar).mock.calls[0][0]).toMatchObject({
      cierreId: "c-rechazado",
      // La zona DESTINO del cierre, que es el alcance del `adminSatelite` que tiene que ver el
      // aviso en su campana (S8). Sale de la fila, no del actor: quien rechaza puede ser el
      // maestro —como aqui—, y entonces el actor no tiene zona ninguna.
      zonaId: ZONA_SAT,
      // El MENSAJERO, no el admin que rechazo. Es el destinatario del aviso (R42).
      mensajeroUsuarioId: "men-1",
    });
  });

  it("el aviso viaja con el DETALLE del bloqueo (N, V y cual toca primero), no con un booleano", async () => {
    // R43: el texto tiene que decir cuantos cierres arrastra y cual toca resolver primero. Si el
    // contexto no llevara el detalle, el aviso no podria contar nada.
    const bloqueo = bloqueoDe({ n: 2, v: 2, jornadaCR: "2026-08-21", cierreId: "c-viejo" });
    const { service, notificar } = newService({ bloqueo });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificar).mock.calls[0][0].bloqueo).toEqual(bloqueo);
  });

  it("la ENTIDAD del aviso es el cierre RECHAZADO, no el que toca resolver primero", async () => {
    // R44 depende de esto: la clave `notificacion_dedupe_key` se calcula sobre `entidad_id`. Con
    // DOS rechazos, `aResolverPrimero` es el MISMO cierre viejo en los dos avisos; si la entidad
    // saliera de ahi, el segundo rechazo colisionaria con el primero sin leer y NO avisaria. Por
    // eso el fixture usa a proposito un `aResolverPrimero.cierreId` DISTINTO del rechazado.
    const bloqueo = bloqueoDe({ n: 2, v: 2, cierreId: "c-mas-viejo" });
    const { service, notificar } = newService({ bloqueo });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    const ctx = mockDe(notificar).mock.calls[0][0];
    expect(ctx.cierreId).toBe("c-rechazado");
    expect(ctx.bloqueo.aResolverPrimero.cierreId).toBe("c-mas-viejo");
  });

  it("el caso que motiva R42: dos rechazos seguidos avisan DOS veces, con entidades distintas", async () => {
    // «Solicita el dia 1, solicita el dia 2, el admin rechaza los dos»: la unica via a `N=2, V=2`.
    const traza: Traza = [];
    const repo = fakeRepo(traza, {
      findCierreByIdEnAlcance: vi.fn(async (cierreId: string) => ({
        cierre: resumenRow({ cierreId }),
        gestiones: [],
        sinGestion: [],
        sinGestionRegistrado: true,
      })),
    });
    const { service, notificar } = newService({ repo, traza });

    await service.rechazarCierre("c-dia-1", MOTIVO, MAESTRO);
    await service.rechazarCierre("c-dia-2", MOTIVO, MAESTRO);

    expect(mockDe(notificar)).toHaveBeenCalledTimes(2);
    expect(mockDe(notificar).mock.calls.map((c) => c[0].cierreId)).toEqual(["c-dia-1", "c-dia-2"]);
  });

  it("el `adminSatelite` avisa igual, y el aviso queda acotado a SU alcance", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza);
    const { service } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, ADMIN_SATELITE);

    expect(r.status).toBe("ok");
    // La relectura del cierre usa EL MISMO alcance que autorizo la escritura: un admin no puede
    // avisar sobre un cierre que no podia tocar.
    const alcanceEscritura = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .alcance as Alcance;
    const alcanceLectura = (repo.findCierreByIdEnAlcance as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Alcance;
    expect(alcanceLectura).toEqual(alcanceEscritura);
    expect(alcanceLectura).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: ZONA_SAT });
  });
});

describe("R42/R47 — el aviso va DESPUES de la escritura, FUERA de su transaccion y no la altera", () => {
  beforeEach(() => vi.clearAllMocks());

  it("el orden es: escribir el rechazo -> releer -> avisar", async () => {
    const traza: Traza = [];
    const { service } = newService({ traza });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(traza).toEqual([
      "resolverCierre",
      "findCierreByIdEnAlcance",
      "findBloqueoDetalle",
      "notificar",
    ]);
  });

  it("`resolverCierre` NO recibe notificador ni nada del aviso: la tx del cierre no se toca", async () => {
    // El emisor de este repo sabe correr DENTRO de una tx (`emitirMensajeroBloqueado(repo, ctx,
    // tx)`), y esa era la tentacion. No se hace: en Postgres un error de sentencia aborta la
    // transaccion ENTERA, asi que un aviso caido REVERTIRIA un rechazo legitimo.
    const { service, repo } = newService();

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    const input = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(input).sort()).toEqual(
      ["alcance", "cierreId", "motivoRechazo", "nuevoEstado", "resueltoPor"].sort(),
    );
    expect(input).toMatchObject({ nuevoEstado: "rechazado", motivoRechazo: MOTIVO });
  });

  it("el bloqueo se relee DESPUES de escribir: el N que cuenta el aviso incluye el rechazo nuevo", async () => {
    const traza: Traza = [];
    const { service, findBloqueoDetalle } = newService({ traza });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(traza.indexOf("findBloqueoDetalle")).toBeGreaterThan(traza.indexOf("resolverCierre"));
    expect(findBloqueoDetalle).toHaveBeenCalledWith("men-1");
  });

  it("R47: un aviso que LANZA no cambia el resultado — el rechazo sigue siendo valido", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const notificar = vi
      .fn()
      .mockRejectedValue(new Error("campana caida")) as unknown as MensajeroBloqueadoNotificador;
    const { service, repo } = newService({ notificar });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(repo.resolverCierre).toHaveBeenCalledTimes(1);
    // Y no es un `catch` vacio (docs/conventions.md): el fallo queda REGISTRADO con su operacion.
    expect(consola).toHaveBeenCalledTimes(1);
    expect(String(consola.mock.calls[0][1])).toContain("mensajero_bloqueado_por_cierres");
    consola.mockRestore();
  });

  it("R47: si la RELECTURA del cierre lanza, el rechazo tampoco se cae", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const traza: Traza = [];
    const repo = fakeRepo(traza, {
      findCierreByIdEnAlcance: vi.fn(async () => {
        throw new Error("base caida");
      }),
    });
    const { service, notificar } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    consola.mockRestore();
  });
});

describe("R42 — sin rechazo NO hay aviso (ninguno de los cinco desenlaces que no escriben)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("`conflict` (el cierre ya no estaba `solicitado`) no avisa", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza, { resolverCierre: vi.fn(async () => "conflict" as const) });
    const { service, notificar, findBloqueoDetalle } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "conflict" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(findBloqueoDetalle).not.toHaveBeenCalled();
  });

  it("`fuera_de_alcance` (cierre de otra bodega) no avisa", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza, { resolverCierre: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service, notificar } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-ajeno", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "no_encontrada" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
  });

  it("motivo vacio (R11) no avisa, y ni siquiera toca el repo", async () => {
    const { service, repo, notificar } = newService();

    const r = await service.rechazarCierre("c-rechazado", "   ", MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
  });

  it("rol no autorizado (R1) no avisa", async () => {
    const { service, repo, notificar } = newService();

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MENSAJERO);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
  });

  it("`adminSatelite` sin zona (R3/R13) no avisa", async () => {
    const { service, repo, notificar } = newService({ zonaSatelite: null });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, ADMIN_SATELITE);

    expect(r).toEqual({ status: "no_encontrada" });
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
  });
});

describe("R42/R43 — el aviso no se emite si no puede decir la verdad", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cierre irrecuperable (relectura `null`) -> no se inventa un aviso, y el rechazo sigue ok", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza, { findCierreByIdEnAlcance: vi.fn(async () => null) });
    const { service, notificar, findBloqueoDetalle } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(findBloqueoDetalle).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
  });

  it("si el mensajero YA no esta bloqueado (re-solicito en medio), no se le dice que lo esta", async () => {
    // R16 permite re-solicitar SIEMPRE (anti-deadlock), asi que la carrera existe. Un aviso que
    // promete menos de lo que el servidor acepta es el fallo que R43 prohibe por su nombre.
    const { service, notificar } = newService({ bloqueo: SIN_BLOQUEO });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
  });
});

describe("R42 — el notificador se INYECTA: el default del constructor es el no-op", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("construido sin inyectar, un rechazo termina en ok y no escribe ningun aviso", async () => {
    // Este service lo instancian trece suites, y la base de este repo es COMPARTIDA. El default
    // no-op es lo que impide que cualquiera de ellas emita avisos de verdad; el camino REAL se
    // cablea en el composition root, y de eso hay guardia aparte en
    // `notificacion-notificadores-reales.test.ts` (el censo de services y el `lib/actions/
    // cierres-admin.ts` que inyecta `notificarMensajeroBloqueadoReal`).
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const traza: Traza = [];
    const { service } = newService({ traza, sinNotificador: true });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    // El camino se recorre entero —hasta el notificador— y no emite nada ni registra ningun fallo.
    expect(traza).toEqual(["resolverCierre", "findCierreByIdEnAlcance", "findBloqueoDetalle"]);
    expect(consola).not.toHaveBeenCalled();
  });
});
