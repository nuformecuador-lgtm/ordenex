// Feature 132 (T4.1, T4.2) — los paneles del tablero financiero. SERVIDOR.
//
// Sin `"use client"` y sin fetch: el dato llega YA cargado por props desde el
// Server Component de la ruta (R9). Este archivo solo decide QUE componente de la
// 130 pinta cada vista y con que textos.
//
// Lo que NUNCA hace, y no es un olvido:
//
//  - NO pasa `avisoRecorte` (R10). Es la unica prop-funcion del contrato de la
//    130 y una funcion no cruza la frontera RSC: un Server Component que pase una
//    funcion a un Client Component falla en RENDER, no en compilacion. No hace
//    falta: `agruparCola` garantiza POR CONSTRUCCION que no hay recorte que
//    anunciar.
//  - NO suma, resta ni promedia importes (R14). Toda cifra sale literalmente de un
//    `bruto`/`neto` del DTO. La unica agregacion es la cola de R20/R21, que el
//    propio requisito ordena.
//  - NO escribe un simbolo de moneda, un codigo ISO ni un locale (R25): todo
//    importe pasa por `formatearValor(valor, unidad)` con la unidad del DTO.
//  - NO resuelve nombres legibles de tienda (R24 / Q2): los cubos por tienda son
//    identificadores internos y se pintan crudos, con la limitacion escrita EN
//    PANTALLA. Resolverlos es la ficha 178.
//  - NO escribe la lista de ids financieros (R27): recorre los paneles que le da
//    `cargar.ts` y elige el componente por la FORMA del DTO (tipo, id de vista,
//    grano, GRANULARIDAD, si trae filas), no por un `switch` sobre nombres de
//    metrica. Desde la feature 183 ⟨D12⟩ (humano, 2026-08-04) eso incluye la `forma`
//    del importe: hay metricas que publican `bruto` y `neto` y otras que solo publican
//    `bruto`, y cual es cual NO se escribe aqui (R22 de la 183).
//  - NO pinta el marcador de dato ausente donde la metrica no tiene neto (R19 de la
//    183): en la 132 ese marcador significa «no se sabe» (R15) y aqui la verdad es
//    «no aplica». Donde no hay neto, no hay linea, ni columna, ni etiqueta.
//
// DESVIACION DECLARADA de `design.md §5` (paneles 6, 7 y 9): alli la tabla lleva
// "fila de totales". Aqui NO se usa la prop `totales` de `TablaResumen`, porque
// esa prop hace que el paquete CALCULE la fila con `totalizar`
// (`TablaResumen.tsx:44-54`), es decir una suma derivada en coma flotante — y R14
// prohibe pintar cualquier cifra que no venga literal del DTO. Peor aun: esa suma
// discreparia del `total` que el servicio calculo en `Prisma.Decimal`, y entonces
// la pantalla mostraria dos verdades distintas del mismo dinero. En su lugar se
// pinta `vista.total` DEL PROPIO DTO junto a la tabla, etiquetado como total.
//
// Las dos vistas de `cod_recaudado` viven en secciones DISTINTAS y sin total
// conjunto (R17): `sumableCon: []` dice que no suman entre si, y ponerlas juntas
// contaria el mismo colon dos veces (lo que el mensajero entrego vs. lo acreditado
// a tiendas).

import type { ReactNode } from "react";

