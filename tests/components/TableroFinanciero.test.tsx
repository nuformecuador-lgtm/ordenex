// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { TableroFinanciero } from "@/app/(app)/analitica/_components/financiero/TableroFinanciero";
import type { PanelFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import { formatearValor } from "@/components/private/analytics/formato";
import {
  IDS_FINANCIERAS_SERVIDAS,
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
  type ImporteAnalitico,
  type MetricaFinancieraId,
  type ResultadoFinanciero,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";

// Feature 132 (T4.1, T4.2) — los paneles del tablero financiero.
//
// Se afirma SIEMPRE sobre nombres accesibles y texto, nunca sobre nodos del SVG
// ni clases de recharts: en jsdom `ResponsiveContainer` renderiza vacio, asi que
// una asercion sobre el lienzo pasaria monte el componente su grafica o no
// (cobertura cero con luz verde). Los lienzos se sustituyen por dobles LOCALES,
// como ya hace `tests/components/AnalyticsGraficas.test.tsx`.

vi.mock("@/components/private/analytics/lienzo/BarrasLienzo", () => ({
  default: () => <div data-testid="lienzo-barras" />,
}));
vi.mock("@/components/private/analytics/lienzo/DonutLienzo", () => ({
  default: () => <div data-testid="lienzo-donut" />,
}));

const RANGO = { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" } as const;

/** Ids opacos de tienda, tal como los entrega el servicio: sin nombre legible (Q2). */
const CUBOS_TIENDA = [
  "tienda-aaa",
  "tienda-bbb",
  "tienda-ccc",
  "tienda-ddd",
  "tienda-eee",
  "tienda-fff",
] as const;

/**
 * El importe formateado, con los espacios normalizados como los normaliza
 * testing-library.
 *
 * `Intl` separa los miles con un espacio DURO (U+00A0) y el matcher colapsa ese
 * espacio a uno normal antes de comparar: sin esta normalizacion el esperado y el
 * DOM difieren en un byte invisible.
 */
function cifra(valor: number, unidad: "moneda" | "conteo"): string {
  return formatearValor(valor, unidad).replace(/\s+/g, " ");
}

function importe(bruto: string, neto: string): ImporteAnalitico {
  // La `moneda` del DTO no la lee nadie: el formato lo resuelve el paquete de la
  // 130 desde `lib/config/moneda.ts` (R25). Se rellena con un marcador para que
  // un panel que la leyera pintara basura visible en vez de acertar por azar.
  return { bruto, neto, moneda: "moneda-que-nadie-lee" };
}

function vistaSinFilas(id: string, total: ImporteAnalitico): VistaFinanciera {
  return {
    id,
    grano: "fecha",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    filas: [],
    total,
  };
}

function dtoKpi(
  metricaId: string,
  etiqueta: string,
  total: ImporteAnalitico,
  esAcumulado = false,
): ResultadoFinanciero {
  return {
    tipo: "vistas",
    metricaId,
    etiqueta,
    unidad: "moneda",
    rango: RANGO,
    esAcumulado,
    vistas: [vistaSinFilas(`${metricaId}__vista`, total)],
  };
}

const ETIQUETAS: Readonly<Record<MetricaFinancieraId, string>> = {
  ingreso_flete: "Ingreso por flete",
  ingreso_comision_cod: "Comisión por COD",
  ingreso_iva: "IVA facturado",
  egresos: "Egresos del período",
  cod_recaudado: "Recaudo COD",
  cuenta_por_pagar_tienda: "Cuenta por pagar a tiendas",
  cuenta_por_pagar_mensajero: "Devengado de mensajeros",
  conciliacion_cierres: "Conciliación de cierres",
};

/**
 * Un DTO por metrica SERVIDA, indexado por la constante del contrato.
 *
 * Que el registro sea exhaustivo sobre `MetricaFinancieraId` no es cosmetica: el
 * dia que la 127 sirva una novena metrica, este archivo deja de compilar en vez
 * de seguir en verde sin cubrirla.
 */
const DTOS: Readonly<Record<MetricaFinancieraId, ResultadoFinanciero>> = {
  ingreso_flete: dtoKpi("ingreso_flete", ETIQUETAS.ingreso_flete, importe("1000.00", "900.00")),
  ingreso_comision_cod: dtoKpi(
    "ingreso_comision_cod",
    ETIQUETAS.ingreso_comision_cod,
    importe("2000.00", "1800.00"),
  ),
  ingreso_iva: dtoKpi("ingreso_iva", ETIQUETAS.ingreso_iva, importe("3000.00", "2700.00")),
  egresos: dtoKpi("egresos", ETIQUETAS.egresos, importe("4000.00", "3600.00")),
  cod_recaudado: {
    tipo: "vistas",
    metricaId: "cod_recaudado",
    etiqueta: ETIQUETAS.cod_recaudado,
    unidad: "moneda",
    rango: RANGO,
    esAcumulado: false,
    vistas: [
      {
        id: VISTA_COD_RECAUDADO_POR_METODO,
        grano: "metodo_pago",
        fuente: "cierre_dia",
        sumableCon: [],
        filas: [
          { cubo: "efectivo", importe: importe("111.11", "101.11") },
          { cubo: "simpe", importe: importe("122.22", "102.22") },
          { cubo: "transferencia", importe: importe("133.33", "103.33") },
        ],
        total: importe("366.66", "311.11"),
      },
      {
        id: VISTA_COD_RECAUDADO_POR_TIENDA,
        grano: "tienda",
        fuente: "wallet_tienda_movimiento",
        sumableCon: [],
        // SEIS cubos con MAX_SERIES = 5: sin `agruparCola` la grafica LANZA
        // `SeriesExcedidasError` fuera de produccion, asi que este numero de
        // filas es parte de la prueba.
        filas: CUBOS_TIENDA.map((cubo, indice) => ({
          cubo,
          importe: importe(`${201 + indice}.00`, `${101 + indice}.00`),
        })),
        total: importe("1206.00", "722.22"),
      },
    ],
  },
  cuenta_por_pagar_tienda: {
    tipo: "vistas",
    metricaId: "cuenta_por_pagar_tienda",
    etiqueta: ETIQUETAS.cuenta_por_pagar_tienda,
    unidad: "moneda",
    rango: RANGO,
    esAcumulado: true,
    vistas: [
      {
        id: "cuenta_por_pagar_tienda__vista",
        grano: "tienda",
        fuente: "wallet_tienda_movimiento",
        sumableCon: [],
        filas: [
          { cubo: CUBOS_TIENDA[0], importe: importe("55.00", "50.00") },
          { cubo: CUBOS_TIENDA[1], importe: importe("66.00", "60.00") },
        ],
        total: importe("121.00", "110.00"),
      },
    ],
  },
  cuenta_por_pagar_mensajero: dtoKpi(
    "cuenta_por_pagar_mensajero",
    ETIQUETAS.cuenta_por_pagar_mensajero,
    importe("88.00", "80.00"),
    true,
  ),
  conciliacion_cierres: {
    tipo: "conciliacion",
    metricaId: "conciliacion_cierres",
    etiqueta: ETIQUETAS.conciliacion_cierres,
    unidad: "moneda",
    rango: RANGO,
    esAcumulado: false,
    conciliacion: {
      porEstado: [
        {
          nivel: "cierre_dia",
          estado: "aprobado",
          cantidad: 7,
          totales: {
            efectivo: "10.00",
            simpe: "11.00",
            transferencia: "12.00",
            general: "33.00",
          },
          fechadoPor: "resuelto_at",
        },
      ],
      cuadre: {
        cuadra: true,
        totalSnapshot: "33.00",
        totalLedger: "33.00",
        diferencia: "0.00",
        cierresDescuadrados: [],
      },
    },
  },
};

/** Los paneles "todo bien", derivados de la CONSTANTE del contrato y no de una lista local. */
function panelesOk(): readonly PanelFinanciero[] {
  return IDS_FINANCIERAS_SERVIDAS.map((id) => ({ estado: "ok", id, datos: DTOS[id] }));
}

/** Los mismos, con una metrica sustituida por otro estado de panel. */
function panelesCon(id: MetricaFinancieraId, reemplazo: PanelFinanciero): readonly PanelFinanciero[] {
  return panelesOk().map((panel) => (panel.id === id ? reemplazo : panel));
}

/** Nombres accesibles esperados: uno por VISTA (9 para 8 metricas). */
function nombresEsperados(ids: readonly MetricaFinancieraId[]): string[] {
  return ids.flatMap((id) => {
    const dto = DTOS[id];
    if (dto.tipo === "conciliacion") return [dto.etiqueta];
    if (dto.vistas.length === 1) return [dto.etiqueta];
    return dto.vistas.map((vista) => `${dto.etiqueta} · ${vista.id}`);
  });
}

/**
 * Las secciones de PANEL: las regiones que no viven dentro de otra region.
 *
 * Hace falta filtrar porque `GraficaMarco` emite su propia `<section aria-label>`
 * para la grafica; sin esto se contarian piezas internas como si fueran paneles.
 */
function seccionesDePanel(): HTMLElement[] {
  const regiones = screen.getAllByRole("region");
  return regiones.filter((region) => !regiones.some((otra) => otra !== region && otra.contains(region)));
}

function nombreDe(region: HTMLElement): string {
  return region.getAttribute("aria-label") ?? "";
}

afterEach(cleanup);

describe("Feature 132 (R13) — un panel por metrica servida, y ninguno de mas", () => {
  it("las secciones del tablero son exactamente las de IDS_FINANCIERAS_SERVIDAS (9 vistas para 8 metricas)", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombres = seccionesDePanel().map(nombreDe);
    expect(nombres.sort()).toEqual(nombresEsperados(IDS_FINANCIERAS_SERVIDAS).sort());
    expect(nombres).toHaveLength(9);
  });

  it("cada metrica servida tiene su seccion, encontrada por la etiqueta del DTO", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    for (const nombre of nombresEsperados(IDS_FINANCIERAS_SERVIDAS)) {
      expect(screen.getByRole("region", { name: nombre })).toBeInTheDocument();
    }
  });
});

describe("Feature 132 (R4) — el panel denegado NO se renderiza", () => {
  const DENEGADA: MetricaFinancieraId = "cuenta_por_pagar_tienda";

  it("no aparece por ninguna de sus etiquetas ni deja hueco", () => {
    render(
      <TableroFinanciero paneles={panelesCon(DENEGADA, { estado: "denegado", id: DENEGADA })} />,
    );

    expect(screen.queryByRole("region", { name: ETIQUETAS[DENEGADA] })).toBeNull();
    expect(screen.queryByText(ETIQUETAS[DENEGADA])).toBeNull();
    // Ni el id de la metrica: pintarlo anunciaria que el panel existe.
    expect(document.body.textContent ?? "").not.toContain(DENEGADA);
    // Ocho secciones en vez de nueve: no queda un hueco vacio en su lugar.
    expect(seccionesDePanel()).toHaveLength(8);
  });

  it("no muestra ningun motivo de denegacion", () => {
    render(
      <TableroFinanciero paneles={panelesCon(DENEGADA, { estado: "denegado", id: DENEGADA })} />,
    );

    expect(document.body.textContent ?? "").not.toMatch(
      /denegad|prohibid|permiso|acceso|forbidden/i,
    );
  });
});

describe("Feature 132 (R23) — el panel en error muestra el error y NI UNA CIFRA", () => {
  const FALLIDA: MetricaFinancieraId = "ingreso_iva";
  // Sin digitos a proposito: el mensaje real del borde lleva las fechas del
  // rango, y aqui se quiere poder afirmar que NINGUN digito de la seccion procede
  // del tablero.
  const MENSAJE = "No se pudo consultar la métrica.";

  it("emite role=alert con el mensaje saneado del borde", () => {
    render(
      <TableroFinanciero
        paneles={panelesCon(FALLIDA, { estado: "error", id: FALLIDA, mensaje: MENSAJE })}
      />,
    );

    const seccion = screen.getByRole("region", { name: FALLIDA });
    expect(within(seccion).getByRole("alert")).toHaveTextContent(MENSAJE);
  });

  it("no pinta cifras, ni ceros, ni el total de la metrica", () => {
    render(
      <TableroFinanciero
        paneles={panelesCon(FALLIDA, { estado: "error", id: FALLIDA, mensaje: MENSAJE })}
      />,
    );

    const seccion = screen.getByRole("region", { name: FALLIDA });
    expect(seccion.textContent ?? "").not.toMatch(/\d/);
    // Tampoco su etiqueta con un importe al lado: el panel no llego a traer DTO.
    expect(within(seccion).queryByText(cifra(0, "moneda"))).toBeNull();
  });
});

describe("Feature 132 (R17) — las dos vistas de cod_recaudado, separadas y sin total conjunto", () => {
  it("viven en secciones distintas con nombres accesibles distintos", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombres = nombresEsperados(["cod_recaudado"]);
    expect(nombres).toHaveLength(2);
    expect(nombres[0]).not.toBe(nombres[1]);

    const porMetodo = screen.getByRole("region", { name: nombres[0] ?? "" });
    const porTienda = screen.getByRole("region", { name: nombres[1] ?? "" });
    expect(porMetodo).not.toBe(porTienda);
    expect(porMetodo.contains(porTienda)).toBe(false);
    expect(porTienda.contains(porMetodo)).toBe(false);
  });

  it("no existe ninguna cifra que sea la suma de los dos totales", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    // 311.11 + 722.22: `sumableCon: []` dice que estas dos vistas NO suman entre
    // si (una es lo que el mensajero entrego, la otra lo acreditado a tiendas).
    const sumaProhibida = formatearValor(311.11 + 722.22, "moneda");
    expect(screen.queryByText(sumaProhibida)).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(sumaProhibida);
  });
});

