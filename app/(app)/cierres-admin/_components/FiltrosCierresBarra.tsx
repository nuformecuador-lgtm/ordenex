"use client";

import { useMemo, useState } from "react";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosCierres,
} from "@/lib/types/filtros-cierres";

/**
 * Pedido humano del 2026-08-16 — la barra de filtros de los cierres del día: fecha, bodega y
 * mensajero.
 *
 * ES LA MISMA BARRA DE `/ordenes`, no una parecida: `BuscadorFiltros` (el contenedor con el
 * selector «Filtros») envolviendo un `FilterComponent` (los controles). Fue pedido explícito
 * ese mismo día, y trae consigo el reparto que aquella pantalla ya había decidido: los filtros
 * se PIDEN uno a uno en vez de ocupar media pantalla en todas las visitas, y «Limpiar todo» se
 * lleva por delante la selección Y los controles pedidos.
 *
 * TRES REGLAS DEL HUMANO, y las tres viven aquí o en el catálogo que alimenta esta barra:
 *
 *  1. **La bodega es la ZONA**, y solo se ofrecen las que pueden serlo: las que tienen admin de
 *     zona asignado, más la GAM. Eso lo resuelve el servidor
 *     (`CierresAdminRepository.findCatalogoFiltros`), no esta barra.
 *  2. **Los mensajeros del desplegable son los que están EN PIE.** Esta regla decía justo lo
 *     contrario hasta la ficha 351 («son todos, incluidos los dados de baja, que siguen siendo
 *     dueños de sus cierres pasados»); el humano la revirtió tras ver cuentas de baja ofrecidas
 *     en los filtros: «muestra tiendas o mensajeros que tenemos desactivos y eso es información
 *     que no debe mostrarse». Lo que aquel argumento protegía NO se pierde: los cierres del
 *     mensajero dado de baja siguen listándose con su nombre —ningún listado mira el estado de
 *     su dueño—; lo único que desaparece es su OPCIÓN para acotar.
 *
 *     ⚠️ POR ESO ESTA BARRA LEE `catalogo.mensajerosFiltro` Y NO `catalogo.mensajeros`. Son dos
 *     campos con dos significados y NO se pueden fundir en uno: `mensajeros` es el UNIVERSO DEL
 *     HISTÓRICO —la selección por defecto de `DescargarGestionesDialog`, que sí tiene que
 *     incluir a los dados de baja o el Excel perdería sus gestiones en silencio— y
 *     `mensajerosFiltro` es la lista de OPCIONES de este desplegable. Quien los unifique rompe
 *     una de las dos cosas, y la que rompe callando es la descarga.
 *  3. **Elegir una bodega recorta los mensajeros a los de esa zona.** Eso sí es de aquí, y se
 *     expresa con el encadenado que `FilterComponent` ya implementa (`dependsOn` + el
 *     `parentValue` de cada opción, el mismo mecanismo con el que `/ordenes` encadena
 *     provincia → cantón → distrito). No se reimplementa: elegir otra bodega poda sola la
 *     selección de mensajeros que deja de ser coherente, que es la parte que a mano se olvida.
 *
 * NO HAY BUSCADOR DE TEXTO, y es una decisión: un cierre no se busca escribiendo. Se localiza
 * por su mensajero, su bodega o su fecha, que son justo los tres filtros. `BuscadorFiltros`
 * monta su campo igualmente —es su forma— pero se le da un `placeholder` que dice qué hace y un
 * `onChange` que no aplica nada; ver la nota de `SIN_BUSQUEDA` más abajo.
 */

const CLAVE_FECHA = "fecha";
const CLAVE_ZONA = "zona";
const CLAVE_MENSAJERO = "mensajero";

const FILTRO_FECHA_LABEL = "Fecha de solicitud";
const FILTRO_BODEGA_LABEL = "Bodega";
const FILTRO_MENSAJERO_LABEL = "Mensajero";
const BARRA_LABEL = "Filtros de los cierres del día";
/**
 * El aviso que hace visible el coste de compartir una barra entre los dos listados: con un
 * filtro puesto, los DOS —incluida la cola de pendientes— están recortados. Sin él, «no hay
 * cierres pendientes» y «no hay pendientes que casen con el filtro» se leen igual, y el
 * segundo es el que deja trabajo sin hacer.
 */
const AVISO_FILTRO_ACTIVO =
  "Filtro activo: los dos listados muestran solo lo que casa con él.";

