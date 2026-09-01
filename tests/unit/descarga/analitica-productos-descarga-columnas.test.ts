// FICHA 345 (T8.2) — el CONTRATO del archivo de productos: qué columnas salen y en qué orden.
//
// Cubre R48 (exactamente las columnas declaradas y en el orden declarado) y R51 (`null` es celda
// vacía, jamás `0`).
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
};

describe("FICHA 345 · columnas del archivo de productos (R48)", () => {
  it("las NUEVE claves salen en este orden y no en otro", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.clave)).toEqual([
      "tienda",
      "producto",
      "unidades",
      "ordenes",
      "entregadas",
      "rechazadas",
      "en_proceso",
      "efectividad",
      "rechazo",
    ]);
  });

  it("los NUEVE encabezados salen en este orden y con la unidad dicha donde hace falta", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.encabezado)).toEqual([
      "Tienda",
      "Producto",
      "Unidades",
      "Órdenes",
      "Entregadas",
      "Rechazadas",
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
  it("escribe las nueve celdas con las cifras de `calcularEfectividad`", () => {
    expect(filaDescargaAnaliticaProductos(FILA)).toEqual({
      tienda: "Tienda Uno",
      producto: "Spray Protector",
      unidades: 19,
      ordenes: 16,
      entregadas: 8,
      rechazadas: 6,
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
