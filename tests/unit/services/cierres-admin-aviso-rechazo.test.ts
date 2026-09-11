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
import type {
  CierreRechazadoNotificador,
  MensajeroBloqueadoNotificador,
} from "@/lib/notificaciones/notificadores";
import { liberarAlAprobarCierreNoOp } from "@/lib/services/liberacion-al-aprobar-cierre";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import { bloqueoDe } from "@/tests/fixtures/bloqueo-cierre";

/**
 * FEATURE 271 (T6.6, R42) + **FICHA 412 (T5.2, R1/R3/R4/R5/R17)** — QUÉ AVISA UN RECHAZO.
 *
 * ⚠️ QUÉ CAMBIÓ EL 2026-09-11 Y POR QUÉ, porque este archivo afirmaba lo contrario. Hasta la 412:
 *
 *   · el aviso se SALTABA ENTERO si el rechazo no dejaba bloqueado al mensajero
 *     (`if (!bloqueo.bloqueado) return;`), y
 *   · cuando sí lo dejaba, le mandaba `mensajero_bloqueado_por_cierres`, cuyo texto es EL MISMO
 *     que recibe quien dejó VENCER su cierre: «Tienes un cierre sin enviar a aprobación».
 *
 * O sea: **ningún aviso del sistema decía nunca la palabra «rechazado»**, y sólo el rechazo exige
 * CORREGIR algo antes de reenviar. Desde la 412 el rechazo emite `cierre_dia_rechazado` SIEMPRE
 * que confirme su escritura (R1), y la fila de bloqueo dirigida al mensajero deja de crearse en
 * esta rama (R17): dos avisos que llevan a `/cierre-dia` a pedir la misma acción serían dos «por
 * hacer» en el distintivo de la 409 para UN solo trabajo, y dos pushes con la 410 encima.
 *
 * EL RIESGO DE ESE CAMBIO ES **CERO MEDIDO**: producción tenía 0 cierres `rechazado` en toda su
 * historia el 2026-09-11 (78 `aprobado`, 5 `solicitado`, desde el arranque comercial del
 * 2026-08-27), así que esa fila NO SE HA EMITIDO JAMÁS a nadie.
 *
 * ⚠️ QUÉ MIDE ESTA SUITE Y QUÉ NO. Aquí todo son DOBLES: no ve una línea de SQL, así que **no
 * prueba** ni la regla N/V (`tests/unit/utils/bloqueo-cierre.test.ts`), ni el `WHERE` que la
 * deriva (`tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`), ni los TEXTOS
 * (`tests/unit/notificaciones/cierre-rechazado-aviso.test.ts`, literales a mano), ni la dedupe de
 * dos rechazos (`tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts`, contra Postgres).
 * Lo que mide es el CABLEADO: quién dispara, con qué contexto, en qué orden, a quién, y —sobre
 * todo— que el aviso NO puede tocar el desenlace del rechazo.
 */

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ZONA_SAT = "z-cartago";
const MOTIVO = "Faltan evidencias de dos entregas.";
/** El instante PERSISTIDO del rechazo: la mitad de la entidad de dedupe del aviso nuevo. */
const RESUELTO_AT = "2026-08-23T15:00:00.000Z";
const JORNADA = "2026-08-21";

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
    resueltoAt: RESUELTO_AT,
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
    // FICHA 398: la correccion en sitio del resultado. Doble MUDO: este archivo no la ejercita,
    // y devolver `conflict` deja constancia de que nadie la esta midiendo aqui.
    corregirResultadoGestionEnCierre: vi.fn(async () => ({ status: "conflict" as const })),
    ...overrides,
  };
}

