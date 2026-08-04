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
//    grano, si trae filas), no por un `switch` sobre nombres de metrica.
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

import { COLUMNAS_IMPORTE, aNumero, agruparCola, filasDeVista, serieDeVista } from "./adaptar";
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
 * El `total` del DTO, bruto y neto, etiquetados y distinguibles (R14, R16).
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
      <div className="flex items-baseline gap-2">
        <dt className="text-muted-foreground">{TEXTOS.totalNeto}</dt>
        <dd className="font-semibold tabular-nums text-foreground">
          {formatearValor(aNumero(total.neto), unidad)}
        </dd>
      </div>
      <div className="flex items-baseline gap-2">
        <dt className="text-muted-foreground">{TEXTOS.totalBruto}</dt>
        <dd className="tabular-nums text-foreground">
          {formatearValor(aNumero(total.bruto), unidad)}
        </dd>
      </div>
    </dl>
  );
}

/** KPI: el `neto` como cifra y el `bruto` en una linea secundaria VISIBLE (R16). */
function PanelKpi({
  vista,
  unidad,
}: {
  readonly vista: VistaFinanciera;
  readonly unidad: MetricaUnidad;
}) {
  return (
    <>
      <KpiCard etiqueta={TEXTOS.neto} valor={aNumero(vista.total.neto)} unidad={unidad} />
      <p className="text-sm text-muted-foreground">
        {`${TEXTOS.bruto}: ${formatearValor(aNumero(vista.total.bruto), unidad)}`}
      </p>
    </>
  );
}

/** Serie de una vista con la cola ya agrupada: el paquete nunca recibe de mas (R20, R21). */
function serieAcotada(vista: VistaFinanciera, campo: "bruto" | "neto"): SerieDato {
  const serie = serieDeVista(vista, campo);
  return { ...serie, puntos: agruparCola(serie.puntos, MAX_SERIES, TEXTOS.otros) };
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
        columnas={COLUMNAS_IMPORTE}
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
 * - una vista SIN filas (las cuatro de caja y la cuenta por pagar de mensajero,
 *   que el servicio devuelve agregadas a proposito) -> KPI;
 * - cualquier otra vista con filas -> tabla.
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
          series={[serieAcotada(vista, "neto")]}
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
          series={[serieAcotada(vista, "bruto"), serieAcotada(vista, "neto")]}
          unidad={unidad}
          vacio={TEXTO_VACIO}
        />
        <PanelTabla titulo={titulo} vista={vista} unidad={unidad} />
      </>
    );
  }

  if (vista.filas.length === 0) {
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
