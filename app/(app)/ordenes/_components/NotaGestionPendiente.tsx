import type { GestionResultado } from "@prisma/client";

import { NotaAyudaConInfo, SenalPendienteConInfo } from "@/components/shared/EstadoInfo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// FICHA 454 (T2.2, R29) — LA NOTA que acompaña al chip de estado de una orden `en_reparto` cuando
// su gestión ya se registró y el cierre del día no se aprobó («Entregada · pendiente de
// confirmación»), o cuando tiene una ayuda a la tienda abierta («Ayuda solicitada a la tienda»).
//
// NO ES UN ESTADO y no sustituye al `EstatusBadge`: la orden SIGUE «En reparto» (el estado real se
// aplica al aprobar el cierre). Va AL LADO, con la variante `outline` —borde y texto, sin relleno—
// para que no se lea como un segundo estado. La gestión pendiente y la ayuda abierta son excluyentes
// por construcción (design §4.1: la ayuda abierta exige «sin gestión pendiente»); si llegaran las
// dos, gana la gestión, que es el hecho más reciente.
//
// Componente de PRESENTACIÓN puro: recibe los dos datos por props, ya decididos por el servidor. No
// deriva nada del estado ni del historial (el predicado de «pendiente» vive SOLO en el servidor,
// `lib/repositories/gestion-pendiente.ts`). Sin nada que pintar, no pinta nada.

export interface NotaGestionPendienteProps {
  /** Resultado de la gestión pendiente de confirmar, o `null` si no hay. */
  resultadoPendiente: GestionResultado | null;
  /** `true` si la orden tiene una ayuda a la tienda abierta. */
  ayudaAbierta?: boolean;
  /** Clases extra de colocación (p. ej. `self-start` dentro de un contenedor en columna). */
  className?: string;
}

/**
 * Montado junto al `EstatusBadge` en la columna «Estado» compartida (`ordenes-columns.tsx`, que
 * pintan `/ordenes` y la bodega satélite) y en el detalle de la orden (`HistorialOrdenSheet`).
 */
export function NotaGestionPendiente({
  resultadoPendiente,
  ayudaAbierta = false,
  className,
}: NotaGestionPendienteProps) {
  // FICHA 456 (T3.2, R11/R12): la nota va con su botón de información, como hermano del `Badge`
  // (que conserva su texto y su variante). La señal de pendiente explica con el texto de «En
  // reparto»; la ayuda, con el de la nota de ayuda.
  const chip = (texto: string) => (
    <Badge variant="outline" className="font-normal">
      {texto}
    </Badge>
  );
  if (resultadoPendiente !== null) {
    return <SenalPendienteConInfo resultado={resultadoPendiente} chip={chip} className={cn(className)} />;
  }
  if (ayudaAbierta) return <NotaAyudaConInfo chip={chip} className={cn(className)} />;
  return null;
}
