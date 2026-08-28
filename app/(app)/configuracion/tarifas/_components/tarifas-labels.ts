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
 * EL DEFECTO DE FONDO, Y LO QUE LO ARREGLA. Estos DOS montos no son el mismo dinero, y la
 * pantalla los presentaba como si lo fueran:
 * - `entregado` → `cobroEntregado`, y `lib/utils/pago-mensajero.ts` se lo paga AL MENSAJERO
 *   (sólo por `entregada`).
 * - `rechazado` → `cobroRechazado`, que según `lib/utils/ingreso-bodega.ts` es INGRESO DE LA
 *   BODEGA responsable del mensajero y «NUNCA se paga al mensajero».
 *
 * Por eso el título ya no atribuye el dinero a nadie —nombra a los dos destinatarios— y quien
 * cobra cada monto lo dice CADA CAMPO, en su ayuda: así no hay que leer el código para saberlo.
 */
export const PAGO_ZONA_TEXTO = {
  /** Encabezado de la sección que envuelve el bloque (`CrearZonaForm`). */
  seccion: "Pagos por zona",
  /** La explicación de la sección: los dos dineros y su destinatario, en una línea. */
  seccionAyuda:
    "Lo que Ordenex paga por cada gestión en esta zona: la entrega se le paga al mensajero; " +
    "el rechazo del cliente es ingreso de la bodega responsable de él.",
  titulo: "Pagos por zona (mensajero y bodega)",
  /** Con el cobro por vehículo activo, los mismos dos pagos se desglosan por vehículo. */
  tituloPorVehiculo: "Pagos por zona y vehículo (mensajero y bodega)",
  entregado: "Entregado",
  /** Quién cobra ESTE monto (feature 39). */
  entregadoDestino: "Se le paga al mensajero.",
  rechazado: "Rechazado por el cliente",
  /** Quién cobra ESTE otro (feature 56). Lo dice en negativo a propósito: es el que se confundía. */
  rechazadoDestino: "Es ingreso de la bodega, no del mensajero.",
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