export interface FiltrosCierresBarraProps {
  /** Opciones ya acotadas al alcance del actor (resueltas en el servidor). */
  catalogo: CatalogoFiltrosCierresDTO;
  /** Emite el objeto ENTERO: el módulo no tiene que recomponerlo por partes. */
  onChange: (filtros: FiltrosCierres) => void;
  /** `true` mientras alguna de las dos páginas está en vuelo. */
  disabled?: boolean;
  /**
   * Pedido humano del 2026-08-16 — «en la parte de bodega deja el mismo filtro solo omitiendo el
   * de mensajero». No es una simplificación de la UI: en un cierre de BODEGA el dato no existe,
   * porque consolida los cierres del día de VARIOS mensajeros. Ofrecer el control ahí sería
   * ofrecer una pregunta sin respuesta.
   *
   * La barra es LA MISMA en las dos mitades —mismo contenedor, mismo selector, mismos atajos de
   * fecha, mismo catálogo de bodegas—: lo único que cambia es que este filtro no se declara.
   */
  sinMensajero?: boolean;
}

/** Ids no vacíos, o `undefined`: una lista vacía NO es un filtro, es la ausencia de filtro. */
function idsONada(valores: string[] | undefined): [string, ...string[]] | undefined {
  if (!valores || valores.length === 0) return undefined;
  return valores as [string, ...string[]];
}

/**
 * Traduce la salida agnóstica de `FilterComponent` al contrato del servidor.
 *
 * El único punto donde se conocen las dos formas, a propósito. La de la barra es
 * `Record<string, string[]>` con posiciones —el rango de fechas viaja como la terna
 * `[atajo, desde, hasta]`, SIN compactar— y la del servidor es un objeto con claves
 * nombradas. Una cadena vacía en la terna significa «ese extremo no se fijó», y por eso se
 * traduce a `undefined` en vez de viajar: `desde: ""` no es una fecha, es la ausencia de una.
 */
function aFiltros(seleccion: FilterSelection): FiltrosCierres {
  const [, desde = "", hasta = ""] = seleccion[CLAVE_FECHA] ?? [];
  return {
    desde: desde === "" ? undefined : desde,
    hasta: hasta === "" ? undefined : hasta,
    destinoZonaIds: idsONada(seleccion[CLAVE_ZONA]),
    mensajeroIds: idsONada(seleccion[CLAVE_MENSAJERO]),
  };
}

/** `true` si el objeto no recorta nada (todas sus claves están ausentes). */
function vacio(filtros: FiltrosCierres): boolean {
  return Object.values(filtros).every((v) => v === undefined);
}

