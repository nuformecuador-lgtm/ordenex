// FICHA 345 (T8.2) — el CONTRATO del archivo de productos: qué columnas salen y en qué orden.
//
// Cubre R48 (exactamente las columnas declaradas y en el orden declarado) y R51 (`null` es celda
// vacía, jamás `0`).
//
// FICHA 347 (G1) — las columnas base pasan de DIEZ a ONCE (entra `otros_resultados_detalle`,
// la composicion de R58 como UNA celda de texto) y, para el actor con el dinero concedido, la
// lista es OTRA constante con NUEVE columnas mas (R66/R68). Las dos se afirman a mano, que es
// lo que `columnas-asercion-de-orden.guardia` exige y lo que hace que una permuta duela.
//
// FICHA 346 — las columnas pasan de NUEVE a DIEZ: entra `otros_resultados`, el cubo de los
// desenlaces que no son entrega ni rechazo. Sin él el archivo repetía el defecto de la pantalla
// (`entregadas + rechazadas + en_proceso` se quedaba corto frente a `ordenes`), y en una hoja de
// cálculo es peor: la fila INVITA a sumarse. Las tres listas de abajo se han reescrito a mano,
// que es el precio de que sean contrato.
//
// ⚠ LOS DOS `toEqual` DE ABAJO LLEVAN EL ESPERADO ESCRITO A MANO, y eso NO es un descuido de
// estilo: comparar `COLUMNAS.map((c) => c.clave)` contra otro `COLUMNAS.map(...)` es comparar la
// constante consigo misma y está SIEMPRE verde —una permutación pasaría—. La lección está medida
// en este repo («Aserción contra su propia fuente») y `columnas-asercion-de-orden.guardia` exige
// que la aserción NOMBRE la constante.
import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO,
  columnasDescargaAnaliticaProductos,
  filaDescargaAnaliticaProductos,
  MARCA_NO_SUMABLE_ARCHIVO,
} from "@/app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas";
import type { DineroProductoDTO } from "@/lib/types/conteo-productos";
import type { FilaProductoDTO } from "@/lib/types/conteo-productos";

/** Un status que NO es ninguno de los cinco desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

/**
 * La fila MEDIDA en producción: `Spray Protector`, 16 órdenes y 37,5 % de rechazo. El uuid de la
 * tienda va a propósito con forma de uuid real: es lo que R49 prohíbe que llegue al archivo, y
 * un `"t1"` no lo probaría.
 */
const FILA: FilaProductoDTO = {
  tiendaId: "3f2a1c88-9b40-4d21-8e77-1c0b5a6d2e91",
  tienda: "Tienda Uno",
  producto: "Spray Protector",
  unidades: 19,
  ordenes: 16,
  porStatus: [
    { status: "entregada", conteo: 8 },
    { status: "rechazada", conteo: 6 },
    { status: EN_CURSO, conteo: 2 },
  ],
  ordenesAcompanadas: 0,
  dinero: null,
};

describe("FICHA 345 · columnas del archivo de productos (R48)", () => {
  it("las ONCE claves salen en este orden y no en otro", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.clave)).toEqual([
      "tienda",
      "producto",
      "unidades",
      "ordenes",
      "entregadas",
      "rechazadas",
      // FICHA 346 — entre «rechazadas» y «en proceso»: las tres primeras son órdenes ya
      // resueltas y la cuarta es trabajo vivo.
      "otros_resultados",
      // FICHA 347 (R58) — DE QUÉ se compone la anterior, PEGADA a ella y como UNA sola celda
      // de texto. No hay una columna por desenlace a propósito: con ellas, el día que el
      // catálogo gane uno el archivo cambiaría de número y de orden de columnas, y toda hoja
      // que lo consuma se rompería en silencio.
      "otros_resultados_detalle",
      "en_proceso",
      "efectividad",
      "rechazo",
    ]);
  });

  it("los ONCE encabezados salen en este orden y con la unidad dicha donde hace falta", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.encabezado)).toEqual([
      "Tienda",
      "Producto",
      "Unidades",
      "Órdenes",
      "Entregadas",
      "Rechazadas",
      // FICHA 346 — el MISMO rótulo que la pantalla: el archivo se abre al lado de la tabla y
      // dos nombres para la misma cifra se leen como dos cifras distintas.
      "Otros resultados",
      "Otros resultados (detalle)",
      "En proceso",
      // La unidad va en el encabezado porque la celda lleva PUNTOS, no la fracción.
      "Efectividad de entrega (%)",
      "Rechazo (%)",
    ]);
  });

  it("R49 — ninguna columna es un identificador interno, un correo ni un teléfono", () => {
    const claves = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.clave);
    expect(claves).not.toContain("tienda_id");
    expect(claves).not.toContain("tiendaId");
    expect(claves).not.toContain("id");
  });
});

