import type { PlantillaEstado } from "@prisma/client";
import { Check, MessageSquareHeart, Store } from "lucide-react";

import type { Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  // Neutra a proposito: un borrador no es un problema (no es `danger`) ni una espera
  // (no es `warning`, que aqui significa "Meta la esta mirando"). Es una plantilla a medias.
  saved_not_aprobation: "secondary",
};

/**
 * Estados desde los que TIENE SENTIDO mandar a revision: la que nunca salio de casa y la que
 * Meta rechazo (se corrige y se reenvia). Desde `pending` no, porque ya esta en revision;
 * desde `activo` tampoco, porque ya paso.
 */
const ENVIABLE_A_APROBACION: ReadonlySet<PlantillaEstado> = new Set([
  "saved_not_aprobation",
  "refused",
]);

/**
 * `true` si la fila puede mandarse a aprobacion. Exportado: el modulo decide el mismo criterio.
 *
 * Recibe la FILA y no solo el estado desde 2026-08-27: una PLANTILLA DE TIENDA puede estar en
 * un estado enviable (`saved_not_aprobation` si se marco despues de crearla) y aun asi no
 * tener nada que enviar, porque su texto no vive en Meta. El estado por si solo ya no basta
 * para contestar la pregunta.
 */
export function puedeEnviarseAAprobacion(
  row: Pick<PlantillaListItemDTO, "estado" | "plantillaTienda">,
): boolean {
  if (row.plantillaTienda) return false;
  return ENVIABLE_A_APROBACION.has(row.estado);
}

function truncar(texto: string): string {
  if (texto.length <= CUERPO_MAX) return texto;
  return `${texto.slice(0, CUERPO_MAX)}…`;
}

/**
 * Lo que el boton de bienvenida explica. Es el UNICO sitio donde se dice que el envio es
 * AUTOMATICO y CUANDO ocurre: sin esa frase, "mensaje de bienvenida" no dice si lo manda
 * alguien a mano ni en que momento del recorrido sale.
 */
export const TOOLTIP_BIENVENIDA =
  "Este mensaje se enviará automáticamente cuando el paquete sea recogido.";

/** Lo que explica el boton cuando la fila YA es la bienvenida: por que no hay nada que pulsar. */
export const TOOLTIP_BIENVENIDA_ACTUAL = `Esta es la plantilla de bienvenida. ${TOOLTIP_BIENVENIDA}`;

/**
 * BORRADO 2026-08-27 (pedido humano): aqui vivia `TOOLTIP_BIENVENIDA_NO_ACTIVA`, el texto que
 * explicaba por que el boton estaba deshabilitado en una plantilla no `activo`. Ya no hay boton
 * que explicar: en esas filas no se pinta (ver `muestraBotonBienvenida`).
 */

/**
 * `true` si la fila PINTA el boton de bienvenida. Distinto de `puedeSerBienvenida`, que decide
 * si se puede PULSAR: la fila ya marcada lo pinta deshabilitado (es donde se lee que ella es la
 * bienvenida), y estas dos no lo pintan en absoluto —
 *
 *   - PLANTILLA DE TIENDA: nunca podra serlo. La bienvenida sale por Meta y ella no vive alli.
 *   - Estado distinto de `activo`: hoy no puede serlo.
 *
 * En los dos casos el boton seria un control muerto, y un control muerto estorba mas de lo que
 * informa. Antes se dejaba visible y deshabilitado con un tooltip que decia el motivo; el
 * pedido humano del 2026-08-27 lo retira.
 */
export function muestraBotonBienvenida(row: PlantillaListItemDTO): boolean {
  return !row.plantillaTienda && row.estado === "activo";
}

/**
 * `true` si la fila puede marcarse como bienvenida. Exportado y usado TANTO por el boton como
 * por su tooltip, para que lo que se deshabilita y lo que se explica no puedan discrepar.
 * Espejo del guardia del service (`marcarMensajeBienvenida`), que es quien manda: esto es
 * cortesia de UI, no la puerta.
 */
export function puedeSerBienvenida(row: PlantillaListItemDTO): boolean {
  // Una plantilla de tienda esta `activo` desde que nace, asi que sin esta linea pasaria el
  // filtro justo por serlo — y la bienvenida sale por Meta, donde ella no existe.
  if (row.plantillaTienda) return false;
  return row.estado === "activo" && !row.welcomeMessage;
}

