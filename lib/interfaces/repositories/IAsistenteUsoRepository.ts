/**
 * ⭑ FICHA 436 (design §4.2) — contrato del CONTADOR del tope. **Es el único acceso a datos de
 * toda la ficha** (R3): ni una lectura de Prisma más en el camino de la respuesta.
 *
 * SOLO queries (`docs/architecture.md`): aquí no se mira el reloj, no se redacta ningún mensaje y
 * no se decide qué ve la persona. Eso vive en `AsistenteService`, que es quien conoce la
 * configuración. Lo único que el tope hace aquí es viajar hasta el `WHERE` —ver abajo por qué no
 * puede vivir en otro sitio—; **la política sigue siendo del servicio, que es quien lo pasa**.
 */
export interface IAsistenteUsoRepository {
  /**
   * ⭑ R16/R17 — SUMA UNA CONSULTA **SI ESTÁ POR DEBAJO DEL TOPE**, Y DEVUELVE EL VALOR
   * RESULTANTE. **Una sola sentencia.**
   *
   * ⚠️ NO HAY `SELECT` PREVIO Y NO PUEDE HABERLO. Quien excluye es el índice único
   * `asistente_uso_diario_usuario_id_fecha_key`: dos consultas simultáneas de la misma persona
   * chocan contra la base —la segunda espera el lock de fila y suma sobre el valor ya escrito— y
   * salen 1 y 2. Con un `SELECT` delante, entre la lectura y la escritura cabe la otra petición
   * entera: las dos leen el mismo número y las dos escriben el mismo +1, así que el tope se salta
   * y **ningún test de servicio lo nota**, porque un doble no tiene índice. Por eso R17 se mide
   * contra Postgres real y con las dos llamadas retenidas en la misma ventana.
   *
   * ⚠️ **POR QUÉ EL `tope` ESTÁ EN LA FIRMA** (revisión de la ficha, `m2`). R17 dice «una vez por
   * consulta **atendida**», y para eso «comprobar» y «sumar» tienen que ser LA MISMA sentencia:
   * cualquier otra forma —sumar siempre y comparar después, o sumar y compensar— o infla la
   * columna o abre una ventana entre las dos escrituras. Con el tope dentro del `WHERE`, quien ya
   * lo alcanzó no suma nada y el número que queda en la base es el de consultas atendidas, que es
   * el que T27 va a leer para decidir si Q2 deja de ser una pregunta.
   *
   * `fecha` es la cadena `YYYY-MM-DD` de `fechaCalendarioCR`, NO un `Date`: la fecha es parte de
   * una clave y una clave no se somete a la conversión de huso de un tipo temporal (misma lección
   * que `push_envio_dia.dia_cr`).
   *
   * @returns cuántas consultas lleva esa persona ese día DESPUÉS de contar ésta (siempre ≥ 1), o
   *          **`null` si ya estaba en el tope**, en cuyo caso NO se escribió nada. El fallo seguro
   *          es `null`: quien llama rechaza, no atiende.
   */
  consumirUnaConsulta(usuarioId: string, fecha: string, tope: number): Promise<number | null>;

  /**
   * Q5 — suma uno al contador de «no lo sé» de ese día. **El número, nunca el texto.**
   *
   * Se llama DESPUÉS de `consumirUnaConsulta`, así que la fila existe; si por lo que fuera no
   * existiera, esto no crea nada y no falla: perder un punto de una señal de diagnóstico no puede
   * tumbar una respuesta que el usuario ya tiene delante.
   */
  contarNoLoSe(usuarioId: string, fecha: string): Promise<void>;
}
