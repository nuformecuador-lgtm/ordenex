// FICHA 422 (design §6.2, T1.4) — contrato del repositorio de LA DECISION DE LA PERSONA.
//
// SOLO queries Prisma (docs/architecture.md): aqui no hay ninguna regla de negocio. Lo que la
// preferencia significa —cuando se pone, cuando se borra, y sobre todo QUE NO DECIDE— vive en las
// Server Actions (`lib/actions/push.ts`) y en la costura de la baja (`lib/pwa/baja-push.ts`).
//
// ⚠️ R6 — ESTE REPOSITORIO NO PARTICIPA EN EL ENVIO. El conjunto de destinatarios de un push sigue
// siendo EXACTAMENTE el de 410/R24-R26 (quien tiene suscripcion), y la preferencia no entra en esa
// decision: una preferencia puesta sin suscripcion no produce ningun envio. Una guardia del arbol
// (`push-alta-punto-unico.guardia.test.ts`) censa el camino del envio para que nadie lo cruce.
export interface IUsuarioPreferenciaRepository {
  /**
   * R2 — «quiere avisos?». SIN FILA, `false`, y NO SE CREA NADA AL LEER.
   *
   * Es la mitad de R2 que se puede escribir en un contrato: la ausencia de fila no es un estado
   * «desconocido» que haya que resolver preguntando ni escribiendo un valor por defecto; es «no».
   * Un repositorio que creara la fila al leer convertiria cada carga del portal en una escritura.
   */
  avisosPushDe(usuarioId: string): Promise<boolean>;

  /**
   * R3/R7 — fija la preferencia de esta persona. UPSERT POR `usuario_id`, UNA SOLA SENTENCIA.
   *
   * ⚠️ NO HAY `SELECT` PREVIO Y NO PUEDE HABERLO. La exclusion la da el indice unico
   * `usuario_preferencia_usuario_id_key`: dos pestanas que activen a la vez chocan EN LA BASE y
   * queda una sola fila. Con un `findFirst` delante, entre la lectura y la escritura cabe la otra
   * transaccion entera y las dos insertarian. Es la misma decision que el cupo diario de la 410.
   */
  fijarAvisosPush(usuarioId: string, quiere: boolean): Promise<void>;
}
