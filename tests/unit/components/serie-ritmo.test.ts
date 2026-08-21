// Feature 258 (F6.3) — EL ADAPTADOR de la serie de entregas acumuladas. Test PURO, sin DOM.
// Mapea: R59, R77.
//
// ══════════════════════════════════════════════════════════════════════════════════════════
// LA TRAMPA QUE ESTE ARCHIVO EXISTE PARA CAZAR
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// El servicio devuelve SIEMPRE los puntos `0..H`, también cuando todos valen 0 (está escrito
// en el contrato: `lib/types/tablero-dia.ts`). Y `GraficaLineas` decide si hay datos con
// `series.some((s) => s.puntos.length > 0)` — mira CUÁNTOS puntos hay, no cuánto valen.
//
// Así que un adaptador que devolviera la serie tal cual haría que un día sin ninguna entrega
// pintara **una línea plana a cero** en lugar del estado vacío del marco. R59 rota, y NADA se
// pone rojo: ni el typecheck, ni el lint, ni ningún test de la 192. Es un fallo mudo.
//
// Por eso la primera aserción de este archivo no es cosmética: es el requisito.

import { describe, expect, it } from "vitest";

import {
  ETIQUETA_SERIE_RITMO,
  ID_SERIE_RITMO,
  horaLegibleCR,
  serieDeRitmo,
} from "@/app/(app)/monitoreo/_components/serie-ritmo";
import { MAX_PUNTOS_SERIE, prepararSeries } from "@/components/private/analytics/topes";
import type { PuntoRitmoEntregas } from "@/lib/types/tablero-dia";

/** La serie tal cual la produce el servicio: `0..H` sin huecos, monótona no decreciente. */
function serieDelServicio(acumulados: readonly number[]): readonly PuntoRitmoEntregas[] {
  return acumulados.map((acumulado, hora) => ({ hora, acumulado }));
}

