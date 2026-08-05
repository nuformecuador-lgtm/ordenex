import { describe, it, expect, vi } from "vitest";
import { IncidenteAdminService } from "@/lib/services/IncidenteAdminService";
import type {
  AlcanceIncidente,
  IIncidenteAdminRepository,
  IncidenteAdminRow,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import { descargaConfig } from "@/lib/config/descarga";
import { listarHistoricoIncidentesSchema } from "@/lib/types/incidente";
import {
  filaDescargaIncidenteHistorico,
  filaDescargaIncidentePendiente,
} from "@/app/(app)/incidentes/_components/incidentes-descarga-columnas";

// Feature 184 — Tanda F (T F.2, R1/R2/R4/R5/R6) — los CONJUNTOS de los que salen los archivos de
// «Incidentes pendientes de decisión» (listado 8) e «Incidentes — histórico» (listado 9).
//
// **Lo que esta tanda quita, y por qué un test de filas no lo mediría.** Los dos archivos se
// producían releyendo `listarIncidentes()`, que llama a `findByAlcance`: TODOS los incidentes del
// alcance —cola e histórico juntos— para que la pantalla se quede con una de las dos mitades.
// Sustituirlo por la lectura dedicada produce EXACTAMENTE las mismas filas: el reparto en memoria
// (`esColaSolicitado`) y el corte en la base seleccionan lo mismo. Es indistinguible mirando el
// resultado, y por eso la deuda llevaba aquí desde la 170 sin que nadie la viera.
//
// Lo que sí lo distingue es CUÁNTO se lee, y por eso el repositorio en memoria de esta suite lleva
// la cuenta de sus llamadas Y de cuántas filas devuelve cada una. La mutación «vuelve a servirse
// del listado compuesto y parte en memoria» sólo muere ahí (M8 de la bitácora).
//
// El repositorio doble NO es un stub que devuelve lo que se le diga: aplica de verdad el alcance
// por la zona de la ORDEN, el corte cola/histórico y el recorte de página, sobre un almacén con
// incidentes de DOS zonas y los tres estados. Sin filas de la cola no habría nada que un corte roto
// pudiera colar en el archivo del histórico; sin dos zonas no se vería que el `adminSatelite`
// descarga sólo lo suyo.
//
// Lo que esta suite NO puede ver: la traducción de ese corte a SQL. El doble no emite consultas.
// Eso vive en `tests/unit/repositories/{historicos-paginados,colas-paginadas}-where.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };

/**
 * Roles que NO alcanzan estos dos listados. El lado de la aceptación lo cubren MAESTRO, ADMIN y
 * SATELITE, sin los cuales el caso pasaría con un servicio que no le devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(
  n: number,
  dia: number,
  estado: IncidenteAdminRow["estado"] = "aprobado",
  zonaId = "z-1",
): IncidenteAdminRow {
  const id = `inc-${String(n).padStart(2, "0")}`;
  const resuelto = estado !== "solicitado";
  return {
    incidenteId: id,
    ordenId: `o-${id}`,
    numGuia: 100 + n,
    numRemision: `REM-${id}`,
    destinatario: `Destinatario ${n}`,
    zonaId,
    zonaNombre: `Zona ${zonaId}`,
    estatusValue: "incidente",
    causa: "danado",
    motivo: `Motivo ${n}`,
    estado,
    indemnizacion: estado === "aprobado" ? "100.00" : null,
    ordenMontoCobrar: "42000.00",
    reportadoPor: "u-autor",
    reportadoPorNombre: "Autor Uno",
    resueltoPor: resuelto ? "u-maestro" : null,
    resueltoPorNombre: resuelto ? "Maestro Uno" : null,
    resueltoAt: resuelto ? `2026-03-${String(dia).padStart(2, "0")}T12:00:00.000Z` : null,
    motivoRechazo: estado === "rechazado" ? "No procede" : null,
    createdAt: `2026-03-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    // R46: todo incidente nace con 1..N evidencias. Que SIEMPRE haya al menos una es lo que hace
    // medible el caso de las firmas: un `evidenciaUrls: []` en el archivo no puede confundirse con
    // «este incidente no tenía fotos».
    evidenciaStoragePaths: [`ev/${id}-0.jpg`],
  };
}

/**
 * El almacén de la suite: CINCO resueltos y DOS en la cola, repartidos entre dos zonas. Los dos
 * números importan y salen citados en la bitácora: la relectura de hoy lee las SIETE filas para
 * producir cualquiera de los dos archivos; la lectura dedicada lee 5 y 2.
 */
const ALMACEN: IncidenteAdminRow[] = [
  fila(1, 1, "aprobado", "z-1"),
  fila(2, 2, "rechazado", "z-2"),
  fila(3, 3, "solicitado", "z-1"), // cola
  fila(4, 4, "aprobado", "z-2"),
  fila(5, 5, "solicitado", "z-2"), // cola
  fila(6, 6, "rechazado", "z-1"),
  fila(7, 7, "aprobado", "z-1"),
];

function esCola(row: { estado: string }): boolean {
  return (ESTADOS_COLA_SOLICITADO as readonly string[]).includes(row.estado);
}

/** `createdAt` descendente: el criterio que los dos listados presentan hoy. */
function porCreadoDesc(a: IncidenteAdminRow, b: IncidenteAdminRow): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Repositorio EN MEMORIA: aplica de verdad el alcance por la zona de la ORDEN, corta
 * cola/histórico, ordena y recorta. Anota cada llamada Y cuántas filas devolvió, que es lo único
 * que distingue la lectura dedicada de la relectura del listado compuesto.
 */
function repoEnMemoria(filas: IncidenteAdminRow[] = ALMACEN) {
  const llamadas: string[] = [];
  const filasLeidas: number[] = [];

  /** R48: el alcance por la zona de la ORDEN, como lo aplicaría el WHERE. */
  function enAlcance(alcance: AlcanceIncidente): IncidenteAdminRow[] {
    return alcance.zonaId === null ? filas : filas.filter((f) => f.zonaId === alcance.zonaId);
  }

  function anotar(nombre: string, rows: IncidenteAdminRow[]): IncidenteAdminRow[] {
    llamadas.push(nombre);
    filasLeidas.push(rows.length);
    return rows;
  }

  const findByAlcance = vi.fn(async (alcance: AlcanceIncidente) =>
    anotar("findByAlcance", [...enAlcance(alcance)].sort(porCreadoDesc)),
  );

  const findHistoricoCompleto = vi.fn(async (alcance: AlcanceIncidente) =>
    anotar(
      "findHistoricoCompleto",
      enAlcance(alcance)
        .filter((f) => !esCola(f))
        .sort(porCreadoDesc),
    ),
  );

  const findColaCompleta = vi.fn(async (alcance: AlcanceIncidente) =>
    anotar("findColaCompleta", enAlcance(alcance).filter(esCola).sort(porCreadoDesc)),
  );

  const findHistoricoPaginado = vi.fn(async (alcance: AlcanceIncidente, rango: RangoPagina) => {
    llamadas.push("findHistoricoPaginado");
    const conjunto = enAlcance(alcance)
      .filter((f) => !esCola(f))
      .sort(porCreadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const findColaPaginada = vi.fn(async (alcance: AlcanceIncidente, rango: RangoPagina) => {
    llamadas.push("findColaPaginada");
    const conjunto = enAlcance(alcance).filter(esCola).sort(porCreadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findByAlcance,
    findHistoricoCompleto,
    findColaCompleta,
    findHistoricoPaginado,
    findColaPaginada,
    findByIdEnAlcance: vi.fn(async () => {
      llamadas.push("findByIdEnAlcance");
      return filas[0] ?? null;
    }),
    reportar: vi.fn(async () => ({ status: "ok" as const, incidenteId: "inc-01" })),
    resolver: vi.fn(async () => "updated" as const),
  } as unknown as IIncidenteAdminRepository;

  return { repo, llamadas, filasLeidas, findHistoricoCompleto, findColaCompleta };
}

/** `zonaUsuario: null` = el `adminSatelite` no tiene zona asignada (R48). */
function servicio(repo: IIncidenteAdminRepository, zonaUsuario: string | null = "z-1") {
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => zonaUsuario),
    findEstatusIdByValue: vi.fn(async (value: string) => `os-${value}`),
  };
  const historialRepo = {
    findOrigenesReversion: vi.fn(async () => new Map<string, string | null>()),
  };
  const storage = {
    upload: vi.fn(async () => "p"),
    remove: vi.fn(async () => undefined),
  } as unknown as IFileStorage;
  // El parámetro se declara EXPLÍCITAMENTE porque es lo que la anti-vacuidad afirma: sin él, el
  // tipo del espía sería de cero argumentos y `mock.calls[0][0]` no existiría.
  const createSignedUrls = vi.fn(async (paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://firmada/${p}`])),
  );
  const signedUrls = { createSignedUrls } as unknown as ISignedUrlProvider;
  const svc = new IncidenteAdminService(repo, ordenRepo, historialRepo, storage, signedUrls);
  return { svc, createSignedUrls, ordenRepo };
}

function input(extra: Record<string, unknown> = {}) {
  return listarHistoricoIncidentesSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ incidenteId: string }>): string[] {
  return items.map((i) => i.incidenteId);
}

/** Un conjunto plano de N incidentes, todos del histórico o todos de la cola, para medir el tope. */
function plano(n: number, estado: IncidenteAdminRow["estado"]): IncidenteAdminRow[] {
  return Array.from({ length: n }, (_, i) => fila(i, (i % 28) + 1, estado));
}

describe("los conjuntos de la descarga de «Incidentes» (feature 184, T F.2)", () => {
  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      for (const listado of ["historico", "pendientes"] as const) {
        const { repo, llamadas } = repoEnMemoria();
        const { svc } = servicio(repo);

        const r =
          listado === "historico"
            ? await svc.listarHistoricoIncidentesCompleto(actor)
            : await svc.listarPendientesIncidentesCompleto(actor);

        const etiqueta = `${listado}/${actor.rol}`;
        expect(r, etiqueta).toEqual({ status: "forbidden" });
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(r, etiqueta).not.toHaveProperty("total"); // un conteo también es información
        // El guard va ANTES de la base: ni una consulta a los incidentes de nadie.
        expect(llamadas, etiqueta).toEqual([]);
      }
    }
  });

  it("el alcance sale del ACTOR, no de la entrada: cada admin descarga LO SUYO (R4)", async () => {
    const conjunto = async (
      actor: Actor,
      listado: "historico" | "pendientes",
    ): Promise<string[]> => {
      const { svc } = servicio(repoEnMemoria().repo);
      const r =
        listado === "historico"
          ? await svc.listarHistoricoIncidentesCompleto(actor)
          : await svc.listarPendientesIncidentesCompleto(actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    // El acceso total ve la operación ENTERA: los incidentes de las dos zonas, en un archivo.
    const historicoMaestro = await conjunto(MAESTRO, "historico");
    expect(historicoMaestro).toEqual(["inc-07", "inc-06", "inc-04", "inc-02", "inc-01"]);
    expect(await conjunto(MAESTRO, "pendientes")).toEqual(["inc-05", "inc-03"]);

    // Y `admin` alcanza lo mismo que `maestro`: los dos son acceso total, sin filtro de zona.
    expect(await conjunto(ADMIN, "historico")).toEqual(historicoMaestro);
    expect(await conjunto(ADMIN, "pendientes")).toEqual(["inc-05", "inc-03"]);

    // El `adminSatelite` de `z-1` descarga SÓLO su zona, y son conjuntos DISJUNTOS de los de la
    // vecina: `inc-04` y `inc-02` (de `z-2`) no aparecen en su archivo, y `inc-05` tampoco en su
    // cola. Ésta es la fila que un alcance roto colaría.
    expect(await conjunto(SATELITE, "historico")).toEqual(["inc-07", "inc-06", "inc-01"]);
    expect(await conjunto(SATELITE, "pendientes")).toEqual(["inc-03"]);

    // Anti-vacuidad del «todas las zonas»: el archivo del maestro trae de las DOS, no de una.
    const { svc } = servicio(repoEnMemoria().repo);
    const r = await svc.listarHistoricoIncidentesCompleto(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect([...new Set(r.items.map((i) => i.zonaNombre))].sort()).toEqual(["Zona z-1", "Zona z-2"]);

    // Y ninguno de los dos métodos admite un parámetro por el que pedir otro alcance: la aridad
    // es 1, y ese 1 es el actor.
    expect(IncidenteAdminService.prototype.listarHistoricoIncidentesCompleto).toHaveLength(1);
    expect(IncidenteAdminService.prototype.listarPendientesIncidentesCompleto).toHaveLength(1);
  });

  it("el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)", async () => {
    for (const listado of ["historico", "pendientes"] as const) {
      const { repo, llamadas } = repoEnMemoria();
      const { svc } = servicio(repo, null); // sin zona asignada

      const r =
        listado === "historico"
          ? await svc.listarHistoricoIncidentesCompleto(SATELITE)
          : await svc.listarPendientesIncidentesCompleto(SATELITE);

      expect(r, listado).toEqual({ status: "ok", items: [], total: 0 });
      // Sin zona no hay alcance que resolver: ni una consulta, como en la página.
      expect(llamadas, listado).toEqual([]);
    }
  });

  it("el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)", async () => {
    // LA prueba de esta tanda. Las filas que devuelve la lectura dedicada son EXACTAMENTE las que
    // devolvía partir en memoria el listado compuesto, así que compararlas no mide nada. Lo que
    // cambia es cuánto se lee para producirlas.
    const historico = repoEnMemoria();
    const rHistorico = await servicio(historico.repo).svc.listarHistoricoIncidentesCompleto(MAESTRO);

    expect(historico.llamadas).toEqual(["findHistoricoCompleto"]);
    expect(historico.llamadas).not.toContain("findByAlcance");
    expect(historico.filasLeidas).toEqual([5]); // los 5 resueltos

    const pendientes = repoEnMemoria();
    const rPendientes =
      await servicio(pendientes.repo).svc.listarPendientesIncidentesCompleto(MAESTRO);

    expect(pendientes.llamadas).toEqual(["findColaCompleta"]);
    expect(pendientes.llamadas).not.toContain("findByAlcance");
    expect(pendientes.filasLeidas).toEqual([2]); // los 2 de la cola

    // ANTI-VACUIDAD: la relectura que esta tanda sustituye SÍ trae las dos mitades, y las trae
    // para producir CUALQUIERA de los dos archivos. Sin esta mitad del caso, los `toEqual` de
    // arriba serían un adorno: un servicio que no leyera nada los pasaría igual.
    const compuesto = repoEnMemoria();
    await servicio(compuesto.repo).svc.listarIncidentes(MAESTRO);
    expect(compuesto.llamadas).toEqual(["findByAlcance"]);
    expect(compuesto.filasLeidas).toEqual([7]); // 5 del histórico + 2 de la cola

    // Y el archivo sale igual: la mejora es de coste, no de contenido (R12/R13).
    if (rHistorico.status !== "ok" || rPendientes.status !== "ok") throw new Error("esperaba ok");
    expect(ids(rHistorico.items)).toEqual(["inc-07", "inc-06", "inc-04", "inc-02", "inc-01"]);
    expect(ids(rPendientes.items)).toEqual(["inc-05", "inc-03"]);
    // Descargar una mitad ya no trae la otra: ni un `solicitado` en el archivo del histórico.
    expect(rHistorico.items.some(esCola)).toBe(false);
    expect(rPendientes.items.every(esCola)).toBe(true);
  });

  it("el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)", async () => {
    // `pageSize: 2` a propósito: con el tamaño de página real (25) y 5 filas de almacén, la página
    // 1 SERÍA el conjunto entero y una mutación de recorte no se notaría.
    const { svc } = servicio(repoEnMemoria().repo);

    const conjuntoHistorico = await svc.listarHistoricoIncidentesCompleto(MAESTRO);
    const conjuntoPendientes = await svc.listarPendientesIncidentesCompleto(MAESTRO);
    if (conjuntoHistorico.status !== "ok" || conjuntoPendientes.status !== "ok") {
      throw new Error("esperaba ok");
    }

    const recorrer = async (listado: "historico" | "pendientes") => {
      const visto: string[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const p =
          listado === "historico"
            ? await svc.listarHistoricoIncidentesPaginado(input({ page, pageSize: 2 }), MAESTRO)
            : await svc.listarPendientesIncidentesPaginado(input({ page, pageSize: 2 }), MAESTRO);
        if (p.status !== "ok") throw new Error(`esperaba ok, vino ${p.status}`);
        if (p.items.length === 0) break;
        visto.push(...ids(p.items));
      }
      return visto;
    };

    expect(await recorrer("historico")).toEqual(ids(conjuntoHistorico.items));
    expect(await recorrer("pendientes")).toEqual(ids(conjuntoPendientes.items));
    // Anti-vacuidad del recorrido: son TRES páginas de histórico, no una.
    expect(conjuntoHistorico.items.length).toBeGreaterThan(2);
    // El total del conjunto es su longitud, no la de una página.
    expect(conjuntoHistorico.total).toBe(conjuntoHistorico.items.length);
    expect(conjuntoPendientes.total).toBe(conjuntoPendientes.items.length);
  });

  it("las filas del archivo son las de la página en TODAS las columnas que el archivo proyecta", async () => {
    // R5 en su forma fuerte, y el guardián de la decisión sobre el enriquecido. La comparación se
    // hace sobre la PROYECCIÓN REAL del archivo —`filaDescargaIncidente*`, el mismo módulo de
    // columnas que usa la pantalla— y no sobre el DTO entero, porque el DTO entero difiere en un
    // campo A PROPÓSITO: `evidenciaUrls`, que el archivo no lleva (R22 de la 170) y que el módulo
    // de columnas ni siquiera lee.
    //
    // El día que alguien añada una columna de evidencia al archivo, este caso se pone rojo. Ése es
    // exactamente el momento en que saltarse las firmas dejaría de ser un ahorro y pasaría a ser
    // un bug, y es la razón de que esta comparación exista.
    const { svc } = servicio(repoEnMemoria().repo);

    const conjuntoHistorico = await svc.listarHistoricoIncidentesCompleto(MAESTRO);
    const paginaHistorico = await svc.listarHistoricoIncidentesPaginado(
      input({ page: 1, pageSize: 50 }),
      MAESTRO,
    );
    const conjuntoCola = await svc.listarPendientesIncidentesCompleto(MAESTRO);
    const paginaCola = await svc.listarPendientesIncidentesPaginado(
      input({ page: 1, pageSize: 50 }),
      MAESTRO,
    );
    if (
      conjuntoHistorico.status !== "ok" ||
      paginaHistorico.status !== "ok" ||
      conjuntoCola.status !== "ok" ||
      paginaCola.status !== "ok"
    ) {
      throw new Error("esperaba ok");
    }

    const proyectar = (items: IncidenteAdminDTO[], fn: (i: IncidenteAdminDTO) => unknown) =>
      items.map(fn);

    expect(proyectar(conjuntoHistorico.items, filaDescargaIncidenteHistorico)).toEqual(
      proyectar(paginaHistorico.items, filaDescargaIncidenteHistorico),
    );
    expect(proyectar(conjuntoCola.items, filaDescargaIncidentePendiente)).toEqual(
      proyectar(paginaCola.items, filaDescargaIncidentePendiente),
    );

    // Anti-vacuidad de la comparación: las filas proyectadas llevan datos, y datos que distinguen
    // unas de otras (el estado y la indemnización separan aprobados de rechazados).
    const filasHistorico = proyectar(
      conjuntoHistorico.items,
      filaDescargaIncidenteHistorico,
    ) as Array<Record<string, unknown>>;
    expect(filasHistorico).toHaveLength(5);
    expect(filasHistorico.filter((f) => f.indemnizacion === "100.00")).toHaveLength(3);
    expect(filasHistorico.filter((f) => f.motivo === "No procede")).toHaveLength(2);
    // Y ninguna columna del archivo se llama como el campo que sí difiere: si mañana lo hiciera,
    // el `toEqual` de arriba lo cazaría antes que este recuento.
    expect(Object.keys(filasHistorico[0]!)).not.toContain("evidenciaUrls");
  });

  it("el conjunto NO firma NINGUNA URL de evidencia: el archivo no las lleva (R22 de la 170)", async () => {
    // La decisión de enriquecido de esta tanda, medida. Firmar cuesta un round-trip al storage
    // sobre TODAS las evidencias del conjunto —el histórico crece sin tope— y lo que produce es
    // justo lo que el archivo tiene PROHIBIDO llevar: un `xlsx` reenviado por correo con URL
    // firmadas dentro es acceso a las fotos sin sesión.
    for (const listado of ["historico", "pendientes"] as const) {
      const { repo } = repoEnMemoria();
      const { svc, createSignedUrls } = servicio(repo);

      const r =
        listado === "historico"
          ? await svc.listarHistoricoIncidentesCompleto(MAESTRO)
          : await svc.listarPendientesIncidentesCompleto(MAESTRO);
      if (r.status !== "ok") throw new Error("esperaba ok");

      expect(createSignedUrls, listado).toHaveBeenCalledTimes(0);
      // Y lo que llega al DTO del archivo es una lista VACÍA, no una URL a medio firmar.
      expect(r.items.every((i) => i.evidenciaUrls.length === 0), listado).toBe(true);
    }

    // ANTI-VACUIDAD del espía, en tres mitades. (1) La PÁGINA del mismo servicio sí firma, en UNA
    // sola llamada y con los paths exactos: sin esto, los `toHaveBeenCalledTimes(0)` de arriba
    // pasarían con un espía que no se dispara nunca o con un almacén sin evidencias.
    const { svc, createSignedUrls } = servicio(repoEnMemoria().repo);
    const pagina = await svc.listarHistoricoIncidentesPaginado(
      input({ page: 1, pageSize: 50 }),
      MAESTRO,
    );
    if (pagina.status !== "ok") throw new Error("esperaba ok");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0]![0]).toEqual([
      "ev/inc-07-0.jpg",
      "ev/inc-06-0.jpg",
      "ev/inc-04-0.jpg",
      "ev/inc-02-0.jpg",
      "ev/inc-01-0.jpg",
    ]);
    // (2) Y esa página SÍ lleva las URL firmadas: la diferencia con el archivo es real y medida.
    expect(pagina.items.every((i) => i.evidenciaUrls.length === 1)).toBe(true);

    // (3) La relectura que esta tanda sustituye firmaba las de TODO el alcance —las siete, cola e
    // histórico juntos— para producir cualquiera de los dos archivos. Ése es el trabajo que se
    // deja de hacer.
    const { svc: svc2, createSignedUrls: espia2 } = servicio(repoEnMemoria().repo);
    await svc2.listarIncidentes(MAESTRO);
    expect(espia2).toHaveBeenCalledTimes(1);
    expect(espia2.mock.calls[0]![0]).toHaveLength(7);
  });

  it("con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    // El borde EXACTO por abajo: `MAX_FILAS` cabe entero.
    const justoHistorico = repoEnMemoria(plano(limite, "aprobado"));
    const okHistorico =
      await servicio(justoHistorico.repo).svc.listarHistoricoIncidentesCompleto(MAESTRO);
    if (okHistorico.status !== "ok") throw new Error(`esperaba ok, vino ${okHistorico.status}`);
    expect(okHistorico.items).toHaveLength(limite);
    expect(okHistorico.total).toBe(limite);

    // Y por arriba: con UNA más no hay archivo, ni truncado ni parcial. Sólo los conteos.
    const pasadoHistorico = repoEnMemoria(plano(limite + 1, "aprobado"));
    const excedidoHistorico =
      await servicio(pasadoHistorico.repo).svc.listarHistoricoIncidentesCompleto(MAESTRO);
    expect(excedidoHistorico).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidoHistorico).not.toHaveProperty("items");

    // La cola tiene su propio tope, con su propio conjunto: no se hereda del de arriba.
    const justaCola = repoEnMemoria(plano(limite, "solicitado"));
    const okCola = await servicio(justaCola.repo).svc.listarPendientesIncidentesCompleto(MAESTRO);
    if (okCola.status !== "ok") throw new Error(`esperaba ok, vino ${okCola.status}`);
    expect(okCola.items).toHaveLength(limite);

    const pasadaCola = repoEnMemoria(plano(limite + 1, "solicitado"));
    const excedidaCola =
      await servicio(pasadaCola.repo).svc.listarPendientesIncidentesCompleto(MAESTRO);
    expect(excedidaCola).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidaCola).not.toHaveProperty("items");
  });
});
