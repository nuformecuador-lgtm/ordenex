// FICHA 445 — EL EJE DE «ÓRDENES CARGADAS POR DÍA», DÍA A DÍA Y NO SALTO A SALTO.
//
// Modulo PURO: sin React, sin DOM, sin red. Se invoca y se comprueba.
//
// ─── QUE ESTABA MAL ─────────────────────────────────────────────────────────────────────────
//
// Medido en el navegador el 2026-09-17 (sesion de maestro, base local, sin filtro de fecha): la
// grafica pintaba cinco puntos —2026-07-21, 07-22, 07-23, 07-24 y 09-04— EQUIDISTANTES. El eje
// de `recharts` es CATEGORICO (`XAxis dataKey` sobre una cadena), asi que la distancia entre dos
// puntos es «una posicion», no «un dia»: entre el 24 de julio y el 4 de septiembre hay CUARENTA
// Y DOS dias sin ninguna carga y se dibujaban igual de anchos que el hueco entre el 21 y el 22.
//
// En una grafica de TENDENCIA eso no es un detalle estetico: la pendiente que se lee es falsa.
// Una caida de 22 a 2 leida como «de un dia al siguiente» es un desplome; leida como lo que es
// —seis semanas sin cargar nada y luego dos ordenes— es otra historia completamente distinta.
//
// ─── POR QUE SE RELLENA AQUI Y NO EN EL DTO ─────────────────────────────────────────────────
//
// Porque lo dice el propio contrato, y con estas palabras: «Los dias con CERO ordenes NO
// aparecen… No se rellenan aqui porque la consulta puede venir SIN ventana… Si la grafica
// necesita el eje continuo, lo construye a partir de la ventana que ELLA pidio, que es la unica
// que lo conoce siempre» (`lib/types/conteo-cargadas.ts`). Este modulo es esa construccion.
//
// UN DIA SIN CARGAS VALE CERO, y eso no contradice la regla R11 del paquete de graficas
// («`valor === null` significa DATO AUSENTE, nunca cero»). Aqui no hay dato ausente: la consulta
// cubrio ese dia y la respuesta fue que no entro ninguna orden. Cero es la medida, no su falta.
//
// ─── EL TECHO DE PUNTOS, Y POR QUE HAY QUE MIRARLO ──────────────────────────────────────────
//
// `aplicarTopePuntos` (el techo del paquete, `MAX_PUNTOS_SERIE`) LANZA fuera de produccion y
// recorta dentro. Rellenar hace crecer la serie —de 5 puntos a 46 en la medicion de arriba— asi
// que una serie que hoy pasa por debajo del techo puede cruzarlo manana solo por rellenarse.
// Sin ventana puesta, ademas, el eje abarca TODA la historia y crece un punto por dia: el panel
// se caeria solo, en el dev server de quien pasara por ahi, sin que nadie tocara nada.
//
// Por eso el recorte se hace AQUI, antes de entregar la serie, y se ANUNCIA. Se conservan los
// dias MAS RECIENTES, que es la misma politica del paquete y por el mismo motivo escrito alli:
// «en una serie temporal lo reciente es lo que se esta mirando».

import { MAX_PUNTOS_SERIE } from "@/components/private/analytics/topes";
import type { ConteoDeDia } from "@/lib/types/conteo-cargadas";

/** Un dia del eje, ya en la forma que consume el paquete de graficas. */
export interface PuntoDeDia {
  /** `YYYY-MM-DD`, calendario de Costa Rica: la misma cadena que trae el DTO. */
  readonly categoria: string;
  /** Ordenes cargadas ese dia. `0` es una medida, no una ausencia. */
  readonly valor: number;
}

/** La ventana que pidio la pantalla, tal como viaja en el filtro de la barra. */
export interface VentanaPedida {
  readonly desde?: string;
  readonly hasta?: string;
}

export interface EjeDeDias {
  /** Un punto POR DIA CALENDARIO, sin huecos, en orden ascendente. */
  readonly puntos: readonly PuntoDeDia[];
  /** `true` si el eje completo no cabia y se dejaron fuera los dias mas antiguos. */
  readonly recortado: boolean;
  /** Dias que abarcaba el eje ANTES del recorte. */
  readonly diasDelPeriodo: number;
  /** Dias que quedaron. Igual a `diasDelPeriodo` cuando no se recorto. */
  readonly diasMostrados: number;
}

const EJE_VACIO: EjeDeDias = {
  puntos: [],
  recortado: false,
  diasDelPeriodo: 0,
  diasMostrados: 0,
};

/**
 * Valida una fecha `YYYY-MM-DD` y la devuelve como milisegundos UTC de su medianoche.
 *
 * ARITMETICA EN UTC A PROPOSITO, y no es una zona horaria escondida: estas cadenas son fechas de
 * CALENDARIO, no instantes. Contar dias en UTC —donde todos duran 24 h exactas— es lo unico que
 * no se rompe con un cambio de horario de verano, y el resultado vuelve a salir como cadena. El
 * huso de Costa Rica ya lo aplico el servidor al producir estas fechas; aqui no se reinterpreta
 * ninguna.
 *
 * `null` cuando la cadena no es una fecha que se pueda contar: una fecha inventada por el
 * llamador no puede convertirse en un eje de miles de dias.
 */