describe("FICHA 345 · la proyección de una fila", () => {
  it("escribe las once celdas con las cifras de `calcularEfectividad`", () => {
    expect(filaDescargaAnaliticaProductos(FILA)).toEqual({
      tienda: "Tienda Uno",
      producto: "Spray Protector",
      unidades: 19,
      ordenes: 16,
      entregadas: 8,
      rechazadas: 6,
      // `Spray Protector` no tiene ningún otro desenlace: un CERO legítimo, no una ausencia.
      otros_resultados: 0,
      // …y por eso su composición es una celda VACÍA (R54): no hay nada que componer. Es
      // `null` y no `""`, que es como el generador común escribe «celda vacía».
      otros_resultados_detalle: null,
      en_proceso: 2,
      // 8/16 = 0,5 => 50 puntos. 6/16 = 0,375 => 37,5 puntos.
      efectividad: 50,
      rechazo: 37.5,
    });
  });

  it("R49 — el uuid de la tienda NO llega al archivo por ninguna celda", () => {
    const fila = filaDescargaAnaliticaProductos(FILA);
    expect(Object.values(fila).join(" ")).not.toContain(FILA.tiendaId);
    expect(Object.keys(fila)).toEqual(
      COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.clave),
    );
  });

  it("R51 — sin órdenes los dos porcentajes son CELDA VACÍA, nunca 0", () => {
    // Este caso no puede darse hoy (el servicio no emite filas con cero órdenes, R31), y por eso
    // mismo se prueba: es la rama que nadie vería fallar en producción.
    const fila = filaDescargaAnaliticaProductos({ ...FILA, unidades: 0, ordenes: 0, porStatus: [] });

    expect(fila.efectividad).toBeNull();
    expect(fila.rechazo).toBeNull();
    expect(fila.efectividad).not.toBe(0);
    expect(fila.rechazo).not.toBe(0);
  });

  it("un CERO legítimo se escribe 0 y no se confunde con la celda vacía", () => {
    // 29 órdenes y ni un rechazo (`Bálsamo Tensor`, medido). El archivo tiene que decir «0».
    const fila = filaDescargaAnaliticaProductos({
      ...FILA,
      ordenes: 29,
      porStatus: [
        { status: "entregada", conteo: 20 },
        { status: "devuelta", conteo: 5 },
        { status: EN_CURSO, conteo: 4 },
      ],
    });

    expect(fila.rechazo).toBe(0);
    expect(fila.rechazo).not.toBeNull();
  });

  it("el redondeo es a un decimal y determinista", () => {
    // 1 de 3 = 0,3333… => 33.3 (hacia abajo). 2 de 3 = 0,6666… => 66.7 (hacia arriba).
    const unTercio = filaDescargaAnaliticaProductos({
      ...FILA,
      porStatus: [
        { status: "entregada", conteo: 1 },
        { status: "rechazada", conteo: 2 },
      ],
    });
    expect(unTercio.efectividad).toBe(33.3);
    expect(unTercio.rechazo).toBe(66.7);

    // Y son NÚMEROS, no cadenas: una hoja de cálculo con la columna en texto no suma ni ordena.
    expect(typeof unTercio.efectividad).toBe("number");
  });
});

