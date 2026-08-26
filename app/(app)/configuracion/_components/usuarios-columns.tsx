import type { EstadoUsuario } from "@prisma/client";
import type { VariantProps } from "class-variance-authority";

import type { Column } from "@/components/shared/DataTable";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";

import { ESTADO_LABELS, SIN_ZONA } from "./usuario-estado-label";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Etiquetas de rol centralizadas en `lib/auth/rol-label` y, desde la feature 170 (T B.3),
// las de estado en `./usuario-estado-label` (módulo PURO, para que las columnas de export
// puedan leerlas sin arrastrar React). Ambas se reexportan aquí para no romper a los
// consumidores existentes de este módulo.
export { ROL_LABELS, ESTADO_LABELS, SIN_ZONA };

/** Estado del usuario -> variante semántica de la primitiva `Badge` (sin hex). */
const ESTADO_VARIANT: Record<EstadoUsuario, BadgeVariant> = {
  activo: "success",
  inactivo: "secondary",
  pendiente: "warning",
  bloqueado: "danger",
};

/** Chip legible del estado del usuario (R14). */
export function EstadoUsuarioBadge({ value }: { value: EstadoUsuario }) {
  return <Badge variant={ESTADO_VARIANT[value]}>{ESTADO_LABELS[value] ?? value}</Badge>;
}

export interface UsuariosColumnsActions {
  /** Abre el formulario de edición para la fila (R27). */
  onEditar: (usuario: UsuarioListItemDTO) => void;
  /** Alterna activo/inactivo de la fila (R20/R21). */
  onCambiarEstado: (usuario: UsuarioListItemDTO) => void;
  /** Id de la fila cuya acción de estado está en curso (deshabilita el botón). */
  estadoPendienteId?: string | null;
}

/**
 * Columnas concretas del listado de usuarios (patrón `ordenes-columns`): nombre,
 * email, rol (value legible), estado y acciones. NUNCA proyecta campos sensibles:
 * el DTO de fila (`UsuarioListItemDTO`) no incluye `passwordHash` (R14/R26).
 */
export function buildUsuariosColumns({
  onEditar,
  onCambiarEstado,
  estadoPendienteId = null,
}: UsuariosColumnsActions): Column<UsuarioListItemDTO>[] {
  return [
    { id: "nombre", value: "Nombre" },
    { id: "email", value: "Email" },
    {
      id: "rol",
      value: "Rol",
      render: (row) => ROL_LABELS[row.rolValue] ?? row.rolValue,
    },
    {
      id: "estado",
      value: "Estado",
      render: (row) => <EstadoUsuarioBadge value={row.estado} />,
    },
    {
      // Pedido humano (2026-08-26): la zona del usuario. La MAYORÍA de las filas no tiene —sólo
      // `mensajero` y `adminSatelite` conservan zona (feature 24/R27)—, así que el guion es el
      // caso NORMAL, no un fallo de datos: una celda vacía se leería como «no se cargó».
      id: "zona",
      value: "Zona",
      render: (row) => row.zonaNombre ?? SIN_ZONA,
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (row) => {
        const esActivo = row.estado === "activo";
        return (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onEditar(row)}
            >
              Editar
            </Button>
            <Button
              type="button"
              size="sm"
              variant={esActivo ? "destructive" : "default"}
              disabled={estadoPendienteId === row.id}
              onClick={() => onCambiarEstado(row)}
            >
              {esActivo ? "Inactivar" : "Activar"}
            </Button>
          </div>
        );
      },
    },
  ];
}
