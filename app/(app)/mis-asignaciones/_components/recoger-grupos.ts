// Feature 274 (B1, R2-R5/R10/R11/R15/R29) — LA PARTICIÓN de «Por recoger» en dos grupos, y los
// textos que esa partición hace falta decir. Función PURA: sin JSX, sin DOM, sin negocio de
// dominio, sobre las asignaciones que ya llegan por props al módulo. Es importable sin arrastrar
// jsdom y se prueba aparte en `tests/unit/components`, el mismo molde que
// `mis-asignaciones-buscador.ts`.
//
// POR QUÉ EXISTE ESTA PANTALLA CON DOS PESTAÑAS. Desde el 2026-08-21 (feature 261) una orden
// marcada para un día posterior no se puede recoger: la reserva protege del corte de la noche **y
// también del mensajero**. Lo que esta ficha cambia es **dónde** vive la orden, no si se ve — las
// dos pestañas están siempre montadas, cada una dice cuántas tiene sin que nadie interactúe y
// ninguna orden queda a más de una pulsación (274/R7-R9). Nada sale de la pantalla.
//
// AQUÍ NO SE LEE NINGÚN RELOJ (R4), igual que en `lib/utils/dia-reparto-textos.ts`: este módulo no
// importa el objeto de fecha del navegador ni el de internacionalización, y no compara fechas. La
// marca llega YA DERIVADA DEL SERVIDOR en el DTO (246/R26) y caduca sola al llegar el día
// (246/R25). Un portátil con la hora corrida no puede mandar una orden al grupo equivocado.

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

/** Los dos grupos en que se parte «Por recoger». Ninguna orden queda fuera ni en los dos (R2). */
export interface GruposPorRecoger {
  /** Las que el mensajero puede recoger hoy. Orden de entrada preservado. */
  hoy: MiAsignacionDTO[];
  /** Las reservadas para un día posterior. Orden de entrada preservado. */
  otroDia: MiAsignacionDTO[];
}

/**
 * Regla ÚNICA de partición: `esParaManana === true` va a `otroDia`; TODO lo demás, a `hoy`.
 *
 * POR QUÉ `=== true` Y NO `Boolean(...)`, dicho aquí para que no se «simplifique» luego. El campo
 * es opcional en el DTO (`esParaManana?: boolean`) por su patrón aditivo, así que una orden servida
 * por un despliegue anterior llega SIN él. `=== true` deja ese `undefined` en el grupo de hoy
 * EXPLÍCITAMENTE (R3), que es lo mismo que ya hace la card al no inventarle la marca. No es un
 * detalle de estilo: es la regla que decide dónde vive una orden que no trae el campo.
 *
 * Preserva el orden en que las órdenes llegan del servidor dentro de cada grupo (R5): separar no
 * es reordenar.
 */
export function separarPorDia(ordenes: MiAsignacionDTO[]): GruposPorRecoger {
  const hoy: MiAsignacionDTO[] = [];
  const otroDia: MiAsignacionDTO[] = [];
  for (const orden of ordenes) {
    if (orden.esParaManana === true) otroDia.push(orden);
    else hoy.push(orden);
  }
  return { hoy, otroDia };
}

/* -------------------------------------------------------------------------- */
/* Los textos de la partición                                                  */
/* -------------------------------------------------------------------------- */
//
// Viven COLOCADOS con la pantalla y no en `lib/`: se usan en un solo sitio (`docs/architecture.md`
// — «si se usa en UN SOLO lugar, vive junto a la página que lo usa»). Los NOMBRES de las dos
// pestañas son la excepción y viven en `lib/utils/dia-reparto-textos.ts`, que es el vocabulario
// visible del día de reparto.
//
// Ninguno dice «reserva», ni «corte», ni el nombre de una columna, ni una fecha en formato de
// máquina (R25): la misma regla con la que este repo retiró «SLA» del frontend. Y todos concuerdan
// en singular y plural (R29).

/** R10 — vacío del grupo de hoy SIN búsqueda. Dice «hoy» porque el otro grupo sí tiene órdenes. */
export const VACIO_GRUPO_HOY = "No hay órdenes por recoger hoy.";

/** R10 — vacío del grupo de otro día SIN búsqueda. */
export const VACIO_GRUPO_OTRO_DIA = "No hay órdenes para otro día.";

/**
 * R10 — vacío CON búsqueda, el mismo en las dos pestañas. Literal de la feature 114, reutilizado
 * tal cual: el mensajero ya lo conoce y sigue significando lo mismo.
 */
export const SIN_RESULTADOS_RECOGER =
  "Ninguna guía por recoger coincide con la búsqueda.";

/**
 * R15/R29 — el contador de la cabecera, que ahora cuenta SÓLO el grupo de hoy y vive DENTRO del
 * panel que cuenta.
 *
 * CONCORDANDO EN SINGULAR (decisión del humano, 2026-08-24, Q1 de la ficha). Hasta hoy decía «N
 * Órdenes nuevas asignadas» con la N pegada a un plural fijo; con una sola orden se leía «1
 * Órdenes nuevas asignadas». El defecto ya existía, pero contar sólo lo de hoy lo vuelve frecuente
 * —el caso medido en producción el 2026-08-24 era exactamente 1— y se decidió no dejarlo a la
 * vista.
 */
export function contadorNuevasAsignadas(cuantas: number): string {
  return cuantas === 1
    ? "1 orden nueva asignada"
    : `${cuantas} órdenes nuevas asignadas`;
}

/**
 * R11/R21 — el puntero a la OTRA pestaña cuando la activa no muestra nada. Sin él, un mensajero que
 * teclea una guía que resulta ser de otro día leería «ninguna coincide», que es FALSO: la guía
 * está, en la otra pestaña, y él la tiene en la mano.
 *
 * POR QUÉ «órdenes» SIN BÚSQUEDA Y «coincidencias» CON ELLA: sin filtro el número es lo que hay;
 * con filtro es lo que casó. Decir «2 órdenes» mientras se filtra sería un número que no
 * corresponde a nada que el mensajero pueda ver.
 *
 * Devuelve `null` cuando al otro lado no hay nada que señalar: un puntero que dijera «Hay 0» sería
 * ruido, y el vacío ya lo explica su propio mensaje.
 *
 * @param cuantas cuántas hay en la otra pestaña BAJO EL ESTADO ACTUAL de la búsqueda.
 * @param nombreDeLaOtraPestana el nombre visible de la otra pestaña, tal y como se lee en ella.
 * @param buscando `true` si hay búsqueda activa.
 */
export function punteroALaOtraPestana(
  cuantas: number,
  nombreDeLaOtraPestana: string,
  buscando: boolean,
): string | null {
  if (cuantas <= 0) return null;
  const que = buscando
    ? cuantas === 1
      ? "1 coincidencia"
      : `${cuantas} coincidencias`
    : cuantas === 1
      ? "1 orden"
      : `${cuantas} órdenes`;
  return `Hay ${que} en «${nombreDeLaOtraPestana}».`;
}
