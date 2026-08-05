import type {
  ImporteAnalitico,
  ImporteConNeto,
  ImporteSoloBruto,
} from "@/lib/types/analitica-financiera";

/**
 * Feature 183 ⟨D12⟩ (humano, 2026-08-04, `progress/decision_183.md`) — el UNICO
 * constructor de importes de fixture del tablero financiero.
 *
 * Desde ⟨D12⟩ `ImporteAnalitico` es una union discriminada por `forma`, y las fixtures
 * del frontend construian el importe a mano en ~40-60 literales repartidos por cuatro
 * archivos. Repetir ahi el discriminante seria repetir cuarenta veces la oportunidad de
 * escribirlo mal y, el dia que aparezca una tercera forma, cuarenta sitios que tocar.
 * Por eso vive UNA sola vez, aqui.
 *
 * Vive en `tests/fixtures/` y no en `tests/unit/services/_dobles-analitica-financiera.ts`
 * a proposito: aquel archivo construye el SERVICIO (importa `AnaliticaFinancieraService`
 * y con el toda la cadena de repositorios), y los tests de componente corren en jsdom.
 * Este modulo solo tiene `import type`, asi que no arrastra un byte de runtime.
 *
 * Complementario, no duplicado, de `conNeto()` / `soloBruto()` de aquel archivo: aquellos
 * LEEN un importe estrechando por forma; estos lo CONSTRUYEN.
 */

/**
 * La `moneda` viaja en el DTO pero NINGUN adaptador ni panel la lee: el formato lo
 * resuelve el paquete de la 130 desde `lib/config/moneda.ts` (R25 de la 132). Se rellena
 * con un marcador precisamente para que un consumidor que la leyera pintara basura
 * visible en vez de acertar por casualidad.
 */
export const MONEDA_QUE_NADIE_LEE = "moneda-que-nadie-lee";

/** Un importe de los que publican las dos cifras (`egresos`, recaudo, cuentas por pagar). */
export function importeConNeto(
  bruto: string,
  neto: string,
  moneda: string = MONEDA_QUE_NADIE_LEE,
): ImporteConNeto {
  return { forma: "bruto_y_neto", bruto, neto, moneda };
}

/**
 * Un importe de los que NO publican neto (`ingreso_flete`, `ingreso_comision_cod`,
 * `ingreso_iva`): la clave no existe, ni vacia ni en `null`.
 */
export function importeSoloBruto(
  bruto: string,
  moneda: string = MONEDA_QUE_NADIE_LEE,
): ImporteSoloBruto {
  return { forma: "solo_bruto", bruto, moneda };
}

/**
 * El mismo importe, con la distincion RETIRADA: conserva el bruto y pierde el neto.
 *
 * Es lo que necesita un caso que quiere probar la MISMA vista en sus dos formas sin
 * duplicar la fixture entera, que es como se comprueba que el tablero decide por la
 * forma del DTO y no por el id de la metrica (R22).
 */
export function sinNeto(importe: ImporteAnalitico): ImporteSoloBruto {
  return importeSoloBruto(importe.bruto, importe.moneda);
}
