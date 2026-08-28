"use client";

import { useMemo, useState } from "react";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import type {
  CatalogoFiltrosOrdenesDTO,
  MensajeroFiltroDTO,
} from "@/lib/types/filtros-ordenes";
import type { FiltroHilosHistorico } from "@/lib/types/historico-conversaciones";

import { CLAVE_BUSQUEDA, construirFiltrosHistorico } from "./historico-filtros-def";
import { seleccionAFiltroHistorico } from "./seleccion-a-filtro";

// Feature 321 / T5.3 (design §5.3, R32/R33/R34/R35/R37) — la BARRA DE FILTROS del histórico,
// montada sobre las MISMAS dos piezas que la barra de `/ordenes` y la del panel maestro:
// `BuscadorFiltros` como contenedor y `FilterComponent` para los controles que se piden.
//
// EL REPARTO, que es lo que hace que esto no sea una barra nueva:
//
//   - las cuatro declaraciones salen de `construirFiltrosHistorico` (T5.1), función PURA;
//   - la traducción de lo elegido al `filtro` del borde sale de `seleccionAFiltroHistorico`
//     (T5.2). Aquí no se decide qué significa ninguna clave: sólo se cablea.
//
// POR QUÉ `q` NO SE OFRECE EN EL SELECTOR. La búsqueda libre es el CAMPO de la barra, no un
// filtro que se pide: su declaración (`minChars`, `placeholder`) se lee del `FilterDef` de
// `q` y se le pasa a `BuscadorFiltros`. Así el mínimo de caracteres sigue saliendo de
// `BUSQUEDA_MIN_CHARS` por un solo camino (R37) y el selector ofrece exactamente los tres
// filtros que se ponen y se quitan: «Mensajero», «Fecha» y «Orden».
//
// DOS SALIDAS Y NO UNA. El término y los filtros viajan por callbacks distintos porque los
// emite gente distinta —el campo, con su propio debounce y su propio mínimo; los controles,
// con el suyo— y unirlos aquí obligaría a mantener un espejo del estado del otro. Quien los
// junta es el módulo, que es el dueño del `filtro` completo.
//
// SOLO LECTURA (R24): esta barra no ofrece ninguna acción que escriba. Filtra y nada más.

/** Catálogo vacío: la barra se declara IGUAL sin opciones (R64 de la 144), no desaparece. */
const CATALOGO_VACIO: CatalogoFiltrosOrdenesDTO = {
  zonas: [],
  tiendas: [],
  mensajeros: [],
  provincias: [],
  cantones: [],
  distritos: [],
};

/**
 * Nombre accesible del campo. Dice QUÉ se busca: sin él, «Buscar» a secas en una pantalla de
 * conversaciones se lee como «buscar dentro de los mensajes», que es justo lo que NO hace
 * (A8: el cuerpo de los mensajes está fuera de alcance).
 */
export const ETIQUETA_BUSCADOR = "Buscar conversación";

export interface HistoricoFiltrosBarProps {
  /** Catálogo de mensajeros pre-cargado por la página (design §5.1). Puede venir vacío. */
  mensajeros: readonly MensajeroFiltroDTO[];
  /** Término ya recortado, o `""` cuando no hay búsqueda aplicada (R37). */
  onBuscar: (termino: string) => void;
  /** Los otros tres filtros, ya traducidos al contrato del borde (R33-R35). */
  onFiltrosChange: (filtro: FiltroHilosHistorico) => void;
  /** Instante desde el que se resuelven los atajos de fecha. Inyectable para los tests. */
  ahora?: Date;
  /** Espera del campo y de los controles. `0` en tests para no depender de temporizadores. */
  debounceMs?: number;
}

export function HistoricoFiltrosBar({
  mensajeros,
  onBuscar,
  onFiltrosChange,
  ahora,
  debounceMs,
}: Readonly<HistoricoFiltrosBarProps>) {
  const declarados = useMemo<FilterDef[]>(
    () =>
      construirFiltrosHistorico(
        { ...CATALOGO_VACIO, mensajeros: [...mensajeros] },
        { ahora },
      ),
    [mensajeros, ahora],
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
    onFiltrosChange(seleccionAFiltroHistorico(nueva, { ahora }));
  }

  /**
   * Retirar un filtro del selector lo retira TAMBIÉN del listado. La poda va en el manejador
   * y no en un efecto que observe `activos`: al desmarcar el último control, `FilterComponent`
   * se DESMONTA y su propia poda —que vive en un efecto suyo— no llega a correr, así que la
   * selección huérfana seguiría recortando la lista (mismo incidente que en `FiltrosEntregas`).
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