function newService(
  opts: {
    repo?: Repo;
    traza?: Traza;
    notificar?: MensajeroBloqueadoNotificador;
    notificarRechazo?: CierreRechazadoNotificador;
    /** Lo que devuelve `findBloqueoDetalle` DESPUES del rechazo. Por defecto: N=1, V=1. */
    bloqueo?: ReturnType<typeof bloqueoDe>;
    /** Lo que devuelve `findJornadaDeCierre` del cierre RECIEN rechazado (FICHA 412). */
    jornada?: string | null;
    zonaSatelite?: string | null;
    /** `true` = se construye SIN inyectar notificadores (defaults no-op del constructor). */
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
  // FICHA 412 (T5.1): la jornada del cierre RECIEN RECHAZADO, para fecharlo en su aviso.
  const findJornadaDeCierre = vi.fn(async () => {
    traza.push("findJornadaDeCierre");
    return opts.jornada === undefined ? JORNADA : opts.jornada;
  });
  const ordenRepo = {
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async () =>
      opts.zonaSatelite === undefined ? ZONA_SAT : opts.zonaSatelite,
    ),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
    findBloqueoDetalle,
    findJornadaDeCierre,
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
      traza.push("notificarBloqueo");
    }) as MensajeroBloqueadoNotificador);
  const notificarRechazo =
    opts.notificarRechazo ??
    (vi.fn(async () => {
      traza.push("notificarRechazo");
    }) as CierreRechazadoNotificador);
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
        liberarAlAprobarCierreNoOp,
        notificarRechazo,
      );
  return {
    service,
    repo,
    ordenRepo,
    findBloqueoDetalle,
    findJornadaDeCierre,
    notificar,
    notificarRechazo,
    traza,
  };
}

/** El mock de un notificador, ya tipado para leerle las llamadas. */
const mockDe = (n: MensajeroBloqueadoNotificador | CierreRechazadoNotificador) =>
  n as unknown as ReturnType<typeof vi.fn>;

// ===========================================================================================
// R1 — EL AVISO SALE SIEMPRE QUE EL RECHAZO CONFIRME, BLOQUEE O NO
// ===========================================================================================

