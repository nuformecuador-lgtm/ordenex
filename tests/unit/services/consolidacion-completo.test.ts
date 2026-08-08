import { describe, it, expect, vi } from "vitest";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import type {
  CierreBodegaResumenRow,
  CierreDiaConsolidableRow,
  ICierreBodegaRepository,
} from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { descargaConfig } from "@/lib/config/descarga";
import {
  listarCierresBodegaPaginadoSchema,
  listarConsolidablesSchema,
} from "@/lib/types/cierre-bodega";

// Feature 184 — Tanda B (T B.1) — los CONJUNTOS de los que salen los archivos de los listados 6
// y 7: `listarCierresBodegaSolicitadosCompleto` y `listarConsolidablesCompleto`.
//
// **Qué cierra esta tanda, y por qué el caso central de este archivo es un espía en cero.**
// Hasta hoy las dos pantallas producían su archivo releyendo `listarConsolidacion()`, que es el
// listado COMPUESTO de la consolidación: cuatro consultas (la zona, los consolidables, el
// contador de cierres pendientes y el histórico de la bodega), los cinco agregados de dinero y
// `repartirEfectivo`, que ordena TODOS los pagos individuales de la zona de menor a mayor. Es la
// relectura más cara del inventario, y cada una de las dos descargas usaba de ella UN campo.
//
// El archivo salía bien: por eso la deuda es invisible desde la pantalla y hace falta medirla
// aquí. Lo que R10 pide no es «que salgan las filas» —eso lo cumplía la relectura— sino que el
// camino de la descarga NO pase por el dinero. Se comprueba de dos formas que fallan por
// separado: (a) qué métodos del repositorio se llegan a llamar, y (b) un contador de LECTURAS
// sobre los propios campos de dinero de cada fila, que se dispara aunque el resultado se tire.
//
// AVISO vigente en todo el repo: este archivo usa un DOBLE de repositorio y NO ve la traducción a
// SQL. El `where`, el `orderBy`, cuántas consultas se emiten y qué NO llevan viven en
// `tests/unit/repositories/historicos-paginados-where.test.ts` (el conjunto de los cierres de
// bodega) y en `colas-paginadas-where.test.ts` (el de los consolidables).

const SAT_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SAT_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };
const SAT_SIN_ZONA: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
  "u-sat-sin": null,
};

/** El lado del rechazo. El `maestro` está aquí a propósito: ve los cierres de bodega por SU
 *  pantalla, no por la del satélite, y descargar no puede ser la puerta de atrás. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
];

/**
 * Convierte los campos de DINERO de una fila en propiedades vigiladas: siguen devolviendo lo
 * mismo, pero anotan cada lectura.
 *
 * Es la única forma de distinguir «el conjunto de la descarga no calcula agregados» de «el
 * conjunto de la descarga calcula agregados y los tira». La segunda produce el mismo archivo y
 * es justo el coste que esta tanda quita: `repartirEfectivo` ordena todos los pagos de la zona
 * y no deja rastro en el resultado.
 */
function vigilarDinero<T extends object>(fila: T, campos: Array<keyof T>, lecturas: string[]): T {
  const valores = { ...fila };
  for (const campo of campos) {
    Object.defineProperty(fila, campo, {
      enumerable: true,
      configurable: true,
      get() {
        lecturas.push(String(campo));
        return valores[campo];
      },
    });
  }
  return fila;
}

function consolidable(
  cierreDiaId: string,
  dinero: { efectivo: string; general: string; pago: string; ingreso: string },
  lecturas: string[],
): CierreDiaConsolidableRow {
  return vigilarDinero(
    {
      cierreDiaId,
      mensajeroId: `m-${cierreDiaId}`,
      mensajeroNombre: `Mensajero ${cierreDiaId}`,
      totales: {
        efectivo: dinero.efectivo,
        simpe: "0.00",
        transferencia: "0.00",
        general: dinero.general,
      },
      totalPagoMensajero: dinero.pago,
      totalIngresoBodegaRechazos: dinero.ingreso,
    },
    ["totales", "totalPagoMensajero", "totalIngresoBodegaRechazos"],
    lecturas,
  );
}

