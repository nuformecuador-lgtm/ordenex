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
  type ResultadoFinancieroVistas,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import {
  importeConNeto,
  importeSoloBruto,
  sinNeto,
} from "@/tests/fixtures/importe-analitico";

// Feature 132 (T4.1, T4.2) — los paneles del tablero financiero.
//
// Se afirma SIEMPRE sobre nombres accesibles y texto, nunca sobre nodos del SVG
// ni clases de recharts: en jsdom `ResponsiveContainer` renderiza vacio, asi que
// una asercion sobre el lienzo pasaria monte el componente su grafica o no
// (cobertura cero con luz verde). Los lienzos se sustituyen por dobles LOCALES,
// como ya hace `tests/components/AnalyticsGraficas.test.tsx`.
//
// Feature 183 ⟨D12⟩ (humano, 2026-08-04, `progress/decision_183.md`) — las fixtures
// llevan ahora la FORMA del importe, y no todas la misma: `ingreso_flete`,
// `ingreso_comision_cod` e `ingreso_iva` publican `solo_bruto` y las otras siete
// `bruto_y_neto`, exactamente como el servicio (lo fija
// `tests/unit/analytics/financiera-forma-importe.guardia.test.ts`). Esa asimetria NO es
// un detalle de fixture: es lo que hace que los casos de R19 y de R20 midan cosas
// distintas sobre el MISMO tablero.

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

// Los dos constructores de importe salen del helper compartido
// (`tests/fixtures/importe-analitico.ts`) y se escriben EN CADA SITIO, sin alias: cual
// forma lleva cada metrica es lo que estos casos miden, y esconderlo tras un constructor
// neutro dejaria la asimetria invisible en la revision. La `moneda` del DTO no la lee
// nadie —el formato lo resuelve el paquete de la 130 desde `lib/config/moneda.ts`
// (R25)— y el helper la rellena con un marcador para que un panel que la leyera pintara
// basura visible en vez de acertar por azar.

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
  // Feature 173 ⟨P4⟩ — las dos de la caja en modo tesoreria. Las etiquetas son las
  // del catalogo (`lib/analytics/metrics.ts`), como las otras ocho.
  dinero_en_caja: "Dinero en caja",
  ganancia_ordenex: "Ganancia de Ordenex",
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
 *
 * Y es exactamente lo que paso: la 173 ⟨P4⟩ sirvio la novena y la decima
 * (`dinero_en_caja`, `ganancia_ordenex`) y el typecheck lo caza aqui (TS2739).
 */