describe("412/R1 — un rechazo confirmado avisa al mensajero, lo deje bloqueado o no", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭑ mensajero NO bloqueado (re-solicitó en medio): el aviso SALE igual, UNA vez", async () => {
    // ⚠️ ÉSTE ES EL CASO QUE ANTES ERA MUDO, y es el literal del título de la ficha. R16 de la 271
    // permite re-solicitar SIEMPRE (anti-deadlock), así que entre la escritura del rechazo y la
    // lectura del bloqueo el mensajero pudo reenviarlo: `bloqueado` sale `false` y hasta hoy no
    // salía NADA. Le rechazaron el cierre igual, y tiene que enterarse.
    //
    // MUTACIÓN QUE ESTO MATA (design §12.3): mover la emisión dentro del `if (bloqueo.bloqueado)`.
    const { service, notificarRechazo } = newService({ bloqueo: SIN_BLOQUEO });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(1);
    expect(mockDe(notificarRechazo).mock.calls[0][0]).toMatchObject({
      // EL MENSAJERO DE LA FILA, no el admin que rechazó (R2).
      mensajeroUsuarioId: "men-1",
      cierreId: "c-rechazado",
      // Y el texto no puede afirmar un bloqueo que no existe (R15).
      quedaBloqueado: false,
    });
  });

  it("⭑ mensajero BLOQUEADO: el aviso sale igual, y dice que sí lo está", async () => {
    const { service, notificarRechazo } = newService({
      bloqueo: bloqueoDe({ n: 2, v: 2, cierreId: "c-viejo" }),
    });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(1);
    expect(mockDe(notificarRechazo).mock.calls[0][0]).toMatchObject({ quedaBloqueado: true });
  });

  it("⭑ el contexto lleva el INSTANTE PERSISTIDO del rechazo, no un reloj del servicio", async () => {
    // Es la mitad de la entidad de dedupe. Con un `new Date()` propio, dos emisiones del MISMO
    // rechazo —un reintento— inventarían dos entidades y saldrían dos avisos por un solo hecho
    // (alternativa A5 del design).
    const { service, notificarRechazo } = newService();

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificarRechazo).mock.calls[0][0].resueltoAtISO).toBe(RESUELTO_AT);
  });

  it("⭑ la JORNADA sale de `findJornadaDeCierre(cierreId)`, del cierre RECIÉN RECHAZADO", async () => {
    // MUTACIÓN QUE ESTO MATA: reusar `bloqueo.aReenviarPrimero.jornadaCR`, que es el
    // re-solicitable MÁS VIEJO. El fixture lo deja a propósito en OTRA fecha: si el servicio
    // leyera de ahí, el aviso fecharía otro cierre.
    const { service, notificarRechazo, findJornadaDeCierre } = newService({
      jornada: "2026-08-21",
      bloqueo: bloqueoDe({
        n: 2,
        v: 2,
        cierreId: "c-mas-viejo",
        jornadaCR: "2026-08-14",
        jornadaCRReenviable: "2026-08-14",
      }),
    });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(findJornadaDeCierre).toHaveBeenCalledWith("c-rechazado");
    expect(mockDe(notificarRechazo).mock.calls[0][0].jornadaCR).toBe("2026-08-21");
  });

  it("sin jornada fiable el contexto la lleva en `null`: el texto la omitirá (R12)", async () => {
    const { service, notificarRechazo } = newService({ jornada: null });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificarRechazo).mock.calls[0][0].jornadaCR).toBeNull();
  });

  it("⭑ R16: el contexto del aviso NO lleva el MOTIVO del rechazo, ni nada que lo parezca", async () => {
    const { service, notificarRechazo } = newService();

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    const ctx = mockDe(notificarRechazo).mock.calls[0][0];
    expect(Object.keys(ctx).sort()).toEqual([
      "cierreId",
      "jornadaCR",
      "mensajeroUsuarioId",
      "quedaBloqueado",
      "resueltoAtISO",
    ]);
    expect(JSON.stringify(ctx)).not.toContain(MOTIVO);
  });

  it("R7 (mitad de cableado): dos rechazos del MISMO cierre producen DOS contextos distintos", async () => {
    // La otra mitad —que eso se convierta en DOS FILAS— la decide el índice único y se mide
    // contra Postgres. Aquí sólo se comprueba que el servicio no manda la misma entidad dos veces.
    const traza: Traza = [];
    const instantes = ["2026-08-23T09:00:00.000Z", "2026-08-23T09:40:00.000Z"];
    let i = 0;
    const repo = fakeRepo(traza, {
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ resueltoAt: instantes[i++] }),
        gestiones: [],
        sinGestion: [],
        sinGestionRegistrado: true,
      })),
    });
    const { service, notificarRechazo } = newService({ repo, traza });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);
    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(2);
    expect(
      mockDe(notificarRechazo).mock.calls.map((c) => `${c[0].cierreId}:${c[0].resueltoAtISO}`),
    ).toEqual([
      "c-rechazado:2026-08-23T09:00:00.000Z",
      "c-rechazado:2026-08-23T09:40:00.000Z",
    ]);
  });

  it("el `adminSatelite` avisa igual, y el aviso queda acotado a SU alcance", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza);
    const { service, notificarRechazo } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, ADMIN_SATELITE);

    expect(r.status).toBe("ok");
    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(1);
    // La relectura del cierre usa EL MISMO alcance que autorizó la escritura: un admin no puede
    // avisar sobre un cierre que no podía tocar.
    const alcanceEscritura = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .alcance as Alcance;
    const alcanceLectura = (repo.findCierreByIdEnAlcance as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Alcance;
    expect(alcanceLectura).toEqual(alcanceEscritura);
    expect(alcanceLectura).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: ZONA_SAT });
  });
});

// ===========================================================================================
// R17 · R18 — UN HECHO, UN AVISO POR PERSONA
// ===========================================================================================