function cierreBodega(
  cierreBodegaId: string,
  zonaId: string,
  dia: number,
  lecturas: string[],
): CierreBodegaResumenRow {
  return vigilarDinero(
    {
      cierreBodegaId,
      zonaId,
      zonaNombre: `Zona ${zonaId}`,
      solicitadoPorId: `u-sat-${zonaId}`,
      solicitadoPorNombre: `Sat ${zonaId}`,
      estado: "aprobado" as const,
      totales: { efectivo: "300.00", simpe: "0.00", transferencia: "0.00", general: "300.00" },
      totalPagoMensajero: "30.00",
      totalIngresoBodegaRechazos: "0.00",
      cantidadCierres: 2,
      solicitadoAt: `2026-03-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
      resueltoAt: null,
      motivoRechazo: null,
    },
    ["totales", "totalPagoMensajero", "totalIngresoBodegaRechazos"],
    lecturas,
  );
}

/**
 * Repositorio EN MEMORIA de las DOS lecturas de la tanda, con los dos almacenes de la zona A y
 * los de su vecina, ya en el orden en que el repositorio real los devuelve (`solicitadoAt desc`,
 * afirmado en los `*-where.test.ts`).
 *
 * Los pagos de los consolidables son deliberadamente desiguales y uno de ellos (500.00) no cabe
 * en el efectivo de la zona: es lo que hace que `repartirEfectivo` tenga trabajo real que hacer
 * y que su ausencia en el camino del archivo sea medible.
 */
function repoEnMemoria(sobre?: {
  consolidables?: CierreDiaConsolidableRow[];
  cierres?: CierreBodegaResumenRow[];
}) {
  const llamadas: string[] = [];
  const lecturasDinero: string[] = [];
  const zonasPedidas: string[] = [];

  const CONSOLIDABLES: Record<string, CierreDiaConsolidableRow[]> = {
    "z-a":
      sobre?.consolidables ??
      [
        consolidable("ca-1", { efectivo: "100.00", general: "100.00", pago: "30.00", ingreso: "5.00" }, lecturasDinero),
        consolidable("ca-2", { efectivo: "200.00", general: "210.00", pago: "40.00", ingreso: "6.00" }, lecturasDinero),
        consolidable("ca-3", { efectivo: "50.00", general: "70.00", pago: "500.00", ingreso: "7.00" }, lecturasDinero),
        consolidable("ca-4", { efectivo: "25.00", general: "25.00", pago: "10.00", ingreso: "8.00" }, lecturasDinero),
        consolidable("ca-5", { efectivo: "5.00", general: "6.00", pago: "20.00", ingreso: "9.00" }, lecturasDinero),
      ],
    "z-b": [
      consolidable("cb-1", { efectivo: "1000.00", general: "1000.00", pago: "100.00", ingreso: "50.00" }, lecturasDinero),
      consolidable("cb-2", { efectivo: "2000.00", general: "2000.00", pago: "200.00", ingreso: "60.00" }, lecturasDinero),
    ],
  };

  const CIERRES: Record<string, CierreBodegaResumenRow[]> = {
    "z-a":
      sobre?.cierres ??
      [
        cierreBodega("ba-5", "z-a", 5, lecturasDinero),
        cierreBodega("ba-4", "z-a", 4, lecturasDinero),
        cierreBodega("ba-3", "z-a", 3, lecturasDinero),
        cierreBodega("ba-2", "z-a", 2, lecturasDinero),
        cierreBodega("ba-1", "z-a", 1, lecturasDinero),
      ],
    "z-b": [cierreBodega("bb-2", "z-b", 12, lecturasDinero), cierreBodega("bb-1", "z-b", 11, lecturasDinero)],
  };

  const findCierresDiaConsolidables = vi.fn(async (zonaId: string) => {
    llamadas.push("findCierresDiaConsolidables");
    zonasPedidas.push(zonaId);
    return CONSOLIDABLES[zonaId] ?? [];
  });

  const findCierresBodegaByZona = vi.fn(async (zonaId: string) => {
    llamadas.push("findCierresBodegaByZona");
    zonasPedidas.push(zonaId);
    return CIERRES[zonaId] ?? [];
  });

  const repo = {
    findCierresDiaConsolidables,
    findCierresBodegaByZona,
    findCierresDiaConsolidablesPaginado: vi.fn(async (zonaId: string, rango: RangoPagina) => {
      llamadas.push("findCierresDiaConsolidablesPaginado");
      const conjunto = CONSOLIDABLES[zonaId] ?? [];
      return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
    }),
    findCierresBodegaByZonaPaginado: vi.fn(async (zonaId: string, rango: RangoPagina) => {
      llamadas.push("findCierresBodegaByZonaPaginado");
      const conjunto = CIERRES[zonaId] ?? [];
      return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
    }),
    contarCierresDiaSolicitados: vi.fn(async () => {
      llamadas.push("contarCierresDiaSolicitados");
      return 0;
    }),
    existeCierreBodegaSolicitado: vi.fn(async () => false),
    crearCierreBodega: vi.fn(async () => "cb-nuevo"),
  } as unknown as ICierreBodegaRepository;

  return {
    repo,
    llamadas,
    lecturasDinero,
    zonasPedidas,
    findCierresDiaConsolidables,
    findCierresBodegaByZona,
  };
}

function servicio(repo: ICierreBodegaRepository) {
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => ZONA_POR_USUARIO[usuarioId] ?? null),
  } as unknown as IOrdenRepository;
  return new CierreBodegaService(repo, ordenRepo);
}

/** Filas planas, sin propiedades vigiladas: para los volúmenes del tope, donde solo importa el número. */
function consolidablesPlanos(n: number): CierreDiaConsolidableRow[] {
  return Array.from({ length: n }, (_, i) => ({
    cierreDiaId: `c-${i}`,
    mensajeroId: `m-${i}`,
    mensajeroNombre: `Mensajero ${i}`,
    totales: { efectivo: "1.00", simpe: "0.00", transferencia: "0.00", general: "1.00" },
    totalPagoMensajero: "1.00",
    totalIngresoBodegaRechazos: "0.00",
  }));
}

function cierresPlanos(n: number): CierreBodegaResumenRow[] {
  return Array.from({ length: n }, (_, i) => ({
    cierreBodegaId: `b-${i}`,
    zonaId: "z-a",
    zonaNombre: "Zona z-a",
    solicitadoPorId: "u-sat-a",
    solicitadoPorNombre: "Sat A",
    estado: "aprobado" as const,
    totales: { efectivo: "1.00", simpe: "0.00", transferencia: "0.00", general: "1.00" },
    totalPagoMensajero: "1.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 1,
    solicitadoAt: "2026-03-01T00:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  }));
}

const idsCierres = (items: ReadonlyArray<{ cierreBodegaId: string }>) =>
  items.map((c) => c.cierreBodegaId);
const idsConsolidables = (items: ReadonlyArray<{ cierreDiaId: string }>) =>
  items.map((c) => c.cierreDiaId);

describe("CierreBodegaService — los conjuntos de la descarga (feature 184, T B.1)", () => {
  it("el conjunto de la descarga no calcula agregados ni reparto de efectivo (R10)", async () => {
    // (a) «Cierres de bodega solicitados»: DOS lecturas —la zona y su listado— y ni una más.
    // Los cinco agregados y el reparto salen todos de `findCierresDiaConsolidables`; que no se
    // llame es la prueba estructural de que no se pueden estar calculando.
    const seis = repoEnMemoria();
    const rSeis = await servicio(seis.repo).listarCierresBodegaSolicitadosCompleto(SAT_A);
    const dineroSeis = [...seis.lecturasDinero];

    expect(seis.llamadas).toEqual(["findCierresBodegaByZona"]);
    expect(seis.llamadas).not.toContain("findCierresDiaConsolidables");
    expect(seis.llamadas).not.toContain("contarCierresDiaSolicitados");
    // Y el espía de dinero, en CERO: ni un campo de importe se llegó a leer.
    expect(dineroSeis).toEqual([]);

    // (b) «Cierres del día a consolidar»: lee el MISMO conjunto sobre el que la cabecera calcula
    // sus cinco números, y aun así no lee ni un importe. Aquí el espía es lo único que separa
    // «devuelve las filas» de «devuelve las filas y de paso reparte el efectivo».
    const siete = repoEnMemoria();
    const rSiete = await servicio(siete.repo).listarConsolidablesCompleto(SAT_A);
    const dineroSiete = [...siete.lecturasDinero];

    expect(siete.llamadas).toEqual(["findCierresDiaConsolidables"]);
    expect(siete.llamadas).not.toContain("findCierresBodegaByZona");
    expect(siete.llamadas).not.toContain("contarCierresDiaSolicitados");
    expect(dineroSiete).toEqual([]);

    // (c) Ni un agregado viaja en el resultado: el archivo lleva filas, no totales.
    for (const [etiqueta, r] of [["6", rSeis], ["7", rSiete]] as const) {
      expect(r.status, `listado ${etiqueta}`).toBe("ok");
      expect(r, `listado ${etiqueta}`).not.toHaveProperty("totalesAgregados");
      expect(r, `listado ${etiqueta}`).not.toHaveProperty("totalPagoMensajeroAgregado");
      expect(r, `listado ${etiqueta}`).not.toHaveProperty("totalIngresoBodegaRechazosAgregado");
      expect(r, `listado ${etiqueta}`).not.toHaveProperty("totalNetoAgregado");
      expect(r, `listado ${etiqueta}`).not.toHaveProperty("totalCentralDebeAgregado");
      expect(r, `listado ${etiqueta}`).not.toHaveProperty("puedesSolicitar");
    }

    // (d) ANTI-VACUIDAD, y es la mitad que da valor a todo lo anterior: la relectura que estos
    // dos métodos sustituyen SÍ hace las cuatro consultas y SÍ lee el dinero de cada fila. Sin
    // esto, un espía que no se disparase nunca dejaría los cinco `toEqual([])` de arriba en un
    // adorno.
    const compuesto = repoEnMemoria();
    const rCompuesto = await servicio(compuesto.repo).listarConsolidacion(SAT_A);
    expect(compuesto.llamadas).toEqual([
      "findCierresDiaConsolidables",
      "contarCierresDiaSolicitados",
      "findCierresBodegaByZona",
    ]);
    expect(compuesto.lecturasDinero.length).toBeGreaterThan(0);
    // Y lee el pago de cada mensajero DOS veces: una para sumarlo y otra para repartirlo. Ese
    // segundo pase es `repartirEfectivo`, exactamente el coste que la descarga deja de pagar.
    const pagosLeidos = compuesto.lecturasDinero.filter((c) => c === "totalPagoMensajero").length;
    expect(pagosLeidos).toBe(10); // 5 consolidables × (sumPagoMensajero + repartirEfectivo)
    expect(rCompuesto.status).toBe("ok");
  });

  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const seis = repoEnMemoria();
      const rSeis = await servicio(seis.repo).listarCierresBodegaSolicitadosCompleto(actor);
      const siete = repoEnMemoria();
      const rSiete = await servicio(siete.repo).listarConsolidablesCompleto(actor);

      for (const [etiqueta, r, caja] of [
        ["6", rSeis, seis],
        ["7", rSiete, siete],
      ] as const) {
        expect(r, `${etiqueta}/${actor.rol}`).toEqual({ status: "forbidden" });
        expect(r, `${etiqueta}/${actor.rol}`).not.toHaveProperty("items");
        // Un conteo también es información: `forbidden` no lleva `total`.
        expect(r, `${etiqueta}/${actor.rol}`).not.toHaveProperty("total");
        // Ni la zona se resuelve: el guard va delante de todo.
        expect(caja.llamadas, `${etiqueta}/${actor.rol}`).toEqual([]);
        expect(caja.lecturasDinero, `${etiqueta}/${actor.rol}`).toEqual([]);
      }
    }
  });

  it("el alcance sale del ACTOR, no de la entrada: cada bodega descarga la SUYA (R4)", async () => {
    const a = repoEnMemoria();
    const seisDeA = await servicio(a.repo).listarCierresBodegaSolicitadosCompleto(SAT_A);
    const b = repoEnMemoria();
    const seisDeB = await servicio(b.repo).listarCierresBodegaSolicitadosCompleto(SAT_B);
    if (seisDeA.status !== "ok" || seisDeB.status !== "ok") throw new Error("no ok");

    expect(idsCierres(seisDeA.items)).toEqual(["ba-5", "ba-4", "ba-3", "ba-2", "ba-1"]);
    // CONTRAPRUEBA: la vecina ve LO SUYO. Sin este lado, un servicio que devolviera vacío a todo
    // el mundo pasaría la primera mitad.
    expect(idsCierres(seisDeB.items)).toEqual(["bb-2", "bb-1"]);
    expect(idsCierres(seisDeA.items).some((id) => id.startsWith("bb-"))).toBe(false);

    const c = repoEnMemoria();
    const sieteDeA = await servicio(c.repo).listarConsolidablesCompleto(SAT_A);
    const d = repoEnMemoria();
    const sieteDeB = await servicio(d.repo).listarConsolidablesCompleto(SAT_B);
    if (sieteDeA.status !== "ok" || sieteDeB.status !== "ok") throw new Error("no ok");

    expect(idsConsolidables(sieteDeA.items)).toEqual(["ca-1", "ca-2", "ca-3", "ca-4", "ca-5"]);
    expect(idsConsolidables(sieteDeB.items)).toEqual(["cb-1", "cb-2"]);

    // Y la zona que llega al repositorio es la del USUARIO, resuelta server-side: es un dato del
    // actor, no un parámetro. Aquí no hay ninguna entrada por la que pudiera colarse otra.
    expect(a.zonasPedidas).toEqual(["z-a"]);
    expect(b.zonasPedidas).toEqual(["z-b"]);
    expect(c.zonasPedidas).toEqual(["z-a"]);
    expect(d.zonasPedidas).toEqual(["z-b"]);
  });

  it("el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)", async () => {
    // La propiedad que impide que el archivo y la pantalla discrepen. Con `pageSize: 2` los dos
    // listados abarcan tres y dos páginas: si el conjunto ordenara o filtrara distinto, el
    // recorrido no coincidiría.
    const seis = repoEnMemoria();
    const svcSeis = servicio(seis.repo);
    const conjuntoSeis = await svcSeis.listarCierresBodegaSolicitadosCompleto(SAT_A);
    if (conjuntoSeis.status !== "ok") throw new Error("no ok");

    const recorridoSeis: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svcSeis.listarCierresBodegaSolicitadosPaginado(
        listarCierresBodegaPaginadoSchema.parse({ page, pageSize: 2 }),
        SAT_A,
      );
      if (p.status !== "ok" || p.items.length === 0) break;
      recorridoSeis.push(...idsCierres(p.items));
    }
    expect(idsCierres(conjuntoSeis.items)).toEqual(recorridoSeis);
    expect(conjuntoSeis.total).toBe(conjuntoSeis.items.length);
    expect(conjuntoSeis.items.length).toBeGreaterThan(2); // el recorrido abarca varias páginas

    const siete = repoEnMemoria();
    const svcSiete = servicio(siete.repo);
    const conjuntoSiete = await svcSiete.listarConsolidablesCompleto(SAT_A);
    if (conjuntoSiete.status !== "ok") throw new Error("no ok");

    const recorridoSiete: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svcSiete.listarConsolidablesPaginado(
        listarConsolidablesSchema.parse({ page, pageSize: 2 }),
        SAT_A,
      );
      if (p.status !== "ok" || p.items.length === 0) break;
      recorridoSiete.push(...idsConsolidables(p.items));
    }
    expect(idsConsolidables(conjuntoSiete.items)).toEqual(recorridoSiete);
    expect(conjuntoSiete.total).toBe(conjuntoSiete.items.length);
    expect(conjuntoSiete.items.length).toBeGreaterThan(2);
  });

  it("las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero", async () => {
    // En una pantalla de dinero esto no es estilo. Dos proyecciones de la misma fila son dos
    // importes para el mismo cierre, y el que decide si se cierra la bodega es el de la pantalla.
    // Se afirma por IDENTIDAD: el servicio entrega lo que el repositorio le dio, sin remapear.
    const seis = repoEnMemoria();
    const svcSeis = servicio(seis.repo);
    const conjuntoSeis = await svcSeis.listarCierresBodegaSolicitadosCompleto(SAT_A);
    const delRepoSeis = await seis.findCierresBodegaByZona.mock.results[0]!.value;
    if (conjuntoSeis.status !== "ok") throw new Error("no ok");
    expect(conjuntoSeis.items).toHaveLength(delRepoSeis.length);
    conjuntoSeis.items.forEach((fila, i) => expect(fila).toBe(delRepoSeis[i]));

    const siete = repoEnMemoria();
    const svcSiete = servicio(siete.repo);
    const conjuntoSiete = await svcSiete.listarConsolidablesCompleto(SAT_A);
    const delRepoSiete = await siete.findCierresDiaConsolidables.mock.results[0]!.value;
    if (conjuntoSiete.status !== "ok") throw new Error("no ok");
    expect(conjuntoSiete.items).toHaveLength(delRepoSiete.length);
    conjuntoSiete.items.forEach((fila, i) => expect(fila).toBe(delRepoSiete[i]));

    // Y son las MISMAS filas que la página entrega para el mismo actor (identidad, otra vez).
    const pagina = await svcSiete.listarConsolidablesPaginado(
      listarConsolidablesSchema.parse({ page: 1, pageSize: 2 }),
      SAT_A,
    );
    if (pagina.status !== "ok") throw new Error("no ok");
    pagina.items.forEach((fila, i) => expect(fila).toBe(conjuntoSiete.items[i]));
  });

  it("con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    // El borde EXACTO por abajo: `MAX_FILAS` cabe entero.
    const justoSeis = repoEnMemoria({ cierres: cierresPlanos(limite) });
    const okSeis = await servicio(justoSeis.repo).listarCierresBodegaSolicitadosCompleto(SAT_A);
    if (okSeis.status !== "ok") throw new Error(`esperaba ok, vino ${okSeis.status}`);
    expect(okSeis.items).toHaveLength(limite);
    expect(okSeis.total).toBe(limite);

    // Y por arriba: con UNA más no hay archivo, ni truncado ni parcial. Solo los conteos.
    const pasadoSeis = repoEnMemoria({ cierres: cierresPlanos(limite + 1) });
    const excedidoSeis =
      await servicio(pasadoSeis.repo).listarCierresBodegaSolicitadosCompleto(SAT_A);
    expect(excedidoSeis).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidoSeis).not.toHaveProperty("items");

    const justoSiete = repoEnMemoria({ consolidables: consolidablesPlanos(limite) });
    const okSiete = await servicio(justoSiete.repo).listarConsolidablesCompleto(SAT_A);
    if (okSiete.status !== "ok") throw new Error(`esperaba ok, vino ${okSiete.status}`);
    expect(okSiete.items).toHaveLength(limite);
    expect(okSiete.total).toBe(limite);

    const pasadoSiete = repoEnMemoria({ consolidables: consolidablesPlanos(limite + 1) });
    const excedidoSiete = await servicio(pasadoSiete.repo).listarConsolidablesCompleto(SAT_A);
    expect(excedidoSiete).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedidoSiete).not.toHaveProperty("items");
  });

  it("el adminSatelite SIN zona recibe un conjunto vacío y no consulta el listado", async () => {
    const seis = repoEnMemoria();
    const rSeis = await servicio(seis.repo).listarCierresBodegaSolicitadosCompleto(SAT_SIN_ZONA);
    const siete = repoEnMemoria();
    const rSiete = await servicio(siete.repo).listarConsolidablesCompleto(SAT_SIN_ZONA);

    // Vacío y `ok`, no `forbidden`: el rol tiene acceso al módulo, lo que no tiene es alcance.
    // Es lo mismo que devuelve hoy `listarConsolidacion` para ese actor.
    expect(rSeis).toEqual({ status: "ok", items: [], total: 0 });
    expect(rSiete).toEqual({ status: "ok", items: [], total: 0 });
    expect(seis.llamadas).toEqual([]);
    expect(siete.llamadas).toEqual([]);
  });
});
