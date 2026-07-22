import type { EstadoApiKey } from "@prisma/client";
import type { VariantProps } from "class-variance-authority";

import type { Column } from "@/components/shared/DataTable";
import { Badge, badgeVariants } from "@/components/ui/badge";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

import { ApiKeyAccionCell } from "./ApiKeyAccionCell";
import { WebhookAccionCell } from "./WebhookAccionCell";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Placeholder para valores ausentes.
const SIN_DATO = "—";

/** Etiqueta legible del estado propio de la key (no solo color, R accesibilidad). */
const ESTADO_LABELS: Record<EstadoApiKey, string> = {
  activa: "Activa",
  inactiva: "Inactiva",
};

/** Estado de la key -> variante semántica de la primitiva `Badge` (sin hex). */
const ESTADO_VARIANT: Record<EstadoApiKey, BadgeVariant> = {
  activa: "success",
  inactiva: "secondary",
};

/** Chip legible del estado de la API key: texto + color semántico (accesible). */
export function EstadoApiKeyBadge({ value }: { value: EstadoApiKey }) {
  return (
    <Badge variant={ESTADO_VARIANT[value]}>
      {ESTADO_LABELS[value] ?? value}
    </Badge>
  );
}

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

export interface ApiKeysColumnsOptions {
  /**
   * Refresco del listado tras cada mutación `ok` de la celda de acciones. Lo
   * inyecta `ApiKeysModule` con su `mutate` de SWR (única fuente de verdad de la
   * key SWR). Se pasa tal cual a `ApiKeyAccionCell`.
   */
  onMutated: () => Promise<void>;
}

/**
 * Columnas del listado de API keys (feature 82/R14): identificador · prefijo ·
 * usuario dedicado (email sintético [D1]) · fecha de creación · estado · webhook · acciones.
 *
 * El prefijo se muestra seguido de un elipsis en `font-mono` (R15). El DTO de
 * fila (`ApiKeyListItemDTO`) no declara `keyHash` ni el secreto, así que NUNCA
 * hay forma de que la key completa aparezca en la tabla (R15, por construcción).
 *
 * La columna de estado pinta un `Badge` semántico con texto legible (no solo
 * color). Feature 105/R2 (D1): la columna "Webhook" con `WebhookAccionCell` abre el
 * modal de gestión de la suscripción de ese owner; su estado NO viaja en la fila, se
 * lee on-demand con `obtenerWebhook` al abrir el modal (D2). La columna de acciones
 * delega en `ApiKeyAccionCell`, al que se le pasa el `onMutated` para refrescar el
 * listado tras rotar/activar/desactivar.
 */
export function buildApiKeysColumns({
  onMutated,
}: ApiKeysColumnsOptions): Column<ApiKeyListItemDTO>[] {
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
    {
      id: "estado",
      value: "Estado",
      render: (row) => <EstadoApiKeyBadge value={row.estado} />,
    },
    {
      id: "webhook",
      value: "Webhook",
      render: (row) => (
        <WebhookAccionCell
          ownerUsuarioId={row.usuarioId}
          identificador={row.identificador}
        />
      ),
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (row) => <ApiKeyAccionCell row={row} onMutated={onMutated} />,
    },
  ];
}
