import type { Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ZonaDTO } from "@/lib/types/zona";

/**
 * Chip legible del flag `esCentral` (feature 54, renombrado del viejo `esGam`).
 * Marca visualmente la zona central. Cuando la zona no es central se muestra
 * un guion neutro para no dejar la celda vacía.
 */
export function ZonaCentralBadge({ value }: { value: boolean }) {
  if (!value) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        "bg-success-soft text-[#065f46] dark:bg-success/15 dark:text-success",
      )}
    >
      Central
    </span>
  );
}

export interface ZonasColumnsActions {
  /** Abre el formulario de edición para la zona de la fila (R31). */
  onEditar: (zona: ZonaDTO) => void;
}

/**
 * Columnas del listado de zonas (patrón `usuarios-columns`): nombre, número de
 * distritos asignados (`distritosCount`), badge central (`esCentral`) y acciones.
 * Mapea directamente el `ZonaDTO` que exponen las Server Actions (feature 54;
 * los pagos al mensajero viven ahora en `tarifa_zona_mensajero`, fuera de esta
 * tabla) sin proyectar campos internos.
 */
export function buildZonasColumns({
  onEditar,
}: ZonasColumnsActions): Column<ZonaDTO>[] {
  return [
    { id: "nombre", value: "Nombre" },
    {
      id: "distritos",
      value: "N.º distritos",
      render: (row) => row.distritosCount,
    },
    {
      id: "central",
      value: "Central",
      render: (row) => <ZonaCentralBadge value={row.esCentral} />,
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEditar(row)}
          >
            Editar
          </Button>
        </div>
      ),
    },
  ];
}
