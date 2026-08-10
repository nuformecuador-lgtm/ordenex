"use client";

// Feature 184 — analitica financiera: export de la serie (T4.1, design §4.1/§4.3).
// EL CONTROL de descarga de UNA vista temporal de la region financiera.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la **188**. Esta feature se rotula con nombre, no solo con numero.
//
// POR QUE ESTE ARCHIVO NO VIVE EN `_components/financiero/`, y no es preferencia de reparto:
// el guardia `tests/unit/guards/tablero-financiero.guardia.test.ts` RECORRE aquella carpeta
// entera y exige que ningun archivo suyo declare la directiva de cliente. Un control de descarga
// es por fuerza un componente de cliente, y ese guardia tiene razon: la directiva ahi arrastraria
// el borde financiero —y con el Prisma— al bundle del navegador. De ahi este subarbol HERMANO
// (R28). El guardia del tablero queda VERDE sin tocarlo: editarlo para que pase invalidaria la
// decision D6.
//
// Componente cliente DELGADO: envuelve `DescargarDatasetButton` (151) y encierra en
// `obtenerFilas` lo unico que el control no sabe — que metrica y que vista. Ni un generador
// propio, ni un dialecto propio, ni un nombre de archivo propio: todo eso lo pone el patron
// 151/148/170 y aqui se REUSA tal cual (R23, R24, R25).
//
// LA PUERTA ES UNA (R1). Las filas salen de `consultarMetricaFinanciera` y de ninguna otra
// fuente. No se reconstruye el filtro y no se forja una consulta —forjarla ni siquiera
// compilaria: `ConsultaAnalitica` lleva una marca `unique symbol` no exportada (122/R16)—. Un
// camino propio hacia los datos traeria su propio control de permisos, su propio parseo y su
// propia forma de olvidarse de registrar el denegado.
//
// R2 — EL MISMO OBJETO DE FILTRO QUE LA PANTALLA. `FILTRO_FINANCIERO_POR_DEFECTO` se IMPORTA de
// `../financiero/rango`: es exactamente la misma instancia congelada que `cargar.ts` envia al
// pintar, y el test lo afirma por IDENTIDAD REFERENCIAL (`toBe`), no por igualdad. Escribir aqui
// un literal equivalente pasaria hoy y divergiria el dia que la region gane una barra de filtros.
//
// R5 — el borde se invoca con DOS argumentos. El tercero (`deps`) es el punto de inyeccion PARA
// TESTS y contiene funciones: usarlo desde produccion convertiria a este control en una segunda
// autoridad sobre «quien eres», que es justo lo que el borde de la 127 prohibe.
//
// SE VUELVE A CONSULTAR EN EL MOMENTO DEL CLICK, en vez de exportar el DTO que la pantalla ya
// tiene. Dos motivos independientes, y el segundo es especifico de esta region:
//  1. sin llamada nueva no hay 403 nuevo y NO HAY NADA QUE REGISTRAR (R6/R7). Si el permiso
//     caduco entre el render y el click, exportar desde memoria produciria un archivo
//     perfectamente valido de datos que el usuario ya no tiene derecho a descargar, y sin rastro;
//  2. pasar el DTO por props cruzaria el dinero a la frontera RSC. Hoy no cruza: la region es
//     entera de servidor. Serializarlo hacia un componente cliente pondria las cifras en el
//     payload RSC de todo el que abra la pagina, exporte o no. Eso es exposicion nueva a cambio
//     de nada.
//
// Consecuencia ACEPTADA y declarada: el archivo puede diferir de la pantalla en el ultimo cubo si
// pasan minutos entre el render y la descarga. El archivo no promete ser la foto de la pantalla,
// sino el mismo dato para el mismo ambito y el mismo filtro — y por eso cada fila lleva su
// `limitacion_conocida` (R30).

import { useRef } from "react";

import type { DescargaFilasResult } from "@/components/shared/DataTable";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { RespuestaFinanciera } from "@/lib/types/analitica-financiera";
import type { DescargaColumna, DescargaTipo } from "@/lib/types/descarga";

import { FILTRO_FINANCIERO_POR_DEFECTO } from "../financiero/rango";
import { COLUMNAS_DESCARGA_ANALITICA_FINANCIERA } from "./analitica-financiera-descarga-columnas";
import {
  columnasDeVistaFinanciera,
  filasDeVistaFinanciera,
  vistaTemporalDelResultado,
} from "./export-financiero";

