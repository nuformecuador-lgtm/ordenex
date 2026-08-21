import { describe, expect, it } from "vitest";

import { horaDeParedCR, ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 258 (B1.1) — R53, R54.
//
// La hora de PARED de Costa Rica sale de restarle `ventana.desde` al instante y dividir entre
// una hora. `ventana.desde` ES las 00:00 de pared de CR, asi que la resta da la hora de pared
// por construccion: no hay conversion de zona horaria en ningun sitio y NO se usa
// `startOfDayCR`, que devuelve la medianoche UTC y correria la hora seis puestos.
//
// Todos los instantes se escriben en UTC con su hora de pared CR anotada al lado, para que el
// lector no tenga que hacer la resta mentalmente (CR es UTC-6 fijo, sin horario de verano).

const VENTANA = ventanaDelDiaEnCursoCR(new Date("2026-08-08T19:00:00.000Z")); // 13:00 CR

describe("horaDeParedCR — la hora del dia CR de un instante", () => {
  it("la ventana de referencia es la del 2026-08-08 y empieza a las 06:00Z (00:00 CR)", () => {
    // Si esto no fuera cierto, todo lo de abajo estaria midiendo otra cosa.
    expect(VENTANA.fecha).toBe("2026-08-08");
    expect(VENTANA.desde.toISOString()).toBe("2026-08-08T06:00:00.000Z");
  });

  it("el PRIMER instante del dia CR (00:00 de pared) es la hora 0", () => {
    expect(horaDeParedCR(VENTANA, new Date("2026-08-08T06:00:00.000Z"))).toBe(0);
  });

  it("las 00:59:59.999 CR siguen siendo la hora 0: el punto se cierra al FINAL de la hora", () => {
    expect(horaDeParedCR(VENTANA, new Date("2026-08-08T06:59:59.999Z"))).toBe(0);
  });

  it("las 01:00 CR son la hora 1: el borde de las 07:00Z", () => {
    expect(horaDeParedCR(VENTANA, new Date("2026-08-08T07:00:00.000Z"))).toBe(1);
  });

  it("el mediodia de pared CR es la hora 12, no la 18 (que es lo que daria la hora UTC)", () => {
    const mediodiaCR = new Date("2026-08-08T18:00:00.000Z");
    expect(horaDeParedCR(VENTANA, mediodiaCR)).toBe(12);
    expect(mediodiaCR.getUTCHours()).toBe(18);
  });

  it("las 23:59:59.999 CR son la hora 23: el ULTIMO instante del dia", () => {
    expect(horaDeParedCR(VENTANA, new Date("2026-08-09T05:59:59.999Z"))).toBe(23);
  });

  it("recorre las 24 horas de pared sin saltarse ninguna ni repetir", () => {
    const horas = Array.from({ length: 24 }, (_, h) =>
      horaDeParedCR(VENTANA, new Date(VENTANA.desde.getTime() + h * 3_600_000 + 30 * 60_000)),
    );
    expect(horas).toEqual(Array.from({ length: 24 }, (_, h) => h));
  });

  it("un instante POR ENCIMA de la ventana se recorta a 23, no produce un 24 inexistente", () => {
    // Pasa si el reloj de la aplicacion y el de la base van desfasados, o si un test congela
    // el reloj en otro dia. Un 24 seria una hora que no existe en la serie.
    expect(horaDeParedCR(VENTANA, new Date("2026-08-09T06:00:00.000Z"))).toBe(23);
    expect(horaDeParedCR(VENTANA, new Date("2026-08-20T12:00:00.000Z"))).toBe(23);
  });

  it("un instante POR DEBAJO de la ventana se recorta a 0, no produce un negativo", () => {
    expect(horaDeParedCR(VENTANA, new Date("2026-08-08T05:59:59.999Z"))).toBe(0);
    expect(horaDeParedCR(VENTANA, new Date("2026-01-01T00:00:00.000Z"))).toBe(0);
  });

  it("es coherente con la ventana de CUALQUIER dia, no solo con la del fixture", () => {
    const otra = ventanaDelDiaEnCursoCR(new Date("2026-12-31T23:30:00.000Z")); // 17:30 CR
    expect(otra.fecha).toBe("2026-12-31");
    expect(horaDeParedCR(otra, new Date("2026-12-31T23:30:00.000Z"))).toBe(17);
  });
});
