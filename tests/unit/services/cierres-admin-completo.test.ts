import { describe, it, expect, vi } from "vitest";
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
import type { FiltrosCierres } from "@/lib/types/filtros-cierres";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_CIERRE_DIA } from "@/lib/utils/colas-cierre";
import { descargaConfig } from "@/lib/config/descarga";
import { listarHistoricoCierresAdminSchema } from "@/lib/types/cierres-admin";

// Feature 184 — Tanda D (T D.2, R1/R2/R4/R5/R6) — los CONJUNTOS de los que salen los archivos de
// «Cierres del día — histórico» (listado 2) y «Cierres del día pendientes» (listado 3).
//
// **Lo que esta tanda quita, y por qué un test de filas no lo mediría.** Los dos archivos se
// producían releyendo `listarCierresAdmin()`, que llama a `findCierresByAlcance`: el alcance
// ENTERO —cola e histórico juntos— para que la pantalla se quede con una de las dos mitades.
// Sustituirlo por la lectura dedicada produce EXACTAMENTE las mismas filas: el reparto en
// memoria y el corte en la base seleccionan lo mismo. Es indistinguible mirando el resultado.
//
// Lo que sí lo distingue es CUÁNTO se lee, y por eso el repositorio en memoria de esta suite
// lleva la cuenta de sus llamadas Y de cuántas filas devuelve cada una. La mutación «vuelve a
// servirse del listado compuesto» sólo muere ahí (M5/M6 de la bitácora).
//
// El repositorio doble NO es un stub que devuelve lo que se le diga: aplica de verdad el alcance
// que RECIBE, el corte cola/histórico y el recorte de página, sobre un almacén con cierres de dos
// bodegas y dos zonas satélite. Es lo único que hace honesto al caso de R4: si el servicio pasara
// un alcance distinto —o ninguno—, las filas cambiarían.
//
// Lo que esta suite NO puede ver: la traducción de ese alcance a SQL. El doble no emite consultas.
// Eso vive en `tests/unit/repositories/{historicos-paginados,colas-paginadas}-where.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SATELITE_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SATELITE_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
};

/**
 * Roles que NO alcanzan estos listados. Es la contraprueba de R4 por el lado del rechazo; el lado
 * de la aceptación lo cubren MAESTRO/ADMIN/SATELITE_A, sin los cuales el caso pasaría con un
 * servicio que no le devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(over: Partial<CierreAdminResumenRow> & { cierreId: string }): CierreAdminResumenRow {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: `Mensajero ${over.cierreId}`,
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: { efectivo: "100.00", simpe: "0.00", transferencia: "0.00", general: "100.00" },
    totalPagoMensajero: "10.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-01-01T00:00:00.000Z",
    resueltoAt: "2026-01-02T00:00:00.000Z",
    motivoRechazo: null,
    ...over,
  };
}

function central(
  cierreId: string,
  dia: number,
  estado: CierreAdminResumenRow["estado"] = "aprobado",
) {
  return fila({
    cierreId,
    estado,
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  });
}

function satelite(
  cierreId: string,
  zonaId: string,
  dia: number,
  estado: CierreAdminResumenRow["estado"] = "aprobado",
) {
  return fila({
    cierreId,
    estado,
    destinoTipo: "bodega_satelite",
    destinoZonaId: zonaId,
    destinoZonaNombre: `Zona ${zonaId}`,
    solicitadoAt: `2026-01-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  });
}

/**
 * El almacén de la suite: cierres de la central y de DOS zonas satélite, en los cuatro estados.
 * Sin filas ajenas no habría nada que un acotamiento roto pudiera filtrar; sin filas de la cola
 * no habría nada que un corte roto pudiera colar en el archivo del histórico.
 */
