import { describe, it, expect } from "vitest";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T3.2 + T4.4 — R13 y D8.
//
// HECHO VERIFICADO: la feature 155 retiro del seed el estado de fulfillment, pero su
// migracion solo BORRA la fila del catalogo si nadie la referencia; en una base con historial
// real el `DELETE` queda NO-OP y la fila SOBREVIVE HUERFANA (37 filas de
// `orden_historial_estado` la apuntan). Como el rollup congela el estatus DESDE EL HISTORIAL,
// ese id SALE en un `GROUP BY estatus_id` real.
//
// Un `Record<OrderStatusValue, string>` cerrado sobre `ORDER_STATUS_SEED` daria `undefined` o
// un `throw` ante esa clave — en produccion, no en los tests, porque en los tests nadie siembra
// una fila huerfana por accidente.
//
// ⚠ EL VALUE RETIRADO NO SE ESCRIBE AQUI. El censo de la 153
// (`tests/unit/guards/censo-order-status-rename.test.ts`) prohibe nombrarlo fuera de su
// allowlist, y esquivarlo por concatenacion seria evadir el guard en vez de cumplirlo. Lo que
// R13 exige no es ESE value concreto sino la propiedad general «un estatus fuera del seed»:
// el caso usa un value sintetico que no esta en `ORDER_STATUS_SEED`, y lo AFIRMA.

const VALUE_FUERA_DEL_SEED = "estatus_retirado_del_catalogo";

const ETIQUETAS = new Map([
  ["e-huerfano", { value: VALUE_FUERA_DEL_SEED, label: VALUE_FUERA_DEL_SEED }],
  ["e-reparto", { value: "en_reparto", label: "en_reparto" }],
]);

describe("R13 · un estatus fuera del seed no rompe el embudo", () => {
  it("el value del caso NO esta en ORDER_STATUS_SEED (si no, el test no probaria nada)", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(VALUE_FUERA_DEL_SEED);
  });

  it("un estatus fuera del seed no rompe el embudo y conserva su etiqueta", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", estatusId: "e-reparto", ordenesEstadoStock: 4 }),
      cubo({ fecha: "2026-08-01", estatusId: "e-huerfano", ordenesEstadoStock: 1 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado"),
    );
    // NO lanza, NO descarta el cubo y conserva la etiqueta que le da la tabla.
    expect(serie.puntos).toHaveLength(2);
    expect(serie.puntos.map((p) => p.dimension)).toContain(VALUE_FUERA_DEL_SEED);
    expect(serie.puntos.find((p) => p.dimension === VALUE_FUERA_DEL_SEED)?.valor).toBe(1);
  });

  it("ocultarlo dejaria el embudo sin cuadrar y SIN SENAL: por eso se muestra", async () => {
    // Alternativa 7 descartada en `design.md §7`. Si el cubo huerfano se filtrara, la suma del
    // embudo del dia (5) dejaria de coincidir con el total del rollup y nada lo diria.
    const cubos = [
      cubo({ fecha: "2026-08-01", estatusId: "e-reparto", ordenesEstadoStock: 4 }),
      cubo({ fecha: "2026-08-01", estatusId: "e-huerfano", ordenesEstadoStock: 1 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado"),
    );
    const total = serie.puntos.reduce((a, p) => a + (p.valor ?? 0), 0);
    expect(total).toBe(5);
  });

  it("un estatus SIN fila de etiqueta tampoco lanza: sigue en la serie con su id", async () => {
    // Frontera del `?? id`: por FK esto no puede pasar en la base, pero el tipo lo admite y la
    // reaccion correcta sigue siendo «conservar el punto», no `throw` ni `undefined`.
    const cubos = [cubo({ fecha: "2026-08-01", estatusId: "e-desconocido", ordenesEstadoStock: 2 })];
    const serie = await servicioCon(rollupFalso(cubos, new Map())).consultar(
      consultaDe("ordenes_por_estado"),
    );
    expect(serie.puntos).toHaveLength(1);
    expect(serie.puntos[0].dimension).toBe("e-desconocido");
    expect(serie.puntos[0].valor).toBe(2);
  });
});