describe("FICHA 346 · la fila del archivo SUMA", () => {
  /**
   * La captura del humano (2026-08-29, `Crema Especial MLX`): 24 órdenes y un desglose que se
   * quedaba en 18. En una hoja de cálculo el defecto es peor que en la pantalla, porque la fila
   * invita a sumarse: quien lo hiciera concluiría que el archivo está mal.
   *
   * El reparto de las seis entre `devuelta` y `reprogramada` NO es dato medido —la captura solo
   * dice que faltan seis— y ninguna aserción depende de él.
   */
  const CREMA: FilaProductoDTO = {
    ...FILA,
    producto: "Crema Especial MLX",
    unidades: 29,
    ordenes: 24,
    porStatus: [
      { status: "entregada", conteo: 3 },
      { status: "rechazada", conteo: 2 },
      { status: "devuelta", conteo: 4 },
      { status: "reprogramada", conteo: 2 },
      { status: EN_CURSO, conteo: 13 },
    ],
  };

  it("los cuatro cubos de la fila dan EXACTAMENTE la celda «ordenes»", () => {
    const fila = filaDescargaAnaliticaProductos(CREMA);

    // 3 + 2 + 6 + 13 = 24. Antes de la ficha 346 esta suma daba 18.
    expect(
      Number(fila.entregadas) +
        Number(fila.rechazadas) +
        Number(fila.otros_resultados) +
        Number(fila.en_proceso),
    ).toBe(fila.ordenes);
    expect(fila.otros_resultados).toBe(6);
  });

  it("y los dos porcentajes de la captura no se mueven", () => {
    const fila = filaDescargaAnaliticaProductos(CREMA);

    // 3/24 = 12,5 puntos. 2/24 = 8,3 puntos (redondeo determinista a un decimal).
    expect(fila.efectividad).toBe(12.5);
    expect(fila.rechazo).toBe(8.3);
  });
});

/* ========================================================================== */
/* FICHA 347 (G1) — el archivo con DINERO                                     */
/* ========================================================================== */

/**
 * Las cifras de dinero de una fila. STRING escala 2, tal y como cruzan la frontera.
 *
 * Los números son los del caso de `design.md §4.1`: `ordenex + tienda === liquidado.recaudado`
 * (R20) y `liquidado.recaudado + pendiente.recaudado === recaudado` (R21). Se escriben aquí ya
 * cuadrados a mano para que el archivo se pruebe con un dato que es posible de verdad.
 */
const DINERO: DineroProductoDTO = {
  recaudado: "45000.00",
  liquidado: {
    recaudado: "35000.00",
    ordenex: "6215.00",
    tienda: "28785.00",
    ordenes: 4,
  },
  pendiente: { recaudado: "10000.00", ordenes: 1 },
  retorno: "2260.00",
};

const FILA_CON_DINERO: FilaProductoDTO = {
  ...FILA,
  ordenesAcompanadas: 3,
  dinero: DINERO,
};

