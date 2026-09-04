import type { EstadoApiKey } from "@prisma/client";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import type { Column } from "@/components/shared/DataTable";
import { Badge, badgeVariants } from "@/components/ui/badge";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";
import { cn } from "@/lib/utils";

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

/**
 * Una celda de DATO de esta tabla: su contenido va en UNA sola línea.
 *
 * =============================================================================================
 * ⚠️ `whitespace-nowrap` NO RECORTA, NO ESCONDE Y NO ABREVIA (2026-09-04).
 * =============================================================================================
 *
 * Lo que hace es SUBIR el `min-content` de la columna de «su palabra más larga» a «el dato
 * entero», y a partir de ahí el ancho lo decide el dato. Es exactamente la pieza que la ficha
 * 354 ya usa en `analitica/…/ProductosTabla` («⚠ NO ES UN RECORTE… lo que hace es prohibirle a
 * la columna ser más estrecha que su frase»), y por eso aquí se REUSA en vez de inventar otra:
 * ni `truncate`, ni `line-clamp`, ni `max-w` con elipsis. Un email a medias no se ve cortado,
 * se lee como OTRO email — la misma lección medida de las fichas 343/344 sobre las cifras.
 *
 * El precio está medido y se paga a sabiendas: la tabla desborda más a lo ancho. Ese
 * desbordamiento NO es un defecto y no hay que resolverlo aquí — `DataTable` ya trae el control
 * para eso (las dos flechas circulares que aparecen SOLO cuando la tabla desborda su contenedor
 * con scroll). El canje es el mismo que este repo ya tiene decidido en las otras tablas anchas:
 * mejor deslizar que estrujar.
 */
function CeldaUnaLinea({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <span className={cn("whitespace-nowrap", className)}>{children}</span>;
}

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
 * Columnas del listado de API keys (feature 82/R14): identificador · prefijo · usuario
 * dedicado (email sintético [D1]) · tienda destino (307) · fecha de creación · estado ·
 * webhook · acciones.
 *
 * =============================================================================================
 * EL DEFECTO ERA VERTICAL, NO HORIZONTAL (2026-09-04). Y EL ORDEN VUELVE A SER EL DE SIEMPRE.
 * =============================================================================================
 *
 * Aquí hubo un intento previo que adelantaba «Acciones» y «Webhook» para que los botones no
 * quedaran fuera del área visible en portátiles. Se revirtió: el desbordamiento HORIZONTAL de
 * esta tabla no es un defecto, es una situación prevista y ya resuelta por un control que
 * existe —las flechas de desplazamiento de `DataTable`, que solo se dibujan cuando la tabla
 * desborda—, y a cambio aquel orden dejaba «Eliminar» en mitad de la fila, delante del
 * «Editar» del webhook. Lo que sí estaba roto era lo VERTICAL: las celdas plegaban su
 * contenido en varios renglones. Medido en Chromium sobre `/configuracion/api` con la barra
 * lateral desplegada, ANTES del arreglo (líneas por celda de la primera fila):
 *
 *   | viewport | visible | tabla | identificador | usuario dedicado | fecha |
 *   |----------|---------|-------|---------------|------------------|-------|
 *   | 1024     |     718 |  1100 | 3 líneas      | 3 líneas         | 2     |
 *   | 1280     |     974 |  1100 | 3 líneas      | 3 líneas         | 2     |
 *   | 1440     |    1134 |  1134 | 3 líneas      | 3 líneas         | 2     |
 *   | 1920     |    1614 |  1614 | 1 línea       | 1 línea          | 1     |
 *
 * Fíjate en la fila de 1440: la tabla NO desbordaba y aun así el texto se partía en tres. Ese
 * es el punto — el plegado no venía del scroll, venía de que a `w-full` con layout automático
 * el navegador estruja las columnas hasta el `min-content`, y el `min-content` de un texto que
 * puede partirse es su palabra más larga. Por eso el arreglo es `CeldaUnaLinea` (ver su nota),
 * no mover columnas.
 *
 * ORDEN, y por qué importa el último puesto: `Identificador · Prefijo · Usuario dedicado ·
 * Tienda destino · Fecha de creación · Estado · Webhook · Acciones`. Primero la identidad de
 * la fila, luego sus datos, y al final lo que se HACE con ella. Con «Webhook» delante de
 * «Acciones», el «Editar» del webhook queda antes que el trío Rotar · Activar/Desactivar ·
 * Eliminar, de modo que **«Eliminar» es la última acción de la fila**: lo irreversible, al
 * final. Lo vigila `tests/unit/guards/api-keys-tabla-una-linea.guardia.test.tsx`.
 *
 * Cambia el orden y la envoltura de las celdas, y NADA más: ids, cabeceras y contenido de cada
 * `render` quedan idénticos, y la descarga vive en `api-keys-descarga-columnas.ts`, que no se
 * entera. NO se tocó `components/shared/DataTable`: lo montan 55 archivos y la fila de
 * columnas de ESTA pantalla se arregla en ESTA pantalla.
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
    {
      id: "identificador",
      value: "Identificador",
      // Antes salía sin `render` (acceso por clave) y era la celda que peor se plegaba: un
      // identificador con espacios («Prueba Tienda 18:06:29») caía en 3 renglones.
      render: (row) => <CeldaUnaLinea>{row.identificador}</CeldaUnaLinea>,
    },
    {
      id: "keyPrefix",
      value: "Prefijo",
      render: (row) => (
        <CeldaUnaLinea className="font-mono">{`${row.keyPrefix}…`}</CeldaUnaLinea>
      ),
    },
    {
      id: "usuarioEmail",
      value: "Usuario dedicado",
      // El email sintético lleva guiones, y el navegador partía por CADA uno de ellos.
      render: (row) => (
        <CeldaUnaLinea className="font-mono text-muted-foreground">
          {row.usuarioEmail}
        </CeldaUnaLinea>
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
      render: (row) => (
        <CeldaUnaLinea>{row.tiendaDestinoNombre ?? SIN_DATO}</CeldaUnaLinea>
      ),
      minWidth: "140px",
    },
    {
      id: "createdAt",
      value: "Fecha de creación",
      // «4/9/26, 1:06 p. m.» tiene tres espacios: sin esto se partía en dos renglones.
      render: (row) => (
        <CeldaUnaLinea>{formatFechaCreacion(row.createdAt)}</CeldaUnaLinea>
      ),
      minWidth: "120px",
    },
    {
      // El `Badge` ya trae `whitespace-nowrap` en su variante: no necesita envoltura.
      id: "estado",
      value: "Estado",
      render: (row) => <EstadoApiKeyBadge value={row.estado} />,
    },
    {
      // Penúltima A PROPÓSITO: su «Editar» es la acción que va ANTES del trío de la fila,
      // para que «Eliminar» quede la última de todas.
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
      // ÚLTIMA columna. Dentro, el orden es Rotar · Activar/Desactivar · Eliminar (lo pone
      // `ApiKeyAccionCell`), así que lo irreversible cierra la fila.
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
  ];
}
