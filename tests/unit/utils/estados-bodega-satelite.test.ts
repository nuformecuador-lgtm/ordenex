import { describe, expect, it } from "vitest";

import {
  ESTADOS_BODEGA_SATELITE,
  ESTADOS_CUSTODIA_SATELITE,
  ESTADOS_FUERA_DEL_LISTADO_SATELITE,
  alcanceDerivadoDelGrafo,
  estadosDelListado,
} from "@/lib/utils/estados-bodega-satelite";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

/**
 * FICHA 357 — EL CONTRATO DE ESTADOS DE LA BODEGA SATELITE.
 *
 * Este archivo custodiaba antes la decision CONTRARIA: que el listado tenia CINCO estados y que
 * `devolucion_por_confirmar` (239/P4) y `ayuda_tienda` (235/R37) NO entraban «porque el paquete
 * no esta en el estante». La ficha 357 cambia la PREMISA —el listado deja de ser «lo que tengo
 * guardado» y pasa a ser «el recorrido de mis ordenes, de principio a fin»—, asi que las tres
 * exclusiones se revierten y aqui se afirma la lista nueva, con su derivacion y con lo que la
 * reversion NO toca (que es la parte delicada: P4 seguia siendo una firma del humano).
 *
 * Lo que se comprueba, en orden de importancia:
 *
 *  1. la lista literal es EXACTAMENTE el cierre del grafo menos las podas declaradas (las dos
 *     direcciones): ni ofrece un estado inalcanzable, ni esconde uno alcanzable;
 *  2. los estados que quedan fuera lo estan por una razon escrita, no por olvido;
 *  3. la seleccion del filtro INTERSECA y nunca amplia;
 *  4. la evidencia de alcance (`ESTADOS_CUSTODIA_SATELITE`) es OTRA lista, y no puede
 *     confundirse con la de la pantalla.
 */

const CATALOGO: readonly string[] = ORDER_STATUS_SEED.map((estado) =>
  typeof estado === "string" ? estado : (estado as { value: string }).value,
);

describe("FICHA 357 · ESTADOS_BODEGA_SATELITE es el cierre del grafo, no una lista de deseos", () => {
  it("la lista literal y el cierre derivado del grafo coinciden EXACTAMENTE (las dos direcciones)", () => {
    // Esta es la afirmacion que impide las dos formas de equivocarse: ofrecer un estado al que
    // una orden de la satelite no puede llegar (filtro que siempre da cero, el defecto de la
    // 355) y esconder uno al que si (el defecto de la cara A).
    const derivado = alcanceDerivadoDelGrafo();
    expect(new Set(ESTADOS_BODEGA_SATELITE)).toEqual(derivado);
    expect(ESTADOS_BODEGA_SATELITE).toHaveLength(derivado.size);
  });

  it("el orden ES la pantalla, y los cinco estados de siempre conservan su orden relativo", () => {
    // El `ORDER BY` del repositorio lee este orden (`array_position`). Un value insertado en
    // medio reordena lo que el adminSatelite ve sin que nadie lo pida — por eso el censo va
    // literal y completo.
    expect([...ESTADOS_BODEGA_SATELITE]).toEqual([
      "en_bodega_satelite",
      "mensajero_recogiendo_en_bodega",
      "en_reparto",
      // ⏳ 2026-09-23 (FICHA 454, R37): aqui iba `ayuda_tienda`, y abajo `devolucion_por_confirmar`.
      // Salen del catalogo; la orden con ayuda abierta o gestion pendiente esta en `en_reparto`.
      "entregado",
      "reprogramado",
      "devolucion_a_origen_por_rechazo",
      "novedad_interna",
      "incidente",
      "por_devolver_a_bodega_central",
      "devolviendo_a_bodega_central",
      "novedad",
      "por_devolver_a_tienda",
      "devolviendo_a_tienda",
      "devuelta_a_tienda",
    ]);

    // Y la promesa concreta: la pantalla GANA filas, no reordena las que ya tenia.
    const posicion = (value: string): number =>
      (ESTADOS_BODEGA_SATELITE as readonly string[]).indexOf(value);
    const losCincoDeSiempre = [
      "en_bodega_satelite",
      "mensajero_recogiendo_en_bodega",
      "por_devolver_a_bodega_central",
      "devolviendo_a_bodega_central",
      "novedad",
    ];
    const posiciones = losCincoDeSiempre.map(posicion);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
    expect(posiciones).not.toContain(-1);
  });

  it("los estados que quedan FUERA son los del catalogo que no alcanza el cierre, y solo esos", () => {
    const fuera = CATALOGO.filter(
      (value) => !(ESTADOS_BODEGA_SATELITE as readonly string[]).includes(value),
    );
    // Los seis: los cinco de custodia de la central / la recoleccion en tienda, mas
    // `en_ruta_bodega_satelite`, que es evidencia de alcance pero tiene pantalla propia.
    expect(new Set(fuera)).toEqual(new Set(ESTADOS_FUERA_DEL_LISTADO_SATELITE));
    expect(fuera).toHaveLength(6);
  });

  it("`en_ruta_bodega_satelite` es EVIDENCIA de alcance y a la vez NO es un estado del listado", () => {
    // Las dos listas existen precisamente porque estas dos cosas son distintas. Confundirlas es
    // lo que haria que las «Por recibir» aparecieran en dos pantallas a la vez.
    expect(ESTADOS_CUSTODIA_SATELITE as readonly string[]).toContain("en_ruta_bodega_satelite");
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain(
      "en_ruta_bodega_satelite",
    );
    expect(ESTADOS_FUERA_DEL_LISTADO_SATELITE as readonly string[]).toContain(
      "en_ruta_bodega_satelite",
    );
  });

  it("la evidencia son DOS estados y los dos existen en el catalogo", () => {
    expect([...ESTADOS_CUSTODIA_SATELITE]).toEqual([
      "en_ruta_bodega_satelite",
      "en_bodega_satelite",
    ]);
    for (const value of ESTADOS_CUSTODIA_SATELITE) expect(CATALOGO).toContain(value);
  });
});

