"use client";

import { useMemo, useState } from "react";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import type { ActorHistorialDTO } from "@/lib/types/historial-accion";

import {
  CLAVE_BUSQUEDA,
  construirFiltrosHistorialAcciones,
} from "./historial-acciones-filtros-def";
import {
  seleccionAFiltroHistorialAcciones,
  type FiltroHistorialAccionUI,
} from "./seleccion-a-filtro";

// FICHA 362 / T5.3 (design §5.2, R28/R29/R32) — la BARRA DE FILTROS del historial, montada
// sobre las MISMAS dos piezas que la barra de `/ordenes` y la del historico de
// conversaciones: `BuscadorFiltros` como contenedor y `FilterComponent` para los controles
// que se piden.
//
// ⚠️ PEDIDO HUMANO EXPLICITO: «obviamente esto debe usar el componente que ya tenemos». Aqui
// no nace ni un `<input>` de busqueda propio ni un desplegable propio; R28 lo exige y su
// mutacion es justamente escribir uno.
//
// EL REPARTO, que es lo que hace que esto no sea una barra nueva:
//
//   - las seis declaraciones salen de `construirFiltrosHistorialAcciones`, funcion PURA;
//   - la traduccion de lo elegido al `filtro` del borde sale de
//     `seleccionAFiltroHistorialAcciones`. Aqui no se decide que significa ninguna clave:
//     solo se cablea.
//
// POR QUE `q` NO SE OFRECE EN EL SELECTOR. La busqueda libre es el CAMPO de la barra, no un
// filtro que se pide: su declaracion (`minChars`, `placeholder`) se lee del `FilterDef` de
// `q` y se le pasa a `BuscadorFiltros`. Asi el minimo de caracteres sigue saliendo de
// `BUSQUEDA_MIN_CHARS` por un solo camino (R32) y el selector ofrece exactamente los CINCO
// filtros de R29.
//
// DOS SALIDAS Y NO UNA. El termino y los filtros viajan por callbacks distintos porque los
// emite gente distinta —el campo, con su propio debounce y su propio minimo; los controles,
// con el suyo— y unirlos aqui obligaria a mantener un espejo del estado del otro. Quien los
// junta es el modulo, que es el dueno del `filtro` completo.
//
// SOLO LECTURA (R21): esta barra no ofrece ninguna accion que escriba. Filtra y nada mas.

/**
 * Nombre accesible del campo. Dice QUE se busca: «Buscar» a secas en una pantalla de
 * auditoria se lee como «buscar dentro de lo que paso», y lo que el campo alcanza es la
 * persona y la etiqueta de lo afectado, no un texto libre (que en esta tabla no existe, R5).
 */
export const ETIQUETA_BUSCADOR = "Buscar en el registro";

export interface HistorialAccionesFiltrosBarProps {
  /** Catálogo de actores pre-cargado por la página. Puede venir vacío. */
  actores: readonly ActorHistorialDTO[];
  /** Término ya recortado, o `""` cuando no hay búsqueda aplicada (R32). */
  onBuscar: (termino: string) => void;
  /** Los otros cinco filtros, ya traducidos al contrato del borde (R29). */
  onFiltrosChange: (filtro: FiltroHistorialAccionUI) => void;
  /** Instante desde el que se resuelven los atajos de fecha. Inyectable para los tests. */
  ahora?: Date;
  /** Espera del campo y de los controles. `0` en tests para no depender de temporizadores. */
  debounceMs?: number;
}

export function HistorialAccionesFiltrosBar({
  actores,
  onBuscar,
  onFiltrosChange,
  ahora,
  debounceMs,
}: Readonly<HistorialAccionesFiltrosBarProps>) {
  const declarados = useMemo<FilterDef[]>(
    () => construirFiltrosHistorialAcciones(actores, { ahora }),
    [actores, ahora],
  );

  const defBusqueda = declarados.find((d) => d.key === CLAVE_BUSQUEDA);
  const pedibles = useMemo(
    () => declarados.filter((d) => d.key !== CLAVE_BUSQUEDA),
    [declarados],
  );
  const ofrecidos = useMemo(
    () => pedibles.map((f) => ({ key: f.key, label: f.label })),
    [pedibles],
  );

  /** Claves de los filtros PUESTOS. Arranca vacía: la barra nace con el campo solo. */
  const [activos, setActivos] = useState<string[]>([]);
  /** Selección agregada de los controles montados; `FilterComponent` la emite entera. */
  const [seleccion, setSeleccion] = useState<FilterSelection>({});
  /** `FilterComponent` no se puede vaciar desde fuera: «Limpiar todo» le cambia la `key`. */
  const [reset, setReset] = useState(0);

  function publicar(nueva: FilterSelection) {
    setSeleccion(nueva);
    onFiltrosChange(seleccionAFiltroHistorialAcciones(nueva, { ahora }));
  }

  /**
   * Retirar un filtro del selector lo retira TAMBIÉN del listado. La poda va en el manejador
   * y no en un efecto que observe `activos`: al desmarcar el último control,
   * `FilterComponent` se DESMONTA y su propia poda —que vive en un efecto suyo— no llega a
   * correr, así que la selección huérfana seguiría recortando la lista (mismo incidente que
   * en `FiltrosEntregas` y que en la barra del histórico de conversaciones).
   */
  function alCambiarActivos(nuevos: string[]) {
    setActivos(nuevos);
    const vivos = new Set(nuevos);
    const podada = Object.fromEntries(
      Object.entries(seleccion).filter(([clave]) => vivos.has(clave)),
    );
    if (Object.keys(podada).length === Object.keys(seleccion).length) return;
    publicar(podada);
  }

  /** Deja la barra como recién abierta. El campo lo vacía `BuscadorFiltros` por su camino. */
  function limpiarTodo() {
    setActivos([]);
    setReset((n) => n + 1);
    publicar({});
  }

  const montados = pedibles.filter((f) => activos.includes(f.key));

  return (
    <BuscadorFiltros
      label={ETIQUETA_BUSCADOR}
      placeholder={defBusqueda?.placeholder}
      minChars={defBusqueda?.minChars}
      debounceMs={debounceMs}
      onChange={onBuscar}
      filtros={ofrecidos}
      activos={activos}
      onActivosChange={alCambiarActivos}
      onLimpiarTodo={limpiarTodo}
      hayFiltrosAplicados={activos.length > 0 || Object.keys(seleccion).length > 0}
    >
      {montados.length > 0 ? (
        <FilterComponent
          key={reset}
          filters={montados}
          onChange={publicar}
          debounceMs={debounceMs}
        />
      ) : null}
    </BuscadorFiltros>
  );
}
