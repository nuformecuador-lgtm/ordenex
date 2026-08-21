import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { conPagos } from "@/tests/fixtures/cierre-pagos";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { descargaConfig } from "@/lib/config/descarga";
import { listarCierresPasadosSchema } from "@/lib/types/cierre";

// Feature 184 — Tanda C (T C.1) — el CONJUNTO del que sale el archivo del listado 1, «Cierres
// solicitados por el mensajero»: `CierreDiaService.listarCierresPasadosCompleto`.
//
// **Por qué el caso central de este archivo es un espía en cero.**
// Hasta hoy la pantalla producía su archivo releyendo `listarCierreDia()`, que es el listado
// COMPUESTO de la pantalla entera: cuatro lecturas (las gestiones del día, el contador de
// pendientes, este histórico y la tarifa por zona+vehículo), los pagos e ingresos derivados de
// cada gestión, los totales por método de pago y —lo que de verdad cuesta— la FIRMA EN LOTE de
// las evidencias fotográficas de todas las gestiones del día contra Supabase Storage.
//
// El archivo no lleva ninguna de esas URL: sus ocho columnas
// (`COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS`) salen enteras del `CierrePasadoDTO`, que ni siquiera
// tiene campo de evidencia. O sea: firmar para descargar era trabajo perdido, y pagado en red
// contra un servicio externo. Eso es lo que R9 prohíbe, y NO se puede medir mirando las filas
// devueltas —salen idénticas con firma y sin ella—: hace falta un espía sobre el proveedor de
// firmas y un conteo de llamadas.
//
// AVISO vigente en todo el repo: este archivo usa un DOBLE de repositorio y NO ve la traducción a
// SQL. El `where`, el `orderBy`, cuántas consultas se emiten y qué NO llevan viven en
// `tests/unit/repositories/historicos-paginados-where.test.ts`.

const MENSAJERO_A: Actor = { usuarioId: "m-a", rol: "mensajero" };
const MENSAJERO_B: Actor = { usuarioId: "m-b", rol: "mensajero" };

/** Contraprueba por el lado del rechazo: este módulo es del mensajero y de nadie más. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

interface FilaConDueno extends CierrePasadoDTO {
  mensajeroId: string;
}

function fila(
  cierreId: string,
  mensajeroId: string,
  dia: number,
  estado: CierrePasadoDTO["estado"] = "aprobado",
): FilaConDueno {
  return {
    mensajeroId,
    cierreId,
    estado,
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    totales: { efectivo: "80.00", simpe: "0.00", transferencia: "0.00", general: "80.00" },
    totalPagoMensajero: "8.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: `2026-04-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  };
}

/**
 * Este listado NO filtra por estado: el mensajero ve TODOS sus cierres, incluido el `solicitado`
 * o `vencido` que le está bloqueando las guías. Por eso el almacén los mezcla.
 */
const ALMACEN: FilaConDueno[] = [
  fila("a-1", "m-a", 1),
  fila("a-2", "m-a", 2, "rechazado"),
  fila("a-3", "m-a", 3, "vencido"),
  fila("a-4", "m-a", 4),
  fila("a-5", "m-a", 5, "solicitado"),
  fila("b-1", "m-b", 11),
  fila("b-2", "m-b", 12),
];

function sinDueno(f: FilaConDueno): CierrePasadoDTO {
  const { mensajeroId, ...dto } = f;
  void mensajeroId; // el dueño es del ALMACÉN (lo usa el filtro), no del DTO que viaja
  return dto;
}

function porSolicitadoDesc(a: FilaConDueno, b: FilaConDueno): number {
  return b.solicitadoAt.localeCompare(a.solicitadoAt);
}

/**
 * Gestión del día CON evidencia fotográfica. Es la pieza que da valor al espía: sin gestiones con
 * `evidenciaStoragePath`, `listarCierreDia` tampoco firmaría y el `toEqual([])` del conjunto sería
 * un adorno (la anti-vacuidad del caso R9).
 */
