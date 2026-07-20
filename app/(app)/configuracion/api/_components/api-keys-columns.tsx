import type { Column } from "@/components/shared/DataTable";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

// Placeholder para valores ausentes.
const SIN_DATO = "—";

// Coacciona a Date defensivamente: el DTO tipa `createdAt: Date`, pero según el
// borde de serialización (Server Action → cliente) puede llegar como string ISO.
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Fecha de creación legible (es-EC): fecha corta + hora. */
function formatFechaCreacion(value: Date | string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return SIN_DATO;
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/**
 * Columnas del listado de API keys (feature 82/R14): identificador · prefijo ·
 * usuario dedicado (email sintético [D1]) · fecha de creación. **Sin columna de
 * acciones**: en este alcance no hay operación por fila.
 *
 * El prefijo se muestra seguido de un elipsis en `font-mono` (R15). El DTO de
 * fila (`ApiKeyListItemDTO`) no declara `keyHash` ni el secreto, así que NUNCA
 * hay forma de que la key completa aparezca en la tabla (R15, por construcción).
 */
export function buildApiKeysColumns(): Column<ApiKeyListItemDTO>[] {
  return [
    { id: "identificador", value: "Identificador" },
    {
      id: "keyPrefix",
      value: "Prefijo",
      render: (row) => (
        <span className="font-mono">{`${row.keyPrefix}…`}</span>
      ),
    },
    {
      id: "usuarioEmail",
      value: "Usuario dedicado",
      render: (row) => (
        <span className="font-mono text-muted-foreground">
          {row.usuarioEmail}
        </span>
      ),
    },
    {
      id: "createdAt",
      value: "Fecha de creación",
      render: (row) => formatFechaCreacion(row.createdAt),
    },
  ];
}
