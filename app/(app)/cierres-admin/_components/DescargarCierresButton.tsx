"use client";

import { useState } from "react";

import { ColumnasPopover } from "@/components/shared/ColumnasPopover";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import type { DataTableDescarga } from "@/components/shared/DataTable";
import { RadioGroup, type RadioGroupOption } from "@/components/ui/radio-group";
import { usePreferenciaColumnas } from "@/hooks/usePreferenciaColumnas";
import { claveDeAmbitoDescarga } from "@/lib/columnas/preferencia-columnas";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";
import type { DescargaColumna } from "@/lib/types/descarga";

import {
  DescargarGestionesDialog,
  type AccionGestionesDescarga,
} from "./DescargarGestionesDialog";
import {
  AMBITO_DESCARGA_GESTIONES_FUNDIDA,
  COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
} from "./cierres-gestiones-fundida-descarga-columnas";

/**
 * UN SOLO botón «Descargar» para las dos pantallas de cierres del maestro (pedido humano del
 * 2026-09-05), con el NIVEL DE DETALLE como primera decisión de su selector.
 *
 * ── QUÉ SUSTITUYE, Y POR QUÉ NO ERAN DOS BOTONES ─────────────────────────────────────────
 * Hasta hoy la pantalla ofrecía «Descargar» y «Descargar detallada», uno al lado del otro. No
 * son dos archivos distintos: son el MISMO archivo con dos GRANOS. Medido en producción con 4
 * cierres pendientes, el primero daba 4 filas (una por cierre) y el segundo 118 (una por
 * gestión). Dos botones con el mismo verbo y sin decir en qué se diferencian obligan a
 * probarlos para saber cuál se quería; una sola decisión explícita —«¿resumen o detalle?»— la
 * responde antes de descargar nada.
 *
 * ── DÓNDE SE ELIGE EL NIVEL, Y POR QUÉ AHÍ ───────────────────────────────────────────────
 * En el MISMO popover donde se eligen las columnas, y arriba del todo. Es una sola decisión
 * encadenada: el nivel determina QUÉ juego de columnas se ofrece debajo. Separarlos —un
 * conmutador fuera, las columnas dentro— dejaría al usuario marcando casillas de una hoja que
 * no es la que va a bajar.
 *
 * La preferencia de columnas es POR NIVEL, con un ámbito propio cada uno: son juegos distintos
 * (7 columnas frente a 29) y compartir clave haría que ocultar «Motivo» en el resumen moviera
 * en silencio lo guardado del detalle. El nivel elegido, en cambio, NO se persiste: es la
 * pregunta que el maestro contesta cada vez, y arrancar siempre en «Resumen» conserva lo que el
 * botón simple hacía hasta hoy —un clic y el archivo—.
 *
 * ── LOS FILTROS DE MENSAJERO Y RANGO: SE CONSERVAN, Y SOLO EN «DETALLE» ──────────────────
 * Se ofrecen donde ya vivían —la ventana de `DescargarGestionesDialog`— y esa ventana es lo que
 * el botón abre cuando el nivel es «Detalle». En «Resumen» el botón descarga directo, como
 * siempre.
 *
 * Las tres alternativas descartadas, y por qué:
 *  · Meter mensajeros y fechas DENTRO del popover. Es una lista con scroll de toda la flota más
 *    dos fechas más 29 casillas de columnas en un panel de 20rem: la elección de columnas
 *    quedaría fuera de la vista justo cuando hay más que elegir.
 *  · Ofrecerlos SIEMPRE, también en «Resumen». Serían controles que no recortan nada de ese
 *    archivo (el resumen sale de los filtros de la pantalla, no de los del diálogo): un filtro
 *    que se puede poner y no hace nada es peor que uno que no está.
 *  · Aplicar en «Detalle» los filtros de la barra de la pantalla. Cambiaría el conjunto que hoy
 *    se descarga sin que nadie lo haya pedido, y esa independencia está decidida (D11, R34/R35).
 *
 * ── LO QUE ESTE CONTROL NO HACE ──────────────────────────────────────────────────────────
 * No genera el archivo, no conoce el tope de filas y no redacta ningún mensaje de error: eso es
 * de `DescargarDatasetButton` y `filasDesdeResultado`, que siguen siendo el único camino. Aquí
 * solo se decide QUÉ columnas y QUÉ nivel, y se monta el control que corresponde.
 *
 * Tampoco importa ninguna Server Action: la recibe por prop, igual que el diálogo, para que la
 * puerta única de cada pantalla siga siendo comprobable por lectura de fuente
 * (`tests/unit/descarga/cierres-descarga-detallada-puerta.test.ts`).
 */

