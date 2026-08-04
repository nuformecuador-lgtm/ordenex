import { describe, it, expect } from "vitest";
import type { EtiquetaEstatus } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import { AHORA, HOY_CR, consultaDe, rollupFalso, servicioCon, vivaFalso } from "./_fake-operativa";

// Feature 176 / T4.6 — R11 y D3.
//
// `aging_por_estado` NO es un caso de rango largo, y confundirlo con uno seria darle una
// respuesta con forma correcta y significado inventado. Es la unica metrica `clase: "live"`
// del catalogo y su serie tiene UNA SOLA FECHA, la del corte: siempre pinta serie, nunca
// entro en `rango_excedido`. Lo que no ha tenido NUNCA, en ningun rango, es su cifra total.
//
// Y como es un STOCK INSTANTANEO, no se agrega sobre el TIEMPO —«el aging medio de agosto»
// no significa nada— sino sobre la DIMENSION: se funden los estatus al corte. De ahi su
// forma propia: un cubo unico, siempre parcial, con la fecha del corte.

const FILAS_DESIGUALES = [
  // 1000 s en 1 orden -> media 1000 s
  { estatusId: "e-uno", zonaId: "z1", tiendaId: "t1", ordenes: 1, segEnEstadoAcum: BigInt(1000) },
  // 100 s en 9 ordenes -> media 11,1 s
  { estatusId: "e-dos", zonaId: "z1", tiendaId: "t1", ordenes: 9, segEnEstadoAcum: BigInt(100) },
];

// Los `value` salen de `ORDER_STATUS_SEED` VIGENTE (`lib/types/order-status.ts:54-79`), no
// de la nomenclatura anterior: el censo de la 153
// (`tests/unit/guards/censo-order-status-rename.test.ts`) prohibe nombrar los 7 values
// retirados fuera de su allowlist, y este fixture no tiene ningun motivo para necesitarlos.
const ETIQUETAS: ReadonlyMap<string, EtiquetaEstatus> = new Map([
  ["e-uno", { value: "en_reparto", label: "en_reparto" }],
  ["e-dos", { value: "en_bodega_central", label: "en_bodega_central" }],
]);

describe("R11 · aging_por_estado agrega la dimension, no el tiempo", () => {
  it("aging_por_estado agrega la dimension al corte en un unico cubo parcial", async () => {
    const agregado = await servicioCon(
      rollupFalso([], ETIQUETAS),
      vivaFalso({ aging: FILAS_DESIGUALES }),
    ).consultarAgregado(consultaDe("aging_por_estado", undefined, { rango: "mes" }));

    // UN cubo, no uno por estatus y no uno por dia del mes.
    expect(agregado.cubos).toHaveLength(1);
    const unico = agregado.cubos[0];
    expect(unico.dimension).toBeUndefined();

    // Σ acum / Σ ordenes = 1100 / 10 = 110. La media de las dos medias seria 505,6.
    expect(unico.numerador).toBe(1100);
    expect(unico.denominador).toBe(10);
    expect(unico.valor).toBeCloseTo(110, 10);
    expect(unico.valor).not.toBeCloseTo(505.6, 1);

    // SIEMPRE parcial: una foto del ahora no es un dia cerrado, aunque el rango sea largo.
    expect(unico.parcial).toBe(true);
    expect(unico.corteAt).toBe(AHORA.toISOString());
    // Y su unica fecha es la del corte, no los extremos del rango del mes.
    expect(unico.fecha).toBe(HOY_CR);
    expect(unico.desdeFecha).toBe(HOY_CR);
    expect(unico.hastaFecha).toBe(HOY_CR);
  });

  it("y si se pide el desglose por estatus, un cubo por estatus con la misma aritmetica", async () => {
    const agregado = await servicioCon(
      rollupFalso([], ETIQUETAS),
      vivaFalso({ aging: FILAS_DESIGUALES }),
    ).consultarAgregado(consultaDe("aging_por_estado", undefined, { rango: "mes" }), {
      desagregacion: "estatus",
    });

    expect(agregado.cubos).toHaveLength(2);
    const porEstatus = new Map(agregado.cubos.map((c) => [c.dimension, c]));
    // La etiqueta sale de la TABLA, no de un mapa hardcodeado.
    expect(porEstatus.get("en_reparto")?.valor).toBeCloseTo(1000, 10);
    expect(porEstatus.get("en_bodega_central")?.valor).toBeCloseTo(100 / 9, 10);
    for (const c of agregado.cubos) {
      expect(c.parcial).toBe(true);
      expect(c.corteAt).toBe(AHORA.toISOString());
    }
  });

  it("sin ordenes vivas en un estado, el cubo dice `null` y no `0`", async () => {
    const agregado = await servicioCon(
      rollupFalso([], ETIQUETAS),
      vivaFalso({
        aging: [
          { estatusId: "e-uno", zonaId: "z1", tiendaId: "t1", ordenes: 0, segEnEstadoAcum: BigInt(0) },
        ],
      }),
    ).consultarAgregado(consultaDe("aging_por_estado", undefined, { rango: "mes" }));

    expect(agregado.cubos[0].valor).toBeNull();
    expect(agregado.cubos[0].denominador).toBe(0);
  });

  it("y la respuesta del aging tambien sobrevive a JSON.stringify", async () => {
    const agregado = await servicioCon(
      rollupFalso([], ETIQUETAS),
      vivaFalso({
        aging: [
          {
            estatusId: "e-uno",
            zonaId: "z1",
            tiendaId: "t1",
            ordenes: 3,
            segEnEstadoAcum: BigInt("9007199254740993"),
          },
        ],
      }),
    ).consultarAgregado(consultaDe("aging_por_estado", undefined, { rango: "mes" }));

    expect(() => JSON.stringify(agregado)).not.toThrow();
    expect(typeof agregado.cubos[0].numerador).toBe("number");
  });
});