const DTOS: Readonly<Record<MetricaFinancieraId, ResultadoFinanciero>> = {
  // Feature 183 ⟨D12⟩ — LAS TRES de lista homogenea de prefijo publican `solo_bruto`.
  // Antes de la 183 esta fixture les daba un neto distinto del bruto (900 / 1800 / 2700),
  // que era una combinacion IMPOSIBLE: con el CHECK categoria↔tipo de la 173 su
  // `Σ egreso` es cero, luego su neto solo podia valer `+bruto`. La fixture no se
  // "arregla" igualando las cifras: se le retira el campo, que es lo que el contrato
  // hizo.
  ingreso_flete: dtoKpi("ingreso_flete", ETIQUETAS.ingreso_flete, importeSoloBruto("1000.00")),
  ingreso_comision_cod: dtoKpi(
    "ingreso_comision_cod",
    ETIQUETAS.ingreso_comision_cod,
    importeSoloBruto("2000.00"),
  ),
  ingreso_iva: dtoKpi("ingreso_iva", ETIQUETAS.ingreso_iva, importeSoloBruto("3000.00")),
  // `egresos` CONSERVA el neto ⟨D12⟩ y lo publica NEGATIVO (P3, humana 2026-08-04: una
  // salida de caja se publica con su signo). El neto no es `−bruto` a proposito: con las
  // dos cifras ligadas, un panel que pintara la misma dos veces pasaria igual.
  egresos: dtoKpi("egresos", ETIQUETAS.egresos, importeConNeto("4000.00", "-3600.00")),
  // Feature 173 ⟨P4⟩ — `deTesoreria` las sirve con la MISMA forma que las cuatro de
  // arriba: una vista sola, `grano: "fecha"`, `sumableCon: []`, SIN filas (el
  // repositorio agrega la ventana entera) y `esAcumulado: false` — no son un saldo
  // al corte, son el movimiento del rango. Por eso van con el mismo helper que sus
  // vecinas y con importes que continuan su serie.
  dinero_en_caja: dtoKpi("dinero_en_caja", ETIQUETAS.dinero_en_caja, importeConNeto("5000.00", "4500.00")),
  ganancia_ordenex: dtoKpi(
    "ganancia_ordenex",
    ETIQUETAS.ganancia_ordenex,
    importeConNeto("6000.00", "5400.00"),
  ),
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
          { cubo: "efectivo", importe: importeConNeto("111.11", "101.11") },
          { cubo: "simpe", importe: importeConNeto("122.22", "102.22") },
          { cubo: "transferencia", importe: importeConNeto("133.33", "103.33") },
        ],
        total: importeConNeto("366.66", "311.11"),
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
          importe: importeConNeto(`${201 + indice}.00`, `${101 + indice}.00`),
        })),
        total: importeConNeto("1206.00", "722.22"),
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
          { cubo: CUBOS_TIENDA[0], importe: importeConNeto("55.00", "50.00") },
          { cubo: CUBOS_TIENDA[1], importe: importeConNeto("66.00", "60.00") },
        ],
        // OJO: el total NO cuadra con la suma de las filas (55+66 = 121 bruto,
        // 50+60 = 110 neto) Y ESO ES A PROPOSITO. NO LO "ARREGLES".
        //
        // EL DESCUADRE ES ARTIFICIAL, no realista. En produccion el total SI
        // coincide con la suma de las filas, y coincide POR CONSTRUCCION:
        // `deSaldoDeTiendas` saca las filas y el total del MISMO array
        // (`AnaliticaFinancieraService.ts:284-310`), y el neto lo produce
        // `derivarSaldoTienda`, que es una resta sin recorte ni tope
        // (`lib/utils/saldo-tienda.ts:11-31`) y por tanto aditiva:
        // Σ(creditos−debitos por tienda) = Σcreditos − Σdebitos. Lo mismo vale
        // para las dos vistas de `cod_recaudado` (`:233-276`). Que la metrica sea
        // `esAcumulado: true` NO cambia nada de esto: cambia el rango que se
        // agrega, no la relacion entre los cubos y su total.
        //
        // Entonces, ¿por que se descuadra? Porque es la UNICA forma de que el
        // test discrimine. Mientras el total del DTO coincida con la suma de las
        // filas, «leo `vista.total`» y «lo calculo sumando las filas» pintan el
        // MISMO numero, y ninguna asercion puede separarlos —justamente la
        // distincion que R14 exige, porque R14 habla de DE DONDE sale la cifra,
        // no de si dos cifras resultan iguales—. Medido: con los numeros
        // cuadrados, derivar el total dejaba el perimetro entero en verde
        // (mutacion M2 del reviewer); con estos, pone rojo el caso de R14.
        //
        // Asi que si vienes de leer el servicio y concluyes que estos numeros
        // "deberian" cuadrar: tienes razon sobre PRODUCCION y es irrelevante
        // AQUI. Esto es una fixture y su trabajo es distinguir, no parecerse.
        // Cuadrarla deja R14 sin red.
        total: importeConNeto("140.00", "128.00"),
      },
    ],
  },
  cuenta_por_pagar_mensajero: dtoKpi(
    "cuenta_por_pagar_mensajero",
    ETIQUETAS.cuenta_por_pagar_mensajero,
    importeConNeto("88.00", "80.00"),
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

/** Nombres accesibles esperados: uno por VISTA (11 para 10 metricas desde la 173). */
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
  it("las secciones del tablero son exactamente las de IDS_FINANCIERAS_SERVIDAS (11 vistas para 10 metricas)", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombres = seccionesDePanel().map(nombreDe);
    expect(nombres.sort()).toEqual(nombresEsperados(IDS_FINANCIERAS_SERVIDAS).sort());
    // 9 hasta la 173, que anadio `dinero_en_caja` y `ganancia_ordenex`: una vista
    // cada una. El ancla sigue siendo un numero ESCRITO A MANO (que es lo que la
    // hace util) y no un `toBeGreaterThan`; lo que cambia es el mundo que cuenta.
    expect(nombres).toHaveLength(11);
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
    // DIEZ secciones en vez de once: no queda un hueco vacio en su lugar.
    expect(seccionesDePanel()).toHaveLength(10);
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

  it("NO aparece en las otras ocho, incluidas las dos de tesoreria de la 173", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombresAcumulados = ACUMULADAS.map((id) => ETIQUETAS[id]);
    const otras = seccionesDePanel().filter(
      (region) => !nombresAcumulados.includes(nombreDe(region)),
    );

    expect(otras).toHaveLength(9); // 11 vistas - 2 acumuladas
    for (const region of otras) {
      expect(region.textContent ?? "").not.toMatch(/saldo al corte/i);
    }
  });
});