function gestion(n: number): CierreGestionPendienteRow {
  // Feature 212/T9: `pagos` es obligatorio; `conPagos` lo deriva del par escalar (UNA linea).
  return conPagos({
    gestionId: `g-${n}`,
    ordenId: `o-${n}`,
    numGuia: n,
    numRemision: `R-${n}`,
    destinatario: `Destinatario ${n}`,
    direccion: null,
    zonaNombre: "Central",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Producto",
    tiendaNombre: "Tienda",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: `evidencias/g-${n}.jpg`, // el path CRUDO que `listarCierreDia` firma
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false,
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    causaIncidente: null,
    indemnizacion: null,
  });
}

const GESTIONES_DEL_DIA: CierreGestionPendienteRow[] = [gestion(1), gestion(2), gestion(3)];

function repoEnMemoria(filas: FilaConDueno[] = ALMACEN) {
  const llamadas: string[] = [];
  const mensajerosPedidos: string[] = [];

  const findCierresByMensajero = vi.fn(async (mensajeroId: string) => {
    llamadas.push("findCierresByMensajero");
    mensajerosPedidos.push(mensajeroId);
    return filas.filter((f) => f.mensajeroId === mensajeroId).sort(porSolicitadoDesc).map(sinDueno);
  });

  const findCierresByMensajeroPaginado = vi.fn(async (mensajeroId: string, rango: RangoPagina) => {
    llamadas.push("findCierresByMensajeroPaginado");
    mensajerosPedidos.push(mensajeroId);
    const conjunto = filas
      .filter((f) => f.mensajeroId === mensajeroId)
      .sort(porSolicitadoDesc)
      .map(sinDueno);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    findCierresByMensajero,
    findCierresByMensajeroPaginado,
    findGestionesPendientes: vi.fn(async () => {
      llamadas.push("findGestionesPendientes");
      return GESTIONES_DEL_DIA;
    }),
    contarOrdenesPendientesGestion: vi.fn(async () => {
      llamadas.push("contarOrdenesPendientesGestion");
      return 0;
    }),
    existeCierreSolicitado: vi.fn(async () => false),
    crearCierre: vi.fn(async () => "c-nuevo"),
    findGestionParaDeshacer: vi.fn(async () => null),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
  } as unknown as ICierreDiaRepository;

  return { repo, llamadas, mensajerosPedidos, findCierresByMensajero };
}

/**
 * Construye el servicio con un ESPÍA sobre el proveedor de URL firmadas: anota cada llamada y los
 * paths que recibe. Es lo único que distingue «el conjunto no firma» de «el conjunto firma y tira
 * las URL»: las dos producen exactamente el mismo archivo.
 */
function servicio(repo: ICierreDiaRepository) {
  const firmas: string[][] = [];
  const tarifa = { n: 0 };

  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => {
      tarifa.n += 1;
      return "z-central";
    }),
    findUsuarioVehiculoId: vi.fn(async () => {
      tarifa.n += 1;
      return null;
    }),
  } as unknown as IOrdenRepository;
  const createSignedUrls = vi.fn(async (paths: string[]) => {
    firmas.push([...paths]);
    return Object.fromEntries(paths.map((p) => [p, `https://firmada/${p}`]));
  });
  const signedUrls = { createSignedUrls } as unknown as ISignedUrlProvider;
  const tarifaRepo = {
    resolvePagoTarifa: vi.fn(async () => {
      tarifa.n += 1;
      return null;
    }),
  } as unknown as ITarifaZonaMensajeroRepository;

  return {
    svc: new CierreDiaService(repo, zonaRepo, ordenRepo, signedUrls, tarifaRepo),
    createSignedUrls,
    firmas,
    tarifa,
  };
}

/** Filas planas: para los volúmenes del tope, donde solo importa el número. */
function cierresPlanos(n: number): FilaConDueno[] {
  return Array.from({ length: n }, (_, i) => fila(`p-${i}`, "m-a", 1));
}

function input(extra: Record<string, unknown> = {}) {
  return listarCierresPasadosSchema.parse(extra);
}

