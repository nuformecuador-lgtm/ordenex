import { describe, expect, it } from "vitest";

import {
  ESTADOS_BODEGA_SATELITE,
  estadosDelListado,
} from "@/lib/utils/estados-bodega-satelite";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";

// Feature 239 (T1.7, R26, P4 FIRMADA EN CONTRA de la recomendacion del spec el 2026-08-19).
//
// Esta lista es PARCIAL y no rompe el build: si el pre-estado tuviera que entrar y alguien lo
// olvidara, el satelite dejaria de ver en pantalla devoluciones que tiene FISICAMENTE en el
// estante y nada se pondria rojo. Aqui se afirma la decision CONTRARIA —que NO entra— junto con
// su razon, para que quien la cambie tenga que pasar por P4 y no por un `push`.

const PRE_ESTADO = "devolucion_por_confirmar";

describe("ESTADOS_BODEGA_SATELITE — el pre-estado NO entra en el listado (239/P4)", () => {
  it("P4/R26: `devolucion_por_confirmar` NO esta en el listado «Ordenes de la bodega»", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain(PRE_ESTADO);
  });

  it("P4: la lista conserva EXACTAMENTE sus cinco estados y su orden de pantalla", () => {
    // El orden ES la pantalla (el `ORDER BY` del repositorio lo lee de aqui). Un value insertado
    // en medio reordena lo que el adminSatelite ve sin que nadie lo pida.
    expect([...ESTADOS_BODEGA_SATELITE]).toEqual([
      "en_bodega_satelite",
      "por_recoger",
      "por_devolver",
      "devolviendo_a_bodega_central",
      "devuelta",
    ]);
  });

  it("P4: la decision es COHERENTE con el grafo — el pre-estado no tiene recuperacion manual", () => {
    // Las dos cosas van juntas y por eso se afirman juntas: si el pre-estado apareciera en el
    // listado sin arista de `recuperacion_manual`, el adminSatelite veria un boton que no puede
    // funcionar; si tuviera la arista sin aparecer en el listado, tendria una palanca invisible.
    // P4 = no a las dos. El precio (el paquete existe en la bodega y no en el sistema hasta que
    // el cierre se apruebe) esta escrito en `requirements.md`.
    const familias = TRANSICIONES.devolucion_por_confirmar.map((d) => d.via);
    expect(familias).not.toContain("recuperacion_manual");
  });

  it("una seleccion que pida el pre-estado devuelve NADA, no lo cuela en el listado", () => {
    // La interseccion con la lista blanca no puede ampliarla: un `estado` colado por el borde no
    // convierte este listado en una ventana a lo que el satelite no debe operar todavia.
    expect(estadosDelListado([PRE_ESTADO])).toEqual([]);
  });

  it("`devuelta` SIGUE en el listado: una devolucion ya ANCLADA si es suya", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain("devuelta");
  });
});