/**
 * R25 / D5 de la 134 — LOS DOS FORMATOS DEL PATRON EXISTENTE, y ni uno propio.
 *
 * El dato concreto, escrito para que el siguiente no lo «arregle» cambiando el dialecto global:
 * `buildCsvRows` emite coma como separador, decimales con punto y UTF-8 sin BOM, y eso en Windows
 * con locale es-EC abre en UNA SOLA COLUMNA y rompe las tildes. La salida NO es cambiar el
 * dialecto —unas 25 tablas de la app dependen de el— sino ofrecer tambien la hoja de calculo en
 * este mismo control, que abre perfecto. Es ademas la salida declarada para el coste de D2: quien
 * necesite sumar en Excel tiene el otro formato.
 */
export const FORMATOS_EXPORT_FINANCIERO: DescargaTipo[] = ["csv", "xlsx"];

/* -------------------------------------------------------------------------- */
/* design §4.3 — los estados que NO producen archivo, con textos DISTINTOS     */
/* -------------------------------------------------------------------------- */

// R6 — «no puedes descargarlo» y «no hay nada que descargar» son dos problemas distintos y piden
// dos cosas distintas del usuario. Fundirlos convierte un problema de permisos en un problema de
// negocio que no existe, y el usuario ajustaria filtros para siempre buscando unas cifras que
// nunca va a poder descargar. El texto de «sin datos» lo pone el control comun (151) y NO se
// replica aqui: copiarlo seria la forma de que un dia dejen de ser distintos.

export const TEXTO_EXPORT_PROHIBIDO =
  "No tienes acceso a esta metrica, asi que no se genero ningun archivo. Consulta con un administrador si crees que deberias verla.";

/** Cabecera de los errores de campo; los detalles son las CLAVES que el borde reporta. */
export const TEXTO_EXPORT_FILTRO_INVALIDO =
  "El filtro no es valido, asi que no se genero ningun archivo.";

/**
 * R12 / D1 — la vista pedida no es una serie temporal, asi que no hay archivo y se DICE.
 *
 * No es una limitacion tecnica disfrazada: los desgloses que no son temporales viajan hoy con
 * identificadores crudos en la clave del cubo, y un archivo que circula no se puede retirar
 * despues. Resolver esos identificadores a nombres legibles es otra ficha.
 */
export const TEXTO_EXPORT_VISTA_NO_TEMPORAL =
  "Esta vista no es una serie por fecha, asi que no se genero ningun archivo. Por ahora solo se descargan las metricas con desglose temporal.";

/**
 * La lectura del dataset. Se inyecta en los tests (patron `deps` del repo); en produccion es
 * SIEMPRE la Server Action de la 127, invocada con DOS argumentos (R5).
 */
export type ConsultarFinanciera = (
  metricaId: string,
  filtro: unknown,
) => Promise<RespuestaFinanciera>;

/** Lo que el control necesita para una descarga: sus filas y las columnas de ESE archivo. */
export interface ExportFinancieroPreparado {
  readonly resultado: DescargaFilasResult;
  /** R13 — elegidas por la FORMA del importe del DTO, no por el id de la metrica. */
  readonly columnas: DescargaColumna[];
}

/** Un estado que no produce archivo: mensaje propio y el juego de columnas por defecto. */
function sinArchivo(mensaje: string): ExportFinancieroPreparado {
  return {
    resultado: { status: "error", mensaje },
    columnas: [...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA],
  };
}

/**
 * De una metrica + una vista a las filas del archivo. Es el UNICO punto que conoce que se
 * descarga, exactamente como pide el contrato de `DescargarDatasetButton` (D4 de la 151).
 *
 * R8 — un `validation_error` NO es un intento de acceso: el borde ya devuelve sin consultar y
 * SIN registrar, y aqui no se reintenta por otro camino. Meterlo en el canal donde se buscan los
 * intentos reales lo llenaria de ruido.
 *
 * R9 — el `error` del borde llega YA saneado (id de metrica + fechas del rango, sin datos
 * personales y sin el texto del error original): se transporta TAL CUAL. Componer aqui un mensaje
 * a partir del error original podria arrastrar una fila entera de la base hasta un toast.
 */
