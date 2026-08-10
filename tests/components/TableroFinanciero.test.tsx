// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { TableroFinanciero } from "@/app/(app)/analitica/_components/financiero/TableroFinanciero";
import type { PanelFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import { formatearValor } from "@/components/private/analytics/formato";
import {
  IDS_FINANCIERAS_ACUMULADAS,
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  IDS_FINANCIERAS_SERVIDAS,
  type GranularidadVista,
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
import {
  cubosDelRango,
  dtoConciliacionServido,
  dtoNoTemporalServido,
  dtoTemporalServido,
  RANGO_TABLERO,
  type ImporteDeFila,
  type MetricaTemporalServida,
} from "@/tests/fixtures/dto-financiero-servido";

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
// Feature 186 — el tercer lienzo se dobla igual que los otros dos, y por el mismo motivo:
// en jsdom `ResponsiveContainer` renderiza vacio, asi que una asercion sobre el SVG pasaria
// monte el componente su grafica o no. Todo lo que se afirma de la linea sale del nombre
// accesible y de la alternativa textual, nunca de un nodo de recharts (lo prohibe
// `tests/unit/components/analytics-paquete-guard.test.ts`).
vi.mock("@/components/private/analytics/lienzo/LineasLienzo", () => ({
  default: () => <div data-testid="lienzo-lineas" />,
}));

// Feature 184 — analitica financiera: export de la serie (⟨D6⟩ humano, 2026-08-08).
//
// Desde esa feature `SeccionVista` monta, en las vistas TEMPORALES, el control de descarga
// `ExportarVistaFinanciera`, que envuelve `DescargarDatasetButton`; y ese control llama a
// `useToast()`, que LANZA fuera de un `ToastProvider` (`hooks/useToast.ts`).
//
// Se dobla EL HOOK y no el control, y la diferencia importa: asi los ~40 casos de este archivo
// siguen montando el arbol REAL —control incluido—, de modo que una prop-funcion cruzando la
// frontera RSC seguiria fallando aqui, que es donde falla de verdad (en render, no en
// compilacion). Mockear el control habria dejado ese arbol sin montar en el unico sitio que lo
// monta entero. Y se dobla en vez de envolver con el `ToastProvider` real porque su viewport
// emite su propia `<section role="region">`, y tres casos de este archivo CUENTAN las regiones
// del tablero: envolverlo habria cambiado lo que esos casos miden.
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

/**
 * El rango con el que se prueba el tablero: treinta dias, ambos extremos incluidos.
 *
 * SE IMPORTA, no se declara aqui (guardia de arnes del 2026-08-07): la guardia
 * `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts` consulta al servicio REAL por
 * esta misma ventana y compara la forma que sale con la que estas fixtures declaran. Con dos
 * declaraciones del rango, esa comparacion mediria dos mundos distintos y volveria a pasar en
 * verde con el doble mintiendo.
 */
const RANGO = RANGO_TABLERO;

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

/**
 * Los cubos que el servicio produce para ESTE rango con `granularidad: "dia"`: los treinta
 * dias de `RANGO`, ambos extremos incluidos.
 *
 * Salen de `trocear`, la MISMA funcion que el servicio usa, en vez de una aritmetica de
 * milisegundos propia como hasta el 2026-08-07. Daba el mismo resultado —medido: identico, 30
 * claves— y aun asi era una SEGUNDA definicion del troceo viviendo al lado de la primera, que
 * es como nace un off-by-one que nadie ve. Si alguien mueve las fechas del rango, la serie lo
 * sigue en vez de quedarse describiendo otra ventana.
 */
const CUBOS_FECHA: readonly string[] = cubosDelRango(RANGO);

/**
 * Un cubo INTERMEDIO de la serie, y por eso util: las dos fechas EXTREMAS del rango ya se
 * pintan en la cabecera de cada panel (R22), asi que afirmar sobre ellas no distinguiria la
 * cabecera de una tabla. Esta fecha solo puede aparecer si alguien pinto la serie.
 */
const CUBO_INTERMEDIO: string = CUBOS_FECHA[15]!;

/**
 * Las cifras de la serie DENSA de una vista temporal.
 *
 * Son deliberadamente AJENAS a todos los totales de este archivo (terminan en 13 y en 17
 * centimos, que ningun total usa): si un panel pintara una fila donde va el titular, ninguna
 * asercion podria acertar por azar. Por eso las cifras se quedan AQUI y no viajan a la fixture
 * compartida: atarlas a las del servicio destruiria justo esa propiedad.
 *
 * La `forma` de cada fila la dicta el TOTAL y no se elige aparte: R18 de la 183 exige que una
 * vista no mezcle formas, y una fixture que las mezclara describiria un DTO imposible.
 */
function cifrasDeLaSerie(total: ImporteAnalitico): ImporteDeFila {
  return (indice) => {
    const bruto = `${(indice + 1) * 7}.13`;
    return total.forma === "solo_bruto"
      ? importeSoloBruto(bruto)
      : importeConNeto(bruto, `-${(indice + 1) * 3}.17`);
  };
}

/**
 * El DTO de una metrica de SERIE TEMPORAL, con la FORMA que el servicio produce hoy.
 *
 * LA FORMA YA NO SE ESCRIBE AQUI (guardia de arnes del 2026-08-07): `grano`, `fuente`,
 * `sumableCon`, `granularidad`, el id de la vista, `esAcumulado`, la unidad y la cardinalidad de
 * la serie salen de `tests/fixtures/dto-financiero-servido.ts`, que los DERIVA de las mismas
 * funciones puras que el servicio usa y que `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts`
 * ATA por ejecucion contra la salida real. Este archivo solo aporta la etiqueta y las cifras.
 *
 * POR QUE, en dos frases. Hasta el hotfix del 2026-08-06 este helper se llamaba `vistaSinFilas`,
 * declaraba `filas: []` y llevaba al lado el comentario «el tablero NO la lee» sobre
 * `granularidad`; las dos cosas eran falsas desde la 180 —`serieDensa` emite una fila por cubo
 * del rango— y la suite entera siguio en verde mientras produccion pintaba una tabla de treinta
 * fechas donde va «Dinero en caja». La 180 EDITO esta misma fixture sin ver que la invalidaba, y
 * eso es lo que una declaracion libre no puede impedir y una derivada atada si.
 *
 * NO LA VUELVAS A VACIAR para «simplificar». El caso de la vista sin filas sigue existiendo y se
 * prueba APARTE, con su propia fixture, en el bloque del hotfix.
 */
function dtoKpi(
  metricaId: MetricaTemporalServida,
  etiqueta: string,
  total: ImporteAnalitico,
): ResultadoFinanciero {
  return dtoTemporalServido(metricaId, etiqueta, cifrasDeLaSerie(total), total, RANGO);
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
  // arriba: una vista sola, `grano: "fecha"`, `sumableCon: []`, con la SERIE DENSA por
  // cubo que la 180 les dio (decia «SIN filas» hasta el hotfix del 2026-08-06, y era la
  // premisa vieja) y `esAcumulado: false` — no son un saldo al corte, son el movimiento
  // del rango. Por eso van con el mismo helper que sus vecinas y con importes que
  // continuan su serie.
  dinero_en_caja: dtoKpi("dinero_en_caja", ETIQUETAS.dinero_en_caja, importeConNeto("5000.00", "4500.00")),
  ganancia_ordenex: dtoKpi(
    "ganancia_ordenex",
    ETIQUETAS.ganancia_ordenex,
    importeConNeto("6000.00", "5400.00"),
  ),
  // TANDA 2 de la guardia de arne (2026-08-07) — la IDENTIDAD de las dos vistas
  // (`id`, `grano`, `fuente`, `sumableCon`, `granularidad`) y el ORDEN en que van ya no se
  // escriben aqui: salen de `IDENTIDAD_NO_TEMPORAL` y las ata contra el servicio real
  // `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts`. Este archivo aporta lo que la
  // identidad no fija y el servicio tampoco puede fijar: las FILAS y el TOTAL, que en un desglose
  // los deciden los datos.
  //
  // El ORDEN importa y por eso viaja en la fixture: la primera vista es la del metodo de pago
  // (donut) y la segunda la de tienda (barras); los casos de abajo indexan `[0]` y `[1]`.
  cod_recaudado: dtoNoTemporalServido("cod_recaudado", ETIQUETAS.cod_recaudado, [
    {
      filas: [
        { cubo: "efectivo", importe: importeConNeto("111.11", "101.11") },
        { cubo: "simpe", importe: importeConNeto("122.22", "102.22") },
        { cubo: "transferencia", importe: importeConNeto("133.33", "103.33") },
      ],
      total: importeConNeto("366.66", "311.11"),
    },
    {
      // SEIS cubos con MAX_SERIES = 5: sin `agruparCola` la grafica LANZA
      // `SeriesExcedidasError` fuera de produccion, asi que este numero de
      // filas es parte de la prueba.
      filas: CUBOS_TIENDA.map((cubo, indice) => ({
        cubo,
        importe: importeConNeto(`${201 + indice}.00`, `${101 + indice}.00`),
      })),
      total: importeConNeto("1206.00", "722.22"),
    },
  ]),
  // TANDA 2 — la identidad la pone `IDENTIDAD_NO_TEMPORAL`. Aqui vivia la divergencia que la
  // §6.5 de la bitacora dejo abierta: el doble declaraba `id: "cuenta_por_pagar_tienda__vista"`
  // y el servicio publica `"cuenta_por_pagar_tienda"`, sin sufijo. Se ato primero y se corrigio
  // despues; corregirla sin atarla habria recreado el fallo que la guardia cierra.
  cuenta_por_pagar_tienda: dtoNoTemporalServido(
    "cuenta_por_pagar_tienda",
    ETIQUETAS.cuenta_por_pagar_tienda,
    [
      {
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
  ),
  // `esAcumulado: true` YA NO SE PASA A MANO: lo deriva `dtoTemporalServido` de
  // `esMetricaAcumulada`, la misma funcion del contrato que el servicio llama en su cabecera.
  // Era el ultimo campo de la cabecera que este doble podia contradecir en silencio, y no es
  // inocuo: con el decide el tablero si pinta «saldo al corte» y si sustituye la linea por el
  // motivo escrito (R3 de la 186).
  cuenta_por_pagar_mensajero: dtoKpi(
    "cuenta_por_pagar_mensajero",
    ETIQUETAS.cuenta_por_pagar_mensajero,
    importeConNeto("88.00", "80.00"),
  ),
  // TANDA 2 — la cabecera la construye `dtoConciliacionServido`, y con ella llego el hallazgo mas
  // caro de aquella tanda: `unidad` NO es `"moneda"` sino `"conteo"`, que es lo que el catalogo
  // declara para esta metrica y lo que el servicio publica. Este doble decia `"moneda"` desde la
  // 132, y de ahi viene la forma de este fixture: la unidad ya no se escribe aqui, sale de
  // `UNIDAD_SERVIDA` (`tests/fixtures/dto-financiero-servido.ts`), que la deriva del catalogo.
  //
  // LA CONSECUENCIA ERA REAL Y ESTA CERRADA (2026-08-07,
  // `progress/impl_fix-conciliacion-unidad.md`). `PanelConciliacion` formateaba las TRES cifras
  // de dinero del cuadre con `datos.unidad`, y en produccion se pintaban redondeadas y sin
  // moneda: ₡1 560,50 salia como «1 561» y un descuadre de ₡60,50 se anunciaba como «61». Hoy ese
  // panel declara la unidad POR CIFRA (`UNIDAD.importe`) y no lee la de la cabecera. Lo fija el
  // caso de regresion de `tests/components/PanelConciliacion.test.tsx`, y el mismo riesgo en el
  // tablero —que formatea con `datos.unidad` y hoy solo es correcto porque las nueve metricas de
  // vistas son `moneda`— lo vigila
  // `tests/unit/analytics/financiera-unidad-de-vistas.guardia.test.ts`.
  conciliacion_cierres: dtoConciliacionServido(ETIQUETAS.conciliacion_cierres, {
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
  }),
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
  /**
   * Las dos fechas del rango, EN EL MISMO elemento y en el orden del DTO.
   *
   * AJUSTADO POR LA FEATURE 186, y hacia MAS estrecho, no hacia menos: hasta la 186 este
   * caso buscaba cada fecha por separado (`getByText(/2026-07-05/)`). Desde que la vista
   * temporal lleva linea, `2026-07-05` es ademas la clave del PRIMER punto de la serie y
   * `SerieTextual` la emite en su alternativa textual, asi que la busqueda suelta
   * encontraba dos elementos y fallaba por ambigua — no por incorrecta.
   *
   * Afirmar sobre la cabecera ENTERA fija mas que antes: las dos fechas juntas, en el orden
   * en que el DTO las trae, en un solo nodo. El separador no se escribe aqui (es texto de
   * UI del componente); lo que se fija es que entre las dos fechas no hay ningun digito,
   * que es lo que impediria que una tercera fecha calculada se colara en medio.
   */
  const CABECERA_DE_RANGO = new RegExp(`${RANGO.desdeFecha}\\D+${RANGO.hastaFecha}`);

  it("cada panel muestra las fechas calendario del propio DTO, sin recalcularlas", () => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.ingreso_flete });
    expect(within(seccion).getByText(CABECERA_DE_RANGO)).toBeInTheDocument();
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

/**
 * La CATEGORÍA de una entrada, aislada de la serie y del valor (feature 186).
 *
 * `SerieTextual` emite «<serie>, <categoría>: <valor>», así que la categoría es lo que hay
 * entre la primera coma y los últimos dos puntos. Se aísla porque los casos de R7 comparan
 * el rótulo de LA MISMA clave de cubo entre dos vistas cuyos importes son distintos: sin
 * aislarla, las entradas diferirían por la cifra y la comparación no mediría el rótulo.
 */
function categoriaDeEntrada(entrada: string): string {
  const desde = entrada.indexOf(", ") + 2;
  const hasta = entrada.lastIndexOf(": ");
  return entrada.slice(desde, hasta);
}

/** La categoría con la que una gráfica rotuló un cubo concreto. */
function categoriaDelCubo(nombreSeccion: string, nombreGrafica: string, cubo: string): string {
  const categorias = entradasDeGrafica(nombreSeccion, nombreGrafica)
    .map(categoriaDeEntrada)
    .filter((categoria) => categoria.includes(cubo));

  // Que aparezca es parte de lo que se mide: si el cubo no estuviera, el caso pasaría por
  // vacío comparando dos cadenas vacías.
  expect(categorias.length, `ninguna entrada de ${nombreGrafica} nombra ${cubo}`).toBeGreaterThan(
    0,
  );
  return categorias[0]!;
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

/* -------------------------------------------------------------------------- */
/* HOTFIX 2026-08-06 — la serie densa de la 180 no convierte el KPI en tabla   */
/* -------------------------------------------------------------------------- */
//
// EL DEFECTO, que estuvo VIVO EN PRODUCCION: `ContenidoDeVista` elegia el componente con
// `vista.filas.length === 0 -> KPI`. Esa condicion era una señal de forma valida mientras el
// servicio devolviera las siete vistas de grano `fecha` agregadas y sin cubo. La 180 la
// invalido: `serieDensa` emite una fila por cubo del rango —incluidos los cubos sin
// movimiento—, asi que las siete cayeron en `PanelTabla` y el maestro perdio la cifra de
// titular («Dinero en caja», «Ganancia de Ordenex», …) a cambio de una tabla de treinta
// fechas.
//
// POR QUE NINGUNA SUITE LO VIO: la fixture de este mismo archivo declaraba `filas: []` para
// esas siete y la 180 la dejo asi, limitandose a añadirle `granularidad`. El componente y su
// prueba compartian una premisa que el servicio ya no cumplia, y dos piezas que se equivocan
// igual no se contradicen nunca. Por eso el arreglo incluye la fixture: sin eso, este bloque
// mediria el mismo mundo inexistente.
//
// LA SEÑAL CORRECTA es `granularidad`, obligatoria en toda vista desde la 180 y con un valor
// —`no_temporal`— que AFIRMA «esta vista no se mide en el tiempo». Sigue sin haber ni una
// decision por id de metrica (R27 / R22 de la 183): se pregunta por la forma del DTO.

describe("Hotfix — una vista TEMPORAL con filas es la cifra de titular, no una tabla de fechas", () => {
  /** Las metricas cuya vista es temporal, leidas de la FORMA de la fixture y no de una lista. */
  const TEMPORALES: readonly MetricaFinancieraId[] = IDS_FINANCIERAS_SERVIDAS.filter((id) => {
    const dto = DTOS[id];
    return dto.tipo === "vistas" && dto.vistas.some((v) => v.granularidad !== "no_temporal");
  });

  /** La cifra que el KPI pone de titular: el `neto` donde el DTO lo trae, el `bruto` donde no. */
  function titularDe(vista: VistaFinanciera): string {
    const { total } = vista;
    return total.forma === "bruto_y_neto"
      ? cifra(Number(total.neto), "moneda")
      : cifra(Number(total.bruto), "moneda");
  }

  function vistaUnicaDe(id: MetricaFinancieraId): VistaFinanciera {
    const dto = DTOS[id];
    if (dto.tipo !== "vistas") throw new Error(`${id} no es una metrica de vistas`);
    return dto.vistas[0]!;
  }

  it("la fixture declara temporales EXACTAMENTE las siete que la 180 desgloso por fecha", () => {
    // El contrapeso que ata la fixture al contrato: el dia que una metrica entre o salga de
    // `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`, esta linea se pone roja y la fixture se
    // actualiza — en vez de seguir describiendo el reparto de ayer, que es como nacio el
    // defecto que este bloque persigue.
    expect([...TEMPORALES].sort()).toEqual([...IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA].sort());
    expect(TEMPORALES).toHaveLength(7);
  });

  it("la serie de la fixture es DENSA: una fila por dia del rango, treinta para treinta dias", () => {
    // Sin esto el bloque entero podria pasar por vacio: con `filas: []` la vista cae en la
    // rama del KPI por la OTRA condicion y ninguna asercion de abajo distinguiria nada.
    expect(CUBOS_FECHA).toHaveLength(30);
    expect(CUBOS_FECHA[0]).toBe(RANGO.desdeFecha);
    expect(CUBOS_FECHA.at(-1)).toBe(RANGO.hastaFecha);
    for (const id of TEMPORALES) {
      expect(vistaUnicaDe(id).filas.map((f) => f.cubo)).toEqual(CUBOS_FECHA);
    }
    // Y el cubo con el que se afirma abajo NO es ninguno de los dos extremos, que la
    // cabecera del panel ya pinta como rango (R22).
    expect(CUBO_INTERMEDIO).not.toBe(RANGO.desdeFecha);
    expect(CUBO_INTERMEDIO).not.toBe(RANGO.hastaFecha);
  });

  it.each(TEMPORALES)("`%s` pinta la cifra de titular de su KPI", (id) => {
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
    expect(within(seccion).getByText(titularDe(vistaUnicaDe(id)))).toBeInTheDocument();
  });

  it.each(TEMPORALES)("`%s` NO pinta ninguna tabla", (id) => {
    // `TablaResumen` emite un `<table>` con su titulo por `<caption>`; el KPI no emite
    // ninguno. Es la asercion que separa las dos pantallas sin mirar una sola cifra.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
    expect(within(seccion).queryByRole("table")).toBeNull();
    expect(within(seccion).queryAllByRole("row")).toHaveLength(0);
  });

  it.each(TEMPORALES)("`%s` NO pinta las fechas de la serie", (id) => {
    // La forma del defecto tal como el maestro lo vio: una columna de fechas donde iba el
    // numero. Se afirma sobre un cubo INTERMEDIO, que no aparece en la cabecera del rango.
    //
    // AJUSTADO POR LA FEATURE 186, Y ES LA UNICA ASERCION DEL BLOQUE DEL HOTFIX QUE SE TOCA.
    // Antes decia `expect(seccion.textContent).not.toContain(CUBO_INTERMEDIO)` sobre la
    // seccion ENTERA. Esa forma es incompatible con R1, y no por descuido de nadie: la linea
    // vive DENTRO de la seccion y `SerieTextual` emite su alternativa textual —«serie,
    // categoria: valor»— en el DOM, que es exactamente donde un lector de pantalla lee la
    // grafica. Con la linea puesta, la fecha del cubo TIENE que aparecer ahi; si no
    // apareciera, la grafica seria muda.
    //
    // LO QUE **NO** HAY QUE HACER —y fue mi primera version, corregida en la ronda 2 de la
    // revision (m7)— es debilitar la ASERCION a «la fecha no es el texto propio de ningun
    // elemento». Eso deja pasar una fecha VISIBLE embebida en un texto mas largo, que es una
    // regresion perfectamente escribible. Medido: un `<p>` con «Cubos del periodo: …» en la
    // rama del KPI producia UN solo rojo —el de la metrica acumulada, por la asercion
    // original que se le conservaba— y las SEIS de flujo no lo veian.
    //
    // Lo correcto es restringir el TEXTO, no la asercion: se quita del arbol la region de la
    // grafica —que es la unica fuente legitima de la fecha— y sobre el resto se afirma
    // exactamente lo que el caso afirmaba antes. Asi la forma `not.toContain` sobrevive
    // intacta, la metrica acumulada queda con la asercion ORIGINAL byte a byte (no tiene
    // grafica que quitar) y las siete se miden con la misma vara, sin rama condicional.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
    expect(within(seccion).queryByRole("cell", { name: CUBO_INTERMEDIO })).toBeNull();
    expect(textoFueraDeLaGrafica(seccion, tituloDeLinea(ETIQUETAS[id]))).not.toContain(
      CUBO_INTERMEDIO,
    );
  });

  it.each(TEMPORALES)("`%s` no pinta el total al pie, que es la marca del panel de tabla", (id) => {
    // `TotalDelDto` —la fila de total que acompaña a toda tabla— siempre escribe «Total
    // bruto». Su ausencia distingue el KPI de la tabla incluso si las dos pintaran la misma
    // cifra, que es justo lo que pasa: el titular del KPI y el total del DTO son el mismo
    // numero, y sin esta asercion el caso de arriba pasaria en verde con el defecto puesto.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS[id] });
    expect(within(seccion).queryByText("Total bruto")).toBeNull();
    expect(within(seccion).queryByText("Total neto")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 186 — la LINEA sobre el KPI restaurado                              */
/* -------------------------------------------------------------------------- */
//
// Lo que esta feature añade es la linea ENCIMA del KPI, no en su lugar: el bloque del
// hotfix de arriba sigue siendo el contrato de que el KPI no se retira (R14).
//
// TODO lo que se afirma aqui sale de nombres accesibles y de texto. La alternativa textual
// de una grafica es una `<ul aria-label={titulo}>` con una entrada
// «<serie>, <categoria>: <valor>» por punto (`SerieTextual.tsx`), y ES ahi donde se
// comprueba que el eje dice lo que debe: en jsdom el lienzo renderiza vacio, asi que una
// asercion sobre el SVG pasaria montara el componente su grafica o no.

/** Nombre de la pieza que la region da a la grafica de evolucion, como `Comparativa…`. */
const PIEZA_EVOLUCION = "Evolución en el tiempo";

/** El titulo accesible que le toca a la linea de una seccion. */
function tituloDeLinea(nombreSeccion: string): string {
  return `${nombreSeccion} · ${PIEZA_EVOLUCION}`;
}

/** ¿Tiene esta seccion una grafica de evolucion? Se pregunta por su nombre accesible. */
function tieneLinea(nombreSeccion: string): boolean {
  const seccion = screen.getByRole("region", { name: nombreSeccion });
  return within(seccion).queryByRole("region", { name: tituloDeLinea(nombreSeccion) }) !== null;
}

/**
 * El texto de una seccion SIN el de su grafica de evolucion.
 *
 * Existe para que el caso del hotfix pueda seguir afirmando `not.toContain(<fecha>)` sobre el
 * texto de la seccion —tal como lo afirmaba antes de esta feature— ahora que la grafica TIENE
 * que nombrar las fechas en su alternativa textual (R1 + R7). Se restringe el TEXTO sobre el
 * que se afirma, no la ASERCION: lo que queda fuera de la grafica no puede contener la fecha
 * de ninguna forma, ni como texto propio de un nodo ni embebida en una frase mas larga.
 *
 * La region se localiza por su NOMBRE ACCESIBLE, que es lo que ya usan `tieneLinea` y todo
 * este archivo, y NO por la clase `sr-only`: acoplarse a una clase de presentacion del paquete
 * de la 130 seria acoplarse a algo que esta feature no controla ni puede tocar. El selector
 * cubre a la vez la `<section>` de `GraficaMarco` y la `<ul>` de `SerieTextual`, que comparten
 * ese `aria-label`; quitar la primera ya se lleva la segunda por dentro.
 *
 * Si la seccion NO tiene grafica —la metrica acumulada por Q2 = (b), y cualquier vista no
 * temporal— no se quita nada y la asercion queda IDENTICA a la original, byte a byte.
 */
function textoFueraDeLaGrafica(seccion: HTMLElement, tituloGrafica: string): string {
  const copia = seccion.cloneNode(true) as HTMLElement;
  for (const nodo of Array.from(copia.querySelectorAll(`[aria-label="${tituloGrafica}"]`))) {
    nodo.remove();
  }
  return copia.textContent ?? "";
}

/**
 * Un rango LARGO, y las claves de cubo SEMANALES que el servidor produciria para el.
 *
 * SESENTA Y TRES DIAS a proposito: `MAX_PUNTOS_SERIE` es 62, asi que este es el rango mas
 * corto que el servidor ya no puede servir por dia (`granularidadDe`). No es un numero
 * bonito: es la frontera.
 *
 * LIMITE DECLARADO (Q4 = (a), humana 2026-08-06): esta granularidad NO ES ALCANZABLE HOY EN
 * PRODUCCION. El filtro del tablero financiero sigue siendo la constante
 * `FILTRO_FINANCIERO_POR_DEFECTO = { rango: "mes" }` y cablearlo a la barra de filtros es el
 * slot de la 131. Por eso la vista semanal vive en su PROPIA fixture y no dentro de
 * `panelesOk()`: meterla ahi haria que «los paneles todo bien» declararan un DTO que el
 * servicio no produce para el rango por defecto — que es, exactamente, la clase de mentira
 * que costo siete horas de produccion el 2026-08-06.
 */
const RANGO_SEMANAL = { desdeFecha: "2026-06-01", hastaFecha: "2026-08-02" } as const;

const CUBOS_SEMANA: readonly string[] = (() => {
  const MS_POR_SEMANA = 7 * 86_400_000;
  const fin = Date.parse(`${RANGO_SEMANAL.hastaFecha}T00:00:00Z`);
  const cubos: string[] = [];
  for (let t = Date.parse(`${RANGO_SEMANAL.desdeFecha}T00:00:00Z`); t <= fin; t += MS_POR_SEMANA) {
    cubos.push(new Date(t).toISOString().slice(0, 10));
  }
  return cubos;
})();

/**
 * LA MISMA clave de cubo, presente en la serie DIARIA y en la SEMANAL.
 *
 * Es la pieza que hace discriminante el caso de R7: la clave del cubo semanal es la del
 * PRIMER dia incluido, asi que el mismo `YYYY-MM-DD` puede significar «este dia» o «los
 * siete dias que empiezan aqui». Si el rotulo no declara cual de las dos, la pantalla dice
 * lo mismo para siete veces mas dinero por punto — que es el defecto que da nombre a la
 * ficha, y que ninguna asercion sobre la cifra puede ver.
 */
const CUBO_EN_AMBAS_SERIES = CUBO_INTERMEDIO;

/** Un panel con vista SEMANAL de una metrica de FLUJO. */
function panelSemanal(): PanelFinanciero {
  return {
    estado: "ok",
    id: "dinero_en_caja",
    datos: {
      tipo: "vistas",
      metricaId: "dinero_en_caja",
      etiqueta: ETIQUETAS.dinero_en_caja,
      unidad: "moneda",
      rango: RANGO_SEMANAL,
      esAcumulado: false,
      vistas: [
        {
          id: "dinero_en_caja__vista",
          grano: "fecha",
          fuente: "wallet_tienda_movimiento",
          sumableCon: [],
          granularidad: "semana",
          filas: CUBOS_SEMANA.map((cubo, indice) => ({
            cubo,
            importe: importeConNeto(`${(indice + 1) * 11}.41`, `${(indice + 1) * 5}.43`),
          })),
          total: importeConNeto("5000.00", "4500.00"),
        },
      ],
    },
  };
}

/** Una vista TEMPORAL con CERO filas: el estado vacio de la grafica (R13). */
function panelTemporalSinFilas(): PanelFinanciero {
  return {
    estado: "ok",
    id: "egresos",
    datos: {
      tipo: "vistas",
      metricaId: "egresos",
      etiqueta: ETIQUETAS.egresos,
      unidad: "moneda",
      rango: RANGO,
      esAcumulado: false,
      vistas: [
        {
          id: "egresos__vista",
          grano: "fecha",
          fuente: "wallet_tienda_movimiento",
          sumableCon: [],
          granularidad: "dia",
          filas: [],
          total: importeConNeto("4000.00", "-3600.00"),
        },
      ],
    },
  };
}

/**
 * El par que separa «decidir por la granularidad» de «decidir por el grano» (R6).
 *
 * Las dos vistas tienen el MISMO numero de filas y el MISMO id de metrica. Lo unico que
 * cambia entre ellas es que la primera declara grano `tienda` con granularidad temporal y
 * la segunda grano `fecha` con granularidad no temporal — o sea, las dos señales CRUZADAS.
 * Un tablero que decidiera por `grano === "fecha"` daria exactamente la respuesta contraria
 * en las dos, y un tablero que decidiera por `filas.length` daria la misma en las dos.
 */
function panelGranoTiendaPeroTemporal(): PanelFinanciero {
  return {
    estado: "ok",
    id: "egresos",
    datos: {
      tipo: "vistas",
      metricaId: "egresos",
      etiqueta: ETIQUETAS.egresos,
      unidad: "moneda",
      rango: RANGO,
      esAcumulado: false,
      vistas: [
        {
          id: "egresos__vista",
          grano: "tienda",
          fuente: "wallet_tienda_movimiento",
          sumableCon: [],
          granularidad: "dia",
          filas: CUBOS_TIENDA.slice(0, 3).map((cubo, indice) => ({
            cubo,
            importe: importeConNeto(`${(indice + 1) * 9}.41`, `${(indice + 1) * 4}.43`),
          })),
          total: importeConNeto("4000.00", "-3600.00"),
        },
      ],
    },
  };
}

function panelGranoFechaPeroNoTemporal(): PanelFinanciero {
  const base = panelGranoTiendaPeroTemporal();
  const datos = base.estado === "ok" ? (base.datos as ResultadoFinancieroVistas) : null;
  const vista = datos!.vistas[0]!;
  return {
    ...base,
    datos: {
      ...datos!,
      vistas: [{ ...vista, grano: "fecha", granularidad: "no_temporal" }],
    },
  } as PanelFinanciero;
}

/**
 * Una vista `no_temporal` de una metrica de FLUJO y SIN FILAS.
 *
 * Es la unica combinacion que llega a la rama del KPI **sin ser temporal**: entra por la
 * segunda condicion del hotfix (`vista.filas.length === 0`), no por la primera. Y es por tanto
 * la unica que pone a prueba el `esVistaTemporal(vista) &&` de la condicion de la linea.
 *
 * POR QUE EL SERVICIO NO PRODUCE HOY ESTE DTO, dicho como en el caso de R5 para que nadie lo
 * lea como una fixture caprichosa: las unicas vistas `no_temporal` de metrica de flujo son las
 * dos de `cod_recaudado`, y las dos salen por sus ramas propias (donut y barras) antes de
 * llegar aqui. O sea que hoy el defecto **no es alcanzable en produccion**. Eso no lo hace
 * menos exigible: R2 prohibe el encabezado que ANUNCIA la grafica, y una condicion que nadie
 * ejercita es exactamente la clase de agujero que produjo ⟨H1⟩ —una premisa que nadie
 * comprueba, esperando a la metrica que la alcance—.
 *
 * MEDIDO: sin este caso, quitar `esVistaTemporal(vista) &&` de la condicion de la linea pasaba
 * los 144 casos de componente en VERDE. Es el gemelo exacto de la mutacion que ya se descubrio
 * viva para el motivo (M-10): la misma linea de codigo, la otra mitad.
 */
function panelNoTemporalDeFlujoSinFilas(): PanelFinanciero {
  return {
    estado: "ok",
    id: "egresos",
    datos: {
      tipo: "vistas",
      metricaId: "egresos",
      etiqueta: ETIQUETAS.egresos,
      unidad: "moneda",
      rango: RANGO,
      esAcumulado: false,
      vistas: [
        {
          id: "egresos__vista",
          grano: "metodo_pago",
          fuente: "wallet_tienda_movimiento",
          sumableCon: [],
          granularidad: "no_temporal",
          filas: [],
          total: importeConNeto("4000.00", "-3600.00"),
        },
      ],
    },
  };
}

/**
 * Una metrica ACUMULADA con vista `no_temporal` Y SIN FILAS.
 *
 * Es la fixture que hace discriminante el caso de R4, y hace falta por una razon que no se
 * ve leyendo el requisito: la otra acumulada de la fixture (`cuenta_por_pagar_tienda`) trae
 * filas, asi que cae en `PanelTabla` y NUNCA entra en la rama del KPI donde vive el motivo.
 * Sin filas entra por la segunda condicion del hotfix, y ahi si coincide con el motivo en
 * el mismo bloque de codigo.
 *
 * MEDIDO, y por eso esta escrito: con solo `panelesOk()`, la mutacion «pintar el motivo en
 * toda metrica acumulada» —quitarle el `esVistaTemporal(vista) &&`— pasaba los 91 casos en
 * VERDE. El requisito estaba escrito y no lo protegia nada.
 */
function panelAcumuladoNoTemporalSinFilas(): PanelFinanciero {
  return {
    estado: "ok",
    id: "cuenta_por_pagar_tienda",
    datos: {
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
          granularidad: "no_temporal",
          filas: [],
          total: importeConNeto("77.00", "70.00"),
        },
      ],
    },
  };
}

/**
 * Todas las vistas que este archivo dobla, vengan del juego "todo bien" o de una fixture suelta.
 *
 * EL NOMBRE PROMETE «TODOS», ASI QUE LA LISTA SE MANTIENE. Cuando una fixture nueva se queda
 * fuera, el censo de R17 sigue verde y deja de cubrir lo que dice cubrir — que es la misma forma
 * de agujero que esta feature persigue en el codigo de produccion. Las dos que la revision
 * encontro fuera (`panelNoTemporalDeFlujoSinFilas`, de la ronda 1, y
 * `panelAcumuladoNoTemporalSinFilas`) se declaran ahora a nivel de modulo justo para poder
 * entrar aqui, en vez de vivir dentro del `describe` que las usa.
 *
 * LA UNICA EXCLUSION, y es deliberada: `panelConGranularidadFutura`, que declara a proposito un
 * valor FUERA del dominio de `GranularidadVista` para ejercitar R5. Meterlo aqui pondria rojo el
 * caso de R17(c) —que exige que las granularidades dobladas sean EXACTAMENTE las del dominio— y
 * el rojo seria falso: ese doble no describe un DTO que el contrato admita, describe uno que
 * llega de una cache o de una version desplegada antes. Queda dicho aqui para que la exclusion
 * sea una decision escrita y no un olvido.
 */
function todasLasVistasDobladas(): readonly VistaFinanciera[] {
  const paneles: readonly PanelFinanciero[] = [
    ...panelesOk(),
    panelSemanal(),
    panelTemporalSinFilas(),
    panelDeTablaSinNeto(),
    panelGranoTiendaPeroTemporal(),
    panelGranoFechaPeroNoTemporal(),
    panelNoTemporalDeFlujoSinFilas(),
    panelAcumuladoNoTemporalSinFilas(),
  ];
  return paneles.flatMap((panel) =>
    panel.estado === "ok" && panel.datos.tipo === "vistas" ? panel.datos.vistas : [],
  );
}

describe("Feature 186 (R17) — los dobles satisfacen los invariantes que el contrato publica", () => {
  /**
   * El dominio de `GranularidadVista` EN RUNTIME, declarado como registro exhaustivo.
   *
   * Es el mismo mecanismo que `DTOS` sobre `MetricaFinancieraId`, y por el mismo motivo: el
   * dia que el contrato gane un cuarto valor, ESTE archivo deja de compilar (TS2739) en vez
   * de seguir en verde declarando que cubre «todas» las granularidades.
   */
  const GRANULARIDADES_DEL_DOMINIO: Readonly<Record<GranularidadVista, true>> = {
    dia: true,
    semana: true,
    no_temporal: true,
  };

  it("la fixture declara acumuladas EXACTAMENTE las dos que el contrato acumula", () => {
    // R17(b). Hermano del caso del hotfix que ata las temporales: `esAcumulado` decide desde
    // esta feature si una vista temporal lleva linea o lleva el motivo escrito, asi que una
    // fixture que se desviara del contrato probaria la pantalla equivocada — en silencio.
    const acumuladas = IDS_FINANCIERAS_SERVIDAS.filter((id) => DTOS[id].esAcumulado);

    expect([...acumuladas].sort()).toEqual([...IDS_FINANCIERAS_ACUMULADAS].sort());
    expect(acumuladas).toHaveLength(2);
  });

  it("los dobles cubren las TRES granularidades, semana incluida", () => {
    // R17(c). Sin la vista semanal, la rama semanal de esta feature se probaria SOLO en el
    // adaptador y nunca de punta a punta: el tablero podria estar pasando la granularidad
    // equivocada al rotulador y ningun test de componente lo veria.
    const presentes = new Set(todasLasVistasDobladas().map((vista) => vista.granularidad));
    const dominio = Object.keys(GRANULARIDADES_DEL_DOMINIO);

    expect([...presentes].sort()).toEqual([...dominio].sort());
    expect(presentes.has("semana")).toBe(true);
  });

  it("ninguna vista de la fixture mezcla formas de importe entre su total y sus filas", () => {
    // R17(d) / R18 de la 183: UNA VISTA, UNA FORMA. Una fixture que las mezclara describiria
    // un DTO imposible, y `esVistaConNeto` responderia `false` por una sola fila — con lo que
    // el panel perderia el neto sin que nadie lo hubiera pedido.
    const mezcladas = todasLasVistasDobladas()
      .filter((vista) => vista.filas.some((fila) => fila.importe.forma !== vista.total.forma))
      .map((vista) => vista.id);

    expect(mezcladas).toEqual([]);
    // Contrapeso: que el censo mire vistas de verdad y de las dos formas.
    const formas = new Set(todasLasVistasDobladas().map((vista) => vista.total.forma));
    expect(formas).toEqual(new Set(["solo_bruto", "bruto_y_neto"]));
  });

  it("la serie semanal del doble es coherente: claves ascendentes, sin repetir y dentro del rango", () => {
    // Un doble incoherente probaria una pantalla que el servidor no puede producir.
    expect(CUBOS_SEMANA.length).toBeGreaterThan(1);
    expect(new Set(CUBOS_SEMANA).size).toBe(CUBOS_SEMANA.length);
    expect([...CUBOS_SEMANA].sort()).toEqual([...CUBOS_SEMANA]);
    expect(CUBOS_SEMANA[0]).toBe(RANGO_SEMANAL.desdeFecha);
    expect(CUBOS_SEMANA.at(-1)!.localeCompare(RANGO_SEMANAL.hastaFecha)).toBeLessThanOrEqual(0);
    // Y la clave con la que se compara diaria contra semanal esta en LAS DOS series.
    expect(CUBOS_FECHA).toContain(CUBO_EN_AMBAS_SERIES);
    expect(CUBOS_SEMANA).toContain(CUBO_EN_AMBAS_SERIES);
  });
});

describe("Feature 186 (R1, R2, R6) — la linea va donde el DTO dice, y solo ahi", () => {
  /** Las seis de FLUJO con vista temporal: las siete del desglose menos la acumulada. */
  const TEMPORALES_DE_FLUJO: readonly MetricaFinancieraId[] =
    IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.filter((id) => !DTOS[id].esAcumulado);

  it.each(TEMPORALES_DE_FLUJO)(
    "`%s`: una vista temporal de metrica de flujo trae su grafica de lineas dentro de su seccion",
    (id) => {
      render(<TableroFinanciero paneles={panelesOk()} />);

      expect(tieneLinea(ETIQUETAS[id])).toBe(true);
      // Y la grafica no esta vacia: sus puntos nombran los cubos del DTO.
      const entradas = entradasDeGrafica(ETIQUETAS[id], tituloDeLinea(ETIQUETAS[id]));
      expect(entradas.length).toBeGreaterThan(0);
      expect(entradas.some((texto) => texto.includes(CUBO_INTERMEDIO))).toBe(true);
    },
  );

  it("son SEIS: la septima temporal es la acumulada, y esa no lleva linea", () => {
    // Contrapeso de cobertura del `it.each`: sin esto, una lista vacia lo dejaria pasando
    // por vacio, y ademas fija que el reparto seis/una sale del DTO y no de una cuenta.
    expect(TEMPORALES_DE_FLUJO).toHaveLength(6);
    expect(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA).toHaveLength(7);
  });

  it("una vista temporal con neto emite DOS series en su linea, y una sin neto UNA", () => {
    // La linea compone sus series por la FORMA del importe, igual que la comparativa (R21
    // de la 183): donde el DTO trae los dos campos van los dos, y donde no, uno solo.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const conNeto = entradasDeGrafica(
      ETIQUETAS.dinero_en_caja,
      tituloDeLinea(ETIQUETAS.dinero_en_caja),
    );
    expect(conNeto.filter((t) => t.startsWith("bruto, "))).toHaveLength(CUBOS_FECHA.length);
    expect(conNeto.filter((t) => t.startsWith("neto, "))).toHaveLength(CUBOS_FECHA.length);

    const sinNetoEntradas = entradasDeGrafica(
      ETIQUETAS.ingreso_flete,
      tituloDeLinea(ETIQUETAS.ingreso_flete),
    );
    expect(sinNetoEntradas.filter((t) => t.startsWith("neto, "))).toHaveLength(0);
    expect(sinNetoEntradas).toHaveLength(CUBOS_FECHA.length);
  });

  it("las vistas no_temporal no traen ninguna grafica de lineas, ni vacia", () => {
    // R2, primera mitad. Se afirma sobre las TRES vistas `no_temporal` de la fixture: las dos
    // de `cod_recaudado` (que si tienen donut y barras) y la de la cuenta por pagar de tiendas
    // (que tiene tabla). Ninguna puede ganar una region de evolucion, ni siquiera con el
    // cartel de vacio: anunciar una serie que no existe es peor que no anunciarla.
    //
    // LO QUE ESTE CASO **NO** MIDE, y por eso hace falta el de abajo: ninguna de las tres entra
    // en la rama del KPI, que es donde vive la condicion de la linea. Salen antes, por sus
    // propias ramas. Este caso comprueba que las OTRAS TRES ramas no pintan lineas —cierto por
    // construccion— y deja la condicion de R2 sin ejercitar.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const noTemporales = [
      ...nombresEsperados(["cod_recaudado"]),
      ETIQUETAS.cuenta_por_pagar_tienda,
    ];
    for (const nombre of noTemporales) {
      expect(tieneLinea(nombre), `${nombre} gano una linea que no le toca`).toBe(false);
    }
    expect(screen.queryAllByRole("region", { name: tituloDeLinea(ETIQUETAS.cod_recaudado) })).toEqual(
      [],
    );
  });


  it("una vista no_temporal de metrica de FLUJO que llega al KPI tampoco trae linea, ni su encabezado", () => {
    // R2, segunda mitad, y la que de verdad ejercita la condicion. La vista entra en la rama del
    // KPI por no traer filas; si la linea se decidiera solo por `!esAcumulado`, esta seccion
    // ganaria una region titulada «… · Evolución en el tiempo» para una vista que NO esta medida
    // en el tiempo — el tercer inciso de R2, el del encabezado que la anuncia.
    render(<TableroFinanciero paneles={[panelNoTemporalDeFlujoSinFilas()]} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.egresos });

    expect(tieneLinea(ETIQUETAS.egresos)).toBe(false);
    // Ni la region, ni su nombre suelto por ningun sitio: «ni con datos, ni vacia, ni con
    // encabezado que la anuncie».
    expect(screen.queryAllByRole("region", { name: tituloDeLinea(ETIQUETAS.egresos) })).toEqual([]);
    expect(seccion.textContent ?? "").not.toContain(PIEZA_EVOLUCION);
    // Y tampoco el cartel de vacio de la grafica, que es como se colaria una linea sin puntos.
    expect(within(seccion).queryByText(/Sin movimientos en el rango/i)).toBeNull();
    // Lo que si sigue habiendo es el KPI: la vista no pierde nada por no llevar linea.
    expect(within(seccion).getByText(cifra(-3600, "moneda"))).toBeInTheDocument();
  });

  it("una vista de grano tienda con granularidad dia SI lleva linea, y una de grano fecha con no_temporal NO", () => {
    // R6, y es EL caso discriminante de la feature. Las dos fixtures comparten metrica, id de
    // vista, numero de filas y forma del importe; lo unico cruzado son las dos señales. Un
    // tablero que decidiera por `vista.grano === "fecha"` responderia al reves en las dos, y
    // uno que decidiera por `filas.length` responderia igual en las dos.
    render(<TableroFinanciero paneles={[panelGranoTiendaPeroTemporal()]} />);
    expect(tieneLinea(ETIQUETAS.egresos)).toBe(true);
    cleanup();

    render(<TableroFinanciero paneles={[panelGranoFechaPeroNoTemporal()]} />);
    expect(tieneLinea(ETIQUETAS.egresos)).toBe(false);
  });

  it("una vista temporal sin filas muestra el vacio con su texto, no un lienzo mudo", () => {
    // R13. `GraficaMarco` da precedencia error > carga > vacio > datos, asi que una serie de
    // cero puntos tiene que caer en el estado vacio CON SU TEXTO. La alternativa: pintar una
    // serie de ceros, que afirmaria «no hubo movimiento» — justo lo que no se sabe.
    render(<TableroFinanciero paneles={[panelTemporalSinFilas()]} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.egresos });
    const linea = within(seccion).getByRole("region", {
      name: tituloDeLinea(ETIQUETAS.egresos),
    });

    expect(within(linea).getByText(/Sin movimientos en el rango/i)).toBeInTheDocument();
    // Ni una entrada de serie: no hay puntos que enumerar, y menos ceros.
    expect(within(linea).queryByRole("list", { name: tituloDeLinea(ETIQUETAS.egresos) })).toBeNull();
    expect(within(linea).queryByText(cifra(0, "moneda"))).toBeNull();
  });
});

describe("Feature 186 (R5) — la granularidad desconocida se trata como serie, no como tabla", () => {
  /**
   * Un DTO con una granularidad que este binario no conoce.
   *
   * El `as` construye un valor fuera del dominio de HOY, y esta aqui a proposito: el caso no
   * habla de lo que el tipo permite, sino de lo que puede llegar por JSON desde una cache
   * (feature 179) o desde un servidor desplegado antes que este cliente. Con la señal escrita
   * en positivo (`=== "dia" || === "semana"`) esta vista caeria en la rama de TABLA — el
   * defecto exacto que estuvo siete horas en produccion el 2026-08-06, reintroducido por
   * simetria con el rotulador, que si enumera.
   */
  function panelConGranularidadFutura(): PanelFinanciero {
    const base = panelSemanal();
    const datos = base.estado === "ok" ? (base.datos as ResultadoFinancieroVistas) : null;
    const vista = datos!.vistas[0]!;
    return {
      ...base,
      datos: {
        ...datos!,
        vistas: [{ ...vista, granularidad: "quincena" as unknown as GranularidadVista }],
      },
    } as PanelFinanciero;
  }

  it("una granularidad que el tablero no conoce se trata como serie, no como tabla", () => {
    render(<TableroFinanciero paneles={[panelConGranularidadFutura()]} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.dinero_en_caja });
    // Lo que NO puede pasar: la tabla de cubos donde va la cifra de titular.
    expect(within(seccion).queryByRole("table")).toBeNull();
    expect(within(seccion).queryAllByRole("row")).toHaveLength(0);
    expect(within(seccion).queryByRole("cell", { name: CUBO_EN_AMBAS_SERIES })).toBeNull();
    expect(within(seccion).queryByText("Total bruto")).toBeNull();
    // Y lo que si: el KPI con su cifra de titular.
    expect(within(seccion).getByText(cifra(4500, "moneda"))).toBeInTheDocument();
  });

  it("y su serie se rotula como grano NO DECLARADO, nunca como si fuera un dia", () => {
    // La otra mitad de ⟨D5⟩: el predicado deja pasar lo desconocido (defecto seguro: serie),
    // y el rotulador NO lo llama dia (defecto seguro: grano no declarado). Los dos defaults
    // son opuestos, y son opuestos a proposito.
    render(<TableroFinanciero paneles={[panelConGranularidadFutura()]} />);
    const desconocida = categoriaDelCubo(
      ETIQUETAS.dinero_en_caja,
      tituloDeLinea(ETIQUETAS.dinero_en_caja),
      CUBO_EN_AMBAS_SERIES,
    );
    cleanup();

    render(<TableroFinanciero paneles={panelesOk()} />);
    const diaria = categoriaDelCubo(
      ETIQUETAS.dinero_en_caja,
      tituloDeLinea(ETIQUETAS.dinero_en_caja),
      CUBO_EN_AMBAS_SERIES,
    );

    expect(desconocida).not.toBe(diaria);
    expect(desconocida).toContain(CUBO_EN_AMBAS_SERIES);
  });
});

describe("Feature 186 (R7) — la etiqueta del eje declara el grano de SU vista", () => {
  it("la alternativa textual de una vista semanal no lee sus puntos como dias", () => {
    // EL CASO QUE DA NOMBRE A LA FICHA, medido de punta a punta. Se compara LA MISMA clave de
    // cubo en una vista diaria y en una semanal: si el rotulo no cambia, la pantalla dice lo
    // mismo para un dia de dinero y para siete, y ninguna asercion sobre la cifra lo veria
    // —las cifras son distintas de todas formas, y por eso aqui se compara solo la CATEGORIA
    // y no la entrada entera—.
    render(<TableroFinanciero paneles={[panelSemanal()]} />);
    const semanal = categoriaDelCubo(
      ETIQUETAS.dinero_en_caja,
      tituloDeLinea(ETIQUETAS.dinero_en_caja),
      CUBO_EN_AMBAS_SERIES,
    );
    cleanup();

    render(<TableroFinanciero paneles={panelesOk()} />);
    const diaria = categoriaDelCubo(
      ETIQUETAS.dinero_en_caja,
      tituloDeLinea(ETIQUETAS.dinero_en_caja),
      CUBO_EN_AMBAS_SERIES,
    );

    expect(semanal).not.toBe(diaria);
    // Las dos conservan la clave LITERAL del DTO (R24 de la 132) y NINGUNA nombra una
    // segunda fecha: el DTO no publica el fin del cubo y calcularlo seria falso justo en los
    // dos extremos, que estan truncados al rango.
    expect(semanal).toContain(CUBO_EN_AMBAS_SERIES);
    expect(diaria).toContain(CUBO_EN_AMBAS_SERIES);
    expect(semanal.match(/\d{4}-\d{2}-\d{2}/g)).toEqual([CUBO_EN_AMBAS_SERIES]);
    expect(diaria.match(/\d{4}-\d{2}-\d{2}/g)).toEqual([CUBO_EN_AMBAS_SERIES]);
  });

  it("la vista semanal pinta TODOS sus cubos, sin agrupar ninguna cola", () => {
    // ⟨D7⟩: «Otros» no significa nada en un eje de tiempo. Nueve cubos con `MAX_SERIES` = 5:
    // si alguien aplicara `agruparCola` quedarian cinco y el ultimo se llamaria «Otros».
    render(<TableroFinanciero paneles={[panelSemanal()]} />);

    const entradas = entradasDeGrafica(
      ETIQUETAS.dinero_en_caja,
      tituloDeLinea(ETIQUETAS.dinero_en_caja),
    );
    const delBruto = entradas.filter((texto) => texto.startsWith("bruto, "));

    expect(delBruto).toHaveLength(CUBOS_SEMANA.length);
    expect(CUBOS_SEMANA.length).toBeGreaterThan(5);
    expect(entradas.filter((texto) => texto.includes(", Otros"))).toEqual([]);
    // Y el ULTIMO cubo sigue ahi, que es lo que una cola agrupada se habria comido.
    expect(delBruto.at(-1)).toContain(CUBOS_SEMANA.at(-1));
  });
});

describe("Feature 186 (R3, R4) — el motivo de por que la acumulada no trae linea", () => {
  const MOTIVO = /saldo acumulado/i;

  it("la cuenta por pagar de mensajero NO trae grafica y dice en pantalla por que", () => {
    // R3 / Q2 = (b). La metrica es un SALDO AL CORTE: dibujada como linea solo puede subir o
    // mantenerse, asi que su forma comunica «tendencia» donde solo hay «acumulacion». Sin el
    // texto, la ausencia de grafica entre seis vecinas que si la tienen se lee como «falta un
    // dato» o «se rompio algo».
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_mensajero });
    expect(tieneLinea(ETIQUETAS.cuenta_por_pagar_mensajero)).toBe(false);
    expect(within(seccion).getByText(MOTIVO)).toBeInTheDocument();
    // El motivo nombra el PORQUE, no solo el hecho: que una linea de saldo solo podria subir.
    expect(within(seccion).getByText(MOTIVO).textContent ?? "").toMatch(/subir|mantener/i);
  });


  it("el motivo no aparece en las seis de flujo ni en la cuenta por pagar de tienda", () => {
    // R4, y es la mitad que discrimina. `cuenta_por_pagar_tienda` TAMBIEN es acumulada, pero
    // su vista es `no_temporal`: nunca tuvo serie que dibujar y su ausencia no necesita
    // explicacion. Un tablero que pintara el motivo en TODAS pone rojo esta primera mitad.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const conMotivo = seccionesDePanel()
      .filter((region) => MOTIVO.test(region.textContent ?? ""))
      .map(nombreDe);

    expect(conMotivo).toEqual([ETIQUETAS.cuenta_por_pagar_mensajero]);
  });

  it("una vista no_temporal de una metrica ACUMULADA que llega al KPI tampoco trae el motivo", () => {
    // La segunda mitad de R4, y la que de verdad mata la mutacion «pintarlo en toda metrica
    // acumulada»: esta vista SI entra en la rama del KPI (por no traer filas), es acumulada, y
    // aun asi no le toca el motivo — porque nunca tuvo serie que dibujar. Sin este caso, la
    // condicion `esVistaTemporal(vista) &&` se podia borrar sin que nada se pusiera rojo.
    render(<TableroFinanciero paneles={[panelAcumuladoNoTemporalSinFilas()]} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });
    expect(seccion.textContent ?? "").not.toMatch(MOTIVO);
    // Y el resto de su panel sigue siendo lo que era: KPI con su cifra, sin tabla ni linea.
    expect(within(seccion).getByText(cifra(70, "moneda"))).toBeInTheDocument();
    expect(within(seccion).queryByRole("table")).toBeNull();
    expect(tieneLinea(ETIQUETAS.cuenta_por_pagar_tienda)).toBe(false);
    // El «saldo al corte» de la 132 si sigue: es el otro texto, y ese depende solo del DTO.
    expect(within(seccion).getByText(/saldo al corte/i)).toBeInTheDocument();
  });

  it("el texto de «saldo al corte» de la 132 sigue donde estaba, y son dos frases distintas", () => {
    // ⟨D3⟩: aquella habla del TOTAL (R18 de la 132) y esta de por que no hay serie. Las dos
    // conviven en la misma seccion sin fundirse; reescribir la primera seria rehacer una
    // feature `done`.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_mensajero });
    const saldoAlCorte = within(seccion).getByText(/saldo al corte/i);
    const motivo = within(seccion).getByText(MOTIVO);

    expect(saldoAlCorte).not.toBe(motivo);
    expect(saldoAlCorte.textContent ?? "").not.toMatch(MOTIVO);
  });
});

