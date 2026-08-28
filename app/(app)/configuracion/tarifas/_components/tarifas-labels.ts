/**
 * Feature 303 — TEXTOS de la pantalla «Costos por zona» (`/configuracion/tarifas`).
 *
 * Módulo PURO (sin React, sin DOM), con el molde de `cierres-admin/_components/
 * pago-mensajero-labels.ts` y `wallet/_components/wallet-labels.ts`: los textos viven FUERA
 * del componente (listos para i18n) y los comparten los dos formularios de la pantalla —el de
 * zona y el de tienda—, para que la misma cifra no pueda acabar llamándose de dos maneras.
 *
 * POR QUÉ EXISTE. En producción, el cobro por rechazo de la zona GAM estaba en ₡0,00 y la
 * pantalla no distinguía «esta zona no paga por rechazo» de «a nadie se le ocurrió ponerlo».
 * Las otras cuatro zonas sí lo tenían. Costó media hora de diagnóstico y 44 rechazos sin
 * pagar a la bodega. Aquí NO cambia ninguna regla de negocio: cambian los rótulos y se añade
 * un aviso que no bloquea nada.
 *
 * LOS DOS DINEROS DE ESTA PANTALLA, que hoy se rotulaban igual de neutros:
 * - Lo que Ordenex PAGA por gestionar en la zona (`tarifa_zona_mensajero`) → los dos montos
 *   de `CobroVehiculoTarifas`.
 * - Lo que Ordenex COBRA a la tienda por repartir (`tarifas`) → los campos de `TarifaCampos`.
 */

/**
 * Rótulos de los campos de `tarifas` — lo que se le COBRA a la tienda. Las claves son las de
 * la tabla; el rótulo es lo único que cambia aquí.
 *
 * `Record` sobre las claves reales (lo teclea `TarifaCampos`): un campo nuevo en la tabla
 * obliga a bautizarlo en este archivo, en vez de dejarlo caer con su nombre técnico.
 */
export const TARIFA_CAMPO_LABEL = {
  valorFlete: "Valor flete",
  /**
   * Antes «Valor flete devuelto». Este monto se cobra SOLO cuando la gestión es `rechazada`
   * (`lib/utils/ingreso-ordenex.ts`): desde la ficha 301, una `devuelta` NO genera nada —el
   * paquete sigue vivo en la calle y todavía puede reprogramarse—. «Devuelto» nombraba
   * justo el caso que no cobra.
   */
  valorFleteDevuelto: "Flete de retorno (solo rechazos)",
  valorFleteGam: "Valor flete GAM",
  /** El equivalente GAM del anterior; conserva la marca de zona porque es OTRA columna. */
  valorFleteDevueltoGam: "Flete de retorno GAM (solo rechazos)",
  /** NO se toca: «Fulfillment» es como lo conocen ellos (decisión del negocio). */
  fulfillment: "Fulfillment",
  /** Antes «Comisión COD (%)». La sigla no la lee nadie fuera del equipo técnico. */
  comisionCod: "Comisión por cobro contra entrega (%)",
  ivaFlete: "IVA flete (%)",
  /** El IVA de la comisión de arriba; se nombra igual que ella para que se lean en pareja. */
  ivaComisionCod: "IVA de la comisión por cobro contra entrega (%)",
  /** NO se tocan: «Tarifa especial» es como lo conocen ellos (decisión del negocio). */
  tarifaEspecial: "Tarifa especial",
  tarifaEspecialDevuelta: "Tarifa especial devuelta",
} as const;

/**
 * Textos del bloque de montos que Ordenex PAGA por cada gestión de la zona.
 *
 * `rechazado` era «No entregado», y ese rótulo abarcaba TRES casos cuando la regla cubre uno:
 * `lib/utils/ingreso-bodega.ts` paga ese monto sólo si el resultado es `rechazada`; una
 * `devuelta` y una `reprogramada` también son «no entregado» y no pagan nada.
 *
 * El título dice de quién es el dinero, porque el bloque convive en la misma pantalla con las
 * tarifas que se le COBRAN a la tienda y hasta hoy los dos rótulos eran igual de neutros.
 */
export const PAGO_MENSAJERO_ZONA_TEXTO = {
  titulo: "Pago al mensajero por zona",
  /** Con el cobro por vehículo activo, el mismo pago se desglosa por vehículo. */
  tituloPorVehiculo: "Pago al mensajero por zona y vehículo",
  entregado: "Entregado",
  rechazado: "Rechazado por el cliente",
} as const;

/**
 * El aviso del CERO (lo que evita repetir el incidente): un monto en cero lo dice la propia
 * pantalla, en vez de dejar que se confunda con el olvido.
 *
 * Es un AVISO, no un bloqueo: cero puede ser una decisión legítima —lo que no puede es ser
 * indistinguible de que nadie lo configuró—. Se pinta como ayuda del campo (`FormField
 * hint`), enlazada por `aria-describedby`, y no impide guardar ni cambia validación alguna.
 *
 * Dos redacciones porque son dos dineros opuestos: uno sale de Ordenex, el otro entra.
 */
export const AVISO_MONTO_CERO = {
  pago: "Sin configurar: no se pagará nada por este concepto.",
  cobro: "Sin configurar: no se cobrará nada por este concepto.",
} as const;

/**
 * true si lo tecleado se GUARDARÁ como cero. Espeja la conversión del bloque de pago al
 * mensajero (`CobroVehiculoTarifas`), donde el campo vacío no es un error de validación: se
 * manda como 0 y no paga nada. Por eso el vacío también avisa —es exactamente el caso «a
 * nadie se le ocurrió ponerlo»— y un valor que no es número tampoco engaña, porque también
 * acaba en 0.
 */
export function seGuardaComoCero(valor: string): boolean {
  const raw = valor.trim();
  if (raw === "") return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n === 0;
}

/**
 * true si lo tecleado es un cero EXPLÍCITO. Es el predicado de los campos de `tarifas`, que
 * son obligatorios: ahí el vacío ya tiene su propio mensaje («Este campo es obligatorio») y
 * duplicarlo con el aviso sólo haría ruido.
 */
export function esCeroExplicito(valor: string): boolean {
  const raw = valor.trim();
  if (raw === "") return false;
  return Number(raw) === 0;
}