describe("Feature 132 (R22) — el rango es el que devuelve el DTO", () => {
  it("cada panel muestra las fechas calendario del propio DTO, sin recalcularlas", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.ingreso_flete });
    expect(within(seccion).getByText(/2026-07-05/)).toBeInTheDocument();
    expect(within(seccion).getByText(/2026-08-03/)).toBeInTheDocument();
  });
});

describe("Feature 132 (R18) — 'saldo al corte' solo donde el DTO lo declara", () => {
  const ACUMULADAS: readonly MetricaFinancieraId[] = [
    "cuenta_por_pagar_tienda",
    "cuenta_por_pagar_mensajero",
  ];

  it("aparece en las DOS metricas cuyo DTO trae esAcumulado true", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    for (const id of ACUMULADAS) {
      const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
      expect(within(seccion).getByText(/saldo al corte/i)).toBeInTheDocument();
    }
  });

  it("NO aparece en las otras seis", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombresAcumulados = ACUMULADAS.map((id) => ETIQUETAS[id]);
    const otras = seccionesDePanel().filter(
      (region) => !nombresAcumulados.includes(nombreDe(region)),
    );

    expect(otras).toHaveLength(7); // 9 vistas - 2 acumuladas
    for (const region of otras) {
      expect(region.textContent ?? "").not.toMatch(/saldo al corte/i);
    }
  });
});

