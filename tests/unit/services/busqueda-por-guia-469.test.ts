import { describe, it, expect, vi } from "vitest";

import type { FiltroCierresDondeAporta } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { IOrdenIdentificadaRepository } from "@/lib/interfaces/repositories/IOrdenIdentificadaRepository";
import { BusquedaPorGuiaService, gruposDeCriterio } from "@/lib/services/BusquedaPorGuiaService";
import type { OrdenIdentificada, SuperficieConGuia } from "@/lib/types/busqueda-por-guia";
import {
  FUENTE_CAJA,
  FUENTE_MENSAJERO,
  FUENTE_TIENDA,
  criterioDeFuente,
  type FuenteDeAporte,
} from "@/lib/utils/aporte-por-orden";
import { verDetalleDeMovimientoCompletoSchema, verDetalleDeMovimientoSchema } from "@/lib/types/detalle-movimiento";
import { ordenesDeFilaSchema } from "@/lib/types/estado-cuenta";

/**
 * FICHA 469 / T5 (y T2) — `BusquedaPorGuiaService` con dobles. Aqui se mide lo que un doble SI puede
 * medir: el modo (texto o guia), que los conceptos salen del CATALOGO (sin lista escrita), los pares de
 * una sola orden, la deduplicacion y que el `tiendaId` viaja. Que el `WHERE` acote de verdad se mide
 * contra Postgres en `tests/integration/db/busqueda-por-guia-469.test.ts`.
 */

const CAJA: SuperficieConGuia = { tipo: "caja" };
const TIENDA_T1: SuperficieConGuia = { tipo: "tienda", tiendaId: "t-1" };
const MENSAJERO: SuperficieConGuia = { tipo: "mensajero" };

function montar(opciones: {
  ordenes?: OrdenIdentificada[];
  cierres?: Array<{ cierreId: string; ordenId: string }>;
  gestiones?: string[];
  incidentes?: string[];
  /** Que devuelve `cierresDondeAporta` segun el criterio (por defecto: todos los pares casan). */
  casan?: (f: FiltroCierresDondeAporta) => Array<{ cierreId: string; ordenId: string }>;
}) {
  const ordenes: IOrdenIdentificadaRepository = {
    identificar: vi.fn(async () => opciones.ordenes ?? []),
    cierresDeOrdenes: vi.fn(async () => opciones.cierres ?? []),
    gestionesConCobroPorRechazo: vi.fn(async () => opciones.gestiones ?? []),
    incidentesDeOrdenes: vi.fn(async () => opciones.incidentes ?? []),
  };
  const cierresDondeAporta = vi.fn(async (f: FiltroCierresDondeAporta) =>
    opciones.casan === undefined ? [...f.pares] : opciones.casan(f),
  );
  return { ordenes, cierresDondeAporta, service: new BusquedaPorGuiaService(ordenes, { cierresDondeAporta }) };
}

const A: OrdenIdentificada = { ordenId: "o-a", numGuia: 46803, numRemision: "NA-107" };
const B: OrdenIdentificada = { ordenId: "o-b", numGuia: 46804, numRemision: "NA-107" };

/** Las categorias de un catalogo que tienen criterio (las que la busqueda por guia DEBE alcanzar). */
function conCriterio(catalogo: Readonly<Record<string, FuenteDeAporte>>): string[] {
  return Object.entries(catalogo)
    .filter(([, f]) => criterioDeFuente(f) !== null)
    .map(([c]) => c)
    .sort();
}

