// La GUÍA QUE VIENE EN LA URL de la landing (`/?guia=4321`).
//
// Módulo puro: sin `next/*`, sin base y sin React. Lo lee `app/page.tsx` (Server Component) para
// decidir con qué guía nace el modal de rastreo, y por eso no puede arrastrar nada del servidor
// del rastreo: `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` exige que NINGUNA ruta
// del App Router importe los módulos de la feature 229. Aquí solo se normaliza una cadena.
//
// QUÉ CAMBIA Y QUÉ NO. El enlace precarga el PRIMER campo del formulario, nada más: el segundo
// factor (los 4 últimos dígitos del teléfono del destinatario) se sigue tecleando y el servidor
// lo sigue exigiendo. Un `?guia=` no revela si esa guía existe —el modal no consulta solo— así
// que esto no abre el oráculo que el rechazo único cierra. Lo que NO cambia es que el RESULTADO
// sigue sin vivir en la URL: aquí solo se lee, nunca se escribe.

/** El nombre del parámetro. Uno solo: dos alias serían dos superficies que mantener. */
export const PARAM_GUIA = "guia";

/**
 * La guía de la URL, o `null` si no la trae o no la trae bien.
 *
 * Se devuelve la CADENA tal cual (no un número) porque su destino es el `value` de un `<input>`,
 * y porque quien decide qué es una guía válida es el schema del servidor, no esta función.
 *
 * Se descarta —sin ruido, la landing simplemente no abre el modal— cuando:
 *  - el parámetro llega repetido (`?guia=1&guia=2`): no hay forma honesta de elegir uno;
 *  - no es un entero positivo sin ceros a la izquierda: `num_guia` es un `Int` positivo
 *    (`db/schema.prisma`), así que `abc`, `-3`, `0` y `007` no son guías;
 *  - tiene más dígitos de los que cabe tener: un tope defensivo para no volcar una cadena
 *    arbitraria dentro del campo.
 */
export function numGuiaDeQuery(valor: string | string[] | undefined): string | null {
  if (typeof valor !== "string") return null;
  return /^[1-9]\d{0,11}$/.test(valor) ? valor : null;
}
