import { Prisma } from "@prisma/client";

/**
 * Feature 205 (design §2.1/§2.4/§2.5, D-A/D-F/D-G) — el REPARTO de un importe entre los cierres
 * pendientes de un mensajero, como funcion PURA.
 *
 * Es la aritmetica entera de la feature y por eso vive aqui y no en el servicio: R17 exige que
 * el calculo se pueda ejercitar SIN base de datos, y R8 exige que el orden sea determinista de
 * verdad (dos ejecuciones sobre los mismos datos, el mismo orden). Un `ORDER BY` no se puede
 * probar sin motor; este comparador si. El repositorio ordena igual por eficiencia, pero la
 * verdad del orden es esta.
 *
 * Money-safe (R16): TODO con `Prisma.Decimal`. Ni un `Number(`, ni un `parseFloat(`, ni un
 * `parseInt(`; el unico `toFixed(2)` es la SERIALIZACION final a STRING de escala 2, que es el
 * formato en el que el dinero cruza la frontera (mismo patron que `lib/utils/cuenta-por-pagar.ts`
 * y `lib/utils/pendiente-cierre.ts`). Entra STRING, sale STRING.
 *
 * El nombre del archivo lleva `liquidacion` A PROPOSITO (design §11): la clausula de
 * auto-captura de `tests/unit/guards/liquidacion-money-safe.test.ts` mete en el censo todo
 * `lib/**` cuya ruta case `/[Ll]iquidacion/`, asi que moverlo, renombrarlo o sacarlo del censo
 * pone el barrido en rojo (R50).
 *
 * Lo que este modulo NO hace, y no por olvido:
 *  - NO lee `process.env`: el `tope` entra por parametro (R53, design §2.5.2). Eso es lo que
 *    permite ejercitar el recorte con `tope: 2` y tres cierres en vez de con cincuenta y uno.
 *  - NO lee el reloj (`new Date()`) ni ninguna fecha que no venga en la entrada.
 *  - NO conoce Prisma-el-cliente, ni repositorios, ni `next/*`: solo `Prisma.Decimal`.
 */

/** Un cierre del mensajero que SI admite imputacion: `aprobado` y con pendiente > 0 (R5). */
export interface CierreImputable {
  cierreId: string;
  /** Pendiente derivado del cierre, STRING escala 2 (`derivarPendienteCierre`). */
  pendiente: string;
  /**
   * La ANTIGUEDAD de R8 (Q1, design §2.4): el instante en que el mensajero pidio el cierre —el
   * dia TRABAJADO—, en ISO-8601. NO es `resuelto_at`: esa depende de la latencia administrativa
   * y haria que el orden de cobro lo fijara el proceso interno.
   */
  solicitadoAt: string;
}

/** Lo que UN cierre recibe dentro de un reparto. Nunca cero ni negativo (R12). */
export interface Imputacion {
  cierreId: string;
  /** STRING escala 2, siempre > 0. */
  monto: string;
  /** Pendiente del cierre ANTES de esta imputacion, STRING escala 2. */
  pendienteAntes: string;
  /** `pendienteAntes − monto`, STRING escala 2. */
  pendienteDespues: string;
  /** `monto < pendienteAntes`: a lo sumo la ULTIMA imputacion de un reparto lo es (R11). */
  parcial: boolean;
}

/** Cuanto se quedo fuera de la ventana por el tope (R53/R54/R56, design §2.5). */
export interface RecorteVentana {
  /** El maximo que se aplico. Es el parametro, no un valor leido de config aqui. */
  tope: number;
  /** Cuantos cierres imputables entran en la ventana. */
  enVentana: number;
  /** Cuantos cierres imputables quedan RECORTADOS (pagables, pero en otro reparto). */
  fuera: number;
  /** Σ pendientes de los recortados, STRING escala 2. */
  montoFuera: string;
}

export interface Reparto {
  imputaciones: Imputacion[];
  /** Σ montos de las imputaciones, STRING escala 2. */
  totalImputado: string;
  /** Σ pendientes de la VENTANA. Es el `disponible` con el que se rechaza por `excede` (R14). */
  imputable: string;
  /** Σ pendientes de TODA la entrada imputable (ventana + recortados). Alimenta R37. */
  imputableTotal: string;
  /** `importe − totalImputado`. Mayor que cero SOLO cuando el importe excede la ventana. */
  sobrante: string;
  recorte: RecorteVentana;
}

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function pendienteDe(cierre: CierreImputable): Prisma.Decimal {
  return round2(new Prisma.Decimal(cierre.pendiente));
}

/**
 * Comparador de R8: `solicitadoAt` ascendente, DESEMPATE por `cierreId` ascendente.
 *
 * El segundo escalon no es adorno (design §2.4): sin el, dos cierres con el mismo instante
 * darian un orden que decide el motor —o el algoritmo de ordenacion— y R8 exige determinismo.
 *
 * La antiguedad se compara como INSTANTE (`Date.parse`), no como texto: dos representaciones
 * distintas del mismo instante (`…Z` y `…+00:00`) son iguales cronologicamente y distintas
 * lexicograficamente, y quien cobra primero no puede depender de como se serializo la fecha.
 * `Number.isFinite` mira un epoch en milisegundos, no un monto: no hay dinero en esta funcion.
 * Si alguna marca no es una fecha parseable —violacion del contrato de entrada— se cae a la
 * comparacion textual, que sigue siendo un orden total y repetible en vez de un NaN silencioso.
 */
