import type { EstadoUsuario, RolValue } from "@prisma/client";

import type { Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";

/**
 * Etiquetas legibles de rol y estado (R14). Se centralizan aquí para que la
 * tabla y el formulario compartan una única fuente de texto (preparado para
 * i18n futuro: son props/constantes, no cadenas incrustadas en el markup).
 */
export const ROL_LABELS: Record<RolValue, string> = {
  maestro: "Maestro",
  admin: "Administrador",
  mensajero: "Mensajero",
  adminTienda: "Admin de tienda",
  adminSatelite: "Admin satélite",
};

export const ESTADO_LABELS: Record<EstadoUsuario, string> = {
  pendiente: "Pendiente",
  activo: "Activo",
  inactivo: "Inactivo",
  bloqueado: "Bloqueado",
};

const ESTADO_CLASSES: Record<EstadoUsuario, string> = {
  activo: "bg-success-soft text-[#065f46] dark:bg-success/15 dark:text-success",
  inactivo:
    "bg-asfalto-1 text-asfalto-7 dark:bg-asfalto-7/20 dark:text-asfalto-2",
  pendiente:
    "bg-warning-soft text-[#92400e] dark:bg-warning/15 dark:text-warning",
  bloqueado:
    "bg-danger-soft text-[#991b1b] dark:bg-danger/15 dark:text-danger",
};

/** Chip legible del estado del usuario (R14). */
export function EstadoUsuarioBadge({ value }: { value: EstadoUsuario }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        ESTADO_CLASSES[value],
      )}
    >
      {ESTADO_LABELS[value] ?? value}
    </span>
  );
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