export function FiltrosCierresBarra({
  catalogo,
  onChange,
  disabled = false,
  sinMensajero = false,
}: Readonly<FiltrosCierresBarraProps>) {
  /** Claves de los filtros PEDIDOS en el selector, en el orden en que se declaran. */
  const [activos, setActivos] = useState<string[]>([]);
  /** La selección agregada que devuelve `FilterComponent`. */
  const [seleccion, setSeleccion] = useState<FilterSelection>({});
  /**
   * Contador de «Limpiar todo». `FilterComponent` es dueño de su selección y no expone forma de
   * vaciarla desde fuera, así que se le cambia la `key` para remontarlo limpio. Mismo recurso
   * que usa `/ordenes`, y por el mismo motivo.
   */
  const [reset, setReset] = useState(0);

  const declarados = useMemo<FilterDef[]>(
    () =>
      ([
      {
        // UN solo filtro de tiempo, con los atajos DENTRO del propio calendario: son ajustes
        // rápidos del rango, no un control aparte.
        key: CLAVE_FECHA,
        label: FILTRO_FECHA_LABEL,
        kind: "dateRange",
        placeholder: "Cualquier fecha",
        // Pedido humano del 2026-08-16: «los mismos rangos por defecto que en órdenes». Se
        // IMPORTAN los de aquella pantalla (`ATAJOS_CREACION`) en vez de reescribir cuatro
        // literales iguales: el día que se decida que 90 días son demasiados, se decide una vez
        // y las dos pantallas ofrecen lo mismo. Cada atajo se resuelve aquí a su rango de fechas
        // de calendario de Costa Rica —lo que viaja son `desde`/`hasta`, nunca el nombre del
        // atajo—, con la misma regla y la misma función que usa órdenes.
        options: ATAJOS_CREACION.map((a) => ({
          value: a.value,
          label: a.label,
          defaultRange: ultimosNDiasCalendarioCR(a.dias),
        })),
      },
      {
        key: CLAVE_ZONA,
        label: FILTRO_BODEGA_LABEL,
        kind: "multi",
        placeholder: "Todas",
        searchPlaceholder: "Filtrar bodegas…",
        emptyMessage: "Ninguna bodega coincide",
        options: catalogo.zonas.map((z) => ({ value: z.id, label: z.nombre })),
      },
      // Se declara al final para poder RETIRARLO entero en la mitad de bodega, sin dejar un
      // hueco en el orden de los otros dos.
      {
        key: CLAVE_MENSAJERO,
        label: FILTRO_MENSAJERO_LABEL,
        kind: "multi",
        // La regla 3 del humano, hecha declaración: con una bodega elegida solo se ofrecen sus
        // mensajeros. Sin bodega elegida se ofrecen todos, que es lo que pidió.
        dependsOn: CLAVE_ZONA,
        placeholder: "Todos",
        searchPlaceholder: "Filtrar mensajeros…",
        emptyMessage: "Ningún mensajero coincide",
        // FICHA 351 — `mensajerosFiltro`, NO `mensajeros`. Ver la regla 2 de la cabecera: el
        // segundo es el universo del histórico que consume la descarga de gestiones, y leerlo
        // aquí es lo que ponía cuentas dadas de baja en este desplegable.
        options: catalogo.mensajerosFiltro.map((m) => ({
          value: m.id,
          label: m.nombre,
          // Un mensajero SIN zona no cuelga de ninguna bodega: al elegir una, desaparece de la
          // lista. Es correcto —sus cierres no son de esa bodega— y sigue disponible mientras
          // no se filtre por bodega.
          ...(m.zonaId === null ? {} : { parentValue: m.zonaId }),
        })),
      },
      ] as FilterDef[]).filter((f) => !(sinMensajero && f.key === CLAVE_MENSAJERO)),
    [catalogo, sinMensajero],
  );

  const ofrecidos = useMemo(
    () => declarados.map((f) => ({ key: f.key, label: f.label })),
    [declarados],
  );
  // Solo se montan los PEDIDOS, en el orden en que se declararon (no en el de los clics): así
  // los controles no bailan de sitio según cómo se hayan ido pidiendo.
  const montados = useMemo(
    () => declarados.filter((f) => activos.includes(f.key)),
    [declarados, activos],
  );

  const filtros = useMemo(() => aFiltros(seleccion), [seleccion]);
  const hayFiltro = !vacio(filtros);

  function aplicar(next: FilterSelection) {
    setSeleccion(next);
    onChange(aFiltros(next));
  }

  function limpiarTodo() {
    setSeleccion({});
    // También se retiran los filtros PEDIDOS: «limpiar todo» es volver al punto de partida, y
    // una barra que se queda con tres controles vacíos no lo es.
    setActivos([]);
    setReset((n) => n + 1);
    onChange({});
  }

  return (
    <section aria-label={BARRA_LABEL} className="flex flex-col gap-2">
      <BuscadorFiltros
        label="Buscar"
        // El campo de la barra no aplica nada en esta pantalla (ver la nota de cabecera): el
        // placeholder lo dice en vez de dejar que alguien teclee una guía y no pase nada.
        placeholder="Usá los filtros para acotar los cierres"
        disabled={disabled}
        onChange={SIN_BUSQUEDA}
        filtros={ofrecidos}
        activos={activos}
        onActivosChange={setActivos}
        onLimpiarTodo={limpiarTodo}
        // Basta con tener un filtro PEDIDO —aunque esté vacío— para ofrecer la limpieza:
        // retirarlo de la barra también es algo que limpiar.
        hayFiltrosAplicados={hayFiltro || activos.length > 0}
      >
        {montados.length > 0 ? (
          <FilterComponent
            key={reset}
            filters={montados}
            onChange={aplicar}
            disabled={disabled}
          />
        ) : null}
      </BuscadorFiltros>

      {hayFiltro ? (
        <p role="note" className="text-xs text-muted-foreground">
          {AVISO_FILTRO_ACTIVO}
        </p>
      ) : null}
    </section>
  );
}

/**
 * El campo de texto de la barra no aplica nada aquí, y esta constante existe para que eso sea
 * una decisión con nombre y no un `() => {}` anónimo que parezca un olvido. Un cierre no se
 * busca escribiendo: se localiza por mensajero, bodega o fecha, que son los tres filtros que el
 * selector ofrece. El día que haya algo que teclear —un folio, por ejemplo— esta constante es
 * el sitio donde se ve que faltaba.
 */
const SIN_BUSQUEDA = () => {};
