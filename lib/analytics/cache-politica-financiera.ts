// Feature 179 (T1.5, design §4bis) — LA POLITICA DE CACHE POR METRICA (D3 / R28).
//
// Modulo de DATOS, puro: sin Next, sin Prisma, sin `process.env` y sin efectos al importarse.
//
// ─── D3 (humano, 2026-08-10) = (a): `conciliacion_cierres` NUNCA se cachea ──────────────────
// `AnaliticaFinancieraService.deConciliacion` emite por el `ErrorLogger` cuando |diferencia|
// supera el umbral (R24 de la 127). Cacheada, ese aviso pasaria de sonar UNA VEZ POR CONSULTA a
// UNA VEZ POR TTL, y un aviso que suena menos es un aviso que alguien deja de ver. El valor de
// esa metrica para el negocio es la ALERTA, no la cifra: cachearla ahorra poco (es la de menor
// volumen de consulta y la unica que no publica importes por cubo) y apaga la senal.
//
// ─── Por que una POLITICA EXHAUSTIVA y no una lista de exclusiones ──────────────────────────
// La pregunta que este archivo responde es: si manana alguien anade una metrica financiera y no
// la cachea, ¿se distingue eso de la exclusion deliberada de hoy?
//
//   - Con una LISTA DE EXCLUSIONES, no: la metrica nueva se cachearia POR DEFECTO y nadie se
//     entera. Si fuera —como esta— una cuya razon de ser es la alerta, cachearla la apaga en
//     silencio.
//   - Con un ALLOWLIST a secas, tampoco: la metrica nueva NO se cachearia y tampoco se entera
//     nadie; «excluida a proposito» y «se me olvido meterla» serian el mismo estado del archivo.
//   - Con la POLITICA EXHAUSTIVA las dos omisiones son imposibles: **la ausencia de decision es
//     roja** (el guardia cuadra contra el catalogo por exceso y por defecto) y la exclusion
//     deliberada es un valor escrito CON SU CAUSA.
//
// ─── Por que las claves son `string` y no `MetricaFinancieraId` ─────────────────────────────
// Un `Record<MetricaFinancieraId, PoliticaCache>` dejaria el cuadre en manos del compilador. R28
// pide un TEST que compare contra `listarMetricas({ dominio: "financiera" })` y falle por exceso
// Y por defecto. Es literalmente el criterio que la 127 dejo escrito para el despacho de
// metricas (`lib/services/AnaliticaFinancieraService.ts:70-75`): «con el mapa abierto, las dos
// direcciones se miden de verdad en vez de depender de que alguien lea el error del
// compilador». Se reusa el precedente en vez de inventar otro.
//
// ─── LIMITE HONESTO, DECLARADO ──────────────────────────────────────────────────────────────
// Este mecanismo obliga a DECLARAR una politica; no puede juzgar si la politica declarada es la
// CORRECTA. Alguien puede declarar `cacheable: true` para una metrica futura que emita alertas y
// el guardia lo aceptara. Lo que si esta cubierto es el caso concreto de hoy:
// `tests/unit/analytics/cache-financiera-conciliacion.test.ts` mide que `conciliacion_cierres`
// CONSULTA LA BASE y EMITE en cada consulta, asi que un «ya que estamos, cacheemos tambien
// esta» se pone rojo sobre el COMPORTAMIENTO, no sobre la declaracion.

/**
 * Por que una metrica NO se cachea. Dominio CERRADO, no texto libre.
 *
 * Con texto libre, la proxima exclusion diria «no procede» y dejaria de poder distinguirse de
 * esta. `alerta_por_consulta` significa algo comprobable: **esta metrica vale por la senal que
 * emite en cada consulta, no por la cifra**.
 */
export type CausaNoCacheable = "alerta_por_consulta";

/** La decision, tomada, para UNA metrica. No hay tercer estado y no debe haberlo. */
export type PoliticaCache =
  | { readonly cacheable: true }
  | { readonly cacheable: false; readonly causa: CausaNoCacheable };

const CACHEABLE: PoliticaCache = { cacheable: true };

/**
 * La politica de cache de TODAS las metricas del dominio `financiera`, una por una.
 *
 * Se cuadra contra el catalogo EN LAS DOS DIRECCIONES en
 * `tests/unit/analytics/cache-financiera-politica.guardia.test.ts`:
 *
 *   - por DEFECTO: una metrica financiera nueva sin entrada aqui pone el guardia rojo con un
 *     mensaje que obliga a elegir;
 *   - por EXCESO: una entrada aqui cuya metrica el catalogo ya no sirve tambien lo pone rojo,
 *     para que la declaracion no acumule entradas muertas.
 */
export const POLITICA_CACHE_FINANCIERA: Readonly<Record<string, PoliticaCache>> = {
  cod_recaudado: CACHEABLE,
  ingreso_flete: CACHEABLE,
  ingreso_comision_cod: CACHEABLE,
  ingreso_iva: CACHEABLE,
  egresos: CACHEABLE,
  dinero_en_caja: CACHEABLE,
  ganancia_ordenex: CACHEABLE,
  cuenta_por_pagar_tienda: CACHEABLE,
  cuenta_por_pagar_mensajero: CACHEABLE,
  /**
   * D3 — la unica excluida, y con su causa escrita. NO es un olvido, y el guardia lo distingue
   * de uno. Ver la cabecera de este archivo.
   */
  conciliacion_cierres: { cacheable: false, causa: "alerta_por_consulta" },
};

/**
 * La politica de una metrica, o `undefined` si NO hay decision escrita para ella.
 *
 * `undefined` es una respuesta de primera clase y no un fallo: por aqui pasan tambien las
 * metricas de OTROS dominios —el decorador financiero recibe cualquier `ConsultaAnalitica`, y
 * una metrica operativa produce `dominio_invalido` mas abajo—, y lanzar aqui convertiria ese
 * estado esperado en una excepcion.
 */
export function politicaDeCacheFinanciera(metricaId: string): PoliticaCache | undefined {
  return POLITICA_CACHE_FINANCIERA[metricaId];
}

/**
 * ¿Se cachea esta metrica?
 *
 * TOTAL y CERRADA HACIA EL LADO SEGURO: sin decision escrita, NO se cachea. Las dos direcciones
 * del error tienen consecuencias muy distintas y por eso el default no es simetrico —cachear
 * una metrica que nadie declaro puede apagar una alerta de dinero en silencio; no cachearla solo
 * cuesta recomputo—. La ausencia de decision no se queda muda: la pone ROJA el guardia de R28,
 * que es donde ese fallo se descubre barato.
 */
export function esMetricaFinancieraCacheable(metricaId: string): boolean {
  return politicaDeCacheFinanciera(metricaId)?.cacheable === true;
}
