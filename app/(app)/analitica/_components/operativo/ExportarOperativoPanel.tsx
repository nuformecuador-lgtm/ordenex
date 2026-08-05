"use client";

// Feature 134 (T4.1, design §4.1/§4.3) — EL CONTROL de descarga de UN panel operativo.
//
// Componente cliente DELGADO: envuelve `DescargarDatasetButton` (feature 151) y encierra en
// `obtenerFilas` lo unico que el control no sabe — que panel y que filtro. Ni un generador
// propio, ni un dialecto propio, ni un nombre de archivo propio: todo eso lo pone el patron
// 151/148/170 y aqui se REUSA tal cual.
//
// LA PUERTA ES UNA (R1). Las filas salen de `consultarAnaliticaOperativa` y de ninguna otra
// fuente. No se reconstruye el filtro y no se forja una consulta —forjarla ni siquiera
// compilaria: `ConsultaAnalitica` lleva una marca `unique symbol` no exportada (feature
// 122/R16)—. Un camino propio hacia los datos traeria su propio gating, su propio parseo y
// su propia forma de olvidarse de auditar el denegado.
//
// R2 — EL MISMO `raw` Y LA MISMA `desagregacion` QUE EL PANEL. Los dos salen de `aRaw()`
// sobre el MISMO `FiltroTablero`. Si el export tradujera el filtro por su cuenta, el dia que
// las dos traducciones divergieran el archivo diria una cosa y la pantalla otra, y no habria
// nada que fallara.
//
// R5/R6 — SE VUELVE A CONSULTAR EN EL MOMENTO DEL CLICK (patron `filasDelConjuntoCompleto`
// de la 170), en vez de exportar el objeto que SWR tiene en memoria. Motivo: si el permiso
// caduco entre el render y el click, el denegado tiene que ocurrir Y AUDITARSE en ese
// momento. Un export servido desde memoria produciria un archivo perfectamente valido de
// datos que el usuario ya no tiene derecho a descargar, y no dejaria rastro de nada.
//
// Consecuencia ACEPTADA (design §4.1): el archivo puede diferir de la grafica en el punto del
// dia en curso si pasan minutos entre el render y la descarga. Por eso la fila parcial lleva
// su propio `corte_at` (R13): el archivo no promete ser la foto de la pantalla, sino el mismo
// dato para el mismo alcance y el mismo filtro.

import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import type { DescargaFilasResult } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import type { EntradaOperativa } from "@/lib/actions/analitica-operativa";
import type { ResultadoOperativo } from "@/lib/types/analitica-operativa";
import type { DescargaTipo } from "@/lib/types/descarga";

import {
  COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
  type FuenteExport,
} from "./analitica-operativa-descarga-columnas";
import type { PanelTablero } from "./catalogo-paneles";
import { filasDeSerie } from "./export-operativo";
import { aRaw, type FiltroTablero } from "./filtro-tablero";
import { lineasDeValidacion } from "./textos";

/**
 * D5/R21 — LOS DOS FORMATOS DEL PATRON EXISTENTE, y ni uno propio.
 *
 * El dato concreto, escrito para que el siguiente no lo «arregle» cambiando el dialecto
 * global: `buildCsvRows` emite coma como separador, decimales con punto y UTF-8 sin BOM, y
 * eso en Windows con locale es-EC abre en UNA SOLA COLUMNA y rompe las tildes. La salida NO
 * es cambiar el dialecto —25 tablas de la app dependen de el— sino ofrecer tambien XLSX en
 * este mismo control, que abre perfecto.
 */
export const FORMATOS_EXPORT_OPERATIVO: DescargaTipo[] = ["csv", "xlsx"];

/* -------------------------------------------------------------------------- */
/* design §4.3 — los estados que NO producen archivo, con textos DISTINTOS      */
/* -------------------------------------------------------------------------- */

// R5 — «no puedes descargarlo» y «no hay nada que descargar» son dos problemas distintos y
// piden dos cosas distintas del usuario. Fundirlos convierte un problema de permisos en un
// problema de negocio que no existe. El texto de «sin datos» lo pone el control comun
// (feature 151) y NO se replica aqui: si se copiara, este archivo tendria una segunda
// version del mismo mensaje, que es la forma de que un dia dejen de ser distintos.

export const TEXTO_EXPORT_PROHIBIDO =
  "No tienes acceso a esta metrica, asi que no se genero ningun archivo. Consulta con un administrador si crees que deberias verla.";

export const TEXTO_EXPORT_SESION_NO_VALIDA =
  "Tu sesion no es valida o ha caducado, asi que no se genero ningun archivo. Vuelve a iniciar sesion y repite la descarga.";

/** Cabecera de los errores de campo: los detalles los pone `lineasDeValidacion` (131). */
export const TEXTO_EXPORT_FILTRO_INVALIDO =
  "El filtro no es valido, asi que no se genero ningun archivo.";

