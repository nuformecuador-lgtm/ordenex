import { describe, it, expect, vi } from "vitest";

import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import type { ICierresAdminRepository } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IngresoOrdenexDTO } from "@/lib/interfaces/services/ICierreDiaService";
import { conPagos } from "@/tests/fixtures/cierre-pagos";
import { efectivoCubreDescuentos, paraLaCentral } from "@/lib/utils/ingreso-ordenex";

/**
 * 💰 FICHA 396 (D4) — **LAS TRES SUPERFICIES PASAN DE VERDAD POR `partesPorTienda`.**
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE ──────────────────────────────────────────────────────────
 *
 * **El composition root que no inyecta.** En este repo ya hubo 2 de 7 notificadores MUERTOS con
 * la suite entera en verde: el módulo los IMPORTABA, así que ninguna guardia de imports se
 * quejaba, pero nadie los PASABA. Un `import { partesPorTienda }` que nadie llama tiene
 * exactamente esa forma, y el desglose entra por **tres** sitios distintos:
 *
 *   1. el detalle del cierre del MENSAJERO      (`CierresAdminService.verCierreDetalle`)
 *   2. la bodega, nivel POR MENSAJERO           (`CierresBodegaAdminService`, por `cierre_dia`)
 *   3. la bodega, nivel AGREGADO                (`CierresBodegaAdminService`, el `flatMap`)
 *
 * ─── CÓMO LO COMPRUEBA, Y POR QUÉ ASÍ ─────────────────────────────────────────────────────
 *
 * Se alimentan **los tres** con EL MISMO conjunto de gestiones y se afirma que emiten **el
 * mismo desglose**, contra un literal escrito a mano. Es a la vez:
 *
 *   · la comprobación de D4 — si alguno de los tres dejara de llamar a `partesPorTienda`,
 *     devolvería una lista vacía y este archivo se pone rojo señalando cuál;
 *   · y la de **R22** — «la misma plata no puede leerse distinta según por qué pantalla se
 *     entre». No basta con que las tres importen la función: tienen que darle el argumento
 *     correcto y no reordenar ni recortar lo que reciben.
 *
 * El corpus tiene **una tienda CON rechazo y otra SIN él** a propósito: si las dos tuvieran el
 * flete por rechazo en cero, la diferencia entre «lo que se le paga» y «lo que gana» sería la
 * misma en las dos y una derivación con el subconjunto equivocado pasaría desapercibida.
 *
 * Los importes son el CONTRATO: están escritos a mano y no salen de llamar a la función bajo
 * prueba.
 */

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

/* -------------------------------------------------------------------------- */
/* El corpus COMPARTIDO por las tres superficies                              */
/* -------------------------------------------------------------------------- */

function ingreso(over: Partial<IngresoOrdenexDTO>): IngresoOrdenexDTO {
  return {
    montoCobrar: null,
    cobraComision: false,
    esCentral: false,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: null,
    ivaFlete: null,
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: null,
    ivaComisionCod: null,
    fleteConIva: null,
    fleteDevolucionConIva: null,
    comisionConIva: null,
    total: "0.00",
    tarifa: null,
    ...over,
  };
}

function gestionRow(overrides: Partial<CierreGestionPendienteRow>): CierreGestionPendienteRow {
  const { pagos, ...resto } = overrides;
  const fila: Omit<CierreGestionPendienteRow, "pagos"> = {
    gestionId: "g",
    ordenId: "o",
    fechaGestion: "2026-09-08",
    numGuia: 1,
    numRemision: "REM-1",
    destinatario: "Dest",
    direccion: null,
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaId: "t-norte",
    tiendaNombre: "Tienda Norte",
    resultado: "entregada",
    montoRecibido: null,
    metodoPago: null,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: "0.00",
    ingresoBodegaRechazo: "0.00",
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...resto,
  };
  return conPagos(fila, pagos);
}

/**
 * DOS tiendas: Norte recaudó 100.000,00 **y trajo un rechazo**; Sur recaudó 40.000,00 y no
 * trajo ninguno. Un solo mensajero, un solo día: así el conjunto de las tres superficies es
 * EXACTAMENTE el mismo y sus desgloses tienen que salir idénticos.
 */