describe("469 — BusquedaPorGuiaService (dobles)", () => {
  it("R6: un termino que no identifica ninguna orden es busqueda de TEXTO y no consulta nada mas", async () => {
    const m = montar({});
    const r = await m.service.resolver({ termino: "transferencia", superficie: CAJA });
    expect(r).toEqual({ modo: "texto", termino: "transferencia" });
    expect(m.ordenes.cierresDeOrdenes).not.toHaveBeenCalled();
    expect(m.cierresDondeAporta).not.toHaveBeenCalled();
  });

  it("R2: si identifica una orden es busqueda por GUIA; sin cierres ni movimientos propios, pares vacios (R22)", async () => {
    const m = montar({ ordenes: [A] });
    const r = await m.service.resolver({ termino: "46803", superficie: CAJA });
    expect(r).toEqual({ modo: "guia", termino: "46803", ordenIds: ["o-a"], pares: [] });
  });

  it("R3/R4: la rama de la guia solo con cifras sin cero inicial que caben en int4; la remision siempre", async () => {
    const m = montar({});
    await m.service.identificar({ termino: "46803" });
    await m.service.identificar({ termino: "0123" }); // «0123» no es la guia 123 (comparacion completa)
    await m.service.identificar({ termino: "1234567890" }); // 10 cifras: no revienta, sin rama de guia
    await m.service.identificar({ termino: "  na-107  " }); // recortado
    const llamadas = vi.mocked(m.ordenes.identificar).mock.calls.map((c) => c[0]);
    expect(llamadas).toEqual([
      { termino: "46803", guia: 46803 },
      { termino: "0123" },
      { termino: "1234567890" },
      { termino: "na-107" },
    ]);
  });

  it("R5/R29: en la tienda (y /mi-wallet) el tiendaId viaja a TODAS las lecturas; en caja y mensajero no", async () => {
    const m = montar({ ordenes: [A], cierres: [{ cierreId: "c-1", ordenId: "o-a" }] });
    await m.service.resolver({ termino: "46803", superficie: TIENDA_T1 });
    expect(vi.mocked(m.ordenes.identificar).mock.calls[0][0]).toEqual({ termino: "46803", guia: 46803, tiendaId: "t-1" });
    expect(vi.mocked(m.ordenes.cierresDeOrdenes).mock.calls[0][0]).toEqual({ ordenIds: ["o-a"], tiendaId: "t-1" });
    expect(vi.mocked(m.ordenes.gestionesConCobroPorRechazo).mock.calls[0][0]).toEqual({ ordenIds: ["o-a"], tiendaId: "t-1" });
    for (const [f] of m.cierresDondeAporta.mock.calls) expect(f.tiendaId).toBe("t-1");

    for (const superficie of [CAJA, MENSAJERO]) {
      const n = montar({ ordenes: [A], cierres: [{ cierreId: "c-1", ordenId: "o-a" }] });
      await n.service.resolver({ termino: "46803", superficie });
      expect(vi.mocked(n.ordenes.identificar).mock.calls[0][0]).not.toHaveProperty("tiendaId");
      for (const [f] of n.cierresDondeAporta.mock.calls) expect(f.tiendaId).toBeUndefined();
    }
  });

  it("R12/R13/R34: los conceptos salen del CATALOGO de cada superficie; toda categoria con criterio entra y pago_efectivo no", () => {
    const casos: Array<[SuperficieConGuia, Readonly<Record<string, FuenteDeAporte>>]> = [
      [CAJA, FUENTE_CAJA],
      [TIENDA_T1, FUENTE_TIENDA],
      [MENSAJERO, FUENTE_MENSAJERO],
    ];
    for (const [superficie, catalogo] of casos) {
      const grupos = gruposDeCriterio(superficie);
      const categorias = grupos.flatMap((g) => g.categorias).sort();
      expect(categorias, superficie.tipo).toEqual(conCriterio(catalogo));
      // Cada categoria va con EL criterio de su catalogo (el mismo objeto que usa el detalle de esa fila).
      for (const g of grupos) {
        for (const c of g.categorias) expect(criterioDeFuente(catalogo[c])).toEqual(g.criterio);
      }
    }
    // Los cuatro de la 468 estan (R12) y el pago tomado del efectivo no (R13).
    const caja = gruposDeCriterio(CAJA).flatMap((g) => g.categorias);
    expect(caja).toEqual(expect.arrayContaining(["ingreso_cod_recaudado", "egreso_pago_mensajero", "egreso_indemnizacion"]));
    const mensajero = gruposDeCriterio(MENSAJERO).flatMap((g) => g.categorias);
    expect(mensajero).toEqual(["pago_devengado"]);
    expect(mensajero).not.toContain("pago_efectivo");
  });

  it("R8/R9: un par por categoria del grupo y SOLO de los cierres donde la orden casa con ESE criterio", async () => {
    const m = montar({
      ordenes: [A],
      cierres: [
        { cierreId: "c-1", ordenId: "o-a" },
        { cierreId: "c-2", ordenId: "o-a" },
      ],
      // En c-1 la orden solo aporta al pago al mensajero; en c-2 a todo.
      casan: (f) => f.pares.filter((p) => p.cierreId === "c-2" || f.criterio.exigePagoMensajero),
    });
    const r = await m.service.resolver({ termino: "46803", superficie: CAJA });
    if (r.modo !== "guia") throw new Error("se esperaba guia");
    const deC1 = r.pares.filter((p) => p.origenId === "c-1");
    expect(deC1).toEqual([{ origenTipo: "cierre_dia", origenId: "c-1", categoria: "egreso_pago_mensajero" }]);
    const deC2 = r.pares.filter((p) => p.origenId === "c-2").map((p) => ("categoria" in p ? p.categoria : "")).sort();
    expect(deC2).toEqual(conCriterio(FUENTE_CAJA));
    // Una consulta por criterio distinto, no una por categoria.
    expect(m.cierresDondeAporta).toHaveBeenCalledTimes(gruposDeCriterio(CAJA).length);
  });

  it("R14: el cobro por rechazo y la indemnizacion por incidente de la orden salen por su origen, sin categoria", async () => {
    const m = montar({ ordenes: [A], gestiones: ["g-1"], incidentes: ["i-1"] });
    const r = await m.service.resolver({ termino: "46803", superficie: CAJA });
    if (r.modo !== "guia") throw new Error("se esperaba guia");
    expect(r.pares).toEqual([
      { origenTipo: "gestion_orden", origenId: "g-1" },
      { origenTipo: "orden_incidente", origenId: "i-1" },
    ]);
  });

  it("R7/R15: dos ordenes identificadas que aportan al mismo movimiento dan UN solo par", async () => {
    const m = montar({
      ordenes: [A, B],
      cierres: [
        { cierreId: "c-1", ordenId: "o-a" },
        { cierreId: "c-1", ordenId: "o-b" },
      ],
    });
    const r = await m.service.resolver({ termino: "na-107", superficie: CAJA });
    if (r.modo !== "guia") throw new Error("se esperaba guia");
    expect(r.ordenIds).toEqual(["o-a", "o-b"]);
    const claves = r.pares.map((p) => JSON.stringify(p));
    expect(new Set(claves).size).toBe(claves.length);
    expect(r.pares).toHaveLength(conCriterio(FUENTE_CAJA).length);
  });
});

