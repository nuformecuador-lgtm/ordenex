/**
 * ⭑ FICHA 436 (design §4.2) — contrato del CONTADOR del tope. **Es el único acceso a datos de
 * toda la ficha** (R3): ni una lectura de Prisma más en el camino de la respuesta.
 *
 * SOLO queries (`docs/architecture.md`): aquí no se compara con el tope, no se mira el reloj y no
 * se decide si alguien puede preguntar. Eso vive en `AsistenteService`, que es quien conoce la
 * configuración. Este contrato cuenta, y nada más.
 */
export interface IAsistenteUsoRepository {
  /**
   * ⭑ R16/R17 — SUMA UNA CONSULTA Y DEVUELVE EL VALOR RESULTANTE. **Una sola sentencia.**
   *
   * ⚠️ NO HAY `SELECT` PREVIO Y NO PUEDE HABERLO. Quien excluye es el índice único
   * `asistente_uso_diario_usuario_id_fecha_key`: dos consultas simultáneas de la misma persona
   * chocan contra la base —la segunda espera el lock de fila y suma sobre el valor ya escrito— y
   * salen 1 y 2. Con un `SELECT` delante, entre la lectura y la escritura cabe la otra petición
   * entera: las dos leen el mismo número y las dos escriben el mismo +1, así que el tope se salta
   * y **ningún test de servicio lo nota**, porque un doble no tiene índice. Por eso R17 se mide
   * contra Postgres real y con las dos llamadas retenidas en la misma ventana.
   *
   * `fecha` es la cadena `YYYY-MM-DD` de `fechaCalendarioCR`, NO un `Date`: la fecha es parte de
   * una clave y una clave no se somete a la conversión de huso de un tipo temporal (misma lección
   * que `push_envio_dia.dia_cr`).
   *
   * @returns cuántas consultas lleva esa persona ese día DESPUÉS de contar ésta. Siempre ≥ 1.
   */
  consumirUnaConsulta(usuarioId: string, fecha: string): Promise<number>;

  /**
   * Q5 — suma uno al contador de «no lo sé» de ese día. **El número, nunca el texto.**
   *
   * Se llama DESPUÉS de `consumirUnaConsulta`, así que la fila existe; si por lo que fuera no
   * existiera, esto no crea nada y no falla: perder un punto de una señal de diagnóstico no puede
   * tumbar una respuesta que el usuario ya tiene delante.
   */
  contarNoLoSe(usuarioId: string, fecha: string): Promise<void>;
}