const GESTIONES = (): CierreGestionPendienteRow[] => [
  gestionRow({
    gestionId: "g-norte-entrega",
    ordenId: "o-1",
    tiendaId: "t-norte",
    tiendaNombre: "Tienda Norte",
    resultado: "entregada",
    montoRecibido: "100000.00",
    metodoPago: "efectivo",
    ingresoOrdenex: ingreso({
      flete: "2500.00",
      ivaFlete: "325.00",
      fleteConIva: "2825.00",
      comisionCod: "3000.00",
      ivaComisionCod: "390.00",
      comisionConIva: "3390.00",
      total: "6215.00",
    }),
  }),
  gestionRow({
    gestionId: "g-norte-rechazo",
    ordenId: "o-2",
    tiendaId: "t-norte",
    tiendaNombre: "Tienda Norte",
    resultado: "rechazada",
    ingresoOrdenex: ingreso({
      fleteDevolucion: "1500.00",
      ivaFleteDevolucion: "195.00",
      fleteDevolucionConIva: "1695.00",
      total: "1695.00",
    }),
  }),
  gestionRow({
    gestionId: "g-sur-entrega",
    ordenId: "o-3",
    tiendaId: "t-sur",
    tiendaNombre: "Tienda Sur",
    resultado: "entregada",
    montoRecibido: "40000.00",
    metodoPago: "SINPE",
    ingresoOrdenex: ingreso({
      flete: "2000.00",
      ivaFlete: "260.00",
      fleteConIva: "2260.00",
      comisionCod: "1200.00",
      ivaComisionCod: "156.00",
      comisionConIva: "1356.00",
      total: "3616.00",
    }),
  }),
];

const TOTALES = {
  efectivo: "100000.00",
  simpe: "40000.00",
  transferencia: "0.00",
  general: "140000.00",
};
const PAGO_MENSAJERO = "3000.00";
const INGRESO_BODEGA = "500.00";

/**
 * EL DESGLOSE ESPERADO, ESCRITO A MANO. Es el CONTRATO, no la salida de `partesPorTienda`:
 * cambiarlo por lo que devuelva la función dejaría los tres casos siempre verdes.
 *
 *   Norte · recaudado 100.000,00 · se le paga 100.000,00 − 2.825,00 − 3.390,00 = 93.785,00
 *                                · gana      100.000,00 − (6.215,00 + 1.695,00) = 92.090,00
 *                                · diferencia = 1.695,00, su flete por rechazo
 *   Sur   · recaudado  40.000,00 · se le paga  40.000,00 − 2.260,00 − 1.356,00 = 36.384,00
 *                                · gana        40.000,00 − 3.616,00            = 36.384,00
 *                                · diferencia = 0,00, no trajo rechazos
 *
 * Ordenadas por lo que se les paga, de mayor a menor (R8).
 */
const DESGLOSE_ESPERADO = [
  {
    tiendaId: "t-norte",
    tiendaNombre: "Tienda Norte",
    recaudado: "100000.00",
    pagoTienda: "93785.00",
    ganaLaTienda: "92090.00",
  },
  {
    tiendaId: "t-sur",
    tiendaNombre: "Tienda Sur",
    recaudado: "40000.00",
    pagoTienda: "36384.00",
    ganaLaTienda: "36384.00",
  },
];

/* -------------------------------------------------------------------------- */
/* Los dos servicios, con dobles                                              */
/* -------------------------------------------------------------------------- */

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
  };
}

/** Superficie 1 — el detalle del cierre del MENSAJERO. */
async function desgloseDelDetalleDeMensajero() {
  const repo = {
    findCierreByIdEnAlcance: vi.fn(async () => ({
      sinGestion: [],
      sinGestionRegistrado: true,
      cierre: {
        cierreId: "c1",
        mensajeroId: "m1",
        mensajeroNombre: "Ana Mensajera",
        estado: "solicitado" as const,
        destinoTipo: "bodega_central" as const,
        destinoZonaId: "z-central",
        destinoZonaNombre: "Central",
        totales: TOTALES,
        totalPagoMensajero: PAGO_MENSAJERO,
        totalIngresoBodegaRechazos: INGRESO_BODEGA,
        solicitadoAt: "2026-09-08T10:00:00.000Z",
        resueltoAt: null,
        motivoRechazo: null,
      },
      gestiones: GESTIONES(),
    })),
  } as unknown as ICierresAdminRepository;

  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async () => "z-cartago"),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;

  const service = new CierresAdminService(repo, zonaRepo, ordenRepo, fakeSignedUrls(), {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  }, {
    sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
  });

  const r = await service.verCierreDetalle("c1", MAESTRO);
  if (r.status !== "ok") throw new Error("esperaba ok en el detalle del mensajero");
  return { partes: r.partesPorTienda, pagoTienda: r.pagoTienda, ganaLaTienda: r.ganaLaTienda };
}

