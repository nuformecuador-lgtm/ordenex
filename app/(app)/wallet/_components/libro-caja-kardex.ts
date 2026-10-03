/**
 * Ficha 468 (design §7.3; R17, R18, R40) — los TEXTOS de un movimiento de la caja en el libro en Excel:
 * su Concepto, su fecha y su Detalle. Los usa la fila de la hoja «Movimientos»
 * (`filaBaseCaja`, en `wallet-ledger-descarga-columnas.ts`) y la hoja «Detalle por guía» (el Concepto de
 * cada fila de guía y el Detalle de «Movimientos sin guía»), para que las dos hojas digan lo mismo.
 *
 * Módulo PURO (sin React). Vive aparte del módulo de columnas porque la guardia de columnas sensibles
 * exige que todo lo que exporta un `*-descarga-columnas` proyecte un DTO a una FILA.
 */
import { PANEL_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { textoDeOrigen } from "@/components/shared/wallet/origen-movimiento";
import { textoDetalle, textoGuias } from "@/components/shared/wallet/libro-kardex-descarga";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

import { CATEGORIA_LABEL, ORIGEN_LABEL } from "./wallet-labels";

/** R17 — el Concepto: la MISMA etiqueta que pinta la tabla (el valor del enum si no tuviera etiqueta). */
export function conceptoDeCaja(movimiento: WalletMovimientoDTO): string {
  return CATEGORIA_LABEL[movimiento.categoria] ?? movimiento.categoria;
}

/** La fecha del movimiento como la pinta la tabla: el día de Costa Rica. */
export function fechaDeCaja(movimiento: WalletMovimientoDTO): string {
  return fechaDiaMovimientoCR(movimiento.fechaMovimiento);
}

/**
 * R18 — el Detalle de la caja: el origen legible con su descripción (la MISMA composición de la celda,
 * `textoDeOrigen`), el «N guía(s)» si es repartible y «Anulado» si el servidor lo dice. La caja no tiene
 * forma de pago por fila.
 */
export function detalleDeCaja(movimiento: WalletMovimientoDTO, ordenes: number | null): string {
  return textoDetalle([
    textoDeOrigen(movimiento, ORIGEN_LABEL),
    textoGuias(ordenes),
    movimiento.documento?.anulado ? PANEL_TEXTO.anulado : null,
  ]);
}
