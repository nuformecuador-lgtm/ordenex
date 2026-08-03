/**
 * Validación de CLIENTE de un monto de dinero STRING. Módulo sin React y sin DOM: solo
 * compara texto.
 *
 * Vive en `components/shared/` —y no en `lib/`— por el mismo motivo que
 * `descarga-resultado.ts`: lo consumen formularios de PANTALLA de varias features y su
 * salida es «¿habilito el botón de confirmar?», no una regla de dominio. El dominio lo
 * revalida el servidor, siempre, con `Prisma.Decimal`.
 *
 * Feature 172 (T D.1) — PROMOVIDO tal cual desde
 * `app/(app)/wallet/_components/wallet-labels.ts` (features 42/45/158), que ahora lo
 * re-exporta para no romper a nadie. Se promueve en vez de copiarse porque la comparación
 * por texto tiene bordes sutiles —ceros a la izquierda, decimales ausentes, ceros a la
 * derecha— que ya se descubrieron una vez por mutación (ver
 * `tests/unit/components/wallet-monto-valido-tope.test.ts`): una segunda copia sería una
 * segunda oportunidad de equivocarse en dinero. Con la 172 son ya CUATRO features las que
 * lo necesitan con la misma API, que es el umbral de `docs/architecture.md` para promover.
 *
 * MONEY-SAFE: cero `Number(` y cero `parseFloat` sobre montos. Un monto de 11 dígitos no
 * cabe exacto en un `number` y comparar así podría aceptar justo el valor que se quiere
 * rechazar.
 */

/**
 * Parte un monto STRING ya validado de forma en sus dos mitades, NORMALIZADAS: enteros sin
 * ceros a la izquierda ("0012" → "12", "000" → "0") y decimales siempre de 2 dígitos
 * ("5" → "50", ausentes → "00"). Es lo que permite comparar dos montos como TEXTO.
 */
function partesMonto(monto: string): { enteros: string; decimales: string } {
  const [enteros = "", decimales = ""] = monto.split(".");
  return {
    enteros: enteros.replace(/^0+(?=\d)/, ""),
    decimales: decimales.padEnd(2, "0"),
  };
}

/**
 * `a <= b` sobre dos montos STRING con el formato de `montoValido`. Money-safe: compara
 * TEXTO (primero por cantidad de dígitos enteros, luego lexicográficamente), nunca
 * `parseFloat`/`Number`.
 */
function montoMenorOIgual(a: string, b: string): boolean {
  const pa = partesMonto(a);
  const pb = partesMonto(b);
  if (pa.enteros.length !== pb.enteros.length) return pa.enteros.length < pb.enteros.length;
  if (pa.enteros !== pb.enteros) return pa.enteros < pb.enteros;
  return pa.decimales <= pb.decimales;
}

/**
 * Valida en cliente un monto de dinero STRING: hasta 2 decimales y > 0 (al menos un dígito
 * distinto de cero). Money-safe: sin parseFloat/Number (el backend re-valida con Decimal).
 *
 * `max` (feature 158, m5 del review) acota POR ARRIBA, con la MISMA frontera que el borde del
 * servidor. Es **opcional a propósito**: esta función la comparten los formularios de la
 * wallet (42/45), cuyo schema de servidor (`montoPositivoSchema`) NO tiene tope. Aplicárselo
 * aquí sin pedirlo dejaría al cliente más estricto que su propio servidor y bloquearía montos
 * que el backend acepta — exactamente el efecto colateral que el backend evitó al poner el
 * tope en el borde de la 158 y no en `montoPositivoSchema`. Quien tiene tope, lo pasa.
 */
export function montoValido(monto: string, max?: string): boolean {
  const limpio = monto.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(limpio) || !/[1-9]/.test(limpio)) return false;
  return max === undefined || montoMenorOIgual(limpio, max);
}