describe("469 / T2 — `resaltar` en las entradas del detalle (R33)", () => {
  const MOV = "11111111-2222-4333-8444-555555555555";
  it("mismo esquema que `q`: recortado, minimo 3 caracteres, y las entradas siguen .strict()", () => {
    expect(verDetalleDeMovimientoSchema.parse({ movimientoId: MOV, resaltar: " 46803 " }).resaltar).toBe("46803");
    expect(verDetalleDeMovimientoSchema.safeParse({ movimientoId: MOV, resaltar: "12" }).success).toBe(false);
    expect(verDetalleDeMovimientoSchema.safeParse({ movimientoId: MOV, otra: 1 }).success).toBe(false);
    const cuenta = { cuenta: { tipo: "tienda", id: MOV }, movimientoId: MOV };
    expect(ordenesDeFilaSchema.safeParse({ ...cuenta, resaltar: "12" }).success).toBe(false);
    expect(ordenesDeFilaSchema.parse({ ...cuenta, resaltar: "NA-107" }).resaltar).toBe("NA-107");
    // El archivo del detalle no destaca nada: `resaltar` ahi es una clave desconocida.
    expect(verDetalleDeMovimientoCompletoSchema.safeParse({ movimientoId: MOV, resaltar: "46803" }).success).toBe(false);
  });
});
