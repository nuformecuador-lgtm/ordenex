"use client";

import { Badge } from "@/components/ui/badge";
import { money } from "@/components/shared/liquidacion/liquidacion-labels";
import { montoValido } from "@/components/shared/monto-cliente";

import { PAGO_MENSAJERO_TEXTO } from "./pago-mensajero-labels";

// Feature 172 (T E.3, R26/R27/R28) — la marca de «pendiente de liquidar» de un cierre. La
// pintan el listado (una columna del histórico) y el detalle, y por eso vive en su propio
// archivo: la deuda tiene que leerse igual en los dos sitios.
//
// R26 EN UNA LÍNEA: **el pendiente se PINTA, no se calcula.** Llega derivado del servidor
// (`CierreAdminResumen.pendientePagoMensajero`, T C.2) como STRING de escala 2 y se muestra
// tal cual. Money-safe (R14): cero `Number(`, cero `parseFloat`. La única lectura que se hace
// del monto es «¿es mayor que cero?», y la hace `montoValido` comparando TEXTO.
//
// Los tres estados que hay que poder distinguir de un vistazo, y por qué son tres:
//   - `null` → el cierre NO está aprobado (R28): no hay nada que pagar todavía y la pantalla
//     no muestra ni ofrece nada. Un guion, como el resto de celdas vacías de esta tabla.
//   - `"0.00"` → aprobado y liquidado del todo (R27): deja de señalarse como pendiente. NO se
//     pinta como un guion: «no debe nada» y «todavía no se sabe» son cosas distintas, y
//     confundirlas es lo que haría que un cierre pagado pasara por uno sin aprobar.
//   - `> 0` → aprobado con deuda (R26): insignia de aviso con el importe.

/**
 * `true` si de este cierre queda dinero por entregarle al mensajero. Es un type guard: donde
 * es cierto, el pendiente es un STRING utilizable (prefija el formulario, R23/R30).
 *
 * Un valor que no sea un monto bien formado se trata como «nada que pagar»: no puede llegar
 * (lo deriva el servidor con `Prisma.Decimal`), y ante la duda la respuesta segura es NO
 * ofrecer un pago cuyo importe nadie pudo leer.
 */
export function hayPendienteDeLiquidar(pendiente: string | null): pendiente is string {
  return pendiente !== null && montoValido(pendiente);
}

export interface PendienteLiquidarBadgeProps {
  /** El STRING del servidor, o `null` si el cierre no está aprobado (R28). */
  pendiente: string | null;
}

export function PendienteLiquidarBadge({ pendiente }: Readonly<PendienteLiquidarBadgeProps>) {
  if (pendiente === null) {
    // R28: en un cierre no aprobado no se muestra nada relativo al pago.
    return <span className="text-muted-foreground">—</span>;
  }
  if (!hayPendienteDeLiquidar(pendiente)) {
    return <Badge variant="success">{PAGO_MENSAJERO_TEXTO.sinPendiente}</Badge>;
  }
  return <Badge variant="warning">{money(pendiente)}</Badge>;
}
