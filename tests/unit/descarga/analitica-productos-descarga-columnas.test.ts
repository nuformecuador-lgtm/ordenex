// FICHA 345 (T8.2) — el CONTRATO del archivo de productos: qué columnas salen y en qué orden.
//
// Cubre R48 (exactamente las columnas declaradas y en el orden declarado) y R51 (`null` es celda
// vacía, jamás `0`).
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
  filaDescargaAnaliticaProductos,
} from "@/app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas";
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
  it("las DIEZ claves salen en este orden y no en otro", () => {
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
      "en_proceso",
      "efectividad",
      "rechazo",
    ]);
  });

  it("los DIEZ encabezados salen en este orden y con la unidad dicha donde hace falta", () => {
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
  it("escribe las diez celdas con las cifras de `calcularEfectividad`", () => {
    expect(filaDescargaAnaliticaProductos(FILA)).toEqual({
      tienda: "Tienda Uno",
      producto: "Spray Protector",
      unidades: 19,
      ordenes: 16,
      entregadas: 8,
      rechazadas: 6,
      // `Spray Protector` no tiene ningún otro desenlace: un CERO legítimo, no una ausencia.
      otros_resultados: 0,
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
