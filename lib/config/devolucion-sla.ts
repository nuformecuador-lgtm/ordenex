// FICHA 409 (T1.2, design §4.3, R39) — LOS PLAZOS DEL RECHAZO AUTOMATICO DE UNA DEVOLUCION, EN UN
// SOLO SITIO.
//
// POR QUE NACE ESTE ARCHIVO, y no es limpieza. Hasta hoy los dos plazos vivian como constantes
// PRIVADAS de `lib/services/DevolucionSlaService.ts` (`VENTANA_NOT_FOUND_MS`, `VENTANA_WRONG_MS`),
// y la ficha 409 necesita DECIRLE EL NUMERO A LA TIENDA en el texto del aviso «tienes N novedades
// sin gestionar». Con dos copias del «5», el dia que el humano mueva el plazo el cron escalaria a
// los 6 dias y el aviso seguiria prometiendo 5 — y la tienda organiza su trabajo con ese numero.
// El texto no puede mentir (leccion de la 407, en su forma aritmetica).
//
// MODULO PURO: dos numeros y nada mas. Sin Prisma, sin React, sin `process.env` —a diferencia de
// `lib/config/reintentos.ts`, estos NO son configurables por entorno: son la promesa que la app le
// hace a la tienda, y una promesa que cambia sola segun donde corra el proceso no es una promesa—.
//
// ⚠️ EL PLAZO DEPENDE DE LA CAUSA, y por eso son DOS numeros y no uno:
//   · `wrong_address` / `wrong_number` -> CINCO DIAS desde el anclaje;
//   · `not_found`                      -> VEINTICUATRO HORAS desde el anclaje.
// Y desde la 276 hay una TERCERA salida que no es un plazo: una novedad `wrong_*` que YA alcanzo
// el tope de intentos escala en la corrida SIGUIENTE, sin esperar sus cinco dias. Por eso el aviso
// de la 409 solo puede afirmar un plazo cuando el lote es HOMOGENEO en causa Y ninguna esta en el
// tope (R39/R40); si no, habla sin numero.

export interface DevolucionSlaConfig {
  /**
   * Dias que una novedad de causa `wrong_address`/`wrong_number` reposa en `devuelta` antes de que
   * el cron la escale a `rechazada`. Lo aplica `DevolucionSlaService` y lo DICE el texto del aviso
   * `novedades_sin_gestionar`: los dos leen de aqui, asi que no pueden divergir.
   */
  readonly DIAS_RECHAZO_AUTOMATICO: number;
  /**
   * Horas que una novedad de causa `not_found` reposa en `devuelta` antes de que el cron la
   * reintente (si le quedan intentos) o la rechace (si alcanzo el tope).
   */
  readonly HORAS_REINTENTO: number;
}

export const devolucionSlaConfig: DevolucionSlaConfig = {
  DIAS_RECHAZO_AUTOMATICO: 5,
  HORAS_REINTENTO: 24,
};
