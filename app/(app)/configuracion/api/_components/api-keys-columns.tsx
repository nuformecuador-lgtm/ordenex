import type { EstadoApiKey } from "@prisma/client";
import type { VariantProps } from "class-variance-authority";

import type { Column } from "@/components/shared/DataTable";
import { Badge, badgeVariants } from "@/components/ui/badge";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

import { ApiKeyAccionCell } from "./ApiKeyAccionCell";
import { WebhookAccionCell } from "./WebhookAccionCell";
import { ESTADO_API_KEY_LABEL } from "./api-key-estado-label";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Placeholder para valores ausentes.
const SIN_DATO = "—";

/**
 * Etiqueta legible del estado propio de la key (no solo color, R accesibilidad). Feature
 * 170 (T B.3): vive en `./api-key-estado-label` (módulo PURO) para que las columnas de
 * export la lean sin arrastrar React; aquí solo se le da el nombre local de siempre.
 */
const ESTADO_LABELS = ESTADO_API_KEY_LABEL;

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
  /**
   * FICHA 373/R35: aviso de que una fila DESAPARECIÓ por un borrado con éxito. Lo inyecta
   * `ApiKeysModule` para retroceder de página cuando la que se está viendo se queda vacía y no
   * es la primera. Se pasa tal cual a `ApiKeyAccionCell`.
   */
  onEliminada?: () => void;
}

/**
 * Columnas del listado de API keys (feature 82/R14): identificador · estado · acciones ·
 * webhook · prefijo · usuario dedicado (email sintético [D1]) · tienda destino (307) ·
 * fecha de creación.
 *
 * =============================================================================================
 * ⚠️ EL ORDEN NO ES COSMÉTICO: LAS DOS COLUMNAS CON BOTONES VAN DELANTE (2026-09-04, ficha 373).
 * =============================================================================================
 *
 * Hasta hoy «Acciones» era la ÚLTIMA columna y, con la tabla desbordando, quedaba fuera del
 * área visible en anchos de portátil. Medido en Chromium sobre el contenedor con scroll de
 * `DataTable`, con la barra lateral desplegada (256 px), que es el caso del defecto:
 *
 *   | viewport | visible | tabla | desborda | «Eliminar» visible |
 *   |----------|---------|-------|----------|--------------------|
 *   | 1920     |    1614 |  1614 |        0 | 74 px              |
 *   | 1440     |    1134 |  1134 |        0 | 74 px              |
 *   | 1280     |     974 |  1100 |    126 → | −40 px (FUERA)     |
 *   | 1024     |     718 |  1100 |    382 → | −296 px (FUERA)    |
 *
 * Y NO se arregla estrechando: el mínimo de contenido de las SIETE columnas de datos, sin
 * «Acciones», ya suma 838 px (identificador 104 · prefijo 133 · usuario 167 · tienda 140 ·
 * fecha 120 · estado 91 · webhook 83), o sea que a 1024 (718 px de sitio) la tabla desborda
 * aunque los botones no existieran. Acotar el email —la sospecha inicial— tampoco: aporta
 * 167 px de 1100 porque ya parte líneas por los guiones, y caparlo solo lo estropearía a
 * 1920, donde hoy se lee entero. El desbordamiento a 1024 es un hecho de esta pantalla; lo
 * que se puede decidir es QUÉ queda fuera, y lo que no puede quedar fuera son los botones.
 *
 * Por eso las dos columnas interactivas —«Acciones» y «Webhook»— se adelantan junto a
 * «Estado», que es lo que dice si el botón del medio ofrece Activar o Desactivar. Con
 * `Identificador · Estado · Acciones · Webhook` = 540 px, las tres acciones de una fila y el
 * webhook caben enteros sin desplazar la tabla incluso a 1024. La identidad de la fila sigue
 * PRIMERA a propósito: unos botones sin saber de qué key son no sirven de nada (y además la
 * flecha de scroll izquierda de `DataTable` se dibuja encima de la primera columna, así que
 * ahí no puede ir un control).
 *
 * Es el mismo remedio que la feature 160 ya aplicó en `/ordenes` con el mismo motivo escrito
 * —«con 18 columnas y scroll horizontal, una columna al final quedaría permanentemente fuera
 * del viewport»— y el mismo sitio donde `OrdenesModule` antepone su columna de selección. NO
 * se tocó `components/shared/DataTable`: lo montan 55 archivos y la fila de columnas de ESTA
 * pantalla se arregla en ESTA pantalla.
 *
 * Cambia el orden y NADA más: ids, cabeceras y `render` quedan idénticos, y la descarga vive
 * en `api-keys-descarga-columnas.ts`, que no se entera. Lo vigila
 * `tests/unit/guards/api-keys-acciones-alcanzables.guardia.test.ts`.
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
  onEliminada,
}: ApiKeysColumnsOptions): Column<ApiKeyListItemDTO>[] {
  return [
    { id: "identificador", value: "Identificador" },
    {
      id: "estado",
      value: "Estado",
      render: (row) => <EstadoApiKeyBadge value={row.estado} />,
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (row) => (
        <ApiKeyAccionCell
          row={row}
          onMutated={onMutated}
          onEliminada={onEliminada}
        />
      ),
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
      /**
       * Feature 307 — A NOMBRE DE QUIÉN carga la clave. La 302 permitió que una key
       * cargue como una tienda ya registrada, pero sin esta columna el listado enseñaba
       * la cuenta dedicada de TODAS por igual: dos keys con destinos distintos se veían
       * idénticas. `null` (comportamiento histórico: la key es dueña de sus órdenes) se
       * pinta con el mismo placeholder que el resto de valores ausentes.
       */
      id: "tiendaDestino",
      value: "Tienda destino",
      render: (row) => row.tiendaDestinoNombre ?? SIN_DATO,
      minWidth: "140px",
    },
    {
      id: "createdAt",
      value: "Fecha de creación",
      render: (row) => formatFechaCreacion(row.createdAt),
      minWidth: "120px",
    },
  ];
}