function compararFifo(a: CierreImputable, b: CierreImputable): number {
  const ta = Date.parse(a.solicitadoAt);
  const tb = Date.parse(b.solicitadoAt);
  const comparables = Number.isFinite(ta) && Number.isFinite(tb);

  if (comparables && ta !== tb) return ta < tb ? -1 : 1;
  if (!comparables && a.solicitadoAt !== b.solicitadoAt) {
    return a.solicitadoAt < b.solicitadoAt ? -1 : 1;
  }
  if (a.cierreId === b.cierreId) return 0;
  return a.cierreId < b.cierreId ? -1 : 1;
}

/**
 * R8 — del cierre MAS ANTIGUO al mas reciente por el dia trabajado. Devuelve un array NUEVO:
 * la entrada no se muta (el llamador puede ser un `readonly` del repositorio).
 */
export function ordenarCierresFifo(cierres: readonly CierreImputable[]): CierreImputable[] {
  return [...cierres].sort(compararFifo);
}

/**
 * R10-R14 + R54 — trocea `importe` entre los cierres, del mas antiguo al mas reciente,
 * dando a cada uno el menor entre lo que queda del importe y su pendiente.
 *
 * `cierres` son TODOS los imputables del mensajero, sin recortar: la VENTANA se forma aqui
 * (design §2.5.1) tomando los `tope` primeros del orden FIFO. Que se forme aqui y no en el
 * `WHERE` es lo que permite probar el recorte sin base de datos (R17/R54) y lo que hace que
 * `imputable`, `imputableTotal` y `recorte` salgan de una sola pasada, coherentes por
 * construccion (R57: previsualizar y aplicar comparten esta funcion y este `tope`).
 *
 * Un importe mayor que el imputable de la ventana NO es un error aqui: devuelve `sobrante > 0`
 * y es el servicio quien lo traduce a `excede` con el `disponible` (R14). Esta funcion no
 * rechaza nada; solo dice lo que cabe.
 */
export function repartirEntreCierres(
  importe: string,
  cierres: readonly CierreImputable[],
  tope: number,
): Reparto {
  // R12: un cierre sin pendiente no es imputable (R5) y no puede recibir una imputacion de 0.
  // Se descarta ANTES de formar la ventana: un cierre saldado no ocupa una plaza del tope.
  const imputables = ordenarCierresFifo(cierres).filter((c) => pendienteDe(c).gt(0));

  // R53/R55: la ventana es lo unico sobre lo que un reparto escribe. Un tope no positivo deja
  // la ventana vacia (defensivo: la config garantiza >= 1, design §2.5.2).
  const topeEfectivo = tope > 0 ? Math.trunc(tope) : 0;
  const ventana = imputables.slice(0, topeEfectivo);
  const recortados = imputables.slice(topeEfectivo);

  const importeDec = round2(new Prisma.Decimal(importe));
  let restante = importeDec;
  let totalImputado = new Prisma.Decimal(0);
  let imputable = new Prisma.Decimal(0);
  const imputaciones: Imputacion[] = [];

  for (const cierre of ventana) {
    const pendienteAntes = pendienteDe(cierre);
    // El `imputable` de la ventana se suma SIEMPRE, tambien cuando el importe ya se agoto: es
    // el disponible que R14 informa, no "lo que este importe alcanzo".
    imputable = imputable.add(pendienteAntes);

    // R10: el menor entre lo que queda del importe y el pendiente de ESTE cierre.
    const monto = restante.lt(pendienteAntes) ? restante : pendienteAntes;
    if (monto.lte(0)) continue;

    const pendienteDespues = pendienteAntes.sub(monto);
    imputaciones.push({
      cierreId: cierre.cierreId,
      monto: monto.toFixed(2),
      pendienteAntes: pendienteAntes.toFixed(2),
      pendienteDespues: pendienteDespues.toFixed(2),
      // R11: solo la ULTIMA puede serlo, porque las anteriores agotaron su pendiente entero.
      parcial: monto.lt(pendienteAntes),
    });
    totalImputado = totalImputado.add(monto);
    restante = restante.sub(monto);
  }

  let montoFuera = new Prisma.Decimal(0);
  for (const cierre of recortados) montoFuera = montoFuera.add(pendienteDe(cierre));

  return {
    imputaciones,
    // R13: Σ montos == importe al centimo mientras el importe quepa en la ventana.
    totalImputado: totalImputado.toFixed(2),
    imputable: imputable.toFixed(2),
    imputableTotal: imputable.add(montoFuera).toFixed(2),
    sobrante: importeDec.sub(totalImputado).toFixed(2),
    recorte: {
      tope: topeEfectivo,
      // R56: cuentan los cierres de la VENTANA REAL, no `min(tope, entrada)`. Si la ventana
      // llego con un cierre ya saldado, la ventana ENCOGE y esto lo dice (design §2.5.5).
      enVentana: ventana.length,
      fuera: recortados.length,
      montoFuera: montoFuera.toFixed(2),
    },
  };
}
