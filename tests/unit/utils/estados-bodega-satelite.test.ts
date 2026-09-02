import { describe, expect, it } from "vitest";

import {
  ESTADOS_BODEGA_SATELITE,
  ESTADOS_CUSTODIA_SATELITE,
  ESTADOS_FUERA_DEL_LISTADO_SATELITE,
  alcanceDerivadoDelGrafo,
  estadosDelListado,
} from "@/lib/utils/estados-bodega-satelite";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
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
      "por_recoger",
      "en_reparto",
      "ayuda_tienda",
      "entregada",
      "reprogramada",
      "rechazada",
      "sin_gestionar",
      "incidente",
      "devolucion_por_confirmar",
      "por_devolver",
      "devolviendo_a_bodega_central",
      "devuelta",
      "por_devolver_a_tienda",
      "devolviendo_a_tienda",
      "devuelta_a_tienda",
    ]);

    // Y la promesa concreta: la pantalla GANA filas, no reordena las que ya tenia.
    const posicion = (value: string): number =>
      (ESTADOS_BODEGA_SATELITE as readonly string[]).indexOf(value);
    const losCincoDeSiempre = [
      "en_bodega_satelite",
      "por_recoger",
      "por_devolver",
      "devolviendo_a_bodega_central",
      "devuelta",
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
    for (const desenlace of ["entregada", "rechazada", "reprogramada"]) {
      expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain(desenlace);
    }
  });

  it("`en_reparto` entra: esconder el tramo de la calle es el mismo defecto, mas corto", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain("en_reparto");
  });

  it("235/R37 REVERTIDA: `ayuda_tienda` entra, porque VER no es tener en el estante", () => {
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain("ayuda_tienda");
  });

  it("239/P4 REVERTIDA SOLO EN CUANTO A VER: el pre-estado se lista y SIGUE sin recuperacion manual", () => {
    // Las dos mitades van juntas y por eso se afirman juntas. P4 decidio que el adminSatelite NO
    // puede RECUPERAR A BODEGA una devolucion aun no anclada, y eso NO cambia: el grafo sigue
    // sin la arista. Lo que cambia es que la fila deja de ser invisible mientras espera.
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain("devolucion_por_confirmar");
    const familias = TRANSICIONES.devolucion_por_confirmar.map((d) => d.via);
    expect(familias).not.toContain("recuperacion_manual");
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
    expect(estadosDelListado(["devuelta", "en_bodega_satelite"])).toEqual([
      "en_bodega_satelite",
      "devuelta",
    ]);
  });

  it("una seleccion mixta se queda solo con lo que el contrato admite", () => {
    expect(estadosDelListado(["entregada", "en_bodega_central", "rechazada"])).toEqual([
      "entregada",
      "rechazada",
    ]);
  });
});