describe("Feature 258 · R59 — un día SIN entregas NO dibuja una línea plana a cero", () => {
  it("devuelve `[]` cuando todos los acumulados valen 0, aunque los puntos existan", () => {
    // Esto es EXACTAMENTE lo que devuelve el servicio a las 09:00 de un día sin entregas:
    // diez puntos, todos a cero. No es una entrada inventada.
    const delServicio = serieDelServicio([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(delServicio).toHaveLength(10);

    expect(
      serieDeRitmo(delServicio),
      "el adaptador pasó la serie tal cual: `GraficaLineas` verá 10 puntos, creerá que hay " +
        "datos y pintará una línea plana a cero en vez del estado vacío (R59)",
    ).toEqual([]);
  });

  it("y el marco lo lee como «no hay datos»: es la condición exacta que evalúa la gráfica", () => {
    // La misma expresión que `GraficaLineas` usa para decidir `hayDatos`. Se reproduce aquí
    // para que este test hable del MECANISMO y no de una consecuencia que alguien podría
    // cambiar sin enterarse.
    const hayDatos = (series: ReturnType<typeof serieDeRitmo>) =>
      series.some((serie) => serie.puntos.length > 0);

    expect(hayDatos(serieDeRitmo(serieDelServicio([0, 0, 0])))).toBe(false);
    expect(hayDatos(serieDeRitmo(serieDelServicio([0, 1, 1])))).toBe(true);
  });

  it("una lista vacía tampoco produce serie", () => {
    expect(serieDeRitmo([])).toEqual([]);
  });

  it("basta UNA entrega en cualquier hora para que la curva exista", () => {
    // Con la primera entrega del día a las 07:00, el acumulado de las horas 0..6 es 0 y el de
    // las 7 en adelante es 1. La serie SÍ existe: lo que no había era ninguna entrega.
    const serie = serieDeRitmo(serieDelServicio([0, 0, 0, 0, 0, 0, 0, 1, 1]));
    expect(serie).toHaveLength(1);
    // Las horas planas de antes de la primera entrega NO se pintan (ver el bloque de más
    // abajo): quedan la hora 6 —el cero desde el que sube— y las dos con dato.
    expect(serie[0].puntos).toHaveLength(3);
    expect(serie[0].puntos.map((p) => p.valor)).toEqual([0, 1, 1]);
  });
});

describe("Feature 258 · R77 — la forma de la serie adaptada", () => {
  const PUNTOS = serieDelServicio([0, 2, 5, 5, 9]);

  it("es UNA serie, con su id y su etiqueta", () => {
    const serie = serieDeRitmo(PUNTOS);
    expect(serie).toHaveLength(1);
    expect(serie[0].id).toBe(ID_SERIE_RITMO);
    expect(serie[0].etiqueta).toBe(ETIQUETA_SERIE_RITMO);
  });

  it("un punto por hora, en el mismo orden en que llegaron", () => {
    const serie = serieDeRitmo(PUNTOS);
    expect(serie[0].puntos.map((p) => p.valor)).toEqual([0, 2, 5, 5, 9]);
    expect(serie[0].puntos.map((p) => p.categoria)).toEqual(
      PUNTOS.map((p) => horaLegibleCR(p.hora)),
    );
  });

  it("ningún `valor` es `null`: en el paquete `null` significa DATO AUSENTE", () => {
    // Una hora sin entregas tiene un acumulado REAL (el de la hora anterior), no ausente.
    // Pintarla como hueco partiría la curva y diría que no se sabe lo que sí se sabe.
    for (const punto of serieDeRitmo(PUNTOS)[0].puntos) {
      expect(punto.valor).not.toBeNull();
      expect(typeof punto.valor).toBe("number");
    }
  });

  it("no muta ni reordena la entrada", () => {
    const entrada = serieDelServicio([0, 1, 3]);
    const copia = entrada.map((p) => ({ ...p }));
    serieDeRitmo(entrada);
    expect(entrada).toEqual(copia);
  });

  it("las 24 horas caben SIN recorte: el tope del paquete es 62", () => {
    // Comprobado, no supuesto: `prepararSeries` es la única puerta antes del lienzo y de la
    // alternativa textual, y `aplicarTopePuntos` LANZA fuera de producción si se excede.
    expect(MAX_PUNTOS_SERIE).toBe(62);

    const diaCompleto = serieDeRitmo(
      serieDelServicio(Array.from({ length: 24 }, (_, hora) => hora + 1)),
    );
    const preparadas = prepararSeries(diaCompleto);

    expect(preparadas.recortePuntos.recortado).toBe(false);
    expect(preparadas.series[0].puntos).toHaveLength(24);
  });
});

describe("Feature 258 · la hora legible de Costa Rica", () => {
  it("las 24 horas dan 24 etiquetas DISTINTAS", () => {
    // Si dos horas dieran la misma categoría, dos puntos de la curva se leerían como el mismo
    // instante en la alternativa textual y en el eje.
    const etiquetas = Array.from({ length: 24 }, (_, hora) => horaLegibleCR(hora));
    expect(new Set(etiquetas).size).toBe(24);
  });

  it("no vuelve a convertir zonas: la hora que entra es la que sale", () => {
    // `hora` YA es de pared de Costa Rica (la calculó `horaDeParedCR` sobre `ventana.desde`).
    // Pasarla otra vez por una zona la correría seis horas, que es el off-by-one de la
    // familia que costó la ficha 166.
    expect(horaLegibleCR(0)).toMatch(/^12\b/);
    expect(horaLegibleCR(7)).toMatch(/^7\b/);
    expect(horaLegibleCR(13)).toMatch(/^1\b/);
    expect(horaLegibleCR(23)).toMatch(/^11\b/);
    // Y la mitad del día se distingue de la otra.
    expect(horaLegibleCR(7)).not.toBe(horaLegibleCR(19));
  });
});

describe("Feature 258 · las horas iniciales sin actividad NO se pintan", () => {
  it("un día que arranca a las 7 a. m. no dibuja ocho horas planas en cero", () => {
    // El caso REAL visto en la app: la operación empieza sobre las 7 y el servicio devuelve
    // igualmente `0..H`. Sin recorte, más de la mitad de la curva era una línea plana y el
    // dato interesante quedaba aplastado en el tercio derecho.
    const delServicio = serieDelServicio([0, 0, 0, 0, 0, 0, 0, 3, 7, 11]);
    const [serie] = serieDeRitmo(delServicio);

    // Se pintan las horas 6..9: la primera entrega es la 7, y se conserva UN cero delante.
    expect(serie.puntos.map((p) => p.valor)).toEqual([0, 3, 7, 11]);
    expect(serie.puntos[0].categoria).toBe(horaLegibleCR(6));
    expect(serie.puntos.at(-1)!.categoria).toBe(horaLegibleCR(9));
  });

  it("conserva UN cero delante: la curva tiene que verse subir DESDE cero", () => {
    // Sin ese punto la línea empezaría directamente en 3 y nadie podría distinguir «subió de
    // 0 a 3 a las 7» de «a las 7 ya había 3 y no sabemos de dónde salieron».
    const [serie] = serieDeRitmo(serieDelServicio([0, 0, 3, 3]));
    expect(serie.puntos[0].valor).toBe(0);
    expect(serie.puntos).toHaveLength(3);
  });

  it("el recorte NO toca el último punto: el cuadre con `entregadas` sigue siendo cierto (R52)", () => {
    // Es la propiedad que hace legítimo recortar: se corta por DELANTE y nunca por la cola.
    for (const acumulados of [
      [0, 0, 0, 0, 5],
      [0, 1, 4, 4, 9],
      [2, 5, 5, 8],
      [0, 0, 1],
    ]) {
      const [serie] = serieDeRitmo(serieDelServicio(acumulados));
      expect(
        serie.puntos.at(-1)!.valor,
        "el recorte se comió el último punto: la línea ya no cuadra con el contador",
      ).toBe(acumulados.at(-1));
    }
  });

  it("si la primera hora ya tiene entregas, no se recorta nada", () => {
    const [serie] = serieDeRitmo(serieDelServicio([2, 4, 4]));
    expect(serie.puntos.map((p) => p.valor)).toEqual([2, 4, 4]);
  });

  it("un día SIN ninguna entrega sigue dando `[]`, no una serie recortada a cero puntos", () => {
    // El recorte se aplica DESPUÉS de decidir que hay entregas: si se aplicara antes, un día
    // sin ninguna daría una serie vacía de puntos en vez de ninguna serie, y `GraficaLineas`
    // vería `series.length > 0` con `puntos.length === 0`. Sigue siendo `[]` (R59).
    expect(serieDeRitmo(serieDelServicio([0, 0, 0, 0]))).toEqual([]);
  });

  it("no se come un cero intermedio, porque no existe: la serie es monótona", () => {
    // Sólo se recorta el prefijo. Un acumulado no puede volver a 0 después de subir, así que
    // no hay ningún hueco interior que el recorte pueda tragarse.
    const [serie] = serieDeRitmo(serieDelServicio([0, 1, 1, 1, 6]));
    expect(serie.puntos.map((p) => p.valor)).toEqual([0, 1, 1, 1, 6]);
  });
});
