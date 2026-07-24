"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import type { OpcionFiltro } from "@/lib/utils/filtro-canton-distrito";

// Feature 117 — control de filtro por cantón y distrito (dos selects encadenados +
// "Limpiar filtros"). Componente de PRESENTACIÓN puro: recibe estado y opciones por
// props y emite los cambios; el estado vive en `useFiltroCantonDistrito`. Textos
// separados en constantes para i18n futura (nada hardcodeado inline).

// El `Select` de base-ui trata `value === ""` como placeholder (sin selección), y sus
// `Item` exigen valor no vacío. Para poder VOLVER a "todos" desde el desplegable se
// antepone una opción con este valor centinela, que el handler traduce a `""`.
const TODOS = "__todos__";

const REGION_LABEL = "Filtrar por cantón y distrito";
const CANTON_CAPTION = "Cantón";
const DISTRITO_CAPTION = "Distrito";
// Nombre accesible (rol combobox) de cada select — contiene su etiqueta visible.
const CANTON_ARIA = "Filtrar por cantón";
const DISTRITO_ARIA = "Filtrar por distrito";
const CANTON_PLACEHOLDER = "Todos los cantones";
const DISTRITO_PLACEHOLDER = "Todos los distritos";
const CANTON_TODOS = "Todos los cantones";
const DISTRITO_TODOS = "Todos los distritos";
const LIMPIAR = "Limpiar filtros";

export interface FiltroCantonDistritoProps {
  /** Cantón elegido (`""` = todos). */
  canton: string;
  /** Distrito elegido (`""` = todos). */
  distrito: string;
  /** Opciones de cantón (etiqueta "Cantón (Provincia)"). */
  cantones: OpcionFiltro[];
  /** Opciones de distrito del cantón elegido. */
  distritos: OpcionFiltro[];
  /** `true` si hay al menos un filtro activo (muestra "Limpiar filtros"). */
  hayFiltro: boolean;
  /** Elegir cantón (recibe `""` para "todos"; resetea el distrito). */
  onCantonChange: (value: string) => void;
  /** Elegir distrito (recibe `""` para "todos"). */
  onDistritoChange: (value: string) => void;
  /** Limpiar ambos filtros. */
  onLimpiar: () => void;
}

/** Antepone la opción centinela "todos" a las opciones derivadas. */
function conTodos(opciones: OpcionFiltro[], etiquetaTodos: string): SelectOption[] {
  return [{ value: TODOS, label: etiquetaTodos }, ...opciones];
}

export function FiltroCantonDistrito({
  canton,
  distrito,
  cantones,
  distritos,
  hayFiltro,
  onCantonChange,
  onDistritoChange,
  onLimpiar,
}: FiltroCantonDistritoProps) {
  const cantonId = useId();
  const distritoId = useId();
  const sinCanton = canton === "";

  return (
    <section
      aria-label={REGION_LABEL}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex min-w-52 flex-col gap-1">
        <label htmlFor={cantonId} className="text-sm font-medium">
          {CANTON_CAPTION}
        </label>
        <Select
          id={cantonId}
          aria-label={CANTON_ARIA}
          value={canton}
          options={conTodos(cantones, CANTON_TODOS)}
          placeholder={CANTON_PLACEHOLDER}
          onValueChange={(next) => onCantonChange(next === TODOS ? "" : next)}
        />
      </div>

      <div className="flex min-w-52 flex-col gap-1">
        <label htmlFor={distritoId} className="text-sm font-medium">
          {DISTRITO_CAPTION}
        </label>
        <Select
          id={distritoId}
          aria-label={DISTRITO_ARIA}
          value={distrito}
          options={conTodos(distritos, DISTRITO_TODOS)}
          placeholder={DISTRITO_PLACEHOLDER}
          // R3: sin cantón elegido el distrito no aplica y va deshabilitado.
          disabled={sinCanton}
          onValueChange={(next) => onDistritoChange(next === TODOS ? "" : next)}
        />
      </div>

      {/* R9: "Limpiar filtros" solo cuando hay al menos un filtro activo. */}
      {hayFiltro ? (
        <Button type="button" variant="ghost" onClick={onLimpiar}>
          {LIMPIAR}
        </Button>
      ) : null}
    </section>
  );
}