export interface PlantillasColumnsActions {
  /** Abre el formulario de edición de la fila (R20). */
  onEditar: (row: PlantillaListItemDTO) => void;
  /**
   * Manda la fila a revisión de Meta. Solo se muestra desde los estados en que sirve de algo
   * (ver `ENVIABLE_A_APROBACION`); el módulo confirma antes porque NO se puede deshacer.
   */
  onEnviarAprobacion: (row: PlantillaListItemDTO) => void;
  /**
   * Desactiva la fila: ÚNICA transición de estado del front (R24), envía destino
   * `inactivo`. Solo se muestra cuando el estado no es ya `inactivo`.
   */
  onDesactivar: (row: PlantillaListItemDTO) => void;
  /** Elimina la fila (SOFT DELETE, R27): la retira del listado tras confirmar. */
  onEliminar: (row: PlantillaListItemDTO) => void;
  /**
   * Deja la fila como MENSAJE DE BIENVENIDA. Es un `set`: la anterior se desmarca sola en el
   * backend, asi que desde aqui no hay forma de quedarse sin ninguna.
   */
  onMarcarBienvenida: (row: PlantillaListItemDTO) => void;
}

/**
 * Columnas del listado de plantillas (feature 107/R6): nombre · plant. tienda · estado ·
 * cuerpo · acciones. El `estado` se pinta como `Badge` de SOLO LECTURA
 * (`pending`/`activo`/`refused` no son accionables desde el front); la ÚNICA acción
 * de estado es "Desactivar", visible cuando el estado no es ya `inactivo` (R24).
 */
export function buildPlantillasColumns(
  actions: PlantillasColumnsActions,
): Column<PlantillaListItemDTO>[] {
  return [
    {
      id: "nombre",
      value: "Nombre",
      // La bienvenida se RESALTA en la primera columna y no solo en el boton de accion: quien
      // recorre el listado busca "cual es" leyendo nombres, no inspeccionando botones.
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className={row.welcomeMessage ? "font-medium" : undefined}>{row.nombre}</span>
          {row.welcomeMessage ? (
            <Badge variant="success">
              <MessageSquareHeart className="size-3" aria-hidden="true" />
              Bienvenida
            </Badge>
          ) : null}
          {/* Sin esta insignia, una plantilla de tienda `activo` es indistinguible de una que
              Meta aprobo, y la diferencia es justo la que explica por que a esta le falta el
              boton de "Enviar para aprobacion". */}
          {row.plantillaTienda ? (
            <Badge variant="secondary">
              <Store className="size-3" aria-hidden="true" />
              Tienda
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "plantillaTienda",
      value: "Plant. Tienda",
      // Columna DEDICADA (pedido humano del 2026-08-28) ademas de la insignia del nombre: la
      // insignia se lee fila a fila, una columna propia se barre en vertical y contesta "cuales
      // son de tienda" de un vistazo.
      //
      // Solo se pinta el chulito del `true`. El `false` va VACIO a proposito: una columna con
      // marca en unas filas y hueco en otras se lee mas rapido que una con dos simbolos que hay
      // que distinguir. El nombre accesible va en el `aria-label` del icono —un `<Check>` sin
      // texto no dice nada a un lector de pantalla— y las filas sin marca se anuncian como la
      // celda vacia que son.
      render: (row) =>
        row.plantillaTienda ? (
          <Check className="size-4 text-primary" aria-label="Sí" role="img" />
        ) : null,
    },
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
          {muestraBotonBienvenida(row) ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    // La marcada va SOLIDA (`default`) y el resto en `outline`: la diferencia
                    // se ve de un vistazo sin leer nada.
                    variant={row.welcomeMessage ? "default" : "outline"}
                    size="sm"
                    // Lo unico que queda deshabilitado es la fila YA marcada: no hay nada que
                    // pulsar, pero el boton se deja visible porque es donde se lee que ella es
                    // la bienvenida. Los demas casos en que no se puede marcar ya no llegan
                    // aqui: esas filas no pintan el boton (ver `muestraBotonBienvenida`).
                    disabled={!puedeSerBienvenida(row)}
                    aria-pressed={row.welcomeMessage}
                    onClick={() => actions.onMarcarBienvenida(row)}
                  >
                    <MessageSquareHeart className="size-4" aria-hidden="true" />
                    Mensaje de bienvenida
                  </Button>
                }
              />
              <TooltipContent>
                {row.welcomeMessage ? TOOLTIP_BIENVENIDA_ACTUAL : TOOLTIP_BIENVENIDA}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {puedeEnviarseAAprobacion(row) ? (
            <Button
              type="button"
              size="sm"
              onClick={() => actions.onEnviarAprobacion(row)}
            >
              Enviar para aprobación
            </Button>
          ) : null}
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