const ALMACEN: CierreAdminResumenRow[] = [
  central("c-01", 1),
  central("c-02", 2, "rechazado"),
  central("c-03", 3),
  central("c-04", 4, "solicitado"), // cola
  central("c-05", 5, "vencido"), // cola
  central("c-06", 6),
  central("c-07", 7, "rechazado"),
  satelite("s-a1", "z-a", 11),
  satelite("s-a2", "z-a", 12, "rechazado"),
  satelite("s-a3", "z-a", 13, "solicitado"), // cola de la zona A
  satelite("s-a4", "z-a", 14, "vencido"), // cola de la zona A
  satelite("s-b1", "z-b", 21),
  satelite("s-b2", "z-b", 22, "solicitado"), // cola de la zona B
];

function casaAlcance(row: CierreAdminResumenRow, alcance: Alcance): boolean {
  if (row.destinoTipo !== alcance.destinoTipo) return false;
  return alcance.destinoZonaId === null || row.destinoZonaId === alcance.destinoZonaId;
}

function esCola(row: CierreAdminResumenRow): boolean {
  return (ESTADOS_COLA_CIERRE_DIA as readonly string[]).includes(row.estado);
}

/** `solicitadoAt` descendente: el criterio que los dos listados presentan hoy. */
function porSolicitadoDesc(a: CierreAdminResumenRow, b: CierreAdminResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

/**
 * Repositorio EN MEMORIA: filtra por el alcance que recibe, corta cola/histórico, ordena y
 * recorta de verdad. Anota cada llamada Y cuántas filas devolvió, que es lo único que distingue
 * la lectura dedicada de la relectura del listado compuesto.
 */
function repoEnMemoria(filas: CierreAdminResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];
  const filasLeidas: number[] = [];

  function anotar(nombre: string, rows: CierreAdminResumenRow[]): CierreAdminResumenRow[] {
    llamadas.push(nombre);
    filasLeidas.push(rows.length);
    return rows;
  }

  const findCierresByAlcance = vi.fn(async (alcance: Alcance) =>
    anotar(
      "findCierresByAlcance",
      filas.filter((f) => casaAlcance(f, alcance)).sort(porSolicitadoDesc),
    ),
  );

  /**
   * Pedido humano del 2026-08-16 — el doble aplica el FILTRO como lo aplica el repositorio de
   * verdad: en conjunción con el alcance, nunca en su lugar. Un doble que lo ignorara dejaría
   * pasar verde un servicio que pasara el filtro EN VEZ del alcance, que es exactamente el
   * error que abriría el dinero de la bodega vecina. La composición en SQL la fija, aparte,
   * `tests/unit/repositories/cierres-filtros-where.test.ts`.
   */
  function casaFiltro(f: CierreAdminResumenRow, filtros?: FiltrosCierres): boolean {
    if (!filtros) return true;
    if (filtros.destinoZonaIds && !filtros.destinoZonaIds.includes(f.destinoZonaId)) return false;
    if (filtros.mensajeroIds && !filtros.mensajeroIds.includes(f.mensajeroId)) return false;
    if (filtros.desde && f.solicitadoAt.slice(0, 10) < filtros.desde) return false;
    if (filtros.hasta && f.solicitadoAt.slice(0, 10) > filtros.hasta) return false;
    return true;
  }

  const findHistoricoCompleto = vi.fn(async (alcance: Alcance, filtros?: FiltrosCierres) =>
    anotar(
      "findHistoricoCompleto",
      filas
        .filter((f) => casaAlcance(f, alcance) && casaFiltro(f, filtros) && !esCola(f))
        .sort(porSolicitadoDesc),
    ),
  );

  const findColaCompleta = vi.fn(async (alcance: Alcance, filtros?: FiltrosCierres) =>
    anotar(
      "findColaCompleta",
      filas
        .filter((f) => casaAlcance(f, alcance) && casaFiltro(f, filtros) && esCola(f))
        .sort(porSolicitadoDesc),
    ),
  );

  const findHistoricoPaginado = vi.fn(async (alcance: Alcance, rango: RangoPagina) => {
    llamadas.push("findHistoricoPaginado");
    const conjunto = filas
      .filter((f) => casaAlcance(f, alcance) && !esCola(f))
      .sort(porSolicitadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const findColaPaginada = vi.fn(async (alcance: Alcance, rango: RangoPagina) => {
    llamadas.push("findColaPaginada");
    const conjunto = filas
      .filter((f) => casaAlcance(f, alcance) && esCola(f))
      .sort(porSolicitadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findCierresByAlcance,
    findHistoricoCompleto,
    findColaCompleta,
    findHistoricoPaginado,
    findColaPaginada,
    findCierreByIdEnAlcance: vi.fn(async () => null),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
  } as unknown as ICierresAdminRepository;

  return { repo, llamadas, filasLeidas, findHistoricoCompleto, findColaCompleta };
}

function servicio(repo: ICierresAdminRepository) {
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    // Feature 271 (T7.1, R48): el estado de bloqueo del mensajero viaja en la fila del cierre.
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => ZONA_POR_USUARIO[usuarioId] ?? null),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;
  // R9 no es de esta tanda, pero el espía existe igual: si algún día el camino del archivo
  // empezara a firmar evidencias, aquí se vería.
  const createSignedUrls = vi.fn(async () => ({}));
  const signedUrls = { createSignedUrls } as unknown as ISignedUrlProvider;
  const sumarVigentesPorCierre = vi.fn(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, "0.00"])),
  );
  const svc = new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, {
    sumarVigentesPorCierre,
    obtenerCierreParaPago: vi.fn(async () => null),
  });
  return { svc, createSignedUrls, sumarVigentesPorCierre };
}

