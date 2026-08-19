// Feature 99 (design §3.3, R6/R13/R14-R19/R26/R27/R28) — contrato del servicio del cron SLA de
// devoluciones diferidas. Logica de negocio pura (sin HTTP ni Prisma directo): el route handler
// `/api/cron/procesar-devueltas-sla` lo invoca con el reloj (`now`) inyectado.

// Resumen de una corrida (sin PII, R11/R12): se devuelve al cron para observabilidad. Los cuatro
// conteos son DISJUNTOS por orden candidata:
//   - evaluadas: ventana AUN viva -> la orden reposa en `devuelta`, el cron NO actua (R14).
//   - liberadas: `not_found` vencida + intentos < umbral -> reintento a bodega (R15).
//   - escaladas: `not_found` >= umbral (R16) o `wrong_*` vencida (R17) -> `rechazada`.
//   - omitidas: causa null (R28), fallo por orden (R26) o guarda de estado ya no vigente
//     (R24/R25: la orden salio de `devuelta` entre la lectura y la escritura).
export interface DevolucionSlaResult {
  evaluadas: number;
  liberadas: number;
  escaladas: number;
  omitidas: number;
  /**
   * Feature 239 (T3.3, R14/R35) — cuantas de las candidatas de esta corrida venian por la RAMA
   * LEGADA: en `devuelta` pero SIN fila de historial `anclaje_devolucion`, asi que su ventana se
   * ancla en la fecha de su gestion (el comportamiento anterior a la 239).
   *
   * NO es un contador decorativo. Es el unico sitio desde el que se ve extinguirse la poblacion
   * que quedo en vuelo el dia del despliegue (grandfather, P6/R30): deberia bajar a cero y
   * quedarse ahi. Si NO baja, o si sube, hay ordenes entrando en `devuelta` por fuera del
   * anclaje — y eso es exactamente lo que no puede volver a pasar en silencio.
   *
   * NO es disjunto con los otros cuatro (que si lo son entre si): una misma orden legada puede
   * contarse ademas como `evaluada`, `liberada` o `escalada`. Es un corte transversal, no un
   * quinto cubo.
   *
   * Sin PII (R35): un numero y nada mas. Ni ids, ni guias, ni tiendas.
   */
  legadas: number;
}

export interface IDevolucionSlaService {
  /**
   * R6/R13/R14-R19/R26/R27/R28: evalua las ordenes en `devuelta`, computa la ventana ROLLING
   * desde el anclaje (24h `not_found`; 5 dias `wrong_*`) con el reloj `now` inyectado, y libera
   * (reintento a bodega) o escala (`rechazada`) al vencer. Resiliente por orden (un fallo no
   * aborta la corrida) e idempotente (la guarda por estado evita el doble efecto). No conoce
   * HTTP; el reloj se inyecta para pruebas deterministas.
   */
  ejecutar(now: Date): Promise<DevolucionSlaResult>;
}
