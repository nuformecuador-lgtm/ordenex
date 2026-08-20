"use client";

import { Checkbox } from "@/components/ui/checkbox";

export interface SelectAllCheckboxProps {
  /**
   * Ids de las filas que SÍ pueden seleccionarse en la página visible (excluye
   * filas bloqueadas). La cuenta define los tres estados del checkbox de
   * cabecera: vacío, indeterminado (algunas) y marcado (todas).
   */
  selectableIds: string[];
  /** Set de ids actualmente seleccionados (la fuente de verdad vive en el padre). */
  selectedIds: ReadonlySet<string>;
  /** Marca (`true`) o desmarca (`false`) TODOS los `selectableIds` de una vez. */
  onToggleAll: (checked: boolean) => void;
  /** Nombre accesible; el `<th>` no aporta texto visible al ser un checkbox. */
  ariaLabel?: string;
  /**
   * `id` del control, para poder asociarle un `<Label htmlFor>` cuando SÍ hay texto visible
   * al lado (2026-08-19: el «Todos» del diálogo de descarga detallada de cierres). En la
   * cabecera del `DataTable` no hace falta y se omite.
   */
  id?: string;
}

/**
 * Checkbox "seleccionar todo" para la cabecera de una columna de selección del
 * `DataTable`. No posee la selección: recibe los ids seleccionables de la página
 * y el set marcado, y delega el toggle en el padre. Refleja el estado parcial
 * con `indeterminate` y se deshabilita cuando no hay nada seleccionable.
 */
export function SelectAllCheckbox({
  selectableIds,
  selectedIds,
  onToggleAll,
  ariaLabel = "Seleccionar todo",
  id,
}: Readonly<SelectAllCheckboxProps>) {
  const total = selectableIds.length;
  const marcados = selectableIds.reduce(
    (n, id) => (selectedIds.has(id) ? n + 1 : n),
    0,
  );
  const todosMarcados = total > 0 && marcados === total;
  const indeterminado = marcados > 0 && marcados < total;

  return (
    <Checkbox
      id={id}
      checked={todosMarcados}
      indeterminate={indeterminado}
      disabled={total === 0}
      onCheckedChange={(checked) => onToggleAll(checked === true)}
      aria-label={ariaLabel}
    />
  );
}