describe("412/R17 — el mensajero recibe EXACTAMENTE UN aviso por el rechazo, y es el nuevo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭑ al bloqueo se le pasa `solo_bodega`: sin eso el mensajero recibiría DOS filas", async () => {
    // MUTACIÓN OBLIGATORIA (design §12.4): pasar `mensajero_y_bodega` aquí. Los dos avisos llevan
    // a `/cierre-dia` a pedir la misma acción, así que dos filas serían dos «por hacer» en el
    // distintivo de la 409 para UN solo trabajo —y dos pushes, porque el cupo de la 410 es por
    // `(usuario, evento, jornada)` y son eventos distintos—.
    const { service, notificar, notificarRechazo } = newService();

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificar)).toHaveBeenCalledTimes(1);
    expect(mockDe(notificar).mock.calls[0][0].destinatarios).toBe("solo_bodega");
    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(1);
  });

  it("⭑ contado: por este hecho sale UNA sola emisión dirigida al mensajero", async () => {
    const { service, notificar, notificarRechazo } = newService();

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    const alMensajero = [
      ...mockDe(notificarRechazo).mock.calls,
      ...mockDe(notificar).mock.calls.filter((c) => c[0].destinatarios !== "solo_bodega"),
    ];
    expect(alMensajero).toHaveLength(1);
  });

  it("R18: el aviso a la bodega sigue llevando el CIERRE y su detalle de bloqueo, sin tocar nada", async () => {
    const bloqueo = bloqueoDe({ n: 2, v: 2, jornadaCR: "2026-08-21", cierreId: "c-viejo" });
    const { service, notificar } = newService({ bloqueo });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificar).mock.calls[0][0]).toEqual({
      cierreId: "c-rechazado",
      // La zona DESTINO del cierre, que es el alcance del `adminSatelite` que ve el aviso. Sale de
      // la fila, no del actor: quien rechaza puede ser el maestro, que no tiene zona ninguna.
      zonaId: ZONA_SAT,
      mensajeroUsuarioId: "men-1",
      bloqueo,
      destinatarios: "solo_bodega",
    });
  });

  it("⭑ si el rechazo NO bloquea, a la bodega NO se le avisa — y al mensajero SÍ", async () => {
    // R18 sólo aplica cuando el rechazo deja bloqueado. Sin bloqueo no hay nada que la bodega
    // tenga que desbloquear, y su texto («Aprueba el más antiguo para que pueda volver a
    // trabajar») sería falso.
    const { service, notificar, notificarRechazo } = newService({ bloqueo: SIN_BLOQUEO });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================================
// R4 · R5 — FUERA DE LA TRANSACCIÓN, SIN ALTERAR EL RESULTADO, Y CADA AVISO POR SU CUENTA
// ===========================================================================================

describe("412/R4 — los avisos van DESPUÉS de la escritura, FUERA de su transacción y no la alteran", () => {
  beforeEach(() => vi.clearAllMocks());

  it("el orden es: escribir el rechazo -> releer -> avisar al mensajero -> avisar a la bodega", async () => {
    const traza: Traza = [];
    const { service } = newService({ traza });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(traza).toEqual([
      "resolverCierre",
      "findCierreByIdEnAlcance",
      "findBloqueoDetalle",
      "findJornadaDeCierre",
      "notificarRechazo",
      "notificarBloqueo",
    ]);
  });

  it("⭑ R4(b): `resolverCierre` NO recibe notificador ni cliente transaccional alguno", async () => {
    // El emisor de este repo sabe correr DENTRO de una tx (`emitirCierreDiaRechazado(repo, ctx,
    // tx)`), y ésa era la tentación. No se hace: en Postgres un error de sentencia aborta la
    // transacción ENTERA, así que un aviso caído REVERTIRÍA un rechazo legítimo.
    const { service, repo } = newService();

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    const input = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(input).sort()).toEqual(
      ["alcance", "cierreId", "motivoRechazo", "nuevoEstado", "resueltoPor"].sort(),
    );
    expect(input).toMatchObject({ nuevoEstado: "rechazado", motivoRechazo: MOTIVO });
  });

  it("el bloqueo se relee DESPUÉS de escribir: el N que cuenta el aviso incluye el rechazo nuevo", async () => {
    const traza: Traza = [];
    const { service, findBloqueoDetalle } = newService({ traza });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(traza.indexOf("findBloqueoDetalle")).toBeGreaterThan(traza.indexOf("resolverCierre"));
    expect(findBloqueoDetalle).toHaveBeenCalledWith("men-1");
  });

  it("⭑ R4(a): el aviso del RECHAZO lanza -> el rechazo sigue siendo `ok`, y queda REGISTRADO", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const notificarRechazo = vi
      .fn()
      .mockRejectedValue(new Error("campana caida")) as unknown as CierreRechazadoNotificador;
    const { service, repo } = newService({ notificarRechazo });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(repo.resolverCierre).toHaveBeenCalledTimes(1);
    // Y no es un `catch` vacío (docs/conventions.md): el fallo queda registrado CON SU OPERACIÓN.
    expect(consola).toHaveBeenCalledTimes(1);
    expect(String(consola.mock.calls[0][1])).toContain("cierre_dia_rechazado");
    consola.mockRestore();
  });

  it("el aviso de BLOQUEO lanza -> el rechazo sigue siendo `ok`, y también queda registrado", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const notificar = vi
      .fn()
      .mockRejectedValue(new Error("campana caida")) as unknown as MensajeroBloqueadoNotificador;
    const { service } = newService({ notificar });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(consola).toHaveBeenCalledTimes(1);
    expect(String(consola.mock.calls[0][1])).toContain("mensajero_bloqueado_por_cierres");
    consola.mockRestore();
  });

  it("R4: si la RELECTURA del cierre lanza, el rechazo tampoco se cae y NO se emite nada", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const traza: Traza = [];
    const repo = fakeRepo(traza, {
      findCierreByIdEnAlcance: vi.fn(async () => {
        throw new Error("base caida");
      }),
    });
    const { service, notificar, notificarRechazo } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
    expect(consola).toHaveBeenCalledTimes(1);
    consola.mockRestore();
  });
});

