import type { PlantillaEstado } from "@prisma/client";
import { MessageSquareHeart } from "lucide-react";

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

/** `true` si la fila puede mandarse a aprobacion. Exportado: el modulo decide el mismo criterio. */
export function puedeEnviarseAAprobacion(estado: PlantillaEstado): boolean {
  return ENVIABLE_A_APROBACION.has(estado);
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
 * Columnas del listado de plantillas (feature 107/R6): nombre · estado · cuerpo ·
 * acciones. El `estado` se pinta como `Badge` de SOLO LECTURA
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
        </span>
      ),
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  // La marcada va SOLIDA (`default`) y el resto en `outline`: la diferencia se
                  // ve de un vistazo sin leer nada.
                  variant={row.welcomeMessage ? "default" : "outline"}
                  size="sm"
                  // Ya marcada = nada que hacer. Se deja VISIBLE y deshabilitada en vez de
                  // ocultarla: escondida, la fila resaltada perderia justo el control que
                  // explica por que esta resaltada.
                  disabled={row.welcomeMessage}
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
          {puedeEnviarseAAprobacion(row.estado) ? (
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