const ids = (items: ReadonlyArray<{ cierreId: string }>) => items.map((c) => c.cierreId);

describe("CierreDiaService.listarCierresPasadosCompleto (feature 184, T C.1)", () => {
  it("el conjunto de la descarga no firma ninguna URL de evidencia (R9)", async () => {
    // (a) El camino del ARCHIVO: una consulta, la del listado, y CERO llamadas al firmador.
    const conjunto = repoEnMemoria();
    const c = servicio(conjunto.repo);
    const r = await c.svc.listarCierresPasadosCompleto(MENSAJERO_A);

    expect(c.createSignedUrls).toHaveBeenCalledTimes(0); // R9, el requisito de esta tanda
    expect(c.firmas).toEqual([]);
    // Prueba ESTRUCTURAL del mismo hecho, que falla por separado: las gestiones del día son de
    // donde salen los paths a firmar, y esa lectura ni se hace.
    expect(conjunto.llamadas).toEqual(["findCierresByMensajero"]);
    expect(conjunto.llamadas).not.toContain("findGestionesPendientes");
    expect(conjunto.llamadas).not.toContain("contarOrdenesPendientesGestion");
    // Ni una resolución de tarifa (zona + vehículo + resolver): el histórico no la necesita.
    expect(c.tarifa.n).toBe(0);
    expect(r.status).toBe("ok");

    // (b) Ni un dato de la otra mitad de esa pantalla viaja en el resultado: el archivo lleva
    // filas, no el detalle del día ni sus totales ni el gate de "Solicitar cierre".
    expect(r).not.toHaveProperty("grupos");
    expect(r).not.toHaveProperty("totales");
    expect(r).not.toHaveProperty("totalPagoMensajero");
    expect(r).not.toHaveProperty("puedesSolicitar");
    expect(r).not.toHaveProperty("tieneVencido");

    // (c) ANTI-VACUIDAD, y es la mitad que da valor a todo lo anterior: la relectura que este
    // método sustituye SÍ firma, y firma las evidencias de TODAS las gestiones del día. Sin esto,
    // un espía que no se disparase nunca dejaría el `toHaveBeenCalledTimes(0)` en un adorno.
    const compuesto = repoEnMemoria();
    const k = servicio(compuesto.repo);
    const rCompuesto = await k.svc.listarCierreDia(MENSAJERO_A);

    expect(rCompuesto.status).toBe("ok");
    expect(k.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(k.firmas).toEqual([
      ["evidencias/g-1.jpg", "evidencias/g-2.jpg", "evidencias/g-3.jpg"],
    ]);
    // Y las otras tres lecturas + la tarifa, que el conjunto tampoco paga.
    expect(compuesto.llamadas).toContain("findGestionesPendientes");
    expect(compuesto.llamadas).toContain("contarOrdenesPendientesGestion");
    expect(compuesto.llamadas.length).toBeGreaterThan(conjunto.llamadas.length);
    expect(k.tarifa.n).toBeGreaterThan(0);
  });

  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const caja = repoEnMemoria();
      const c = servicio(caja.repo);
      const r = await c.svc.listarCierresPasadosCompleto(actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      // Un conteo también es información: `forbidden` no lleva `total`.
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      expect(caja.llamadas, `rol ${actor.rol}`).toEqual([]); // el guard va ANTES de la base
      expect(c.createSignedUrls, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("el alcance sale del ACTOR, no de la entrada: cada mensajero descarga el SUYO (R4)", async () => {
    const a = repoEnMemoria();
    const deA = await servicio(a.repo).svc.listarCierresPasadosCompleto(MENSAJERO_A);
    const b = repoEnMemoria();
    const deB = await servicio(b.repo).svc.listarCierresPasadosCompleto(MENSAJERO_B);
    if (deA.status !== "ok" || deB.status !== "ok") throw new Error("no ok");

    expect(ids(deA.items)).toEqual(["a-5", "a-4", "a-3", "a-2", "a-1"]);
    // CONTRAPRUEBA: el otro mensajero ve LO SUYO. Sin este lado, un servicio que devolviera vacío
    // a todo el mundo pasaría la primera mitad.
    expect(ids(deB.items)).toEqual(["b-2", "b-1"]);
    expect(ids(deA.items).some((id) => id.startsWith("b-"))).toBe(false);
    expect(ids(deB.items).some((id) => id.startsWith("a-"))).toBe(false);

    // Y el id que llega al repositorio es el del ACTOR. Este es el único listado del Anexo A cuyo
    // alcance ES el propio usuario: no hay parámetro por el que pedir el histórico de otro, y el
    // método ni siquiera recibe entrada donde pudiera colarse.
    expect(a.mensajerosPedidos).toEqual(["m-a"]);
    expect(b.mensajerosPedidos).toEqual(["m-b"]);
    expect(CierreDiaService.prototype.listarCierresPasadosCompleto).toHaveLength(1); // solo `actor`
  });

  it("el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)", async () => {
    // La propiedad que impide que el archivo y la pantalla discrepen. Con `pageSize: 2` el
    // listado abarca tres páginas: si el conjunto ordenara o filtrara distinto, no coincidirían.
    const caja = repoEnMemoria();
    const { svc } = servicio(caja.repo);
    const conjunto = await svc.listarCierresPasadosCompleto(MENSAJERO_A);
    if (conjunto.status !== "ok") throw new Error("no ok");

    const recorrido: string[] = [];
    let totalPaginado = -1;
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarCierresPasadosPaginado(input({ page, pageSize: 2 }), MENSAJERO_A);
      if (p.status !== "ok") throw new Error("no ok");
      totalPaginado = p.total;
      if (p.items.length === 0) break;
      recorrido.push(...ids(p.items));
    }

    expect(ids(conjunto.items)).toEqual(recorrido);
    expect(conjunto.items.length).toBeGreaterThan(2); // el recorrido abarca varias páginas
    expect(conjunto.total).toBe(conjunto.items.length);
    expect(conjunto.total).toBe(totalPaginado);
  });

  it("las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero", async () => {
    // En una pantalla de dinero esto no es estilo. Dos proyecciones de la misma fila son dos
    // importes para el mismo cierre. Se afirma por IDENTIDAD: el servicio entrega lo que el
    // repositorio le dio, sin remapear.
    const caja = repoEnMemoria();
    const { svc } = servicio(caja.repo);
    const conjunto = await svc.listarCierresPasadosCompleto(MENSAJERO_A);
    const delRepo = await caja.findCierresByMensajero.mock.results[0]!.value;
    if (conjunto.status !== "ok") throw new Error("no ok");

    expect(conjunto.items).toHaveLength(delRepo.length);
    conjunto.items.forEach((f, i) => expect(f).toBe(delRepo[i]));

    // Y ninguna fila lleva URL de evidencia: el DTO del histórico no tiene ese campo, y esa es la
    // razón por la que firmarlas para producir el archivo era trabajo perdido (R9).
    for (const f of conjunto.items) {
      expect(f).not.toHaveProperty("evidenciaUrl");
      expect(f).not.toHaveProperty("evidenciaStoragePath");
    }
  });

  it("con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    // El borde EXACTO por abajo: `MAX_FILAS` cabe entero.
    const justo = repoEnMemoria(cierresPlanos(limite));
    const ok = await servicio(justo.repo).svc.listarCierresPasadosCompleto(MENSAJERO_A);
    if (ok.status !== "ok") throw new Error(`esperaba ok, vino ${ok.status}`);
    expect(ok.items).toHaveLength(limite);
    expect(ok.total).toBe(limite);

    // Y por arriba: con UNA más no hay archivo, ni truncado ni parcial. Solo los conteos.
    const pasado = repoEnMemoria(cierresPlanos(limite + 1));
    const excedido = await servicio(pasado.repo).svc.listarCierresPasadosCompleto(MENSAJERO_A);
    expect(excedido).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedido).not.toHaveProperty("items");
  });
});
