import type { Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ZonaDTO } from "@/lib/types/zona";

/**
 * Chip legible del flag `esCentral` (feature 54, renombrado del viejo `esGam`).
 * Marca visualmente la zona central/GAM. Cuando la zona no es central se muestra
 * un guion neutro para no dejar la celda vacía.
 */
export function ZonaCentralBadge({ value }: { value: boolean }) {
  if (!value) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <Badge variant="success">Central / GAM</Badge>;
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
 *
 * @sin-superficie son las columnas de la tabla de `ZonasModule`, y a `ZonasModule` no lo monta ninguna ruta (ver el motivo completo alli). Muere con el, no por su cuenta.
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
