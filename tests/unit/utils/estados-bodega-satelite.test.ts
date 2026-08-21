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

  // Feature 235 (T1.5, R37/R45): misma clase de decision que la de la 239, con otra razon.
  it("235/R37: `ayuda_tienda` NO entra en el listado — el paquete esta en la moto, no en el estante", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain("ayuda_tienda");
    // Y la lista sigue teniendo CINCO: el censo cerrado es lo que delata un value colado.
    expect(ESTADOS_BODEGA_SATELITE).toHaveLength(5);
  });

  it("235/R45 (CASO NEGATIVO): una seleccion que pida `ayuda_tienda` devuelve NADA", () => {
    // La interseccion con la lista blanca no puede ampliarla. Sin este caso, «no esta en la
    // lista» no demostraria que el borde tampoco lo cuela.
    expect(estadosDelListado(["ayuda_tienda"])).toEqual([]);
  });

  it("235: la decision es COHERENTE con el grafo — `ayuda_tienda` no tiene salida a bodega", () => {
    // Igual que con el pre-estado de la 239: si apareciera en el listado sin arista hacia una
    // bodega, el adminSatelite veria una fila sobre la que no puede hacer nada.
    const destinos = TRANSICIONES.ayuda_tienda.map((d) => d.to);
    expect(destinos).not.toContain("en_bodega_satelite");
    expect(destinos).not.toContain("en_bodega_central");
  });
});