// --- Textos (separados de la lógica, i18n-ready) --------------------------

/** Nombre accesible del disparador del selector. Dice las DOS cosas que se eligen dentro. */
export const SELECTOR_DISPARADOR = "Elegir el detalle y las columnas de la descarga";
/** Encabezado del popup. */
const SELECTOR_TITULO = "Qué se descarga";
/** Rótulo del grupo de opciones y nombre accesible del `radiogroup`. */
export const NIVEL_LEGEND = "Nivel de detalle";
/** Rótulo de la lista de columnas, dentro del mismo popup. */
const COLUMNAS_LEGEND = "Columnas del archivo";
/**
 * Las dos opciones. Cada etiqueta DICE EL GRANO —«una fila por cierre» / «una fila por
 * gestión»—, que es exactamente lo que los dos botones de antes no decían.
 */
export const NIVEL_RESUMEN_LABEL = "Resumen · una fila por cierre";
export const NIVEL_DETALLE_LABEL = "Detalle · una fila por gestión";
/** Por qué el detalle no deja mover columnas. Se muestra bajo su lista. */
const NOTA_ORDEN_FIJO =
  "El orden de esta hoja es fijo: primero las columnas que siempre traen dato y después las que dependen del resultado de cada gestión. Podés ocultar las que no uses.";

// --- Niveles ---------------------------------------------------------------

const NIVEL_RESUMEN = "resumen";
const NIVEL_DETALLE = "detalle";
type Nivel = typeof NIVEL_RESUMEN | typeof NIVEL_DETALLE;

const OPCIONES_NIVEL: readonly RadioGroupOption[] = [
  { value: NIVEL_RESUMEN, label: NIVEL_RESUMEN_LABEL },
  { value: NIVEL_DETALLE, label: NIVEL_DETALLE_LABEL },
];

/**
 * El nivel «Detalle»: la hoja fundida y su ámbito, que es el MISMO en las dos pantallas.
 *
 * Se escribe como una asignación `ambitoColumnas: <CONSTANTE>` —y no como un `?:` de tipo ni
 * como una expresión— a propósito: `ambito-columnas.guardia` lee el árbol COMO TEXTO y solo
 * resuelve literales e identificadores. Una forma más lista (un mapa indexado, un ternario) le
 * sale `null` y la pone roja, y con razón: lo que no puede resolver, no puede comprobar que sea
 * único. Éste es el ÚNICO módulo que lo asigna, que es lo que permite compartirlo entre las dos
 * pantallas sin que la guardia lo lea como un duplicado.
 */
const DETALLE_GESTIONES = {
  columnas: COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
  ambitoColumnas: AMBITO_DESCARGA_GESTIONES_FUNDIDA,
};

/**
 * La descarga de RESUMEN de la pestaña activa, tal y como la pantalla ya la declaraba, con una
 * exigencia extra: su `ambitoColumnas` deja de ser opcional.
 *
 * Sin ámbito no hay preferencia que guardar, y este control no puede degradarse a «pues no
 * guardo»: el selector es ahora el único sitio donde se elige también el nivel, así que una
 * pantalla que se olvidara del ámbito perdería el selector entero. Que lo cace el compilador.
 *
 * Se escribe con `Required<Pick<…>>` y no repitiendo el campo, para no dejar en el árbol una
 * segunda forma `ambitoColumnas: <tipo>` que `ambito-columnas.guardia` leería como una
 * asignación sin resolver.
 */
export type DescargaResumenCierres = DataTableDescarga &
  Required<Pick<DataTableDescarga, "ambitoColumnas">>;

