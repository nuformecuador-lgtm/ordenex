import { z } from "zod";

import { LIQUIDACION_REFERENCIA_MAX } from "@/lib/types/liquidacion";
import { comprobanteSchema, PAGO_POR_CUENTA_BENEFICIARIO_MAX } from "@/lib/types/pago-por-cuenta-tienda";
import { registrarEgresoAdministrativoSchema, registrarMovimientoManualSchema } from "@/lib/types/wallet";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §4.1, R42/R43/R74, D5) — los campos LATERALES de los registros de caja a mano
// (sueldo, gasto de Ordenex, correccion): «a quien», referencia y comprobante. Archivo HOJA a
// proposito: importa de `wallet.ts`, `liquidacion.ts` y `pago-por-cuenta-tienda.ts` sin crear un ciclo.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Los topes NO se inventan: «a quien» es el MISMO concepto que el beneficiario del pago de un gasto
// (459, 120) y la referencia la misma que la del pago de la 172 (60).
//
// D5 dice «a quien» OBLIGATORIO en sueldo y gasto: lo exige el DIALOGO de la 458-C (R42 es del
// dialogo). En el servidor es opcional a proposito: el dialogo de hoy no lo manda, y sin los campos
// nuevos el registro tiene que ser byte a byte el de hoy (TB.11). Anotado en `progress/impl_458-B.md`.

/** Un texto libre opcional: vacio o solo espacios = ausente (un campo de formulario sin rellenar). */
function textoOpcional(max: number, mensaje: string) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max, mensaje).optional(),
  );
}

export const camposLateralesCaja = z.object({
  contraparteNombre: textoOpcional(
    PAGO_POR_CUENTA_BENEFICIARIO_MAX,
    `«A quién» no puede superar ${PAGO_POR_CUENTA_BENEFICIARIO_MAX} caracteres.`,
  ),
  referencia: textoOpcional(
    LIQUIDACION_REFERENCIA_MAX,
    `La referencia no puede superar ${LIQUIDACION_REFERENCIA_MAX} caracteres.`,
  ),
});

export type CamposLateralesCaja = z.infer<typeof camposLateralesCaja>;

/** Sueldo / gasto de Ordenex CON sus laterales. Intersección: cada lado conserva sus reglas. */
export const registrarEgresoConLateralesSchema = z.intersection(registrarEgresoAdministrativoSchema, camposLateralesCaja);
/** Corrección de caja CON sus laterales (su `refine` tipo↔categoría se conserva). */
export const registrarMovimientoManualConLateralesSchema = z.intersection(registrarMovimientoManualSchema, camposLateralesCaja);

/** El comprobante opcional del registro (R74/R75): los tipos y el tope de la 459. */
export const comprobanteOpcionalSchema = comprobanteSchema.optional();

/**
 * Del `FormData` (o del objeto de hoy) a `{ crudo, comprobante }`: el archivo va aparte porque los
 * schemas de hoy no son `.strict()` y lo descartarian en silencio. Un campo de archivo vacio (el
 * `File` de 0 bytes del navegador) es «sin comprobante» (molde 457).
 */
export function separarComprobante(input: unknown): { crudo: unknown; comprobante: unknown } {
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    const crudo: Record<string, unknown> = {};
    let comprobante: unknown = undefined;
    for (const [clave, valor] of input.entries()) {
      if (clave === "comprobante") {
        if (typeof valor !== "string" && valor.size === 0) continue;
        comprobante = valor;
        continue;
      }
      crudo[clave] = valor;
    }
    return { crudo, comprobante };
  }
  return { crudo: input, comprobante: undefined };
}
