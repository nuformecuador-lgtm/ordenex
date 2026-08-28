// FICHA 312 (E1) — traduce el resultado no-"ok" de la Server Action `corregirDatosCliente`
// (`lib/actions/corregir-datos-cliente.ts`) a un mensaje de usuario ACCIONABLE y DISTINTO por causa.
// Patron literal de `eliminar-orden-error-messages.ts`, su hermana de esta misma carpeta.
//
// ⚠️ R30 — NINGUN MENSAJE EXPONE IDENTIFICADORES INTERNOS NI EL DETALLE DEL RECHAZO. El
// `forbidden` del servidor es OPACO a proposito (R12): rol no autorizado, orden inexistente, orden
// borrada y orden de otra tienda devuelven EL MISMO objeto, justamente para no convertir la
// respuesta en un oraculo de que ordenes existen y de quien son. Un texto que dijera «esa orden no
// existe» o «esa orden no es tuya» desharia esa decision desde la pantalla, asi que aqui se dice lo
// unico que es cierto en los cuatro casos —no se pudo, y esto es lo que puedes hacer— sin adivinar
// cual de ellos fue.
//
// ⚠️ NINGUN TEXTO PROMETE UN RASTRO. Nada de «se registrara quien lo cambio»: no se registra (D4,
// decision humana del 2026-08-28), y una promesa falsa en la pantalla es peor que el silencio.
//
// MODULO PURO: sin React y sin `next/`. Lo consumen el modal (que lo pinta) y sus tests.

/** Los desenlaces que la pantalla puede recibir y no son un exito. */
type CorregirErrorStatus =
  | "forbidden"
  | "conflict"
  | "validation_error"
  | "unauthenticated";

const CORREGIR_ERROR_MESSAGES: Record<CorregirErrorStatus, string> = {
  // R12/R30 — opaco Y accionable a la vez: dice qué hacer (actualizar la lista y volver a mirar el
  // estado) sin decir cuál de las cuatro causas fue.
  forbidden:
    "No se pudo corregir esta orden. Puede que ya no admita cambios: actualiza la lista y vuelve a mirarla.",
  // R13 — la orden se movió entre que se abrió la ventana y se confirmó. NO se escribió nada, y por
  // eso el texto no puede afirmar que se guardó a medias.
  conflict:
    "La orden cambió de estado mientras la corregías, así que no se guardó nada. Actualiza la lista y vuelve a intentarlo.",
  // El borde rechazó la entrada. El detalle POR CAMPO se pinta junto a cada campo; esto es el
  // resumen para cuando el rechazo no viene mapeado a ninguno.
  validation_error: "Revisa los datos: hay un campo que no se puede guardar así.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
};

/** Último recurso: un desenlace que esta pantalla no conoce. Tampoco expone nada. */
const CORREGIR_ERROR_GENERICO =
  "No se pudieron guardar los cambios. Inténtalo de nuevo.";

/**
 * Mensaje de usuario para un fallo de la correccion. Acepta el RESULTADO completo de la accion o
 * el `status` crudo, igual que `eliminarOrdenErrorMessage`.
 *
 * Nunca devuelve cadena vacia: un canal de error mudo es indistinguible de un exito.
 */
export function corregirDatosClienteErrorMessage(error: unknown): string {
  const objeto = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = objeto && "status" in objeto ? objeto.status : error;

  if (typeof status === "string" && status in CORREGIR_ERROR_MESSAGES) {
    return CORREGIR_ERROR_MESSAGES[status as CorregirErrorStatus];
  }
  return CORREGIR_ERROR_GENERICO;
}
