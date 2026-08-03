import { describe, it, expect } from "vitest";
import { SIN_CAUSA_TIPIFICADA } from "@/lib/services/AnaliticaOperativaService";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.5 — R15. El cubo `causa_devolucion IS NULL` NO es basura.
//
// HECHO VERIFICADO (`db/schema.prisma`, columna `gestion_orden.causa_devolucion`): la columna
// nacio con la feature 73 y el HISTORICO NO SE BACKFILLEO. Una `devuelta` anterior a esa
// feature tiene `causa_devolucion = NULL`, y son devoluciones REALES.
//
// La mutacion que R15 anticipa es `causaDevolucion: { not: null }` en el `where`: parece una
// limpieza («quitar las filas sin causa») y lo que hace es borrar del informe todas las
// devoluciones anteriores a la 73, sin que ningun total avise.

describe("R15 · motivos de devolucion incluye el cubo sin causa", () => {
  it("las devoluciones sin causa tipificada aparecen en su propio cubo", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", causaDevolucion: "not_found", devoluciones: 3 }),
      cubo({ fecha: "2026-08-01", causaDevolucion: null, devoluciones: 4 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("motivos_devolucion"));
    expect(serie.puntos).toHaveLength(2);
    const sinCausa = serie.puntos.find((p) => p.dimension === SIN_CAUSA_TIPIFICADA);
    expect(sinCausa, "el cubo sin causa desaparecio de la serie").toBeDefined();
    expect(sinCausa?.valor).toBe(4);
  });

  it("y esta ETIQUETADO, no `null` serializado ni cadena vacia", async () => {
    const cubos = [cubo({ fecha: "2026-08-01", causaDevolucion: null, devoluciones: 1 })];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("motivos_devolucion"));
    expect(serie.puntos[0].dimension).toBe(SIN_CAUSA_TIPIFICADA);
    expect(serie.puntos[0].dimension).not.toBe("");
    expect(JSON.stringify(serie)).not.toContain('"dimension":null');
  });

  it("el total de la serie cuadra con el total de devoluciones del recorte", async () => {
    // La contrapartida de todo lo anterior: si el cubo nulo se descartara, este total bajaria
    // de 7 a 3 y NADA en la respuesta lo diria.
    const cubos = [
      cubo({ fecha: "2026-08-01", causaDevolucion: "wrong_address", devoluciones: 3 }),
      cubo({ fecha: "2026-08-01", causaDevolucion: null, devoluciones: 4 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("motivos_devolucion"));
    expect(serie.puntos.reduce((a, p) => a + (p.valor ?? 0), 0)).toBe(7);
  });

  it("las causas tipificadas conservan su valor del enum como dimension", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", causaDevolucion: "not_found", devoluciones: 1 }),
      cubo({ fecha: "2026-08-01", causaDevolucion: "wrong_number", devoluciones: 2 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(consultaDe("motivos_devolucion"));
    expect(serie.puntos.map((p) => p.dimension).sort()).toEqual(["not_found", "wrong_number"]);
  });
});
