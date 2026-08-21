// Feature 258 (F6.1, R59/R76/R77) — ADAPTADOR de la serie de entregas acumuladas al contrato
// del paquete de graficas.
//
// Funcion PURA, sin DOM y sin React: entra `PuntoRitmoEntregas[]` (lo que publica el tablero)
// y sale `SerieDato[]` (lo que `GraficaLineas` sabe pintar). Es pegamento propio de esta
// pantalla, no una primitiva: adaptar nuestro contrato al del paquete es exactamente lo que la
// regla del humano permite («reusa siempre que se pueda; cuando el componente no exista, creas
// uno nuevo»). Lo que NO se hace es dibujar un SVG a mano.
//
// ══════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ AQUI VIVE R59, Y ES EL SITIO EXACTO DONDE SE ROMPE SIN QUE NADA SE PONGA ROJO
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// El servicio devuelve SIEMPRE los puntos `0..H`, TAMBIEN cuando todos valen 0 (esta escrito
// en el contrato: `lib/types/tablero-dia.ts`, campo `ritmoEntregas`). Y `GraficaLineas` decide
// si hay datos con `series.some((s) => s.puntos.length > 0)` — mira CUANTOS puntos hay, no
// cuanto valen.
//
// Por lo tanto: si este adaptador devolviera la serie tal cual, un dia sin ninguna entrega
// pintaria **una linea plana a cero** en vez del estado vacio del marco. Nadie se rompe, nada
// falla, y la pantalla afirma «llevamos todo el dia entregando cero» en vez de decir «todavia
// no hay entregas». Es un fallo MUDO de la familia que este repo ya conoce.
//
// Por eso `serieDeRitmo` devuelve `[]` cuando el dia no registra ninguna entrega, que es lo
// que hace que `GraficaMarco` muestre su `EmptyState`.
//
// ⛔ NO lo "simplifiques" devolviendo siempre la serie: lo fija
// `tests/unit/components/serie-ritmo.test.ts` › «un dia SIN entregas devuelve `[]`».

import type { PuntoDato, SerieDato } from "@/components/private/analytics/tipos";
import type { PuntoRitmoEntregas } from "@/lib/types/tablero-dia";

/** Identificador de la unica serie. El COLOR no viaja aqui: lo asigna la paleta por indice (R49). */
export const ID_SERIE_RITMO = "entregas";

/** Nombre de la serie en la alternativa textual («Entregas acumuladas, 7 a. m.: 12»). */
export const ETIQUETA_SERIE_RITMO = "Entregas acumuladas";

/**
 * La hora de pared CR ya FORMATEADA. El paquete de graficas no sabe de fechas ni de zonas
 * (`tipos.ts`: «categoria ya formateada por el llamador»), asi que el formato se pone aqui.
 *
 * Se construye un instante en UTC con esa hora y se formatea EN UTC: la `hora` que llega ya ES
 * de pared de Costa Rica (la calculo `horaDeParedCR` a partir de `ventana.desde`), asi que
 * volver a pasarla por una zona horaria la correria seis horas. Cero conversiones aqui.
 */
export function horaLegibleCR(hora: number): string {
  return new Intl.DateTimeFormat("es-CR", {
    hour: "numeric",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(1970, 0, 1, hora)));
}

/**
 * Las horas iniciales SIN NINGUNA ENTREGA no se pintan (2026-08-21, visto en la app con datos
 * reales): de catorce horas dibujadas, las ocho primeras eran una linea plana en cero porque
 * la operacion arranca sobre las 7 a. m., y el dato interesante quedaba aplastado en el
 * tercio derecho.
 *
 * Se recorta AQUI y no en el backend a proposito: el servicio sigue publicando `0..H`
 * completo —es su contrato, y `totales.entregadas` cuadra con su ultimo punto (R52)— y esta
 * capa decide desde donde SE PINTA. Recortar en el servicio ataria la lectura a una decision
 * de presentacion.
 *
 * Se conserva el ULTIMO cero antes de la primera entrega, y no es un detalle: sin el, la
 * curva empezaria directamente en 3 y nadie podria ver que subio DESDE cero. Con el, la
 * primera subida se dibuja como lo que es.
 *
 * ⛔ SOLO SE RECORTA POR DELANTE. El ultimo punto no se toca nunca, que es lo que mantiene
 * cierto el cuadre con el contador `entregadas` (R52). Y como la serie es monotona no
 * decreciente, en cuanto hay una entrega ya no vuelve a haber ceros: el recorte no puede
 * comerse un hueco intermedio.
 */
function desdeLaPrimeraEntrega(
  puntos: readonly PuntoRitmoEntregas[],
): readonly PuntoRitmoEntregas[] {
  const primera = puntos.findIndex((punto) => punto.acumulado > 0);
  if (primera <= 0) return puntos;
  return puntos.slice(primera - 1);
}

/**
 * R77 — adapta la serie del backend al contrato del paquete.
 *
 * - Devuelve `[]` si el dia no registra NINGUNA entrega (ver la cabecera: es R59).
 * - Si hay alguna, UNA serie que empieza en la hora anterior a la primera entrega, con un
 *   punto por hora y en el orden en que llegan.
 * - `valor` NUNCA es `null`: en el paquete `null` significa DATO AUSENTE, y una hora sin
 *   entregas tiene un acumulado REAL (el de la hora anterior), no ausente. Pintarla como
 *   hueco partiria la curva en trozos y diria que no se sabe lo que si se sabe.
 * - No recorta por la cola: un dia tiene como mucho 24 puntos y `MAX_PUNTOS_SERIE` es 62.
 */
export function serieDeRitmo(puntos: readonly PuntoRitmoEntregas[]): readonly SerieDato[] {
  // Se mira si ALGUN punto es mayor que cero, y no solo el ultimo: la serie es monotona no
  // decreciente por construccion, asi que los dos criterios coinciden hoy — pero este no
  // depende de que esa garantia siga siendo cierta, y ademas cubre la lista vacia.
  const hayEntregas = puntos.some((punto) => punto.acumulado > 0);
  if (!hayEntregas) return [];

  const datos: PuntoDato[] = desdeLaPrimeraEntrega(puntos).map((punto) => ({
    categoria: horaLegibleCR(punto.hora),
    valor: punto.acumulado,
  }));

  return [{ id: ID_SERIE_RITMO, etiqueta: ETIQUETA_SERIE_RITMO, puntos: datos }];
}
