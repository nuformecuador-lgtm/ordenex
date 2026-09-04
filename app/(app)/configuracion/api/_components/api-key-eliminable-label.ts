import type { MotivoNoEliminable } from "@/lib/types/api-key";

/**
 * FICHA 373 (design §7.1) — POR QUE ESTA API KEY NO SE PUEDE ELIMINAR, dicho al usuario.
 *
 * Modulo PURO (sin React), hermano de `api-key-estado-label.ts`: la celda de acciones lo importa
 * para el `aria-label` y el `title` del boton apagado, y los tests lo leen sin arrastrar el DOM.
 *
 * EL MOTIVO NO SE CALCULA AQUI. Llega ya resuelto en `ApiKeyListItemDTO.motivoNoEliminable`, que
 * lo produce `motivoNoEliminable(estado, dependencias)` en el SERVIDOR con su precedencia fija
 * (373/R13). Esta tabla solo traduce ese vocabulario cerrado a castellano: recalcular en el
 * cliente serian dos verdades capaces de divergir.
 *
 * Las claves son las cinco del vocabulario, y el `Record` es EXHAUSTIVO por tipo: un motivo nuevo
 * en `MOTIVOS_NO_ELIMINABLE` no compila hasta que alguien escriba su texto.
 */
export const MOTIVO_NO_ELIMINABLE_TEXTO: Record<MotivoNoEliminable, string> = {
  ordenes: "Tiene órdenes a su nombre. No se puede eliminar.",
  dinero: "Tiene movimientos de dinero a su nombre. No se puede eliminar.",
  tarifas:
    "Tiene tarifas configuradas. Bórralas primero desde Configuración › Tarifas.",
  // El UNICO accionable desde la misma fila: el boton que lo resuelve —«Desactivar»— esta al lado.
  activa: "Está activa. Desactívala antes de eliminarla.",
  // Solo aparece como aviso TRAS un intento (red de las FK `Restrict`, design §4.4): el listado
  // nunca lo pinta en el boton porque `motivoNoEliminable` no lo produce jamas.
  otros_datos: "Tiene datos asociados.",
};

/**
 * Texto de respaldo cuando la fila NO es eliminable y el servidor no mando motivo. No deberia
 * ocurrir —el DTO trae los dos campos juntos—, pero un boton apagado que no dice nada es
 * exactamente el fallo mudo que 373/R28 viene a impedir: mejor una frase corta que una vacia.
 */
export const MOTIVO_NO_ELIMINABLE_GENERICO = "No se puede eliminar.";

/** Traduce el motivo del servidor a su texto; `null`/ausente cae en el respaldo. */
export function textoNoEliminable(
  motivo: MotivoNoEliminable | null | undefined,
): string {
  return motivo
    ? MOTIVO_NO_ELIMINABLE_TEXTO[motivo]
    : MOTIVO_NO_ELIMINABLE_GENERICO;
}
