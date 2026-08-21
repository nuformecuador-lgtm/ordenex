import { describe, it, expect, vi } from "vitest";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import { descargaConfig } from "@/lib/config/descarga";
import { listarCierresBodegaPaginadoSchema } from "@/lib/types/cierre-bodega";
import { conPagos } from "@/tests/fixtures/cierre-pagos";

// Feature 184 — Tanda E (T E.2, R1/R2/R4/R5/R6) — los CONJUNTOS de los que salen los archivos de
// «Cierres de bodega pendientes» (listado 4) y «Cierres de bodega resueltos» (listado 5).
//
// **Lo que esta tanda quita, y por qué un test de filas no lo mediría.** Los dos archivos se
// producían releyendo `listarCierresBodegaAdmin()`, que llama a `findCierresBodega`: TODOS los
// cierres de bodega —cola e histórico juntos— para que la pantalla se quede con una de las dos
// mitades. Sustituirlo por la lectura dedicada produce EXACTAMENTE las mismas filas: el reparto en
// memoria (`esColaSolicitado`) y el corte en la base seleccionan lo mismo. Es indistinguible
// mirando el resultado, y por eso la deuda llevaba aquí desde la 170 sin que nadie la viera.
//
// Lo que sí lo distingue es CUÁNTO se lee, y por eso el repositorio en memoria de esta suite lleva
// la cuenta de sus llamadas Y de cuántas filas devuelve cada una. La mutación «vuelve a servirse
// del listado compuesto y parte en memoria» sólo muere ahí (M6 de la bitácora).
//
// El repositorio doble NO es un stub que devuelve lo que se le diga: aplica de verdad el corte
// cola/histórico y el recorte de página sobre un almacén con cierres de DOS zonas y los tres
// estados. Sin filas de la cola no habría nada que un corte roto pudiera colar en el archivo del
// histórico; sin dos zonas no se vería que el acceso total descarga la operación entera.
//
// Lo que esta suite NO puede ver: la traducción de ese corte a SQL. El doble no emite consultas.
// Eso vive en `tests/unit/repositories/{historicos-paginados,colas-paginadas}-where.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

/**
 * Roles que NO alcanzan estos dos listados. El `adminSatelite` está aquí a propósito: tiene su
 * propia pantalla de bodega (los listados 6 y 7 de la tanda B), pero NO el agregado de todas las
 * zonas. El lado de la aceptación lo cubren MAESTRO y ADMIN, sin los cuales el caso pasaría con
 * un servicio que no le devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function fila(
  cierreBodegaId: string,
  dia: number,
  estado: CierreBodegaResumenRow["estado"] = "aprobado",
  zonaId = "z-1",
): CierreBodegaResumenRow {
  return {
    cierreBodegaId,
    zonaId,
    zonaNombre: `Zona ${zonaId}`,
    solicitadoPorId: `u-sat-${zonaId}`,
    solicitadoPorNombre: `Sat ${zonaId}`,
    estado,
    totales: { efectivo: "500.00", simpe: "0.00", transferencia: "0.00", general: "500.00" },
    totalPagoMensajero: "50.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 3,
    solicitadoAt: `2026-02-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    resueltoAt:
      estado === "solicitado" ? null : `2026-02-${String(dia).padStart(2, "0")}T12:00:00.000Z`,
    motivoRechazo: estado === "rechazado" ? "Faltó efectivo" : null,
  };
}

/**
 * El almacén de la suite: CINCO resueltos y DOS en la cola, repartidos entre dos zonas satélite.
 * Los dos números importan y salen citados en la bitácora: la relectura de hoy lee las SIETE filas
 * para producir cualquiera de los dos archivos; la lectura dedicada lee 5 y 2.
 */
const ALMACEN: CierreBodegaResumenRow[] = [
  fila("cb-01", 1, "aprobado", "z-1"),
  fila("cb-02", 2, "rechazado", "z-2"),
  fila("cb-03", 3, "solicitado", "z-1"), // cola
  fila("cb-04", 4, "aprobado", "z-2"),
  fila("cb-05", 5, "solicitado", "z-2"), // cola
  fila("cb-06", 6, "rechazado", "z-1"),
  fila("cb-07", 7, "aprobado", "z-1"),
];

function esCola(row: { estado: string }): boolean {
  return (ESTADOS_COLA_SOLICITADO as readonly string[]).includes(row.estado);
}

/** `solicitadoAt` descendente: el criterio que los dos listados presentan hoy. */
function porSolicitadoDesc(a: CierreBodegaResumenRow, b: CierreBodegaResumenRow): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

