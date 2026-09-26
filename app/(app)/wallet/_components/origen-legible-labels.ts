// Ficha 458-A (TA.2, design §3.3, R5–R8) — los textos con que se nombra la ENTIDAD de origen de un
// movimiento. Modulo PURO (sin React): lo lee `OrigenLegibleService` en el servidor, que compone el
// texto completo y el enlace; el cliente recibe el resultado hecho.
//
// Regla H6: ningun texto de aqui recibe un identificador interno. Reciben dias (`YYYY-MM-DD`,
// dia de Costa Rica), nombres (ya con `etiquetaDeCuenta`), guias, metodos y conceptos.

import { METODO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import {
  DETALLE_MOVIMIENTO_VER_ORDEN,
  etiquetaVerOrden,
} from "@/app/(app)/wallet/_components/detalle-movimiento-labels";

/** El separador de la casa entre el rotulo y la entidad («Cierre del día · 2026-09-12 · Juan»). */
export const SEPARADOR_ORIGEN = " · ";

/** Metodo de pago en palabras: el MISMO diccionario que pinta los cierres (no una copia). */
export const METODO_ORIGEN_LABEL = METODO_LABEL;

export const ORIGEN_ENTIDAD_LABEL = {
  /** Una fila de caja del cobro por rechazo (flete o IVA del flete por rechazo). */
  cobroPorRechazo: "cobro por rechazo",
  guia: (guia: string) => `guía ${guia}`,
  remision: (remision: string) => `remisión ${remision}`,
  podio: (dia: string) => `podio del ${dia}`,
  aBeneficiario: (beneficiario: string) => `a ${beneficiario}`,
  /** El egreso de caja registrado a mano, por su concepto (design §3.3, fila `gasto`). */
  sueldo: "Sueldo",
  gastoDeOrdenex: "Gasto de Ordenex",
  gastoFijo: "Gasto fijo de Ordenex",
} as const;

/** Nombres accesibles de los enlaces (R7): dicen a donde van y con que, nunca un id. */
export const ORIGEN_ENLACE_LABEL = {
  verCierre: (dia: string) => `Ver el cierre del ${dia}`,
  verCierreDe: (dia: string, mensajero: string) => `Ver el cierre del ${dia} de ${mensajero}`,
  verOrden: etiquetaVerOrden,
  verPodio: (dia: string) => `Ver el ranking del ${dia}`,
} as const;

export { DETALLE_MOVIMIENTO_VER_ORDEN };
