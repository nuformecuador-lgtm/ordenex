import type { PlantillaEstado } from "@prisma/client";

import type { Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

import { ESTADO_PLANTILLA_LABEL } from "./plantilla-estado-label";

// Longitud máxima del cuerpo mostrado en la celda antes de truncar (R6). El cuerpo
// completo se ve/edita en el formulario; la tabla solo da una vista de una línea.
const CUERPO_MAX = 80;

/**
 * Etiqueta legible del estado (listo para i18n vía diccionario). Feature 170 (T B.3): vive
 * en `./plantilla-estado-label` (módulo PURO) para que las columnas de export la lean sin
 * arrastrar React; aquí solo se le da el nombre local de siempre.
 */
const ESTADO_LABEL = ESTADO_PLANTILLA_LABEL;

/** Variante del `Badge` por estado. Solo lectura: el front no activa/rechaza. */
const ESTADO_VARIANT: Record<
  PlantillaEstado,
  "success" | "secondary" | "warning" | "danger"
> = {
  activo: "success",
  inactivo: "secondary",
  pending: "warning",
  refused: "danger",
};

function truncar(texto: string): string {
  if (texto.length <= CUERPO_MAX) return texto;
  return `${texto.slice(0, CUERPO_MAX)}…`;
}

export interface PlantillasColumnsActions {
  /** Abre el formulario de edición de la fila (R20). */
  onEditar: (row: PlantillaListItemDTO) => void;
  /**
   * Desactiva la fila: ÚNICA transición de estado del front (R24), envía destino
   * `inactivo`. Solo se muestra cuando el estado no es ya `inactivo`.
   */
  onDesactivar: (row: PlantillaListItemDTO) => void;
  /** Elimina la fila (SOFT DELETE, R27): la retira del listado tras confirmar. */
  onEliminar: (row: PlantillaListItemDTO) => void;
}

/**
 * Columnas del listado de plantillas (feature 107/R6): nombre · estado · cuerpo ·
 * acciones. El `estado` se pinta como `Badge` de SOLO LECTURA
 * (`pending`/`activo`/`refused` no son accionables desde el front); la ÚNICA acción
 * de estado es "Desactivar", visible cuando el estado no es ya `inactivo` (R24).
 */
export function buildPlantillasColumns(
  actions: PlantillasColumnsActions,
): Column<PlantillaListItemDTO>[] {
  return [
    { id: "nombre", value: "Nombre" },
    {
      id: "estado",
      value: "Estado",
      render: (row) => (
        <Badge variant={ESTADO_VARIANT[row.estado]}>
          {ESTADO_LABEL[row.estado]}
        </Badge>
      ),
    },
    {
      id: "cuerpo",
      value: "Cuerpo",
      render: (row) => (
        <span className="text-muted-foreground" title={row.cuerpo}>
          {truncar(row.cuerpo)}
        </span>
      ),
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.onEditar(row)}
          >
            Editar
          </Button>
          {row.estado !== "inactivo" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => actions.onDesactivar(row)}
            >
              Desactivar
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => actions.onEliminar(row)}
          >
            Eliminar
          </Button>
        </div>
      ),
    },
  ];
}