describe("FICHA 347 · columnas del archivo con dinero concedido (R66/R68)", () => {
  it("las VEINTE claves salen en este orden y no en otro", () => {
    // Las once primeras son EXACTAMENTE las de arriba, y en el mismo orden: el archivo de un
    // maestro y el de un rol sin dinero tienen que poder abrirse uno al lado del otro. Las
    // nueve de dinero van al final, en el orden en que se leen: lo recaudado, con cuántas de
    // sus órdenes llevan otro producto; lo liquidado y su reparto; lo pendiente; y el retorno,
    // que va el último porque está FUERA del reparto (R19).
    expect(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.map((c) => c.clave)).toEqual([
      "tienda",
      "producto",
      "unidades",
      "ordenes",
      "entregadas",
      "rechazadas",
      "otros_resultados",
      "otros_resultados_detalle",
      "en_proceso",
      "efectividad",
      "rechazo",
      "recaudado",
      "ordenes_con_otro_producto",
      "liquidado_recaudado",
      "liquidado_ordenes",
      "ordenex",
      "para_la_tienda",
      "pendiente_recaudado",
      "pendiente_ordenes",
      "retorno",
    ]);
  });

  it("los VEINTE encabezados salen en este orden, con la marca de no-sumable donde toca", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.map((c) => c.encabezado)).toEqual([
      "Tienda",
      "Producto",
      "Unidades",
      "Órdenes",
      "Entregadas",
      "Rechazadas",
      "Otros resultados",
      "Otros resultados (detalle)",
      "En proceso",
      "Efectividad de entrega (%)",
      "Rechazo (%)",
      // R49 — LA MARCA VA EN EL ENCABEZADO porque el párrafo de la pantalla NO viaja con el
      // `.xlsx`: quien abre el archivo tres semanas después no tiene delante ninguna
      // advertencia, y una hoja de cálculo invita a arrastrar la columna hasta el pie.
      "Recaudado (no sumar: importe de la orden completa)",
      "Órdenes con otro producto",
      "Recaudado liquidado (no sumar: importe de la orden completa)",
      "Órdenes liquidadas",
      "Cobró Ordenex (no sumar: importe de la orden completa)",
      "Para la tienda (no sumar: importe de la orden completa)",
      "Pendiente de cierre (no sumar: importe de la orden completa)",
      "Órdenes pendientes de cierre",
      "Flete por rechazo (no sumar: importe de la orden completa)",
    ]);
  });

  it("R49 — las SEIS columnas de importe llevan la marca; las de conteo, no", () => {
    // El barrido, para que añadir una columna de dinero sin marca duela aunque el `toEqual` de
    // arriba se hubiera reescrito a la ligera. Las de conteo NO la llevan a propósito: ésas
    // SÍ son aditivas, y marcarlas diría lo contrario de lo que se quiere decir.
    const conMarca = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.filter((c) =>
      c.encabezado.includes(MARCA_NO_SUMABLE_ARCHIVO),
    ).map((c) => c.clave);

    expect(conMarca).toEqual([
      "recaudado",
      "liquidado_recaudado",
      "ordenex",
      "para_la_tienda",
      "pendiente_recaudado",
      // El retorno tambien: es un importe, y ademas uno que esta FUERA del reparto (R19), asi
      // que sumarlo con los otros seria peor todavia.
      "retorno",
    ]);
    expect(conMarca).not.toContain("ordenes_con_otro_producto");
    expect(conMarca).not.toContain("liquidado_ordenes");
    expect(conMarca).not.toContain("pendiente_ordenes");
  });

  it("R66/R67 — el selector devuelve la lista que corresponde a la concesión", () => {
    expect(columnasDescargaAnaliticaProductos(true)).toBe(
      COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO,
    );
    expect(columnasDescargaAnaliticaProductos(false)).toBe(
      COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
    );
  });

  it("R69 — ninguna columna de dinero es un identificador interno", () => {
    const claves = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.map((c) => c.clave);
    expect(claves).not.toContain("tienda_id");
    expect(claves).not.toContain("tiendaId");
    expect(claves).not.toContain("orden_id");
    expect(claves).not.toContain("id");
  });
});

