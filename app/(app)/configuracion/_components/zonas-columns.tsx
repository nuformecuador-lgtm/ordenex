import type { Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ZonaDTO } from "@/lib/types/zona";

/**
 * Formatea un monto de pago para mostrarlo con dos decimales. El DTO ya entrega
 * los montos como `number` (R26); aquí solo se les da forma para la tabla.
 */
function formatMonto(value: number): string {
  return value.toFixed(2);
}

/**
 * Chip legible del flag `esGam` (R24/R31). Marca visualmente la zona central/GAM.
 * Cuando la zona no es GAM se muestra un guion neutro para no dejar la celda vacía.
 */
export function ZonaGamBadge({ value }: { value: boolean }) {
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
      Central / GAM
    </span>
  );
}

export interface ZonasColumnsActions {
  /** Abre el formulario de edición para la zona de la fila (R31). */
  onEditar: (zona: ZonaDTO) => void;
}

/**
 * Columnas del listado de zonas (patrón `usuarios-columns`): nombre, número de
 * distritos asignados (`distritosCount`), pago por entrega, pago por rechazo,
 * badge GAM (`esGam`) y acciones. Mapea directamente el `ZonaDTO` que exponen las
 * Server Actions (R24/R30) sin proyectar campos internos.
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
      id: "pagoEntrega",
      value: "Pago entrega",
      render: (row) => formatMonto(row.pagoEntrega),
    },
    {
      id: "pagoRechazo",
      value: "Pago rechazo",
      render: (row) => formatMonto(row.pagoRechazo),
    },
    {
      id: "gam",
      value: "GAM",
      render: (row) => <ZonaGamBadge value={row.esGam} />,
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
