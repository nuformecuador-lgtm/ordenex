// Feature 132 (T4.1, T4.2) — los paneles del tablero financiero. SERVIDOR.
//
// Sin `"use client"` y sin fetch: el dato llega YA cargado por props desde el
// Server Component de la ruta (R9). Este archivo solo decide QUE componente de la
// 130 pinta cada vista y con que textos.
//
// Lo que NUNCA hace, y no es un olvido:
//
//  - NO pasa `avisoRecorte` (R10; R12 de la 186). Es la unica prop-funcion del
//    contrato de la 130 y una funcion no cruza la frontera RSC: un Server Component
//    que pase una funcion a un Client Component falla en RENDER, no en compilacion.
//    No hace falta, y por dos vias distintas: en los paneles de categoria
//    `agruparCola` garantiza POR CONSTRUCCION que no hay recorte que anunciar, y en
//    la linea temporal lo garantiza el SERVIDOR (R19/R20 de la 180: ningun rango
//    admisible pasa de `MAX_PUNTOS_SERIE` puntos). Ahi NO se recorta a proposito:
//    ver ⟨D7⟩ de la 186.
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
import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { TablaResumen } from "@/components/private/analytics/TablaResumen";
import { formatearValor } from "@/components/private/analytics/formato";
import { MAX_CATEGORIAS_LEGIBLES } from "@/components/private/analytics/topes";
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

import { ExportarVistaFinanciera } from "../export-financiero/ExportarVistaFinanciera";

import {
  aNumero,
  agruparCola,
  columnasDeVista,
  esVistaConNeto,
  esVistaTemporal,
  filasDeVista,
  serieDeVista,
  serieTemporalDeVista,
  type TextosCubo,
  type VistaTemporal,
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
  evolucion: "Evolución en el tiempo",
  vacioTitulo: "Sin movimientos en el rango",
  vacioDescripcion: "La consulta no devolvió ninguna categoría para este rango.",
  // Feature 186 ⟨D4⟩ — como se nombra un cubo. El prefijo declara el GRANO y la clave
  // del DTO se concatena literal: el contrato no publica el fin del cubo y el primero y
  // el ultimo estan truncados al rango, asi que un rotulo de rango seria falso justo en
  // los dos extremos. Aqui no se escribe ninguna fecha ni ningun literal de idioma: se
  // escribe la PALABRA que declara el grano, y la fecha la pone el DTO.
  cuboDia: "Día",
  cuboSemana: "Semana del",
  // ⟨D5⟩ — el grano que el rotulador no sabe nombrar. Decir "día" aqui seria afirmar un
  // grano que no sabemos, y una serie semanal leida como diaria miente sobre siete veces
  // mas dinero por punto.
  cuboGranoNoDeclarado: "Cubo",
  // Feature 186 R3 / ⟨D3⟩ (Q2 = (b), humana 2026-08-06) — POR QUE esta metrica no trae
  // gráfica, dicho EN PANTALLA. Seis metricas vecinas la tienen y esta no; sin
  // explicacion, la ausencia se lee como «falta un dato» o «se rompio algo». Nombra el
  // MOTIVO (un saldo acumulado es monotono por construccion), no solo el hecho.
  //
  // NO repite la frase de `saldoAlCorte`, y no es casualidad: aquella habla del TOTAL
  // (R18 de la 132) y esta de por que no hay serie dibujada. Son dos afirmaciones
  // distintas y fundirlas dejaria una sola frase que no dice ninguna de las dos.
  sinSerieAcumulado:
    "Esta cifra es un saldo acumulado, no el movimiento del período: dibujada como línea solo podría subir o mantenerse, y se leería como una tendencia sin serlo. Por eso esta métrica no trae gráfica de evolución.",
} as const;

const TEXTO_VACIO = {
  titulo: TEXTOS.vacioTitulo,
  descripcion: TEXTOS.vacioDescripcion,
} as const;

/**
 * Los textos con los que `adaptar.ts` rotula cada cubo.
 *
 * Se componen aqui y no alli por la misma razon que `etiquetaOtros` en `agruparCola`: el
 * modulo puro no escribe texto de UI, para que la region entera tenga sus cadenas en un
 * solo objeto y quede lista para i18n sin tocar un adaptador.
 */
const TEXTOS_CUBO: TextosCubo = {
  dia: TEXTOS.cuboDia,
  semana: TEXTOS.cuboSemana,
  granoNoDeclarado: TEXTOS.cuboGranoNoDeclarado,
};

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
  return { ...serie, puntos: agruparCola(serie.puntos, MAX_CATEGORIAS_LEGIBLES, TEXTOS.otros) };
}

/**
 * Las series de una grafica comparativa: DOS donde el importe trae los dos campos, UNA
 * —la del bruto— donde no (R21 de la 183).
 *
 * Emitir dos series iguales donde el neto es `+bruto` por construccion consumiria el
 * techo `MAX_CATEGORIAS_LEGIBLES` al doble y pintaria dos veces la misma cifra con dos nombres.
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

/**
 * Las series de la LINEA temporal: DOS donde el importe trae los dos campos, UNA —la del
 * bruto— donde no. Mismo criterio y mismo motivo que `seriesComparativas`.
 *
 * NO pasa por `acotar` A PROPOSITO (⟨D7⟩ de la 186): fundir fechas en «Otros» no significa
 * nada en un eje de tiempo, se comeria el final de la serie —que es lo que se mira— y
 * escondería el dia en que la garantia del servidor (R19/R20 de la 180) se rompa. Si el
 * servicio mandara mas de `MAX_PUNTOS_SERIE` puntos, lo correcto es que `aplicarTopePuntos`
 * lance fuera de produccion, que es para lo que esta escrito.
 */