describe("FICHA 357 · las tres exclusiones que se revierten, y lo que NO se toca", () => {
  it("(cara A) los desenlaces que la bodega perdia de vista SI estan en el listado", () => {
    // Las 17 ordenes invisibles de produccion estaban repartidas en estos tres estados: 15
    // `entregada`, 1 `rechazada` (la guia 66840050 del reporte) y 1 `reprogramada`.
    for (const desenlace of ["entregado", "devolucion_a_origen_por_rechazo", "reprogramado"]) {
      expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain(desenlace);
    }
  });

  it("`en_reparto` entra: esconder el tramo de la calle es el mismo defecto, mas corto", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain("en_reparto");
  });

  // ⏳ 2026-09-23 (FICHA 454, R37): aqui vivian «235/R37 REVERTIDA: `ayuda_tienda` entra» y
  // «239/P4 REVERTIDA SOLO EN CUANTO A VER: el pre-estado se lista». La intencion de la 357 —que la
  // satelite VEA la orden mientras espera— se cumple ahora por `en_reparto`, que es donde esta una
  // orden con ayuda abierta o con su gestion pendiente de confirmar (caso de arriba). Lo que se
  // afirma aqui es que los dos estados retirados ya no se ofrecen.
  it("454/R37: los dos estados retirados ya no estan en el listado de la satelite", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain("ayuda_tienda");
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain("devolucion_por_confirmar");
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain("en_reparto");
  });

  it("la reversion de cualquiera de las tres es UN solo sitio, y las dos listas no pueden divergir", () => {
    // Mover un value de `ESTADOS_BODEGA_SATELITE` a `ESTADOS_FUERA_DEL_LISTADO_SATELITE` es la
    // vuelta atras documentada. Aqui se afirma que las dos listas son DISJUNTAS: si alguien
    // añadiera el value a la poda sin quitarlo del listado, esto se pone rojo en vez de dejar
    // dos verdades a la vez.
    const listado = new Set<string>(ESTADOS_BODEGA_SATELITE);
    for (const value of ESTADOS_FUERA_DEL_LISTADO_SATELITE) {
      expect(listado.has(value)).toBe(false);
    }
  });
});

describe("FICHA 357 · el filtro INTERSECA, nunca amplia", () => {
  it("sin seleccion devuelve el contrato entero, en el orden canonico", () => {
    expect(estadosDelListado()).toEqual([...ESTADOS_BODEGA_SATELITE]);
    expect(estadosDelListado([])).toEqual([...ESTADOS_BODEGA_SATELITE]);
  });

  it("una seleccion fuera del contrato devuelve NADA, no cae a «todos»", () => {
    // La diferencia importa: si la interseccion vacia cayera a «todos», un `estado` colado por
    // el borde ampliaria el listado en vez de vaciarlo — justo lo contrario de lo que protege.
    expect(estadosDelListado(["en_bodega_central"])).toEqual([]);
    expect(estadosDelListado(["en_ruta_bodega_satelite"])).toEqual([]);
    expect(estadosDelListado(["un_estado_inventado"])).toEqual([]);
  });

  it("el resultado sale en el orden canonico aunque la seleccion llegue al reves", () => {
    expect(estadosDelListado(["novedad", "en_bodega_satelite"])).toEqual([
      "en_bodega_satelite",
      "novedad",
    ]);
  });

  it("una seleccion mixta se queda solo con lo que el contrato admite", () => {
    expect(estadosDelListado(["entregado", "en_bodega_central", "devolucion_a_origen_por_rechazo"])).toEqual([
      "entregado",
      "devolucion_a_origen_por_rechazo",
    ]);
  });
});