describe("Feature 186 (R14) — la linea se añade ENCIMA del KPI, no en su lugar", () => {
  it("la vista temporal conserva su KPI junto a la linea y sigue sin tabla", () => {
    // Es lo que impide que esta feature deshaga el hotfix «al reorganizar el panel». La cifra
    // de titular es el `total` del DTO (4.500,00 neto de `dinero_en_caja`) y NO puede salir de
    // los puntos: ninguno de los treinta vale eso.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.dinero_en_caja });

    expect(within(seccion).getByText(cifra(4500, "moneda"))).toBeInTheDocument();
    expect(tieneLinea(ETIQUETAS.dinero_en_caja)).toBe(true);
    // Y sigue sin tabla y sin el total al pie, que son las dos marcas del panel de tabla.
    expect(within(seccion).queryByRole("table")).toBeNull();
    expect(within(seccion).queryAllByRole("row")).toHaveLength(0);
    expect(within(seccion).queryByText("Total bruto")).toBeNull();
    expect(within(seccion).queryByText("Total neto")).toBeNull();
  });

  it("el KPI va ANTES que la linea en el orden del documento", () => {
    // El orden importa para quien navega con lector de pantalla: la cifra de titular primero,
    // el detalle despues. Sustituir el KPI por la grafica, o colarla delante, cambia lo que se
    // oye primero.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.dinero_en_caja });
    const kpi = within(seccion).getByText(cifra(4500, "moneda"));
    const linea = within(seccion).getByRole("region", {
      name: tituloDeLinea(ETIQUETAS.dinero_en_caja),
    });

    expect(kpi.compareDocumentPosition(linea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Hotfix — las otras dos conductas de la 132 siguen intactas", () => {
  /** Una vista NO temporal y sin filas: el otro camino al KPI, el que ya existia. */
  function panelSinFilas(): PanelFinanciero {
    return {
      estado: "ok",
      id: "cuenta_por_pagar_tienda",
      datos: {
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
            granularidad: "no_temporal",
            filas: [],
            total: importeConNeto("77.00", "70.00"),
          },
        ],
      },
    };
  }

  it("una vista NO temporal y SIN filas sigue siendo un KPI, no una tabla vacia", () => {
    // La segunda condicion del arreglo, con su propio caso: sin ella, «simplificar» el `if`
    // a solo la granularidad dejaria una tabla con el cartel de vacio donde iba una cifra, y
    // ningun otro caso lo veria.
    render(<TableroFinanciero paneles={[panelSinFilas()]} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });
    expect(within(seccion).queryByRole("table")).toBeNull();
    expect(within(seccion).queryByText(/Sin movimientos en el rango/i)).toBeNull();
    expect(within(seccion).getByText(cifra(70, "moneda"))).toBeInTheDocument();
  });

  it("una vista NO temporal CON filas sigue siendo una tabla: el arreglo no lo mando todo a KPI", () => {
    // El contrapeso del bloque anterior. Sin el, un `ContenidoDeVista` que devolviera SIEMPRE
    // el KPI pasaria en verde todos los casos del hotfix y perderia los desgloses por tienda.
    render(<TableroFinanciero paneles={panelesOk()} />);

    const seccion = screen.getByRole("region", { name: ETIQUETAS.cuenta_por_pagar_tienda });
    expect(within(seccion).getByRole("table")).toBeInTheDocument();
    expect(within(seccion).getByRole("cell", { name: CUBOS_TIENDA[0] })).toBeInTheDocument();
  });
});
