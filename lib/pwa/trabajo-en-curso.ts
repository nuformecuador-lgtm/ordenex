/**
 * Feature 284 (B1 de la revisión, 2026-08-25) — REGISTRO DE TRABAJO EN CURSO.
 *
 * ## Por qué existe: la heurística sobre el DOM no ve esta app
 *
 * La primera versión de `hayTrabajoEnCurso` comparaba `input.value` con `input.defaultValue`.
 * **Medido con sondas sobre React 19.2.4**: en un input **controlado** —que es lo único que usa
 * esta app— React mantiene `defaultValue` sincronizado con `value`, así que teclear `45000` en
 * el campo del recaudo dejaba `value === defaultValue` y la heurística respondía **`false`**.
 * El aviso se pintaba encima del panel de gestión, con el dinero ya tecleado y las fotos ya
 * elegidas. La señal del archivo tampoco valía: `handleEvidenciaChange` limpia `input.value`
 * justo después de elegir, a propósito, para poder volver a elegir la misma foto.
 *
 * O sea: **el estado que se perdería vive en React, no en el DOM**, y desde fuera no se ve.
 *
 * ## Qué es esto
 *
 * Un registro explícito, fuera de React (un `Set` de claves) para que se pueda consultar de
 * forma **síncrona** desde cualquier sitio —incluido el manejador de un clic— sin contexto ni
 * providers, y sin obligar a que el aviso sea descendiente de nadie. Cada superficie que tiene
 * datos sin guardar **se declara**; el aviso de versión nueva sólo pregunta.
 *
 * Se prefiere a un contexto de React por tres razones concretas:
 *  1. `useActualizacionPwa` necesita la respuesta **en el instante del clic**, no en el próximo
 *     render;
 *  2. el aviso vive en el layout del portal y las superficies que declaran están en cualquier
 *     rama del árbol: un contexto obligaría a envolver la app entera;
 *  3. se puede afirmar en un test sin montar nada.
 *
 * ## Lo que NO garantiza, dicho antes de que alguien lo suponga
 *
 * Cubre **las superficies que se declaran**, no «todo el trabajo del usuario». Hoy se declara
 * el panel de gestión del mensajero (dinero + evidencias + motivo), que es donde el daño estaba
 * medido. Una pantalla nueva con datos sin guardar **no se protege sola**: tiene que llamar a
 * `useDeclararTrabajo`. Por eso el texto del aviso **ya no promete** que no se pierde nada.
 */

const claves = new Set<string>();
const oyentes = new Set<() => void>();

/**
 * Declara (o retira) una superficie con trabajo sin guardar.
 *
 * La clave identifica la superficie: dos llamadas con la misma clave no se suman, así que un
 * componente puede llamarla en cada render sin llevar cuentas. Retirar una clave que no está
 * es un no-op.
 */
export function declararTrabajo(clave: string, activo: boolean): void {
  const antes = claves.has(clave);
  if (activo === antes) return;
  if (activo) claves.add(clave);
  else claves.delete(clave);
  for (const oyente of [...oyentes]) oyente();
}

/** ¿Hay alguna superficie declarada con trabajo sin guardar? */
export function hayTrabajoDeclarado(): boolean {
  return claves.size > 0;
}

/** Las claves vivas. Existe para que un fallo se lea con nombre en vez de con un booleano. */
export function trabajoDeclarado(): string[] {
  return [...claves].sort();
}

/** Avisa cuando el registro cambia, para que el aviso se retire en el acto y no en 3 segundos. */
export function suscribirTrabajo(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Sólo para tests: deja el registro vacío entre casos. */
export function reiniciarTrabajoDeclarado(): void {
  claves.clear();
  for (const oyente of [...oyentes]) oyente();
}