describe("412/R5 — los dos avisos son unidades INDEPENDIENTES: uno caído no se lleva al otro", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭑ el del RECHAZO lanza -> el de BLOQUEO se emite igual", async () => {
    // MUTACIÓN QUE ESTO MATA (design §12): envolver los dos en un solo `emitirBestEffort`. Con
    // uno solo, el `throw` de la primera emisión se llevaría la segunda por delante.
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const notificarRechazo = vi
      .fn()
      .mockRejectedValue(new Error("campana caida")) as unknown as CierreRechazadoNotificador;
    const { service, notificar } = newService({ notificarRechazo });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificar)).toHaveBeenCalledTimes(1);
    expect(mockDe(notificar).mock.calls[0][0].destinatarios).toBe("solo_bodega");
    consola.mockRestore();
  });

  it("⭑ y al revés: el de BLOQUEO lanza -> el del RECHAZO ya se emitió", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const notificar = vi
      .fn()
      .mockRejectedValue(new Error("campana caida")) as unknown as MensajeroBloqueadoNotificador;
    const { service, notificarRechazo } = newService({ notificar });

    await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(mockDe(notificarRechazo)).toHaveBeenCalledTimes(1);
    consola.mockRestore();
  });
});

// ===========================================================================================
// R3 — SIN RECHAZO CONFIRMADO NO HAY AVISO, DE NINGUNO DE LOS DOS
// ===========================================================================================