/** Una gestión con evidencia, para que el espía de firmas tenga a quién dispararse. */
function gestionConEvidencia(): CierreGestionPendienteRow {
  // Feature 212/T9: `pagos` es obligatorio; `conPagos` lo deriva del par escalar (UNA linea).
  return conPagos({
    gestionId: "g-1",
    ordenId: "o-1",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    zonaNombre: "Zona z-1",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: "evidencias/g-1.jpg",
    pagoMensajero: "5.00",
    ingresoBodegaRechazo: "0.00",
    esRechazoSla: false,
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    causaIncidente: null,
    indemnizacion: null,
  });
}

/**
 * Repositorio EN MEMORIA: corta cola/histórico, ordena y recorta de verdad. Anota cada llamada Y
 * cuántas filas devolvió, que es lo único que distingue la lectura dedicada de la relectura del
 * listado compuesto.
 */
function repoEnMemoria(filas: CierreBodegaResumenRow[] = ALMACEN) {
  const llamadas: string[] = [];
  const filasLeidas: number[] = [];

  function anotar(nombre: string, rows: CierreBodegaResumenRow[]): CierreBodegaResumenRow[] {
    llamadas.push(nombre);
    filasLeidas.push(rows.length);
    return rows;
  }

  const findCierresBodega = vi.fn(async () =>
    anotar("findCierresBodega", [...filas].sort(porSolicitadoDesc)),
  );

  /**
   * Pedido humano del 2026-08-16 — el doble aplica el FILTRO como lo aplica el repositorio de
   * verdad: en conjunción con el criterio, nunca en su lugar. Un doble que lo ignorara dejaría
   * pasar verde un servicio que pasara el filtro EN VEZ del alcance. La composición en SQL la
   * fija, aparte, `tests/unit/repositories/*-where.test.ts`.
   */
  function casaFiltro(f: CierreBodegaResumenRow, filtros?: FiltrosCierresBodega): boolean {
    if (!filtros) return true;
    if (filtros.destinoZonaIds && !filtros.destinoZonaIds.includes(f.zonaId)) return false;
    if (filtros.desde && f.solicitadoAt.slice(0, 10) < filtros.desde) return false;
    if (filtros.hasta && f.solicitadoAt.slice(0, 10) > filtros.hasta) return false;
    return true;
  }

  const findHistoricoCompleto = vi.fn(async (filtros?: FiltrosCierresBodega) =>
    anotar(
      "findHistoricoCompleto",
      filas.filter((f) => !esCola(f) && casaFiltro(f, filtros)).sort(porSolicitadoDesc),
    ),
  );

  const findColaCompleta = vi.fn(async (filtros?: FiltrosCierresBodega) =>
    anotar(
      "findColaCompleta",
      filas.filter((f) => esCola(f) && casaFiltro(f, filtros)).sort(porSolicitadoDesc),
    ),
  );

  const findHistoricoPaginado = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("findHistoricoPaginado");
    const conjunto = filas.filter((f) => !esCola(f)).sort(porSolicitadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const findColaPaginada = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("findColaPaginada");
    const conjunto = filas.filter(esCola).sort(porSolicitadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const findCierreBodegaConDetalle = vi.fn(async () => {
    llamadas.push("findCierreBodegaConDetalle");
    return {
      cierre: filas[0]!,
      cierresDia: [
        {
          resumen: {
            cierreDiaId: "cd-1",
            mensajeroId: "m-1",
            mensajeroNombre: "Mensajero 1",
            totales: {
              efectivo: "10.00",
              simpe: "0.00",
              transferencia: "0.00",
              general: "10.00",
            },
            totalPagoMensajero: "5.00",
            totalIngresoBodegaRechazos: "0.00",
          },
          gestiones: [gestionConEvidencia()],
        },
      ],
    };
  });

  const repo = {
    findCierresBodega,
    findHistoricoCompleto,
    findColaCompleta,
    findHistoricoPaginado,
    findColaPaginada,
    findCierreBodegaConDetalle,
    resolverCierreBodega: vi.fn(async () => "updated" as const),
  } as unknown as ICierresBodegaAdminRepository;

  return { repo, llamadas, filasLeidas, findHistoricoCompleto, findColaCompleta };
}

function servicio(repo: ICierresBodegaAdminRepository) {
  // El parámetro se declara EXPLÍCITAMENTE porque es lo que la anti-vacuidad afirma: sin él, el
  // tipo del espía sería de cero argumentos y `mock.calls[0][0]` no existiría.
  const createSignedUrls = vi.fn(async (paths: string[]) => {
    void paths;
    return {} as Record<string, string>;
  });
  const signedUrls = { createSignedUrls } as unknown as ISignedUrlProvider;
  return { svc: new CierresBodegaAdminService(repo, signedUrls), createSignedUrls };
}

function input(extra: Record<string, unknown> = {}) {
  return listarCierresBodegaPaginadoSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ cierreBodegaId: string }>): string[] {
  return items.map((c) => c.cierreBodegaId);
}

/** Un conjunto plano de N cierres, todos del histórico o todos de la cola, para medir el tope. */
function plano(n: number, estado: CierreBodegaResumenRow["estado"]): CierreBodegaResumenRow[] {
  return Array.from({ length: n }, (_, i) => fila(`x-${i}`, (i % 28) + 1, estado));
}

describe("los conjuntos de la descarga de «Cierres de bodega» del admin (feature 184, T E.2)", () => {
  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      for (const listado of ["resueltos", "pendientes"] as const) {
        const { repo, llamadas } = repoEnMemoria();
        const { svc } = servicio(repo);

        const r =
          listado === "resueltos"
            ? await svc.listarHistoricoCierresBodegaCompleto(actor)
            : await svc.listarPendientesCierresBodegaCompleto(actor);

        const etiqueta = `${listado}/${actor.rol}`;
        expect(r, etiqueta).toEqual({ status: "forbidden" });
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(r, etiqueta).not.toHaveProperty("total"); // un conteo también es información
        // El guard va ANTES de la base: ni una consulta al dinero agregado de nadie.
        expect(llamadas, etiqueta).toEqual([]);
      }
    }
  });

  it("el alcance sale del ROL del ACTOR, no de la entrada, y abarca TODAS las zonas (R4)", async () => {
    const conjunto = async (
      actor: Actor,
      listado: "resueltos" | "pendientes",
    ): Promise<string[]> => {
      const { svc } = servicio(repoEnMemoria().repo);
      const r =
        listado === "resueltos"
          ? await svc.listarHistoricoCierresBodegaCompleto(actor)
          : await svc.listarPendientesCierresBodegaCompleto(actor);
      return r.status === "ok" ? ids(r.items) : [`<${r.status}>`];
    };

    // El acceso total ve la operación ENTERA: los cierres de las dos zonas, en un solo archivo.
    const resueltosMaestro = await conjunto(MAESTRO, "resueltos");
    expect(resueltosMaestro).toEqual(["cb-07", "cb-06", "cb-04", "cb-02", "cb-01"]);
    expect(await conjunto(MAESTRO, "pendientes")).toEqual(["cb-05", "cb-03"]);

    // Y `admin` alcanza lo mismo que `maestro`: los dos son acceso total, sin filtro de zona.
    expect(await conjunto(ADMIN, "resueltos")).toEqual(resueltosMaestro);
    expect(await conjunto(ADMIN, "pendientes")).toEqual(["cb-05", "cb-03"]);

    // Anti-vacuidad del «todas las zonas»: el archivo trae de las DOS, no de una.
    const { svc } = servicio(repoEnMemoria().repo);
    const r = await svc.listarHistoricoCierresBodegaCompleto(MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect([...new Set(r.items.map((c) => c.zonaId))].sort()).toEqual(["z-1", "z-2"]);

    // AQUÍ ESTABA UNA AFIRMACIÓN DE ARIDAD, y se REEXPRESA en vez de relajarse. Decía: «ninguno
    // de los dos métodos admite un parámetro por el que pedir otro alcance: la aridad es 1, y
    // ese 1 es el actor». Era un buen proxy MIENTRAS el segundo parámetro no existía; el pedido
    // humano del 2026-08-16 le añadió uno —los FILTROS— y subir el número a 2 no habría
    // afirmado nada: la pregunta no es cuántos parámetros hay, es si alguno puede ensanchar lo
    // que el actor ve. Aquí el alcance es el ROL —acceso total, TODAS las zonas—, así que lo que
    // se comprueba es que el filtro solo RECORTA: pedir una zona devuelve esa zona y ninguna más.
    const soloZona1 = await svc.listarHistoricoCierresBodegaCompleto(MAESTRO, {
      destinoZonaIds: ["z-1"],
    });
    if (soloZona1.status !== "ok") throw new Error("esperaba ok");
    expect([...new Set(soloZona1.items.map((c) => c.zonaId))]).toEqual(["z-1"]);
    // Anti-vacuidad: sin filtro salían las DOS zonas, así que el recorte hizo algo de verdad.
    expect(soloZona1.items.length).toBeLessThan(r.items.length);
  });

  it("el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)", async () => {
    // LA prueba de esta tanda. Las filas que devuelve la lectura dedicada son EXACTAMENTE las que
    // devolvía partir en memoria el listado compuesto, así que compararlas no mide nada. Lo que
    // cambia es cuánto se lee para producirlas.
    const resueltos = repoEnMemoria();
    const rResueltos =
      await servicio(resueltos.repo).svc.listarHistoricoCierresBodegaCompleto(MAESTRO);

    expect(resueltos.llamadas).toEqual(["findHistoricoCompleto"]);
    expect(resueltos.llamadas).not.toContain("findCierresBodega");
    expect(resueltos.filasLeidas).toEqual([5]); // los 5 resueltos

    const pendientes = repoEnMemoria();
    const rPendientes =
      await servicio(pendientes.repo).svc.listarPendientesCierresBodegaCompleto(MAESTRO);

    expect(pendientes.llamadas).toEqual(["findColaCompleta"]);
    expect(pendientes.llamadas).not.toContain("findCierresBodega");
    expect(pendientes.filasLeidas).toEqual([2]); // los 2 de la cola

    // ANTI-VACUIDAD: la relectura que esta tanda sustituye SÍ trae las dos mitades, y las trae
    // para producir CUALQUIERA de los dos archivos. Sin esta mitad del caso, los `toEqual` de
    // arriba serían un adorno: un servicio que no leyera nada los pasaría igual.
    const compuesto = repoEnMemoria();
    await servicio(compuesto.repo).svc.listarCierresBodegaAdmin(MAESTRO);
    expect(compuesto.llamadas).toEqual(["findCierresBodega"]);
    expect(compuesto.filasLeidas).toEqual([7]); // 5 resueltos + 2 de la cola

    // Y el archivo sale igual: la mejora es de coste, no de contenido (R12/R13).
    if (rResueltos.status !== "ok" || rPendientes.status !== "ok") throw new Error("esperaba ok");
    expect(ids(rResueltos.items)).toEqual(["cb-07", "cb-06", "cb-04", "cb-02", "cb-01"]);
    expect(ids(rPendientes.items)).toEqual(["cb-05", "cb-03"]);
    // Descargar una mitad ya no trae la otra: ni un `solicitado` en el archivo de resueltos.
    expect(rResueltos.items.some(esCola)).toBe(false);
    expect(rPendientes.items.every(esCola)).toBe(true);
  });

  it("el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)", async () => {
    // `pageSize: 2` a propósito: con el tamaño de página real y 5 filas de almacén, la página 1
    // SERÍA el conjunto entero y una mutación de recorte no se notaría.
    const { svc } = servicio(repoEnMemoria().repo);

    const conjuntoResueltos = await svc.listarHistoricoCierresBodegaCompleto(MAESTRO);
    const conjuntoPendientes = await svc.listarPendientesCierresBodegaCompleto(MAESTRO);
    if (conjuntoResueltos.status !== "ok" || conjuntoPendientes.status !== "ok") {
      throw new Error("esperaba ok");
    }

    const recorrer = async (listado: "resueltos" | "pendientes") => {
      const visto: string[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const p =
          listado === "resueltos"
            ? await svc.listarHistoricoCierresBodegaPaginado(input({ page, pageSize: 2 }), MAESTRO)
            : await svc.listarPendientesCierresBodegaPaginado(input({ page, pageSize: 2 }), MAESTRO);
        if (p.status !== "ok") throw new Error(`esperaba ok, vino ${p.status}`);
        if (p.items.length === 0) break;
        visto.push(...ids(p.items));
      }
      return visto;
    };

    expect(await recorrer("resueltos")).toEqual(ids(conjuntoResueltos.items));
    expect(await recorrer("pendientes")).toEqual(ids(conjuntoPendientes.items));
    // Anti-vacuidad del recorrido: son TRES páginas de resueltos, no una.
    expect(conjuntoResueltos.items.length).toBeGreaterThan(2);
    // El total del conjunto es su longitud, no la de una página.
    expect(conjuntoResueltos.total).toBe(conjuntoResueltos.items.length);
    expect(conjuntoPendientes.total).toBe(conjuntoPendientes.items.length);
  });

  it("las filas del archivo son las MISMAS que las de la página, campo por campo", async () => {
    // Mismo mapper (`toResumen`, R13) en los dos caminos: los totales son el SNAPSHOT y ninguno
    // de los dos recomputa nada. Si el conjunto usara un mapper propio, aquí se vería.
    const { svc } = servicio(repoEnMemoria().repo);

    const conjunto = await svc.listarHistoricoCierresBodegaCompleto(MAESTRO);
    const pagina = await svc.listarHistoricoCierresBodegaPaginado(
      input({ page: 1, pageSize: 50 }),
      MAESTRO,
    );
    if (conjunto.status !== "ok" || pagina.status !== "ok") throw new Error("esperaba ok");

    expect(conjunto.items).toEqual(pagina.items);
    // Y los campos que el archivo proyecta viajan tal cual desde el snapshot: `motivoRechazo` y
    // `resueltoAt` distinguen las dos ramas, así que el `toEqual` de arriba no es vacío.
    expect(conjunto.items.map((c) => c.totales.general)).toEqual([
      "500.00",
      "500.00",
      "500.00",
      "500.00",
      "500.00",
    ]);
    expect(conjunto.items.filter((c) => c.motivoRechazo !== null)).toHaveLength(2);
    expect(conjunto.items.every((c) => c.resueltoAt !== null)).toBe(true);
  });

  it("el conjunto NO firma ninguna URL de evidencia ni consulta ninguna otra tabla", async () => {
    // A diferencia de la tanda D, aquí no hay enriquecido que conservar ni que saltarse: el
    // camino del archivo es repositorio + mapper, y nada más. Lo afirmable —y lo que este caso
    // afirma— es que sigue siendo así: una consulta, cero firmas.
    for (const listado of ["resueltos", "pendientes"] as const) {
      const { repo, llamadas } = repoEnMemoria();
      const { svc, createSignedUrls } = servicio(repo);

      const r =
        listado === "resueltos"
          ? await svc.listarHistoricoCierresBodegaCompleto(MAESTRO)
          : await svc.listarPendientesCierresBodegaCompleto(MAESTRO);
      if (r.status !== "ok") throw new Error("esperaba ok");

      expect(createSignedUrls, listado).toHaveBeenCalledTimes(0);
      expect(llamadas, listado).toHaveLength(1);
      expect(llamadas, listado).not.toContain("findCierreBodegaConDetalle");
    }

    // ANTI-VACUIDAD del espía: el camino que SÍ firma en este mismo servicio es el detalle, y con
    // el mismo doble se dispara una vez, con el path exacto. Sin esta mitad, los
    // `toHaveBeenCalledTimes(0)` de arriba pasarían con un espía que no se dispara nunca.
    const { repo } = repoEnMemoria();
    const { svc, createSignedUrls } = servicio(repo);
    await svc.verCierreBodegaDetalle("cb-01", MAESTRO);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0]![0]).toEqual(["evidencias/g-1.jpg"]);
  });

  it("con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    // El borde EXACTO por abajo: `MAX_FILAS` cabe entero.
    const justoResueltos = repoEnMemoria(plano(limite, "aprobado"));
    const okResueltos =
      await servicio(justoResueltos.repo).svc.listarHistoricoCierresBodegaCompleto(MAESTRO);
    if (okResueltos.status !== "ok") throw new Error(`esperaba ok, vino ${okResueltos.status}`);
    expect(okResueltos.items).toHaveLength(limite);
    expect(okResueltos.total).toBe(limite);

    // Y por arriba: con UNA más no hay archivo, ni truncado ni parcial. Sólo los conteos.
    const pasadoResueltos = repoEnMemoria(plano(limite + 1, "aprobado"));
    const excedidoResueltos =
      await servicio(pasadoResueltos.repo).svc.listarHistoricoCierresBodegaCompleto(MAESTRO);
    expect(excedidoResueltos).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidoResueltos).not.toHaveProperty("items");

    // La cola tiene su propio tope, con su propio conjunto: no se hereda del de arriba.
    const justaCola = repoEnMemoria(plano(limite, "solicitado"));
    const okCola =
      await servicio(justaCola.repo).svc.listarPendientesCierresBodegaCompleto(MAESTRO);
    if (okCola.status !== "ok") throw new Error(`esperaba ok, vino ${okCola.status}`);
    expect(okCola.items).toHaveLength(limite);

    const pasadaCola = repoEnMemoria(plano(limite + 1, "solicitado"));
    const excedidaCola =
      await servicio(pasadaCola.repo).svc.listarPendientesCierresBodegaCompleto(MAESTRO);
    expect(excedidaCola).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidaCola).not.toHaveProperty("items");
  });
});