describe("Feature 132 (R16) — bruto y neto, los dos y distinguibles", () => {
  it("el panel de KPI muestra el neto como cifra y el bruto etiquetado aparte", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.ingreso_flete });
    const neto = cifra(900, "moneda");
    const bruto = cifra(1000, "moneda");

    expect(neto).not.toBe(bruto);
    expect(within(seccion).getByText(neto)).toBeInTheDocument();
    expect(within(seccion).getByText(`Bruto: ${bruto}`)).toBeInTheDocument();
  });

  it("el panel de tabla muestra el total del DTO en sus dos formas", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });
    expect(within(seccion).getByText("Total neto")).toBeInTheDocument();
    expect(within(seccion).getByText("Total bruto")).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(110, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(121, "moneda"))).toBeInTheDocument();
  });
});

describe("Feature 132 (R24, Q2) — el cubo de tienda se pinta crudo y la limitacion se dice en pantalla", () => {
  it("la tabla muestra el identificador interno tal cual, sin resolver el nombre", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombre = nombresEsperados(["cod_recaudado"])[1] ?? "";
    const seccion = screen.getByRole("region", { name: nombre });

    for (const cubo of CUBOS_TIENDA) {
      expect(within(seccion).getByText(cubo)).toBeInTheDocument();
    }
    // Los seis cubos siguen en la TABLA aunque en la grafica no quepan (6 filas
    // con MAX_SERIES = 5): la cola se agrupa en la alternativa textual de la
    // grafica en vez de lanzar o de recortar en silencio.
    expect(within(seccion).getAllByText(/, Otros: /).length).toBeGreaterThan(0);
  });

  it("la limitacion de los identificadores esta visible junto a los paneles por tienda", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const porTienda = screen.getByRole("region", {
      name: nombresEsperados(["cod_recaudado"])[1] ?? "",
    });
    const cuentaPorPagar = screen.getByRole("region", {
      name: ETIQUETAS.cuenta_por_pagar_tienda,
    });

    expect(
      within(porTienda).getByText(/identificadores internos de tienda/i),
    ).toBeInTheDocument();
    expect(
      within(cuentaPorPagar).getByText(/identificadores internos de tienda/i),
    ).toBeInTheDocument();
  });

  it("los paneles sin grano de tienda no muestran esa limitacion", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.ingreso_flete });
    expect(seccion.textContent ?? "").not.toMatch(/identificadores internos de tienda/i);
  });
});
