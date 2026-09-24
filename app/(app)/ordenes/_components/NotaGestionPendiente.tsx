import type { GestionResultado } from "@prisma/client";

import { NOTA_AYUDA_SOLICITADA } from "@/components/shared/nota-pendiente-confirmacion";
import { Badge } from "@/components/ui/badge";

import { notaGestionPendiente } from "./estatus-label";

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
}

/**
 * @sin-superficie espera su dato: el DTO del listado de `/ordenes` (y el de la satélite) todavía no
 * trae la gestión pendiente ni la ayuda abierta de cada fila (design §11 U9: «el DTO del listado
 * gana `gestionPendiente: { resultado } | null`»), y derivarlas en el cliente sería una segunda
 * definición del predicado. Queda devuelto como BLOQUEO de la fase 2 de la 454
 * (`progress/impl_454_frontend.md`). La anotación CADUCA: se retira al montarlo junto al
 * `EstatusBadge` de `OrdenesListado` y `SateliteOrdenesListado`.
 */
export function NotaGestionPendiente({
  resultadoPendiente,
  ayudaAbierta = false,
}: NotaGestionPendienteProps) {
  const texto =
    resultadoPendiente !== null
      ? notaGestionPendiente(resultadoPendiente)
      : ayudaAbierta
        ? NOTA_AYUDA_SOLICITADA
        : null;
  if (texto === null) return null;
  return (
    <Badge variant="outline" className="font-normal">
      {texto}
    </Badge>
  );
}