describe("FICHA 347 · la proyección con dinero", () => {
  it("escribe las nueve celdas de dinero con los STRING del servidor, TAL CUAL", () => {
    const fila = filaDescargaAnaliticaProductos(FILA_CON_DINERO, true);

    // Money-safe (R22): el archivo lleva el mismo STRING que cruzó la frontera. Sin `Number`,
    // sin `toFixed` y sin reformatear: la contabilidad necesita la cola de céntimos, y este
    // repo ya perdió un céntimo por una conversión.
    expect(fila.recaudado).toBe("45000.00");
    expect(fila.liquidado_recaudado).toBe("35000.00");
    expect(fila.ordenex).toBe("6215.00");
    expect(fila.para_la_tienda).toBe("28785.00");
    expect(fila.pendiente_recaudado).toBe("10000.00");
    expect(fila.retorno).toBe("2260.00");
    // Y los conteos son NÚMEROS: una hoja con la columna en texto no suma ni ordena, y éstos
    // sí se pueden sumar.
    expect(fila.ordenes_con_otro_producto).toBe(3);
    expect(fila.liquidado_ordenes).toBe(4);
    expect(fila.pendiente_ordenes).toBe(1);
  });

  it("R68 — las claves de la fila son EXACTAMENTE las columnas declaradas, en su orden", () => {
    expect(Object.keys(filaDescargaAnaliticaProductos(FILA_CON_DINERO, true))).toEqual(
      COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.map((c) => c.clave),
    );
  });

  it("R67 — SIN concesión, la fila no lleva NI UNA clave de dinero", () => {
    // No basta con no declarar la columna: el generador común emite exactamente las columnas
    // declaradas, pero una clave sobrante en la fila sería dinero viajando en una estructura
    // que alguien puede volcar. Y la fila del DTO trae dinero: lo que se prueba es que la
    // proyección lo TIRA, no que no lo tuviera.
    const fila = filaDescargaAnaliticaProductos(FILA_CON_DINERO, false);

    expect(Object.keys(fila)).toEqual(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.clave));
    for (const clave of ["recaudado", "ordenex", "para_la_tienda", "retorno"]) {
      expect(Object.keys(fila)).not.toContain(clave);
    }
    // Ni siquiera en cero: R5 prohíbe emitir la cifra «ni recortada, ni agregada, ni en cero».
    expect(Object.values(fila)).not.toContain("45000.00");
  });

  it("R70 — un importe ausente es celda VACÍA, nunca `0`", () => {
    // La fila tiene dinero pero NADA liquidado: `ordenex`, `tienda` y `retorno` llegan `null`
    // del servidor (R30). El archivo tiene que decir «no se sabe», no «fue cero». Es la
    // mutación M6 vista desde el archivo.
    const sinLiquidar = filaDescargaAnaliticaProductos(
      {
        ...FILA_CON_DINERO,
        dinero: {
          recaudado: "10000.00",
          liquidado: { recaudado: "0.00", ordenex: null, tienda: null, ordenes: 0 },
          pendiente: { recaudado: "10000.00", ordenes: 1 },
          retorno: null,
        },
      },
      true,
    );

    expect(sinLiquidar.ordenex).toBeNull();
    expect(sinLiquidar.para_la_tienda).toBeNull();
    expect(sinLiquidar.retorno).toBeNull();
    expect(sinLiquidar.ordenex).not.toBe(0);
    expect(sinLiquidar.ordenex).not.toBe("0.00");
    // Lo que SÍ es un hecho se escribe: lo recaudado existe desde que se registró la gestión.
    expect(sinLiquidar.recaudado).toBe("10000.00");
  });

  it("R70 — una fila SIN ninguna orden que aporte deja las ocho celdas de dinero vacías", () => {
    // `fila.dinero === null` es el tercer camino a la ausencia (esa fila no tiene ni una orden
    // que aporte). Se escribe igual que los otros dos, y por el mismo motivo.
    const sinDinero = filaDescargaAnaliticaProductos({ ...FILA_CON_DINERO, dinero: null }, true);

    for (const clave of [
      "recaudado",
      "liquidado_recaudado",
      "liquidado_ordenes",
      "ordenex",
      "para_la_tienda",
      "pendiente_recaudado",
      "pendiente_ordenes",
      "retorno",
    ]) {
      expect(sinDinero[clave], clave).toBeNull();
    }
    // `ordenes_con_otro_producto` NO es dinero: sale del lado del volumen y siempre existe.
    expect(sinDinero.ordenes_con_otro_producto).toBe(3);
  });

  it("R58 — la composición de «Otros resultados» sale en UNA celda de texto", () => {
    const fila = filaDescargaAnaliticaProductos(
      {
        ...FILA_CON_DINERO,
        porStatus: [
          { status: "entregada", conteo: 3 },
          { status: "devuelta", conteo: 4 },
          { status: "reprogramada", conteo: 2 },
        ],
      },
      true,
    );

    expect(fila.otros_resultados).toBe(6);
    expect(fila.otros_resultados_detalle).toBe("4 devueltas · 2 reprogramadas");
    // Y NO hay una columna por desenlace: ni `devuelta`, ni `reprogramada`, ni `incidente`.
    const claves = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.map((c) => c.clave);
    expect(claves).not.toContain("devuelta");
    expect(claves).not.toContain("reprogramada");
    expect(claves).not.toContain("incidente");
  });
});