/**
 * La lectura del dataset. Se inyecta en los tests (patron `deps` del repo); en produccion
 * SIEMPRE es la Server Action de la 126.
 */
export type ConsultarOperativa = (entrada: EntradaOperativa) => Promise<ResultadoOperativo>;

/**
 * De un panel + un filtro a las filas del archivo. Es el UNICO punto que conoce filtros y
 * metricas, exactamente como pide el contrato de `DescargarDatasetButton` (D4 de la 151).
 *
 * La precedencia de los estados es la misma que la del panel (`reducirResultados`): una
 * sesion caida explica cualquier otra cosa, y un denegado explica un filtro raro. No es
 * cosmetica: decidir aqui otro orden haria que la misma respuesta produjese en la pantalla
 * un mensaje y en la descarga otro.
 */
export async function filasDelPanel(
  panel: PanelTablero,
  filtro: FiltroTablero,
  consultar: ConsultarOperativa = consultarAnaliticaOperativa,
): Promise<DescargaFilasResult> {
  // R2 — el MISMO `aRaw` del panel, sobre el MISMO filtro. No hay segunda traduccion.
  const raw = aRaw(filtro);
  const resultados = await Promise.all(
    panel.metricas.map((metrica) =>
      consultar({
        metricaId: metrica.metricaId,
        raw,
        // R2 — la desagregacion viaja tambien: omitirla produciria un archivo sin el
        // desglose que el panel SI esta pintando.
        ...(panel.desagregacion ? { desagregacion: panel.desagregacion } : {}),
      }),
    ),
  );

  if (resultados.some((r) => r.status === "unauthenticated")) {
    return { status: "error", mensaje: TEXTO_EXPORT_SESION_NO_VALIDA };
  }
  // R5 — sin archivo y con mensaje PROPIO. La auditoria del intento ya la dejo el borde
  // (126), ANTES de responder: aqui no se reintenta por otro camino ni se traduce el
  // denegado a un `ok` vacio, que lo volveria indistinguible de «no hay datos».
  if (resultados.some((r) => r.status === "forbidden")) {
    return { status: "error", mensaje: TEXTO_EXPORT_PROHIBIDO };
  }
  // R18 — un filtro malformado NO es un intento de acceso y no se audita (el borde ya
  // devuelve sin consultar y sin registrar). Meterlo en el canal de auditoria llenaria de
  // ruido justo el sitio donde se busca el intento real.
  const invalido = resultados.find((r) => r.status === "validation_error");
  if (invalido && invalido.status === "validation_error") {
    const lineas = lineasDeValidacion(invalido.fieldErrors);
    return {
      status: "error",
      mensaje: [TEXTO_EXPORT_FILTRO_INVALIDO, ...lineas].join(" "),
    };
  }

  const fuentes: FuenteExport[] = [];
  resultados.forEach((resultado, indice) => {
    if (resultado.status !== "ok") return;
    const metrica = panel.metricas[indice];
    fuentes.push({
      etiqueta: metrica?.etiqueta ?? resultado.datos.metricaId,
      serie: resultado.datos,
    });
  });

  // R16 — el tope UNICO de la app (`descargaConfig.MAX_FILAS`), aplicado por el adaptador
  // comun de la 170. Superarlo NO produce archivo truncado: produce el mensaje accionable
  // con el total y el tope. Un archivo truncado es la peor de las salidas, porque parece
  // completo.
  //
  // R17 — sin puntos, `filas` queda vacio y el control avisa «no hay datos» sin producir
  // archivo (feature 151). No se genera un CSV con solo cabecera: un archivo de cabecera
  // sola se reenvia y se lee como «no hubo actividad», que es una afirmacion distinta.
  return filasLocales(filasDeSerie(fuentes), (fila) => fila);
}

export interface ExportarOperativoPanelProps {
  readonly panel: PanelTablero;
  readonly filtro: FiltroTablero;
}

/**
 * R20 — el nombre del archivo lo produce `nombreArchivoDescarga` a partir del `titulo`:
 * `<slug del titulo>-YYYY-MM-DD.<ext>`. Aqui no se compone ningun nombre.
 *
 * R21/accesibilidad — el nombre accesible del control lo forma `DescargarDatasetButton`
 * como `Descargar <titulo del panel>`, asi que con seis paneles a la vista cada control
 * dice cual descarga.
 */
export function ExportarOperativoPanel({ panel, filtro }: ExportarOperativoPanelProps) {
  return (
    <DescargarDatasetButton
      titulo={panel.titulo}
      columnas={COLUMNAS_DESCARGA_ANALITICA_OPERATIVA}
      obtenerFilas={() => filasDelPanel(panel, filtro)}
      formatos={FORMATOS_EXPORT_OPERATIVO}
      className="self-end"
    />
  );
}