function seriesTemporales(vista: VistaTemporal): readonly SerieDato[] {
  if (!esVistaConNeto(vista)) return [serieTemporalDeVista(vista, "bruto", TEXTOS_CUBO)];
  return [
    serieTemporalDeVista(vista, "bruto", TEXTOS_CUBO),
    serieTemporalDeVista(vista, "neto", TEXTOS_CUBO),
  ];
}

/**
 * La linea de una vista temporal de metrica de FLUJO (R1 de la 186).
 *
 * El titulo lleva el sufijo de pieza porque `GraficaMarco` emite su propia
 * `<section aria-label>`: dos regiones con el mismo nombre son indistinguibles para un
 * lector de pantalla, y esta cuelga dentro de la seccion de la vista.
 *
 * Una grafica POR VISTA, y no una combinada con las seis metricas de flujo: seis series
 * (mas, contando `bruto` y `neto`) superan `MAX_CATEGORIAS_LEGIBLES` y `aplicarTopeSeries` LANZA fuera
 * de produccion; y el DTO no declara sumabilidad entre metricas, solo entre vistas.
 */
function PanelLineas({
  titulo,
  vista,
  unidad,
}: {
  readonly titulo: string;
  readonly vista: VistaTemporal;
  readonly unidad: MetricaUnidad;
}) {
  return (
    <GraficaLineas
      titulo={`${titulo} · ${TEXTOS.evolucion}`}
      series={seriesTemporales(vista)}
      unidad={unidad}
      vacio={TEXTO_VACIO}
    />
  );
}

/**
 * Por que una vista temporal ACUMULADA no trae linea, dicho en pantalla (R3 de la 186).
 *
 * Lo decide el DTO (`esAcumulado`), no una lista de ids escrita aqui — igual que el «saldo
 * al corte» de `CabeceraPanel` (R18 de la 132). El tablero no sabe, ni tiene por que saber,
 * cual es la metrica que hoy cae en esta rama.
 */
function MotivoSinSerie() {
  return <p className="text-xs text-muted-foreground">{TEXTOS.sinSerieAcumulado}</p>;
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
 *   un grano temporal) -> KPI: la cifra de titular del periodo. La 132 les dio esa forma,
 *   la 180 no la retiro y la 186 no la retira tampoco: lo que la 186 añade es la LINEA
 *   ENCIMA del KPI (R14), no en su lugar;
 * - una vista SIN filas -> KPI tambien: no hay tabla que pintar;
 * - cualquier otra vista con filas (los desgloses por tienda y por metodo) -> tabla.
 *
 * La linea se añade DENTRO de la rama del KPI y no como una quinta rama (⟨D8⟩ de la 186):
 * asi la conducta que el hotfix del 2026-08-06 restauro —toda vista temporal es KPI— se
 * conserva literalmente y lo nuevo cuelga de ella en vez de competir con ella.
 */
function ContenidoDeVista({
  titulo,
  vista,
  unidad,
  esAcumulado,
}: {
  readonly titulo: string;
  readonly vista: VistaFinanciera;
  readonly unidad: MetricaUnidad;
  /** Del DTO, no de una lista de ids: vive en la cabecera de la metrica (R43 de la 127). */
  readonly esAcumulado: boolean;
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
    return (
      <>
        <PanelKpi vista={vista} unidad={unidad} />
        {/* R1 / R3 / R4 de la 186 — la linea va donde hay grano temporal Y la metrica es
            de FLUJO; donde es un ACUMULADO va el motivo escrito, y donde no hay grano
            temporal no va ninguna de las dos cosas. Las dos preguntas salen del DTO
            (`granularidad` y `esAcumulado`) y de ningun id de metrica (R6). */}
        {esVistaTemporal(vista) && !esAcumulado ? (
          <PanelLineas titulo={titulo} vista={vista} unidad={unidad} />
        ) : null}
        {esVistaTemporal(vista) && esAcumulado ? <MotivoSinSerie /> : null}
      </>
    );
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
      {/* Feature 184 — analitica financiera: export de la serie (⟨D6⟩ humano, 2026-08-08).
          LA UNICA insercion de esa feature en este archivo, y con su condicion integra: no
          añade la directiva de cliente aqui (el control vive en el subarbol HERMANO
          `_components/export-financiero/`, porque el censo de esta carpeta la prohibe y
          tiene razon: arrastraria el borde financiero —y con el Prisma— al navegador), no
          pasa ninguna prop-funcion (las tres son cadenas del DTO que esta seccion ya pinta)
          y no nombra ningun grano ni ningun id de metrica: la pregunta la responde
          `esVistaTemporal`, que vive en `adaptar.ts`. Solo las vistas temporales, porque en
          ellas la clave del cubo es una fecha por construccion y el archivo no puede llevar
          un identificador ni por descuido (⟨D1⟩). */}
      {esVistaTemporal(vista) ? (
        <ExportarVistaFinanciera
          metricaId={datos.metricaId}
          vistaId={vista.id}
          titulo={titulo}
        />
      ) : null}
      <ContenidoDeVista
        titulo={titulo}
        vista={vista}
        unidad={datos.unidad}
        esAcumulado={datos.esAcumulado}
      />
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
