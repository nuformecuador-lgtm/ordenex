/**
 * Feature 172 (TANDA E, design §8/§10.2) — TEXTOS del pago al mensajero en `/cierres-admin`.
 *
 * Módulo PURO (sin React, sin DOM): lo comparten la sección del detalle, la insignia de la
 * tabla y el diálogo cableado, para que la pantalla no pueda acabar diciendo tres cosas
 * distintas de la misma deuda. Molde: `cierre-labels.ts` (esta misma carpeta) y
 * `components/shared/liquidacion/liquidacion-labels.ts` (Tanda D).
 *
 * Los textos van SEPARADOS del componente (`docs/conventions.md`: listos para i18n) y en
 * lenguaje claro: nada de siglas ni de jerga contable. «Pendiente de liquidar» es lo que de
 * este cierre todavía no se le ha entregado al mensajero.
 *
 * LO QUE ESTOS TEXTOS TIENEN QUE DEJAR CLARO (§8, R17/R18): aprobar un cierre y pagarle al
 * mensajero son **dos pasos distintos**. Por eso el botón que cierra el diálogo tras aprobar
 * dice «Ahora no» y no «Cancelar», y por eso el aviso de que el pago falló empieza diciendo
 * que el cierre quedó aprobado: si el usuario creyera que un pago fallido revierte la
 * aprobación, volvería a aprobar un cierre que ya lo está — y, peor, podría creer que el
 * mensajero sigue bloqueado (feature 111) por un trámite administrativo ajeno a él.
 */
import { money } from "@/components/shared/liquidacion/liquidacion-labels";

/** Rótulo de la columna del listado y de la línea del detalle (R26). Uno solo, compartido. */
export const PENDIENTE_LIQUIDAR_COL = "Pendiente de liquidar";

export const PAGO_MENSAJERO_TEXTO = {
  /** Nombre accesible y título de la sección del detalle (R19). */
  seccion: "Pago al mensajero",
  /** Rótulo del importe pendiente, dentro de la sección. */
  pendiente: PENDIENTE_LIQUIDAR_COL,
  /** Abre el formulario de registro. */
  registrar: "Registrar pago",
  /**
   * R17 — cierra el diálogo que se ofrece TRAS APROBAR sin registrar nada. No dice
   * «Cancelar» a propósito: no hay nada que cancelar, el cierre ya está aprobado.
   */
  ahoraNo: "Ahora no",
  /** R27 — el cierre está pagado del todo: no se ofrece registrar más pagos contra él. */
  liquidado: "Este cierre ya está liquidado: no queda nada por pagar.",
  /** Insignia del cierre aprobado sin nada pendiente (R27). */
  sinPendiente: "Liquidado",
  /** Confirmación de un pago registrado. El monto es el STRING del servidor, tal cual. */
  registrado: (monto: string) => `Pago de ${money(monto)} registrado.`,
  /**
   * R17 — el pago NO se registró y el diálogo venía de aprobar. El mensaje **empieza** por lo
   * que importa: el cierre quedó aprobado. La deuda queda abierta y visible (R26).
   */
  cierreSigueAprobado:
    "El cierre quedó aprobado. El pago no se registró: podés registrarlo después desde el detalle del cierre.",
  /** Mismo caso, pero pagando desde el detalle de un cierre ya aprobado (R19). */
  pagoNoRegistrado: "No se registró el pago. Revisá el aviso del formulario e intentá de nuevo.",
} as const;
