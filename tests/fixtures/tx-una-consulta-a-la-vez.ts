/**
 * FICHA 450 (T4.1) — DOBLE DE CLIENTE DE TRANSACCION QUE CUENTA CONSULTAS EN VUELO.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE UN DOBLE NORMAL NO SIRVE, Y ESTE SI
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Los `buildTx` de `tests/unit/services/wallet-feed-service.test.ts` y de su hermana de tienda son
 * `vi.fn().mockResolvedValue(...)`: resuelven al instante, asi que para ellos
 *
 *     await Promise.all([a(), b()])      y      await a(); await b();
 *
 * son indistinguibles. Ese es exactamente el motivo por el que el defecto de esta ficha llevaba
 * meses en verde con 32 casos pasando.
 *
 * ESTE DOBLE SI LOS DISTINGUE, y la razon merece escribirse porque no es obvia: **el solape se
 * detecta aunque el mock resuelva al instante**. Cuando el codigo bajo prueba escribe
 * `Promise.all([f(), g()])`, JavaScript evalua `f()` y `g()` en la MISMA vuelta del bucle de
 * eventos — las dos llamadas se emiten antes de que corra ninguna continuacion—. Asi que si el
 * contador sube al ENTRAR y solo baja en un tick posterior (`await Promise.resolve()` dentro del
 * delegado), las dos llamadas coinciden y el solape queda anotado.
 *
 * Con la forma secuencial (`await f(); await g();`) la continuacion de `f` corre antes de que se
 * emita `g`, el contador ya ha bajado y no hay solape.
 *
 * ⚠️ QUE MIDE EXACTAMENTE, Y QUE NO. Mide **la forma del codigo**: si las dos lecturas se EMITEN
 * juntas o una despues de otra. NO mide lo que hace la conexion de Postgres, y conviene decirlo
 * porque la medicion de la 450 lo desmintio: con `@prisma/client@7.8.0` un `Promise.all` sobre un
 * `tx` acaba llegando a la conexion EN SERIE de todos modos, porque Prisma serializa por su cuenta
 * las peticiones de una transaccion interactiva (medido en
 * `tests/integration/db/aprobacion-consultas-en-serie.test.ts`: 1 consulta en vuelo, 0 solapes,
 * antes y despues del arreglo).
 *
 * Por eso este doble es la prueba de cierre de R3 y el contador de la conexion NO lo es: lo que la
 * ficha prohibe es el patron —afirmar que dos consultas de una transaccion son independientes—, y
 * eso es una propiedad del codigo, no del driver de esta semana.
 *
 * ⚠️ AUTOCOMPROBACION OBLIGATORIA. Un contador que no cuenta deja verde cualquier test que lo use.
 * `tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts` demuestra que este doble marca solape ante
 * una implementacion sintetica con `Promise.all` y NO lo marca ante la secuencial. Sin ese archivo,
 * los bloques «450» de las dos suites de feed serian un verde vacio.
 */

/** Un solape: dos o mas delegados en vuelo a la vez sobre el mismo cliente de transaccion. */
export interface SolapeEnTx {
  /** Cuantas llamadas habia en vuelo en el instante del solape (>= 2). */
  enVuelo: number;
  /** Los delegados implicados, en orden de llegada (p. ej. `cierreDetail.findMany`). */
  delegados: string[];
}

export interface TxVigilado<T> {
  /** El doble, tipado como el cliente de transaccion que espera el codigo bajo prueba. */
  tx: T;
  /** Los solapes anotados. Vacio = nunca hubo dos consultas a la vez (R3). */
  solapes: SolapeEnTx[];
  /** Toda llamada emitida, en orden. Sirve de anti-vacio: un feed que no lee no vale. */
  llamadas: string[];
  /** El maximo de llamadas simultaneas visto. 1 = siempre en serie. */
  maximoEnVuelo: () => number;
}

/**
 * Lo que devuelve cada delegado vigilado, por nombre completo (`modelo.metodo`). Lo que no este
 * aqui se sigue exponiendo tal cual, sin vigilar: asi el doble puede conservar los dobles
 * «delatores» (`orden`, `zona`, `tarifa`) que las suites usan para R12/R13.
 */
export type RespuestasVigiladas = Record<string, unknown>;

/**
 * Envuelve un objeto plano `{ modelo: { metodo: valor } }` en un cliente de transaccion cuyos
 * metodos cuentan consultas en vuelo.
 *
 * `respuestas` mapea `"modelo.metodo"` al valor que ese delegado resuelve. `extras` se copia tal
 * cual sobre el doble (para los dobles delatores que NO deben contar como lectura vigilada).
 */
export function txVigilado<T>(
  respuestas: RespuestasVigiladas,
  extras: Record<string, unknown> = {},
): TxVigilado<T> {
  const solapes: SolapeEnTx[] = [];
  const llamadas: string[] = [];
  const enVuelo: string[] = [];
  let maximo = 0;

  const doble: Record<string, Record<string, unknown>> = {};
  for (const [clave, valor] of Object.entries(respuestas)) {
    const [modelo, metodo] = clave.split(".");
    if (modelo === undefined || metodo === undefined) {
      throw new Error(`clave de delegado mal formada: "${clave}" (se espera "modelo.metodo")`);
    }
    doble[modelo] ??= {};
    doble[modelo][metodo] = async (): Promise<unknown> => {
      enVuelo.push(clave);
      llamadas.push(clave);
      if (enVuelo.length > maximo) maximo = enVuelo.length;
      if (enVuelo.length >= 2) solapes.push({ enVuelo: enVuelo.length, delegados: [...enVuelo] });
      // EL TICK ES LA PIEZA CLAVE: sin el, el delegado bajaria el contador ANTES de que se
      // emitiera la segunda llamada del `Promise.all` y el solape no se veria nunca. Con el,
      // la bajada ocurre en la siguiente vuelta de microtareas, que es cuando `pg` habria
      // recibido la respuesta de la primera consulta.
      await Promise.resolve();
      const i = enVuelo.indexOf(clave);
      if (i >= 0) enVuelo.splice(i, 1);
      return valor;
    };
  }
  Object.assign(doble, extras);

  return {
    tx: doble as unknown as T,
    solapes,
    llamadas,
    maximoEnVuelo: () => maximo,
  };
}
