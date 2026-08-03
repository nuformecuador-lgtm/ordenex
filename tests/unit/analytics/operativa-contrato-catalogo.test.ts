import { describe, it, expect } from "vitest";
import { getMetrica, listarMetricas } from "@/lib/analytics/metrics";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.1 — R9. La `unidadDeConteo` sale del CATALOGO, jamas de una tabla propia.
//
// D10/R36 de la 135: `unidadDeConteo` es lo que hace evidente que `entregas` cuenta GESTIONES
// y `ordenes_creadas` cuenta ORDENES, y es lo que `sonSumables` consulta para impedir que se
// sumen entre si. Si la 126 la escribiera a mano en su proyeccion, tendria una segunda tabla
// de verdad que se desincroniza en silencio: el catalogo diria una cosa y la respuesta otra,
// y `sonSumables` seguiria razonando sobre la del catalogo.

describe("R9 · la unidad de conteo de cada serie sale del catalogo", () => {
  it("la unidad de conteo de cada serie sale del catalogo", async () => {
    // Se recorren TODAS las metricas operativas del catalogo, no una muestra: escribir
    // `unidadDeConteo: "orden"` a mano en la proyeccion de `entregas` (la mutacion de R9)
    // pone rojo este caso sin que haya que anticipar en cual la escribiria alguien.
    for (const metrica of listarMetricas({ dominio: "operativa" })) {
      const serie = await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
        consultaDe(metrica.id),
      );
      expect(serie.unidadDeConteo, metrica.id).toBe(metrica.unidadDeConteo);
      expect(serie.unidad, metrica.id).toBe(metrica.unidad);
      expect(serie.metricaId, metrica.id).toBe(metrica.id);
    }
  });

  it("y `entregas` cuenta GESTIONES mientras `ordenes_creadas` cuenta ORDENES", async () => {
    // El caso concreto que R9 protege, con su numero: son las dos unidades que `sonSumables`
    // declara incompatibles. Si la proyeccion las igualara, la incompatibilidad desapareceria
    // del dato aunque siguiera en el catalogo.
    const entregas = await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
      consultaDe("entregas"),
    );
    const creadas = await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
      consultaDe("ordenes_creadas"),
    );
    expect(entregas.unidadDeConteo).toBe("gestion");
    expect(creadas.unidadDeConteo).toBe("orden");
    expect(getMetrica("entregas")?.unidadDeConteo).toBe("gestion");
  });

  it("el censo mira metricas de verdad: hay 15 operativas en el catalogo", () => {
    // Sin esto, un `listarMetricas` que devolviera lista vacia dejaria el primer caso verde
    // por vacio y nadie se enteraria.
    expect(listarMetricas({ dominio: "operativa" }).length).toBe(15);
  });
});