export interface DescargarCierresButtonProps {
  /** La descarga de una fila por CIERRE: la de la pestaña que se está mirando. */
  resumen: DescargaResumenCierres;
  /** Opciones YA acotadas al alcance del actor, resueltas en el servidor (R29). */
  catalogo: CatalogoFiltrosCierresDTO;
  /** El ÚNICO punto de entrada de servidor del DETALLE en esta pantalla (R13). */
  accion: AccionGestionesDescarga;
  /** `true` mientras la pantalla tiene una lectura en vuelo. */
  disabled?: boolean;
}

/**
 * Accesores del ámbito, a NIVEL DE MÓDULO y no inline: son dependencias de los `useMemo` del
 * hook de preferencia, y una función creada en el render cambia de identidad cada vez.
 */
function claveDeDescarga(columna: DescargaColumna): string {
  return columna.clave;
}

function etiquetaDeDescarga(columna: DescargaColumna): string {
  return columna.encabezado;
}

export function DescargarCierresButton({
  resumen,
  catalogo,
  accion,
  disabled = false,
}: Readonly<DescargarCierresButtonProps>) {
  const [nivel, setNivel] = useState<Nivel>(NIVEL_RESUMEN);
  const esDetalle = nivel === NIVEL_DETALLE;

  // El nivel activo entero, y de él sus columnas y su ámbito. El del resumen es el de la
  // pestaña que se está mirando (cada una el suyo); el del detalle es común a las dos pantallas
  // (R26).
  //
  // Se elige el OBJETO y luego se leen sus campos, en vez de un ternario por campo. No es
  // estilo: `ambito-columnas.guardia` busca `ambitoColumnas` seguido de dos puntos, y los dos
  // puntos de un ternario (`… ? a.ambitoColumnas : b.ambitoColumnas`) le parecen una asignación
  // que no sabe resolver — la guardia lo cazó al primer intento y tenía razón, porque un ámbito
  // que no puede leer es un ámbito cuya unicidad no puede comprobar.
  const nivelActivo = esDetalle ? DETALLE_GESTIONES : resumen;
  const columnas = nivelActivo.columnas;
  const clave = claveDeAmbitoDescarga(nivelActivo.ambitoColumnas);

  // Las MARCADAS, en el orden efectivo del ámbito. Se resuelven aquí y viajan ya resueltas al
  // control que descarga, que por eso NO declara ámbito: si lo declarara montaría un segundo
  // selector, y habría dos sitios para la misma decisión.
  const { visibles } = usePreferenciaColumnas(clave, columnas, claveDeDescarga);

  const encabezadoSelector = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{NIVEL_LEGEND}</span>
        <RadioGroup
          value={nivel}
          onValueChange={(valor) =>
            setNivel(valor === NIVEL_DETALLE ? NIVEL_DETALLE : NIVEL_RESUMEN)
          }
          options={OPCIONES_NIVEL}
          aria-label={NIVEL_LEGEND}
        />
      </div>
      <span className="text-sm font-medium">{COLUMNAS_LEGEND}</span>
    </div>
  );

  return (
    <div className="inline-flex items-center gap-1">
      {/* El botón, y solo uno: en «Resumen» descarga; en «Detalle» abre la ventana donde se
          elige el conjunto (mensajeros y rango) y desde la que se descarga. */}
      {esDetalle ? (
        <DescargarGestionesDialog
          catalogo={catalogo}
          accion={accion}
          columnas={visibles}
          disabled={disabled}
        />
      ) : (
        <DescargarDatasetButton
          titulo={resumen.titulo}
          columnas={visibles}
          obtenerFilas={resumen.obtenerFilas}
          formatos={resumen.formatos}
        />
      )}

      {/* Control PARALELO al botón, no un paso de su camino: abrirlo no descarga nada, y el
          botón sigue descargando en un click con lo ya elegido. */}
      <ColumnasPopover
        claveAlmacenamiento={clave}
        publicadas={columnas}
        claveDe={claveDeDescarga}
        etiquetaDe={etiquetaDeDescarga}
        titulo={SELECTOR_TITULO}
        etiquetaDisparador={SELECTOR_DISPARADOR}
        encabezado={encabezadoSelector}
        // El detalle OCULTA pero no REORDENA: el orden de esa hoja es lo que la hace legible.
        // El resumen sí se reordena, como hasta hoy.
        permitirReordenar={!esDetalle}
        notaOrden={NOTA_ORDEN_FIJO}
      />
    </div>
  );
}