/** Superficies 2 y 3 — la bodega, con UN solo `cierre_dia`, para que el conjunto sea el mismo. */
async function desglosesDelDetalleDeBodega() {
  const cabecera = {
    cierreBodegaId: "cb1",
    zonaId: "z-cartago",
    zonaNombre: "Cartago",
    solicitadoPorId: "adm-sat",
    solicitadoPorNombre: "Sara Satelite",
    estado: "solicitado" as const,
    totales: TOTALES,
    totalPagoMensajero: PAGO_MENSAJERO,
    totalIngresoBodegaRechazos: INGRESO_BODEGA,
    cantidadCierres: 1,
    solicitadoAt: "2026-09-08T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    // Los dos derivados llegan YA HECHOS del mapper del repositorio, igual que en producción:
    // el doble los produce con las MISMAS funciones puras, no con un literal que mentiría en
    // cuanto alguien cambiara los snapshots de arriba.
    paraLaCentral: paraLaCentral(TOTALES.general, PAGO_MENSAJERO, INGRESO_BODEGA),
    efectivoCubreDescuentos: efectivoCubreDescuentos(
      TOTALES.efectivo,
      PAGO_MENSAJERO,
      INGRESO_BODEGA,
    ),
  };

  const repo = {
    findCierreBodegaConDetalle: vi.fn(async () => ({
      cierre: cabecera,
      cierresDia: [
        {
          resumen: {
            cierreDiaId: "cd1",
            mensajeroId: "m1",
            mensajeroNombre: "Ana Mensajera",
            totales: TOTALES,
            totalPagoMensajero: PAGO_MENSAJERO,
            totalIngresoBodegaRechazos: INGRESO_BODEGA,
          },
          gestiones: GESTIONES(),
        },
      ],
    })),
  } as unknown as ICierresBodegaAdminRepository;

  const service = new CierresBodegaAdminService(repo, fakeSignedUrls());
  const r = await service.verCierreBodegaDetalle("cb1", MAESTRO);
  if (r.status !== "ok") throw new Error("esperaba ok en el detalle de bodega");
  return {
    porMensajero: r.cierres[0].partesPorTienda,
    agregado: r.partesPorTienda,
    pagoTiendaPorMensajero: r.cierres[0].pagoTienda,
    ganaLaTiendaPorMensajero: r.cierres[0].ganaLaTienda,
    pagoTiendaAgregado: r.pagoTienda,
    ganaLaTiendaAgregado: r.ganaLaTienda,
  };
}

/* -------------------------------------------------------------------------- */

describe("396/D4 — el desglose por tienda entra por LAS TRES superficies (R22)", () => {
  it("1 · el detalle del cierre del MENSAJERO lo emite", async () => {
    const { partes } = await desgloseDelDetalleDeMensajero();
    expect(partes).toEqual(DESGLOSE_ESPERADO);
  });

  it("2 · la bodega, nivel POR MENSAJERO, lo emite", async () => {
    const { porMensajero } = await desglosesDelDetalleDeBodega();
    expect(porMensajero).toEqual(DESGLOSE_ESPERADO);
  });

  it("3 · la bodega, nivel AGREGADO, lo emite", async () => {
    const { agregado } = await desglosesDelDetalleDeBodega();
    expect(agregado).toEqual(DESGLOSE_ESPERADO);
  });

  it("R22: con las MISMAS gestiones, las tres superficies dicen EXACTAMENTE lo mismo", async () => {
    // Aquí es donde muere «me acordé de dos de los tres»: no basta con que cada una emita algo,
    // tienen que emitir LO MISMO. Si una recibiera el conjunto equivocado —el agregado en el
    // nivel de mensajero, o al revés—, o reordenara, esta comparación cae.
    const mensajero = await desgloseDelDetalleDeMensajero();
    const bodega = await desglosesDelDetalleDeBodega();

    expect(mensajero.partes).toEqual(bodega.porMensajero);
    expect(mensajero.partes).toEqual(bodega.agregado);

    // Y las dos cifras que el desglose parte también coinciden en las tres, al céntimo: es el
    // mismo dinero mirado desde tres pantallas.
    expect(mensajero.pagoTienda).toBe("130169.00"); // 140.000,00 − 5.085,00 − 4.746,00
    expect(bodega.pagoTiendaPorMensajero).toBe("130169.00");
    expect(bodega.pagoTiendaAgregado).toBe("130169.00");
    expect(mensajero.ganaLaTienda).toBe("128474.00"); // 140.000,00 − 11.526,00
    expect(bodega.ganaLaTiendaPorMensajero).toBe("128474.00");
    expect(bodega.ganaLaTiendaAgregado).toBe("128474.00");
  });

  it("ninguna de las tres devuelve la lista vacía — que es la forma que tiene «nadie la llama»", async () => {
    // Un `import` sin llamada no rompe el typecheck ni ninguna guardia de imports: deja el campo
    // en `[]`. Este caso existe para que ese silencio sea imposible.
    const mensajero = await desgloseDelDetalleDeMensajero();
    const bodega = await desglosesDelDetalleDeBodega();

    expect(mensajero.partes).toHaveLength(2);
    expect(bodega.porMensajero).toHaveLength(2);
    expect(bodega.agregado).toHaveLength(2);
  });
});
