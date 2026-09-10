import { describe, it, expect } from "vitest";

import { motivoGestionLegible } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

/**
 * FICHA 408 (R4) — GUARDIA: ni la sigla `SLA` ni el value inglés del enum llegan nunca a una
 * pantalla ni a una hoja descargada.
 *
 * ── POR QUÉ SE ESCRIBE SOBRE LA SALIDA Y NO SOBRE EL CÓDIGO FUENTE
 * La sigla `SLA` **tiene que aparecer** en el emparejador: hay que reconocer la cadena que el
 * cron guardó. Un `grep` del archivo daría rojo por eso —que es correcto— y verde por un
 * comentario que la mencione —que no prueba nada—. Las dos respuestas están mal. Lo que importa
 * es lo que sale por el otro lado, así que esta guardia **ejecuta la función** y mira su
 * resultado.
 *
 * ── POR QUÉ RECORRE EL SEED Y NO UNA LISTA ESCRITA A MANO
 * Si el enum `gestion_causa_devolucion` gana un cuarto valor, el cron empezará a componer una
 * cuarta plantilla el día que se despliegue. Recorriendo `CAUSA_DEVOLUCION_SEED`, esta guardia
 * la mira sola y se pone roja si nadie le puso etiqueta: el motivo saldría crudo, con la sigla
 * y el value dentro. Una lista literal aquí se quedaría callada.
 *
 * ── ES LA MISMA PLANTILLA QUE LA DE PRODUCCIÓN
 * `escalado SLA ${causa}` es, carácter por carácter, la de `lib/services/DevolucionSlaService.ts`.
 * Si el productor cambia de forma, esta guardia deja de reconocerla y la NO-VACUIDAD de abajo se
 * pone roja en vez de pasar por vacío.
 */

/** La plantilla del cron, compuesta igual que en producción. */
function plantillaDelCron(causa: string): string {
  return `escalado SLA ${causa}`;
}

/** Las dos variantes del texto: con marcador de origen en la fila y sin él. */
const LAS_DOS_VARIANTES = [true, false] as const;

describe("R4 — ni la sigla ni el value del enum llegan a la pantalla", () => {
  it("CONTROL DE NO-VACUIDAD: hay causas que recorrer y las tres se traducen de verdad", () => {
    // Sin esto, un SEED vacío —o un traductor que devolviera cadena vacía— haría que los
    // `not.toContain` de abajo pasaran sin haber comprobado nada.
    expect(CAUSA_DEVOLUCION_SEED.length).toBeGreaterThanOrEqual(3);
    for (const causa of CAUSA_DEVOLUCION_SEED) {
      for (const hayMarcadorDeOrigen of LAS_DOS_VARIANTES) {
        const salida = motivoGestionLegible(plantillaDelCron(causa), hayMarcadorDeOrigen);
        expect(salida, `${causa} sin traducir`).not.toBeNull();
        expect(salida, `${causa} salió vacío`).not.toBe("");
        // Y NO es la entrada: si alguien devolviera el motivo tal cual, esto lo dice con
        // nombre y apellido en vez de dejarlo pasar por «no contiene nada prohibido».
        expect(salida, `${causa} salió sin traducir`).not.toBe(plantillaDelCron(causa));
      }
    }
  });

  for (const causa of CAUSA_DEVOLUCION_SEED) {
    for (const hayMarcadorDeOrigen of LAS_DOS_VARIANTES) {
      const variante = hayMarcadorDeOrigen ? "con marcador" : "sin marcador";
      it(`«${plantillaDelCron(causa)}» sale sin jerga (${variante})`, () => {
        const salida = motivoGestionLegible(plantillaDelCron(causa), hayMarcadorDeOrigen) ?? "";

        // La sigla que este repo decidió no enseñar nunca, en cualquier caja.
        expect(salida, "se escapó la sigla").not.toMatch(/\bSLA\b/i);
        // El value en inglés del enum: es un identificador de base de datos, no una palabra.
        expect(salida, `se escapó el value «${causa}»`).not.toContain(causa);
        // Y el verbo de la plantilla, que tampoco es castellano de pantalla.
        expect(salida, "se escapó «escalado»").not.toMatch(/escalado/i);
      });
    }
  }
});