import { GraficaBarras } from "@/components/private/analytics/GraficaBarras";
import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { TablaResumen } from "@/components/private/analytics/TablaResumen";
import { formatearValor } from "@/components/private/analytics/formato";
import { MAX_SERIES } from "@/components/private/analytics/topes";
import type { SerieDato } from "@/components/private/analytics/tipos";
import type { MetricaUnidad } from "@/lib/analytics/types";
import {
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
  type ImporteAnalitico,
  type RangoFinanciero,
  type ResultadoFinancieroVistas,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";

import {
  aNumero,
  agruparCola,
  columnasDeVista,
  esVistaConNeto,
  esVistaTemporal,
  filasDeVista,
  serieDeVista,
} from "./adaptar";
import type { PanelFinanciero } from "./cargar";
import { PanelConciliacion } from "./PanelConciliacion";

/**
 * Todo el texto de UI del tablero, en un solo objeto y fuera del JSX.
 *
 * No es decoracion: el paquete de la 130 exige que los textos los ponga el
 * llamador (no incrusta cadenas de UI), y tenerlos juntos deja el archivo listo
 * para i18n sin tocar un solo componente.
 */
const TEXTOS = {
  bruto: "Bruto",
  neto: "Neto",
  totalBruto: "Total bruto",
  totalNeto: "Total neto",
  etiquetaRango: "Rango",
  otros: "Otros",
  saldoAlCorte:
    "Saldo al corte: es el acumulado a la fecha de cierre del rango, no el movimiento del período.",
  limitacionTienda:
    "Las categorías son identificadores internos de tienda. Los nombres legibles llegan en una entrega posterior.",
  columnaTienda: "Categoría",
  // Nombres de las piezas INTERNAS de un panel. Van prefijados con el titulo del
  // panel para que ninguna region anidada (`GraficaMarco` emite su propia
  // `<section aria-label>`) comparta nombre accesible con la seccion que la
  // contiene: dos regiones con el mismo nombre son indistinguibles para un lector
  // de pantalla.
  distribucion: "Distribución",
  comparativa: "Comparativa por categoría",
  detalle: "Detalle por categoría",
  vacioTitulo: "Sin movimientos en el rango",
  vacioDescripcion: "La consulta no devolvió ninguna categoría para este rango.",
} as const;

const TEXTO_VACIO = {
  titulo: TEXTOS.vacioTitulo,
  descripcion: TEXTOS.vacioDescripcion,
} as const;

export interface TableroFinancieroProps {
  /** Objetos PLANOS ya resueltos por `cargar.ts`. Ninguna prop es una función (R10). */
  readonly paneles: readonly PanelFinanciero[];
}

/** Cabecera comun de cada seccion: titulo, rango efectivo del DTO y saldo al corte. */
function CabeceraPanel({
  titulo,
  rango,
  esAcumulado,
}: {
  readonly titulo: string;
  readonly rango: RangoFinanciero;
  readonly esAcumulado: boolean;
}) {
  return (
    <>
      <h3 className="text-base font-semibold text-foreground">{titulo}</h3>
      {/* R22: las fechas se pintan TAL CUAL las devuelve el DTO. Recalcularlas
          aqui produciria una ventana distinta de la que se consulto. */}
      <p className="text-xs text-muted-foreground">
        {`${TEXTOS.etiquetaRango}: ${rango.desdeFecha} — ${rango.hastaFecha}`}
      </p>
      {/* R18: lo declara el DTO (`esAcumulado`), no una lista de ids escrita aqui. */}
      {esAcumulado ? (
        <p className="text-xs font-medium text-muted-foreground">{TEXTOS.saldoAlCorte}</p>
      ) : null}
    </>
  );
}

/**
 * El `total` del DTO: los DOS importes donde el DTO los trae, etiquetados y
 * distinguibles (R14, R16/132; R20 de la 183); solo el bruto donde no (R19).
 *
 * La linea del neto no se pinta vacia ni con el marcador de dato ausente: se OMITE.
 * En la 132 ese marcador significa «no se sabe» (R15) y aqui la verdad es «no aplica».
 *
 * Sustituye a la fila de totales calculada del paquete: ver la desviacion
 * declarada en la cabecera del archivo.
 */
function TotalDelDto({
  total,
  unidad,
}: {
  readonly total: ImporteAnalitico;
  readonly unidad: MetricaUnidad;
}) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
      {total.forma === "bruto_y_neto" ? (
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">{TEXTOS.totalNeto}</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {formatearValor(aNumero(total.neto), unidad)}
          </dd>
        </div>
      ) : null}
      <div className="flex items-baseline gap-2">
        <dt className="text-muted-foreground">{TEXTOS.totalBruto}</dt>
        <dd className="tabular-nums text-foreground">
          {formatearValor(aNumero(total.bruto), unidad)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * KPI, ramificado por la FORMA del total y no por el id de la metrica (R22).
 *
 * - Con neto: el `neto` como cifra y el `bruto` en una linea secundaria VISIBLE
 *   (R16/132, conservado donde hay material — R20).
 * - Sin neto: el `bruto` como cifra, con la etiqueta «Bruto» que ya existe en `TEXTOS`
 *   y SIN linea secundaria (P2, humana, 2026-08-04). No se deja sin etiqueta: el nombre
 *   de la metrica esta en la cabecera de la seccion, pero un KPI sin etiqueta pierde el
 *   nombre accesible que la 132 le dio. Y donde iba el neto no va NADA: ni la etiqueta
 *   «Neto», ni un guion, ni el marcador de dato ausente (R19).
 */
function PanelKpi({
  vista,
  unidad,
}: {
  readonly vista: VistaFinanciera;
  readonly unidad: MetricaUnidad;
}) {
  const { total } = vista;
  if (total.forma === "solo_bruto") {
    return <KpiCard etiqueta={TEXTOS.bruto} valor={aNumero(total.bruto)} unidad={unidad} />;
  }
  return (
    <>
      <KpiCard etiqueta={TEXTOS.neto} valor={aNumero(total.neto)} unidad={unidad} />
      <p className="text-sm text-muted-foreground">
        {`${TEXTOS.bruto}: ${formatearValor(aNumero(total.bruto), unidad)}`}
      </p>
    </>
  );
}

/** Una serie con la cola ya agrupada: el paquete nunca recibe de mas (R20, R21 de la 132). */
function acotar(serie: SerieDato): SerieDato {
  return { ...serie, puntos: agruparCola(serie.puntos, MAX_SERIES, TEXTOS.otros) };
}

/**
 * Las series de una grafica comparativa: DOS donde el importe trae los dos campos, UNA
 * —la del bruto— donde no (R21 de la 183).
 *
 * Emitir dos series iguales donde el neto es `+bruto` por construccion consumiria el
 * techo `MAX_SERIES` al doble y pintaria dos veces la misma cifra con dos nombres.
 */
function seriesComparativas(vista: VistaFinanciera): readonly SerieDato[] {
  if (!esVistaConNeto(vista)) return [acotar(serieDeVista(vista, "bruto"))];
  return [acotar(serieDeVista(vista, "bruto")), acotar(serieDeVista(vista, "neto"))];
}

/**
 * La serie UNICA de una grafica que pinta una sola cifra: el `neto` donde lo hay —es la
 * cifra con signo, la que esa grafica lleva pintando desde la 132— y el `bruto` donde no.
 * Nunca las dos: el donut aplica el techo a los SEGMENTOS de la unica serie que pinta.
 */
function serieUnica(vista: VistaFinanciera): SerieDato {
  return esVistaConNeto(vista)
    ? acotar(serieDeVista(vista, "neto"))
    : acotar(serieDeVista(vista, "bruto"));
}

/** Tabla con TODAS las filas del DTO y, al lado, el total literal del DTO. */
function PanelTabla({
  titulo,
  vista,
  unidad,
}: {
  readonly titulo: string;
  readonly vista: VistaFinanciera;
  readonly unidad: MetricaUnidad;
}) {
  return (
    <>
      <TablaResumen
        titulo={`${titulo} · ${TEXTOS.detalle}`}
        encabezadoCategoria={TEXTOS.columnaTienda}
        columnas={columnasDeVista(vista)}
        filas={filasDeVista(vista)}
        vacio={TEXTO_VACIO}
      />
      <TotalDelDto total={vista.total} unidad={unidad} />
    </>
  );
}

/**
 * Que componente pinta cada vista, decidido por la FORMA del DTO y no por el
 * nombre de la metrica (R27).
 *
 * - la vista por metodo de `cod_recaudado` -> donut (tres segmentos como mucho);
 * - la vista por tienda de `cod_recaudado` -> barras (con la cola agrupada) MAS
 *   la tabla con todas las filas: la grafica se lee de un vistazo y la tabla no
 *   esconde ninguna tienda;
 * - una SERIE TEMPORAL (las seis de caja y la cuenta por pagar de mensajero, que declaran
 *   `granularidad` `dia` o `semana`) -> KPI: la cifra de titular del periodo. La 132 les
 *   dio esa forma y la 180 no la retiro; lo que la 180 añadio fue el desglose por fecha,
 *   cuyo panel de lineas es la ficha 186 y NO se adelanta aqui;
 * - una vista SIN filas -> KPI tambien: no hay tabla que pintar;
 * - cualquier otra vista con filas (los desgloses por tienda y por metodo) -> tabla.
 */
function ContenidoDeVista({
  titulo,
  vista,
  unidad,
}: {
  readonly titulo: string;
  readonly vista: VistaFinanciera;
  readonly unidad: MetricaUnidad;
}): ReactNode {
  if (vista.id === VISTA_COD_RECAUDADO_POR_METODO) {
    return (
      <>
        <GraficaDonut
          titulo={`${titulo} · ${TEXTOS.distribucion}`}
          series={[serieUnica(vista)]}
          unidad={unidad}
          vacio={TEXTO_VACIO}
        />
        <TotalDelDto total={vista.total} unidad={unidad} />
      </>
    );
  }

  if (vista.id === VISTA_COD_RECAUDADO_POR_TIENDA) {
    return (
      <>
        <GraficaBarras
          titulo={`${titulo} · ${TEXTOS.comparativa}`}
          series={seriesComparativas(vista)}
          unidad={unidad}
          vacio={TEXTO_VACIO}
        />
        <PanelTabla titulo={titulo} vista={vista} unidad={unidad} />
      </>
    );
  }

  // Las DOS conductas que la 132 declaro, y ninguna tercera: la serie temporal se lee como
  // cifra de titular, y una vista sin filas tampoco tiene tabla que pintar. Antes de la 180
  // la segunda condicion cubria a la primera por accidente; hoy hacen falta las dos.
  if (esVistaTemporal(vista) || vista.filas.length === 0) {
    return <PanelKpi vista={vista} unidad={unidad} />;
  }

  return <PanelTabla titulo={titulo} vista={vista} unidad={unidad} />;
}

/**
 * Una seccion por VISTA, con nombre accesible propio y distinto.
 *
 * Cuando una metrica trae mas de una vista (solo `cod_recaudado`), el nombre lleva
 * ademas el id de la vista: son dos cifras que no suman entre si y compartir
 * nombre las presentaria como dos mitades de la misma.
 */
function SeccionVista({
  datos,
  vista,
  desambiguar,
}: {
  readonly datos: ResultadoFinancieroVistas;
  readonly vista: VistaFinanciera;
  readonly desambiguar: boolean;
}) {
  const titulo = desambiguar ? `${datos.etiqueta} · ${vista.id}` : datos.etiqueta;
  return (
    <section aria-label={titulo} className="flex flex-col gap-2">
      <CabeceraPanel titulo={titulo} rango={datos.rango} esAcumulado={datos.esAcumulado} />
      {/* Q2 / R24: la limitacion se dice EN PANTALLA en vez de esconderla. */}
      {vista.grano === "tienda" ? (
        <p className="text-xs text-muted-foreground">{TEXTOS.limitacionTienda}</p>
      ) : null}
      <ContenidoDeVista titulo={titulo} vista={vista} unidad={datos.unidad} />
    </section>
  );
}

/**
 * Panel en error (R23): estado de error y NI UNA CIFRA.
 *
 * Se usa la prop `error` del paquete —que emite `role="alert"`— en vez de un
 * texto suelto: pintar un cero o una serie vacia aqui afirmaria que no hubo
 * movimiento, que es precisamente lo que no se sabe.
 */
function SeccionError({ panel }: { readonly panel: { id: string; mensaje: string } }) {
  return (
    <section aria-label={panel.id} className="flex flex-col gap-2">
      <KpiCard etiqueta={panel.id} valor={null} unidad="moneda" error={panel.mensaje} />
    </section>
  );
}

/** Un panel -> sus secciones. `denegado` devuelve NADA (R4): ni cero, ni vacio, ni motivo. */
function seccionesDePanel(panel: PanelFinanciero): ReactNode {
  if (panel.estado === "denegado") return null;
  if (panel.estado === "error") return <SeccionError key={panel.id} panel={panel} />;

  const { datos } = panel;
  if (datos.tipo === "conciliacion") {
    return <PanelConciliacion key={panel.id} datos={datos} />;
  }

  const desambiguar = datos.vistas.length > 1;
  return datos.vistas.map((vista) => (
    <SeccionVista
      key={`${panel.id}__${vista.id}`}
      datos={datos}
      vista={vista}
      desambiguar={desambiguar}
    />
  ));
}

/**
 * El tablero financiero: una seccion por vista servida, en el orden en que
 * `cargar.ts` las trajo (el de `IDS_FINANCIERAS_SERVIDAS`).
 */
export function TableroFinanciero({ paneles }: TableroFinancieroProps) {
  return (
    <div className="flex flex-col gap-8">
      {/* Sin envoltorio por panel A PROPOSITO: un `denegado` devuelve `null` y un
          `<div>` vacio alrededor dejaria un hueco donde R4 exige que no haya
          nada. Cada seccion trae su propia `key`. */}
      {paneles.map((panel) => seccionesDePanel(panel))}
    </div>
  );
}
