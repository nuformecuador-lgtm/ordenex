import type { ComprobanteGuardado } from "@/lib/interfaces/repositories/IWalletComprobanteRepository";
import type { LateralesDelRegistro } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CamposLateralesCaja } from "@/lib/types/wallet-laterales";
import type {
  CarpetaLateral,
  ComprobanteRecibido,
  FalloDeComprobante,
  IWalletComprobanteService,
} from "@/lib/interfaces/services/IWalletComprobanteService";

/**
 * R42/R74 — lo lateral de un registro de caja a mano: la anotacion si trae «a quien» o referencia
 * (el CHECK de la tabla exige al menos uno) y el comprobante si se subio. `undefined` si no hay nada:
 * el repositorio recibe entonces EXACTAMENTE la llamada de antes.
 */
export function lateralesDeCaja(
  input: Partial<CamposLateralesCaja>,
  guardado: ComprobanteGuardado | null,
  subidoPor: string,
): LateralesDelRegistro | undefined {
  const contraparteNombre = input.contraparteNombre ?? null;
  const referencia = input.referencia ?? null;
  const hayAnotacion = contraparteNombre !== null || referencia !== null;
  if (!hayAnotacion && guardado === null) return undefined;
  return {
    ...(hayAnotacion ? { anotacion: { contraparteNombre, referencia } } : {}),
    ...(guardado !== null ? { comprobante: { ...guardado, subidoPor } } : {}),
  };
}

export type { FalloDeComprobante };

/**
 * FICHA 458-B (design §4.1, R74–R76) — el MOLDE 459 del comprobante al registrar, escrito una vez para
 * los caminos que lo ganan (sueldo, gasto, correccion, pago a tienda/mensajero, cobro):
 *
 *  1. sin comprobante → el registro de siempre, sin tocar el almacenamiento (byte a byte el de hoy);
 *  2. con comprobante → se valida y se sube ANTES de escribir (R75: invalido → nada; R76: no se pudo
 *     guardar → nada se registra);
 *  3. el registro escribe la fila del comprobante EN SU transaccion y dice si quedo (`quedo`);
 *  4. si no quedo —error, clave repetida, regla del dinero— el objeto se retira (R76).
 *
 * Sin el puerto y CON comprobante es un error de programacion (un composition root que no inyecta):
 * se lanza, no se descarta el archivo en silencio.
 */
export async function registrarConComprobante<T>(
  puerto: IWalletComprobanteService | undefined,
  carpeta: CarpetaLateral,
  comprobante: ComprobanteRecibido | null,
  escribir: (guardado: ComprobanteGuardado | null) => Promise<{ quedo: boolean; resultado: T }>,
): Promise<T | FalloDeComprobante> {
  if (comprobante === null) return (await escribir(null)).resultado;
  if (puerto === undefined) {
    throw new Error("registro con comprobante sin el puerto de comprobantes: revisar el composition root");
  }
  const subida = await puerto.subir(carpeta, comprobante);
  if (subida.status === "invalido") {
    return { status: "validation_error", fieldErrors: { comprobante: [subida.problema] } };
  }
  if (subida.status === "no_guardado") return { status: "comprobante_no_guardado" };

  let quedo = false;
  try {
    const r = await escribir(subida.guardado);
    quedo = r.quedo;
    return r.resultado;
  } finally {
    if (!quedo) await puerto.retirar(subida.guardado);
  }
}