export async function prepararExportFinanciero(
  metricaId: string,
  vistaId: string,
  consultar: ConsultarFinanciera = consultarMetricaFinanciera,
): Promise<ExportFinancieroPreparado> {
  // R1/R2 — la unica puerta, con el MISMO objeto de filtro que la pantalla y con DOS argumentos.
  const respuesta = await consultar(metricaId, FILTRO_FINANCIERO_POR_DEFECTO);

  if (respuesta.status === "forbidden") {
    // R6/R7 — el registro del intento ya lo dejo el borde, ANTES de responder. Aqui no se
    // traduce el denegado a un `ok` vacio, que lo volveria indistinguible de «no hay datos».
    return sinArchivo(TEXTO_EXPORT_PROHIBIDO);
  }

  if (respuesta.status === "validation_error") {
    const claves = Object.keys(respuesta.fieldErrors).sort();
    return sinArchivo(
      claves.length === 0
        ? TEXTO_EXPORT_FILTRO_INVALIDO
        : `${TEXTO_EXPORT_FILTRO_INVALIDO} (${claves.join(", ")})`,
    );
  }

  if (respuesta.status === "error") {
    return sinArchivo(respuesta.mensaje);
  }

  const { datos } = respuesta;
  // El discriminante de la union, no el nombre de la metrica (R14): el DTO de conciliacion no
  // publica vistas, asi que no hay serie que proyectar.
  if (datos.tipo !== "vistas") return sinArchivo(TEXTO_EXPORT_VISTA_NO_TEMPORAL);

  const vista = vistaTemporalDelResultado(datos, vistaId);
  if (vista === null) return sinArchivo(TEXTO_EXPORT_VISTA_NO_TEMPORAL);

  return {
    // R22 — el tope UNICO de la app (`descargaConfig.MAX_FILAS`), aplicado por el adaptador comun
    // de la 170. Superarlo NO produce un archivo truncado: produce el mensaje accionable con el
    // total y el tope. Un archivo truncado es la peor de las salidas, porque parece completo.
    //
    // R21 — sin filas, `filas` queda vacio y el control comun avisa «no hay datos» sin producir
    // archivo. No se genera un archivo de cabecera sola: se reenvia y se lee como «no hubo
    // movimiento», que es otra afirmacion.
    resultado: await filasLocales(filasDeVistaFinanciera(datos, vista), (fila) => fila),
    columnas: columnasDeVistaFinanciera(vista),
  };
}

export interface ExportarVistaFinancieraProps {
  /** `datos.metricaId` del DTO que la seccion ya pinta. Plano, nunca una funcion (R28). */
  readonly metricaId: string;
  /** `vista.id` — id de VISTA, no de METRICA. */
  readonly vistaId: string;
  /** El MISMO titulo que rotula la seccion en pantalla (R24). */
  readonly titulo: string;
}

/**
 * R24 — el nombre del archivo lo produce `nombreArchivoDescarga` a partir del `titulo`:
 * `<slug del titulo>-YYYY-MM-DD.<extension>`. Aqui no se compone ningun nombre.
 *
 * R27/accesibilidad — el nombre accesible lo forma `DescargarDatasetButton` como
 * `Descargar <titulo>`, asi que con siete controles a la vista cada uno dice cual descarga. Y no
 * se escribe aqui ninguna condicion de permiso ni ninguna lista de perfiles: el control se
 * renderiza donde la region financiera se renderiza, y quien la ve lo decide la pagina.
 *
 * POR QUE EL JUEGO DE COLUMNAS VIVE EN UN REF Y NO EN ESTADO. `DescargarDatasetButton` entrega al
 * generador comun exactamente el array que recibio por props, en el mismo tick en que
 * `obtenerFilas` resuelve; un `setState` no llegaria a ese click. Y las columnas del archivo NO se
 * pueden fijar al renderizar: dependen de la FORMA del importe (R13), que solo se conoce cuando el
 * DTO llega. Por eso se pasa una instancia ESTABLE y `obtenerFilas` la fija con el juego que le
 * toca a ese archivo, justo antes de que el generador la lea. La alternativa —declarar las ocho
 * columnas siempre— dejaria una columna «Neto» VACIA en las metricas que no lo publican, y una
 * celda vacia significa «no se sabe» donde la verdad es «no aplica» (R13).
 */
export function ExportarVistaFinanciera({
  metricaId,
  vistaId,
  titulo,
}: ExportarVistaFinancieraProps) {
  const columnas = useRef<DescargaColumna[]>([...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA]);

  async function obtenerFilas(): Promise<DescargaFilasResult> {
    const preparado = await prepararExportFinanciero(metricaId, vistaId);
    columnas.current.splice(0, columnas.current.length, ...preparado.columnas);
    return preparado.resultado;
  }

  return (
    <DescargarDatasetButton
      titulo={titulo}
      columnas={columnas.current}
      obtenerFilas={obtenerFilas}
      formatos={FORMATOS_EXPORT_FINANCIERO}
      className="self-end"
    />
  );
}