function diaUtc(fecha: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const ms = Date.parse(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  // `Date.parse` acepta «2026-02-31» y lo desplaza a marzo. Se compara la ida y la vuelta: si no
  // coinciden, la fecha no existia.
  return new Date(ms).toISOString().slice(0, 10) === fecha ? ms : null;
}

const MS_POR_DIA = 86_400_000;

/** La fecha `YYYY-MM-DD` de un dia UTC. */
function fechaDe(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * EL EJE CONTINUO: un punto por dia calendario entre los dos extremos, los días sin carga a cero.
 *
 * ─── DE DONDE SALEN LOS EXTREMOS ────────────────────────────────────────────────────────────
 *
 * De la VENTANA que pidio la pantalla cuando la hay, y de los propios datos cuando no —que es el
 * arranque normal de `/analitica`, donde el filtro nace vacio (`FILTRO_ENTREGAS_INICIAL`) y la
 * serie abarca toda la historia—. Los dos casos se tratan igual de bien: lo que no se puede es
 * rellenar unas veces si y otras no.
 *
 * Y se toma el extremo MAS ANCHO de los dos: si llegara un dia con cargas fuera de la ventana
 * pedida, se ensancha el eje en vez de tirarlo. Perder un dato por una discrepancia de bordes
 * seria peor que dibujar un dia de mas.
 *
 * ⚠ PUNTO DE MUTACION DE LA FICHA: devolver aqui los dias tal como llegaron —sin rellenar— hace
 * que el eje vuelva a tratar los dias como categorias y que seis semanas de hueco midan lo mismo
 * que un dia. `tests/unit/analytics/eje-de-dias.test.ts` lo pone rojo con los numeros medidos.
 */
export function ejeContinuoDeDias(
  porDia: readonly ConteoDeDia[],
  ventana: VentanaPedida = {},
): EjeDeDias {
  const conteos = new Map<string, number>();
  const extremos: number[] = [];

  for (const fila of porDia) {
    const ms = diaUtc(fila.fecha);
    if (ms === null) continue;
    // Un dia repetido se SUMA en vez de pisarse: el contrato dice un elemento por dia, pero
    // quedarse con el ultimo perderia ordenes en silencio si alguna vez dejara de cumplirse.
    conteos.set(fila.fecha, (conteos.get(fila.fecha) ?? 0) + fila.conteo);
    extremos.push(ms);
  }

  const desdePedido = ventana.desde ? diaUtc(ventana.desde) : null;
  const hastaPedido = ventana.hasta ? diaUtc(ventana.hasta) : null;
  if (desdePedido !== null) extremos.push(desdePedido);
  if (hastaPedido !== null) extremos.push(hastaPedido);

  if (extremos.length === 0) return EJE_VACIO;

  const primero = Math.min(...extremos);
  const ultimo = Math.max(...extremos);
  const diasDelPeriodo = Math.round((ultimo - primero) / MS_POR_DIA) + 1;

  // Se recorta ANTES de generar los puntos, no despues: un eje sin ventana sobre una base con
  // años de historia son decenas de miles de dias, y generarlos todos para tirar casi todos
  // es trabajo que el navegador hace en cada render.
  const recortado = diasDelPeriodo > MAX_PUNTOS_SERIE;
  const diasMostrados = recortado ? MAX_PUNTOS_SERIE : diasDelPeriodo;
  const arranque = ultimo - (diasMostrados - 1) * MS_POR_DIA;

  const puntos: PuntoDeDia[] = [];
  for (let ms = arranque; ms <= ultimo; ms += MS_POR_DIA) {
    const fecha = fechaDe(ms);
    puntos.push({ categoria: fecha, valor: conteos.get(fecha) ?? 0 });
  }

  return { puntos, recortado, diasDelPeriodo, diasMostrados };
}

/**
 * Lo que se escribe cuando el eje no cabia entero. Se dice CUANTOS dias se ven y cuantos tenia
 * el periodo: un eje recortado en silencio es una tendencia sobre un trozo del periodo que el
 * usuario cree completo.
 *
 * No reusa `avisoRecorte` de `../operativo/textos` porque aquel habla de «los que no caben en
 * este panel» sin decir de QUE se recortaron; aqui lo que se pierde es tiempo, y el usuario
 * necesita saber que lo que mira son los ultimos N dias y no el periodo entero.
 */
export function avisoDeEjeRecortado(diasMostrados: number, diasDelPeriodo: number): string {
  return (
    `Se muestran los últimos ${diasMostrados} días de los ${diasDelPeriodo} del periodo: ` +
    "un eje diario más largo no se lee. Acota el filtro de fechas para ver los demás."
  );
}