function ids(items: ReadonlyArray<{ cierreId: string }>): string[] {
  return items.map((c) => c.cierreId);
}

/** Un conjunto plano de N cierres del histórico de la central, para medir el tope. */
function historicoPlano(n: number): CierreAdminResumenRow[] {
  return Array.from({ length: n }, (_, i) => central(`h-${i}`, ((i % 28) + 1) as number));
}

/** Un conjunto plano de N cierres de la COLA de la central. */
function colaPlana(n: number): CierreAdminResumenRow[] {
  return Array.from({ length: n }, (_, i) => central(`p-${i}`, ((i % 28) + 1) as number, "solicitado"));
}

describe("los conjuntos de la descarga de «Cierres del día» del admin (feature 184, T D.2)", () => {
  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      for (const listado of ["historico", "cola"] as const) {
        const { repo, llamadas } = repoEnMemoria();
        const { svc } = servicio(repo);

        const r =
          listado === "historico"
            ? await svc.listarHistoricoCierresAdminCompleto(actor)
            : await svc.listarPendientesCierresAdminCompleto(actor);

        const etiqueta = `${listado}/${actor.rol}`;
        expect(r, etiqueta).toEqual({ status: "forbidden" });
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(r, etiqueta).not.toHaveProperty("total"); // un conteo también es información
        // El guard va ANTES de la base: ni una consulta al dinero ajeno.
        expect(llamadas, etiqueta).toEqual([]);
      }
    }
  });

  it("el alcance sale del ACTOR, no de la entrada: cada admin descarga LO SUYO (R4)", async () => {
    const conjunto = async (
      actor: Actor,
      listado: "historico" | "cola",
    ): Promise<string[]> => {
      const { svc } = servicio(repoEnMemoria().repo);
      const r =
        listado === "historico"
          ? await svc.listarHistoricoCierresAdminCompleto(actor)
          : await svc.listarPendientesCierresAdminCompleto(actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    // El acceso total ve la bodega central y NINGÚN satélite.
    const historicoMaestro = await conjunto(MAESTRO, "historico");
    expect(historicoMaestro).toEqual(["c-07", "c-06", "c-03", "c-02", "c-01"]);
    expect(historicoMaestro.some((id) => id.startsWith("s-"))).toBe(false);
    expect(await conjunto(MAESTRO, "cola")).toEqual(["c-05", "c-04"]);

    // Y `admin` alcanza lo mismo que `maestro`: los dos son acceso total.
    expect(await conjunto(ADMIN, "historico")).toEqual(historicoMaestro);

    // El adminSatelite de la zona A ve LOS SUYOS: ni los de la central ni los de la B.
    const historicoA = await conjunto(SATELITE_A, "historico");
    const colaA = await conjunto(SATELITE_A, "cola");
    expect(historicoA).toEqual(["s-a2", "s-a1"]);
    expect(colaA).toEqual(["s-a4", "s-a3"]);

    // Y el de la zona B, los suyos. Sin este segundo lado, un servicio que devolviera siempre
    // vacío pasaría la mitad de arriba.
    const historicoB = await conjunto(SATELITE_B, "historico");
    expect(historicoB).toEqual(["s-b1"]);
    expect(await conjunto(SATELITE_B, "cola")).toEqual(["s-b2"]);

    // Los alcances son disjuntos: ninguna fila se ve desde dos actores distintos.
    expect(historicoMaestro.filter((id) => historicoA.includes(id) || historicoB.includes(id))).toEqual([]);
    expect(historicoA.filter((id) => historicoB.includes(id))).toEqual([]);

    // AQUÍ ESTABA UNA AFIRMACIÓN DE ARIDAD, y se REEXPRESA en vez de relajarse. Decía: «ninguno
    // de los dos métodos admite un parámetro por el que pedir el alcance de otro: la aridad es 1,
    // y ese 1 es el actor». Era un buen proxy MIENTRAS el segundo parámetro no existía; el pedido
    // humano del 2026-08-16 le añadió uno —los FILTROS— y subir el número a 2 no habría afirmado
    // nada: la pregunta no es cuántos parámetros hay, es si alguno de ellos puede ensanchar lo
    // que el actor ve. Así que se comprueba ESO, con el peor caso: el `adminSatelite` de la zona
    // A pidiendo, por filtro, la zona B.
    const { svc: svcA } = servicio(repoEnMemoria().repo);
    const zonaAjena = { destinoZonaIds: ["z-b"] as [string, ...string[]] };
    const historicoConZonaAjena = await svcA.listarHistoricoCierresAdminCompleto(
      SATELITE_A,
      zonaAjena,
    );
    const colaConZonaAjena = await svcA.listarPendientesCierresAdminCompleto(
      SATELITE_A,
      zonaAjena,
    );
    // La intersección de «mi zona» con «la zona B» es vacía: se ve NADA, no se ve la zona B.
    expect(historicoConZonaAjena.status === "ok" && ids(historicoConZonaAjena.items)).toEqual([]);
    expect(colaConZonaAjena.status === "ok" && ids(colaConZonaAjena.items)).toEqual([]);
    // Y ninguna de las dos trajo una sola fila de la zona ajena, ni siquiera para descartarla.
    expect(historicoB.length, "el almacén no tiene filas de la zona B: el caso sería vacuo")
      .toBeGreaterThan(0);
  });

  it("el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)", async () => {
    const sinZona: Actor = { usuarioId: "u-sin-zona", rol: "adminSatelite" };

    for (const listado of ["historico", "cola"] as const) {
      const { repo, llamadas } = repoEnMemoria();
      const { svc } = servicio(repo);

      const r =
        listado === "historico"
          ? await svc.listarHistoricoCierresAdminCompleto(sinZona)
          : await svc.listarPendientesCierresAdminCompleto(sinZona);

      expect(r, listado).toEqual({ status: "ok", items: [], total: 0 });
      // Es lo mismo que devuelven hoy el listado sin paginar y la página, sin tocar cierres.
      expect(llamadas, listado).toEqual([]);
    }
  });

  it("el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)", async () => {
    // LA prueba de esta tanda. Las filas que devuelve la lectura dedicada son EXACTAMENTE las
    // que devolvía partir en memoria el listado compuesto, así que compararlas no mide nada.
    // Lo que cambia es cuánto se lee para producirlas.
    const historico = repoEnMemoria();
    const rHistorico = await servicio(historico.repo).svc.listarHistoricoCierresAdminCompleto(MAESTRO);

    expect(historico.llamadas).toEqual(["findHistoricoCompleto"]);
    expect(historico.llamadas).not.toContain("findCierresByAlcance");
    expect(historico.filasLeidas).toEqual([5]); // las 5 del histórico de la central

    const cola = repoEnMemoria();
    const rCola = await servicio(cola.repo).svc.listarPendientesCierresAdminCompleto(MAESTRO);

    expect(cola.llamadas).toEqual(["findColaCompleta"]);
    expect(cola.filasLeidas).toEqual([2]); // las 2 de la cola de la central

    // ANTI-VACUIDAD: la relectura que esta tanda sustituye SÍ trae las dos mitades. Sin esta
    // mitad del caso, los `toEqual` de arriba serían un adorno: un servicio que no leyera nada
    // los pasaría igual.
    const compuesto = repoEnMemoria();
    await servicio(compuesto.repo).svc.listarCierresAdmin(MAESTRO);
    expect(compuesto.llamadas).toEqual(["findCierresByAlcance"]);
    expect(compuesto.filasLeidas).toEqual([7]); // 5 del histórico + 2 de la cola

    // Y el archivo sale igual: la mejora es de coste, no de contenido (R12/R13).
    if (rHistorico.status !== "ok" || rCola.status !== "ok") throw new Error("esperaba ok");
    expect(ids(rHistorico.items)).toEqual(["c-07", "c-06", "c-03", "c-02", "c-01"]);
    expect(ids(rCola.items)).toEqual(["c-05", "c-04"]);
    // Descargar una mitad ya no trae la otra: ni un `estado` de la cola en el histórico.
    expect(rHistorico.items.some((c) => esCola(c as CierreAdminResumenRow))).toBe(false);
    expect(rCola.items.every((c) => esCola(c as CierreAdminResumenRow))).toBe(true);
  });

  it("el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)", async () => {
    // `pageSize: 2` a propósito: con el tamaño de página real (25) y 5 filas de almacén, la
    // página 1 SERÍA el conjunto entero y una mutación de recorte no se notaría.
    for (const actor of [MAESTRO, SATELITE_A, SATELITE_B]) {
      const { svc } = servicio(repoEnMemoria().repo);

      const conjuntoHistorico = await svc.listarHistoricoCierresAdminCompleto(actor);
      const conjuntoCola = await svc.listarPendientesCierresAdminCompleto(actor);
      if (conjuntoHistorico.status !== "ok" || conjuntoCola.status !== "ok") {
        throw new Error("esperaba ok");
      }

      const recorrer = async (listado: "historico" | "cola") => {
        const visto: string[] = [];
        for (let page = 1; page <= 20; page += 1) {
          const input = listarHistoricoCierresAdminSchema.parse({ page, pageSize: 2 });
          const p =
            listado === "historico"
              ? await svc.listarHistoricoCierresAdminPaginado(input, actor)
              : await svc.listarPendientesCierresAdminPaginado(input, actor);
          if (p.status !== "ok") throw new Error(`esperaba ok, vino ${p.status}`);
          if (p.items.length === 0) break;
          visto.push(...ids(p.items));
        }
        return visto;
      };

      expect(await recorrer("historico"), `histórico de ${actor.usuarioId}`).toEqual(
        ids(conjuntoHistorico.items),
      );
      expect(await recorrer("cola"), `cola de ${actor.usuarioId}`).toEqual(ids(conjuntoCola.items));
      // El total del conjunto es su longitud, no la de una página.
      expect(conjuntoHistorico.total).toBe(conjuntoHistorico.items.length);
      expect(conjuntoCola.total).toBe(conjuntoCola.items.length);
    }
  });

  it("las filas del archivo son las MISMAS que las de la página, campo por campo", async () => {
    // Incluye `pendientePagoMensajero`, que el archivo no proyecta pero el DTO sí declara: si el
    // conjunto se saltara el enriquecido, emitiría `null` —que significa «este cierre NO está
    // aprobado» (172/R28)— en cierres aprobados. Un dato equivocado en un DTO de dinero.
    const { svc } = servicio(repoEnMemoria().repo);

    const conjunto = await svc.listarHistoricoCierresAdminCompleto(MAESTRO);
    const pagina = await svc.listarHistoricoCierresAdminPaginado(
      listarHistoricoCierresAdminSchema.parse({ page: 1, pageSize: 50 }),
      MAESTRO,
    );
    if (conjunto.status !== "ok" || pagina.status !== "ok") throw new Error("esperaba ok");

    expect(conjunto.items).toEqual(pagina.items);
    for (const f of conjunto.items) {
      // Aprobado -> el pendiente DERIVADO ("0.00" con este doble de pagos); cualquier otro
      // estado -> `null`, que significa «todavía no hay nada que pagar» y no «cero».
      expect(f.pendientePagoMensajero, `pendiente de ${f.cierreId} (${f.estado})`).toBe(
        f.estado === "aprobado" ? "0.00" : null,
      );
    }
    // Anti-vacuidad: el histórico de la central trae de los dos tipos, así que la línea de
    // arriba distingue de verdad. Si todos fueran rechazados, `null` pasaría siempre.
    expect(conjunto.items.filter((c) => c.estado === "aprobado")).toHaveLength(3);
    expect(conjunto.items.filter((c) => c.estado !== "aprobado")).toHaveLength(2);
  });

  it("el conjunto NO firma ninguna URL de evidencia ni recalcula dinero", async () => {
    // Los totales son SNAPSHOT: viajan tal cual desde la fila. El único agregado del camino es
    // `sumarVigentesPorCierre`, y es UNA llamada para todo el conjunto —no una por fila—, la
    // misma que ya hace la página.
    const { repo } = repoEnMemoria();
    const { svc, createSignedUrls, sumarVigentesPorCierre } = servicio(repo);

    const r = await svc.listarHistoricoCierresAdminCompleto(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    expect(createSignedUrls).toHaveBeenCalledTimes(0);
    expect(sumarVigentesPorCierre).toHaveBeenCalledTimes(1);
    // Los cinco cierres del histórico de la central conservan su snapshot sin tocar.
    expect(r.items.map((c) => c.totales.general)).toEqual([
      "100.00",
      "100.00",
      "100.00",
      "100.00",
      "100.00",
    ]);
  });

  it("con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    // El borde EXACTO por abajo: `MAX_FILAS` cabe entero.
    const justoHistorico = repoEnMemoria(historicoPlano(limite));
    const okHistorico =
      await servicio(justoHistorico.repo).svc.listarHistoricoCierresAdminCompleto(MAESTRO);
    if (okHistorico.status !== "ok") throw new Error(`esperaba ok, vino ${okHistorico.status}`);
    expect(okHistorico.items).toHaveLength(limite);
    expect(okHistorico.total).toBe(limite);

    // Y por arriba: con UNA más no hay archivo, ni truncado ni parcial. Sólo los conteos.
    const pasadoHistorico = repoEnMemoria(historicoPlano(limite + 1));
    const excedidoHistorico =
      await servicio(pasadoHistorico.repo).svc.listarHistoricoCierresAdminCompleto(MAESTRO);
    expect(excedidoHistorico).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidoHistorico).not.toHaveProperty("items");

    // La cola tiene su propio tope, con su propio conjunto: no se hereda del de arriba.
    const justaCola = repoEnMemoria(colaPlana(limite));
    const okCola = await servicio(justaCola.repo).svc.listarPendientesCierresAdminCompleto(MAESTRO);
    if (okCola.status !== "ok") throw new Error(`esperaba ok, vino ${okCola.status}`);
    expect(okCola.items).toHaveLength(limite);

    const pasadaCola = repoEnMemoria(colaPlana(limite + 1));
    const excedidaCola =
      await servicio(pasadaCola.repo).svc.listarPendientesCierresAdminCompleto(MAESTRO);
    expect(excedidaCola).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidaCola).not.toHaveProperty("items");
  });
});