describe("412/R3 — ninguno de los desenlaces que NO escriben emite nada", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭑ `conflict` (el cierre ya no estaba resoluble) no avisa, ni uno ni otro", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza, { resolverCierre: vi.fn(async () => "conflict" as const) });
    const { service, notificar, notificarRechazo, findBloqueoDetalle } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "conflict" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
    expect(findBloqueoDetalle).not.toHaveBeenCalled();
  });

  it("⭑ `fuera_de_alcance` (cierre de otra bodega) no avisa, ni uno ni otro", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza, { resolverCierre: vi.fn(async () => "fuera_de_alcance" as const) });
    const { service, notificar, notificarRechazo } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-ajeno", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "no_encontrada" });
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
  });

  it("⭑ motivo vacío (R11 de la 38) no avisa, y ni siquiera toca el repo", async () => {
    const { service, repo, notificar, notificarRechazo } = newService();

    const r = await service.rechazarCierre("c-rechazado", "   ", MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
  });

  it("rol no autorizado no avisa", async () => {
    const { service, repo, notificar, notificarRechazo } = newService();

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MENSAJERO);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
  });

  it("`adminSatelite` sin zona no avisa", async () => {
    const { service, repo, notificar, notificarRechazo } = newService({ zonaSatelite: null });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, ADMIN_SATELITE);

    expect(r).toEqual({ status: "no_encontrada" });
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
  });
});

describe("412 — el aviso no se emite si no puede identificar el hecho (FALLO CERRADO)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cierre irrecuperable (relectura `null`) -> no se inventa un aviso, y el rechazo sigue ok", async () => {
    const traza: Traza = [];
    const repo = fakeRepo(traza, { findCierreByIdEnAlcance: vi.fn(async () => null) });
    const { service, notificar, notificarRechazo, findBloqueoDetalle } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(findBloqueoDetalle).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
  });

  it("⭑ `resueltoAt` nulo -> NO se emite con una entidad inventada, y el fallo queda REGISTRADO", async () => {
    // Inalcanzable tras un `updated` (`resolverCierre` escribe `resueltoAt: new Date()` en la
    // misma sentencia que mueve el estado), pero se comprueba: el instante ES LA MITAD DE LA
    // ENTIDAD de dedupe, y sin él no hay forma de distinguir el segundo rechazo del primero.
    // Emitir con `undefined` dentro del `entidad_id` sería peor que no emitir.
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const traza: Traza = [];
    const repo = fakeRepo(traza, {
      findCierreByIdEnAlcance: vi.fn(async () => ({
        cierre: resumenRow({ resueltoAt: null }),
        gestiones: [],
        sinGestion: [],
        sinGestionRegistrado: true,
      })),
    });
    const { service, notificar, notificarRechazo } = newService({ repo, traza });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    expect(mockDe(notificarRechazo)).not.toHaveBeenCalled();
    expect(mockDe(notificar)).not.toHaveBeenCalled();
    expect(consola).toHaveBeenCalledTimes(1);
    expect(String(consola.mock.calls[0][1])).toContain("cierre_dia_rechazado");
    consola.mockRestore();
  });
});

describe("412/R6 — los notificadores se INYECTAN: los defaults del constructor son el no-op", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("construido sin inyectar, un rechazo termina en ok y no escribe ningún aviso", async () => {
    // Este service lo instancian trece suites, y la base de este repo es COMPARTIDA. El default
    // no-op es lo que impide que cualquiera de ellas emita avisos de verdad; el camino REAL se
    // cablea en el composition root, y de eso hay guardia aparte en
    // `notificacion-notificadores-reales.test.ts`, que afirma que alguien lo PASA de verdad.
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const traza: Traza = [];
    const { service } = newService({ traza, sinNotificador: true });

    const r = await service.rechazarCierre("c-rechazado", MOTIVO, MAESTRO);

    expect(r).toEqual({ status: "ok", cierreId: "c-rechazado", estado: "rechazado" });
    // El camino se recorre ENTERO —hasta los dos notificadores— y no emite nada ni registra fallo.
    expect(traza).toEqual([
      "resolverCierre",
      "findCierreByIdEnAlcance",
      "findBloqueoDetalle",
      "findJornadaDeCierre",
    ]);
    expect(consola).not.toHaveBeenCalled();
  });
});