describe("Feature 132 (R16) / 183 (R20) — donde el DTO trae los DOS, se muestran los dos y distinguibles", () => {
  // R16 de la 132 queda REINTERPRETADO por ⟨D12⟩, no derogado: cada panel muestra todos
  // los importes que su DTO trae, y donde trae los dos siguen los dos. Por eso este
  // bloque se traslada de `ingreso_flete` —que desde la 183 publica `solo_bruto` y con
  // el que la aserción ya no tendría material— a `egresos`, que CONSERVA el neto. La
  // aserción no se borra ni se relaja: se muda a donde el requisito sigue aplicando.
  it("el panel de KPI muestra el neto como cifra y el bruto etiquetado aparte", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.egresos });
    const neto = cifra(-3600, "moneda");
    const bruto = cifra(4000, "moneda");

    expect(neto).not.toBe(bruto);
    expect(within(seccion).getByText(neto)).toBeInTheDocument();
    expect(within(seccion).getByText(`Bruto: ${bruto}`)).toBeInTheDocument();
  });

  it("el neto de `egresos` conserva su signo negativo (P3, humana 2026-08-04)", () => {
    // El KPI pinta `−3.600,00` bajo el título «Egresos». Se lee dos veces, y aun así se
    // conserva tal cual: cambiar la presentación del signo tocaría `formatearValor`, que
    // es del paquete compartido de la 130 y no está en ⟨D12⟩.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.egresos });
    expect(within(seccion).getByText(cifra(-3600, "moneda"))).toBeInTheDocument();
    expect(within(seccion).queryByText(cifra(3600, "moneda"))).toBeNull();
  });

  it("el panel de tabla muestra el total del DTO en sus dos formas", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });
    expect(within(seccion).getByText("Total neto")).toBeInTheDocument();
    expect(within(seccion).getByText("Total bruto")).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(128, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(140, "moneda"))).toBeInTheDocument();
  });

  it("la tabla de una vista CON neto conserva sus dos columnas de importe", () => {
    // Contrapeso del caso de R19 de más abajo: sin esto, un tablero que unificara TODOS
    // los paneles en «solo bruto» pasaría aquel en verde y perdería el neto en silencio.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });
    expect(within(seccion).getByRole("columnheader", { name: "Neto" })).toBeInTheDocument();
    expect(within(seccion).getByRole("columnheader", { name: "Bruto" })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 183 — donde NO hay neto no se pinta nada en su lugar                */
/* -------------------------------------------------------------------------- */

/** Las tres métricas que ⟨D12⟩ dejó sin neto, con el bruto que la fixture les da. */
const SIN_NETO: [MetricaFinancieraId, number][] = [
  ["ingreso_flete", 1000],
  ["ingreso_comision_cod", 2000],
  ["ingreso_iva", 3000],
];

/** El marcador de dato ausente REAL del paquete, no un guion escrito aquí. */
const MARCADOR_AUSENTE = formatearValor(null, "moneda");

describe("Feature 183 (R19) — un panel sin neto pinta el bruto y NADA en el lugar del neto", () => {
  it.each(SIN_NETO)(
    "`%s` pinta su bruto como cifra del KPI, con la etiqueta «Bruto» (P2)",
    (id, bruto) => {
      render(<TableroFinanciero paneles={panelesOk()} />);

      const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
      // La etiqueta existe: sin ella el KPI perdería su nombre accesible, que es lo que
      // P2 descartó explícitamente.
      expect(within(seccion).getByText("Bruto")).toBeInTheDocument();
      expect(within(seccion).getByText(cifra(bruto, "moneda"))).toBeInTheDocument();
    },
  );

  it.each(SIN_NETO)("`%s` no muestra la etiqueta «Neto» ni una línea secundaria", (id, bruto) => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
    expect(within(seccion).queryByText("Neto")).toBeNull();
    expect(within(seccion).queryByText("Total neto")).toBeNull();
    expect(seccion.textContent ?? "").not.toMatch(/neto/i);
    // Y tampoco la línea secundaria del bruto: con una sola cifra sobraría (P2).
    expect(within(seccion).queryByText(`Bruto: ${cifra(bruto, "moneda")}`)).toBeNull();
  });

  it.each(SIN_NETO)("`%s` no pinta el marcador de dato ausente en el lugar del neto", (id) => {
    // ES LA COLISIÓN QUE HAY QUE EVITAR: en la 132 ese marcador significa «no se sabe»
    // (R15) y aquí la verdad es «no aplica». `queryByText` compara el texto COMPLETO del
    // elemento, así que el guion de las fechas del rango («2026-07-05 — 2026-08-03») no
    // lo dispara: solo lo haría una celda o una cifra que valiera exactamente eso.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
    expect(within(seccion).queryByText(MARCADOR_AUSENTE)).toBeNull();
    expect(within(seccion).queryAllByText(MARCADOR_AUSENTE)).toHaveLength(0);
  });

  it("una tabla de una vista sin neto no declara la columna del neto", () => {
    // El otro sitio donde el ausente aparecería solo: `TablaResumen` pinta el marcador en
    // toda celda cuya clave no encuentra (`TablaResumen.tsx:73`). La columna no existe.
    render(<TableroFinanciero paneles={[panelDeTablaSinNeto()]} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cod_recaudado });
    // El marcador PRIMERO: es la afirmación de R19 y la que tiene que fallar antes que
    // ninguna otra si la columna volviera. Las seis filas de la fixture producirían seis
    // celdas con el marcador en cuanto la columna del neto exista.
    expect(within(seccion).queryAllByRole("cell", { name: MARCADOR_AUSENTE })).toHaveLength(0);
    expect(within(seccion).queryByRole("columnheader", { name: "Neto" })).toBeNull();
    expect(within(seccion).getByRole("columnheader", { name: "Bruto" })).toBeInTheDocument();
  });
});

/**
 * El panel de la vista por tienda de `cod_recaudado`, con la distinción RETIRADA.
 *
 * Es la MISMA vista de la fixture de arriba —mismo id, mismo grano, mismos brutos— y lo
 * único que cambia es la `forma`. Por eso sirve para R21 y para R22 a la vez: si el
 * tablero decidiera por una lista de ids escrita en el componente, las dos versiones se
 * comportarían igual.
 */
function panelDeTablaSinNeto(): PanelFinanciero {
  const original = DTOS.cod_recaudado as ResultadoFinancieroVistas;
  const porTienda = original.vistas[1]!;
  return {
    estado: "ok",
    id: "cod_recaudado",
    datos: {
      ...original,
      vistas: [
        {
          ...porTienda,
          filas: porTienda.filas.map((fila) => ({ ...fila, importe: sinNeto(fila.importe) })),
          total: sinNeto(porTienda.total),
        },
      ],
    },
  };
}

/** Los `<li>` de la alternativa textual de una gráfica, que nombran serie y categoría. */
function entradasDeGrafica(nombreSeccion: string, nombreGrafica: string): string[] {
  const seccion = screen.getByRole("region", { name: nombreSeccion });
  const lista = within(seccion).getByRole("list", { name: nombreGrafica });
  return within(lista)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("Feature 183 (R21) — una vista sin neto emite UNA sola serie", () => {
  const TITULO_TIENDA = `${ETIQUETAS.cod_recaudado} · Comparativa por categoría`;

  it("con neto, la gráfica comparativa recibe DOS series: la del bruto y la del neto", () => {
    // El lado que hay que conservar: la serie doble sigue existiendo donde hay material.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const nombre = nombresEsperados(["cod_recaudado"])[1] ?? "";
    const entradas = entradasDeGrafica(nombre, `${nombre} · Comparativa por categoría`);

    expect(entradas.filter((texto) => texto.startsWith("bruto, "))).toHaveLength(5);
    expect(entradas.filter((texto) => texto.startsWith("neto, "))).toHaveLength(5);
    // 6 cubos con MAX_SERIES = 5: la cola se agrupa, y son 5 puntos por serie.
    expect(entradas).toHaveLength(10);
  });

  it("sin neto, la MISMA gráfica recibe UNA: ninguna entrada de la serie del neto", () => {
    render(<TableroFinanciero paneles={[panelDeTablaSinNeto()]} />);

    const entradas = entradasDeGrafica(ETIQUETAS.cod_recaudado, TITULO_TIENDA);

    expect(entradas.filter((texto) => texto.startsWith("neto, "))).toHaveLength(0);
    expect(entradas.filter((texto) => texto.startsWith("bruto, "))).toHaveLength(5);
    // La mitad de entradas que el caso anterior: el techo `MAX_SERIES` no se consume al
    // doble por una serie que sería copia de la otra.
    expect(entradas).toHaveLength(5);
  });
});

describe("Feature 183 (R22) — lo que pinta el tablero lo decide la FORMA del DTO", () => {
  it("la misma vista, con y sin neto, produce dos pantallas distintas", () => {
    // Las dos fixtures comparten id de métrica, id de vista, grano y brutos. Un tablero
    // que decidiera por una lista de ids escrita a mano no podría distinguirlas.
    render(<TableroFinanciero paneles={panelesOk()} />);
    const conNeto = screen.getByRole("region", {
      name: nombresEsperados(["cod_recaudado"])[1] ?? "",
    }).textContent;
    cleanup();

    render(<TableroFinanciero paneles={[panelDeTablaSinNeto()]} />);
    const sinNetoTexto = screen.getByRole("region", { name: ETIQUETAS.cod_recaudado })
      .textContent;

    expect(conNeto).not.toBe(sinNetoTexto);
    expect(conNeto ?? "").toMatch(/neto/i);
    expect(sinNetoTexto ?? "").not.toMatch(/neto/i);
  });

  it("las tres métricas sin neto y las siete con neto conviven en el MISMO tablero", () => {
    // La prueba de que no hay un interruptor global: el mismo render pinta paneles de las
    // dos clases, y cada uno según lo que su propio DTO trae.
    render(<TableroFinanciero paneles={panelesOk()} />);

    for (const [id] of SIN_NETO) {
      const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
      expect(seccion.textContent ?? "").not.toMatch(/neto/i);
    }
    for (const id of ["egresos", "dinero_en_caja", "ganancia_ordenex"] as const) {
      const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
      expect(seccion.textContent ?? "").toMatch(/neto/i);
    }
  });
});

describe("Feature 132 (R14) — el total pintado sale del DTO, nunca de sumar las filas", () => {
  // Las tres vistas que llevan total al lado tienen fixtures cuyo total NO
  // coincide con la suma de sus filas (ver el comentario de la fixture): asi, un
  // componente que derivara la cifra pintaria un numero distinto del esperado.

  it("la vista por metodo de pago muestra el neto del DTO y no la suma de sus metodos", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", {
      name: nombresEsperados(["cod_recaudado"])[0] ?? "",
    });

    // 311,11 es el `total.neto` del DTO; 306,66 es lo que suman los tres metodos
    // (101,11 + 102,22 + 103,33).
    expect(within(seccion).getByText(cifra(311.11, "moneda"))).toBeInTheDocument();
    expect(within(seccion).queryByText(cifra(306.66, "moneda"))).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(cifra(306.66, "moneda"));
  });

  it("la vista por tienda muestra los totales del DTO y no la suma de sus seis cubos", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", {
      name: nombresEsperados(["cod_recaudado"])[1] ?? "",
    });

    // Del DTO: 1206,00 bruto y 722,22 neto. Sumando los seis cubos saldria
    // 201..206 = 1221,00 y 101..106 = 621,00.
    expect(within(seccion).getByText(cifra(1206, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(722.22, "moneda"))).toBeInTheDocument();
    expect(within(seccion).queryByText(cifra(1221, "moneda"))).toBeNull();
    expect(within(seccion).queryByText(cifra(621, "moneda"))).toBeNull();
  });

  it("el saldo al corte de la cuenta por pagar es el del DTO y no la suma de sus tiendas", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });

    // Del DTO: 140,00 bruto y 128,00 neto. Sumando las dos filas saldria 121,00 y
    // 110,00, que es lo que pintaria un total derivado.
    expect(within(seccion).getByText(cifra(140, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(128, "moneda"))).toBeInTheDocument();
    expect(within(seccion).queryByText(cifra(121, "moneda"))).toBeNull();
    expect(within(seccion).queryByText(cifra(110, "moneda"))).toBeNull();
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
