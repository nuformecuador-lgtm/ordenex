import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA,
  LIMITACION_ULTIMO_CUBO_EN_CURSO,
  filaDescargaAnaliticaFinanciera,
  type ContextoExportFinanciero,
} from "@/app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas";
import { filasDeVistaFinanciera } from "@/app/(app)/analitica/_components/export-financiero/export-financiero";
import type { FilaFinanciera } from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";

import { dtoTemporalConNeto, MONEDA_DE_FIXTURE } from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T2.3). R11, R17 y R18.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// COMO SE MIDE «PROCEDE DE UN CAMPO DEL DTO», que es lo unico dificil de R11: se proyecta DOS
// veces con dos DTO cuyos campos son TODOS distintos, y se mira que celdas NO cambiaron. Una
// celda que sobrevive intacta a cambiar el DTO entero no puede proceder de el. El caso afirma
// que hay EXACTAMENTE UNA y la NOMBRA (`limitacion_conocida`, D3): si apareciera una segunda
// —un rotulo de ambito, una constante de contexto— el caso falla. **La excepcion es de una
// celda, no una puerta.**

/** Dos contextos y dos filas SIN un solo campo en comun: es lo que hace medible R11. */
const CONTEXTO_A: ContextoExportFinanciero = {
  etiqueta: "etiqueta-de-la-metrica-A",
  granularidad: "grano-declarado-A",
  esAcumulado: false,
};
const FILA_A: FilaFinanciera = {
  cubo: "cubo-A",
  importe: importeConNeto("11.11", "22.22", "moneda-A"),
};

const CONTEXTO_B: ContextoExportFinanciero = {
  etiqueta: "etiqueta-de-la-metrica-B",
  granularidad: "grano-declarado-B",
  esAcumulado: true,
};
const FILA_B: FilaFinanciera = {
  cubo: "cubo-B",
  importe: importeConNeto("33.33", "44.44", "moneda-B"),
};

describe("Feature 184 — analitica financiera: export de la serie (R11) · el origen de cada celda", () => {
  it("toda celda del archivo procede de un campo del DTO salvo la limitacion declarada", () => {
    const filaA = filaDescargaAnaliticaFinanciera(CONTEXTO_A)(FILA_A);
    const filaB = filaDescargaAnaliticaFinanciera(CONTEXTO_B)(FILA_B);

    // (1) El archivo emite EXACTAMENTE las columnas declaradas, en su orden. Una columna nueva
    // —«Tienda (nombre)», por ejemplo, que exigiria consultar un catalogo— rompe esto.
    expect(Object.keys(filaA)).toEqual(
      COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.map((columna) => columna.clave),
    );
    expect(Object.keys(filaB)).toEqual(Object.keys(filaA));

    // (2) Las celdas que NO cambiaron al cambiar el DTO entero: son las que no proceden de el.
    const constantes = Object.keys(filaA).filter((clave) => filaA[clave] === filaB[clave]);
    expect(
      constantes,
      "solo `limitacion_conocida` puede llevar texto propio (D3, y R11 la nombra como excepcion UNICA). " +
        "Una segunda celda constante seria una cabecera de metadatos empezando por su primera piedra.",
    ).toEqual(["limitacion_conocida"]);

    // (3) Y la exenta lleva el texto declarado, no cualquier constante.
    expect(filaA.limitacion_conocida).toBe(LIMITACION_ULTIMO_CUBO_EN_CURSO);

    // (4) Contrapeso: el resto SI proviene del DTO, campo a campo. Sin esto, (2) pasaria igual
    // con una proyeccion que emitiera basura distinta en cada llamada.
    expect(filaA.periodo).toBe(FILA_A.cubo);
    expect(filaA.grano).toBe(CONTEXTO_A.granularidad);
    expect(filaA.metrica).toBe(CONTEXTO_A.etiqueta);
    expect(filaA.bruto).toBe(FILA_A.importe.bruto);
    expect(filaA.moneda).toBe(FILA_A.importe.moneda);
  });

  it("ninguna celda resuelve un identificador a un nombre ni consulta un catalogo", () => {
    // La otra mitad de R11: el `cubo` viaja LITERAL. No se traduce, no se acorta y no se
    // enriquece. Resolver ids a nombres es la ficha 181, y meteria acceso a datos en una
    // feature de presentacion.
    const datos = dtoTemporalConNeto();
    const [vista] = datos.vistas;
    const filas = filasDeVistaFinanciera(datos, vista!);
    expect(filas.map((fila) => fila.periodo)).toEqual(vista!.filas.map((fila) => fila.cubo));
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R17) · la moneda sale del importe", () => {
  it("la moneda de cada fila sale del importe y no de un literal", () => {
    // La fixture usa un codigo DISTINTO del de produccion a proposito: un codigo ISO escrito a
    // mano en la proyeccion pasaria desapercibido contra una fixture que usara el real.
    const datos = dtoTemporalConNeto();
    const [vista] = datos.vistas;
    const filas = filasDeVistaFinanciera(datos, vista!);

    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      expect(fila.moneda).toBe(MONEDA_DE_FIXTURE);
    }
    // Y la moneda de CADA fila sale de SU importe, no de la primera ni del total.
    const otra = filaDescargaAnaliticaFinanciera(CONTEXTO_A)({
      cubo: "cubo-con-otra-moneda",
      importe: importeConNeto("1.00", "1.00", "otra-moneda-distinta"),
    });
    expect(otra.moneda).toBe("otra-moneda-distinta");
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R18) · el dinero viaja literal", () => {
  it("el importe se escribe literal, sin conversion a number ni reformateo", () => {
    // D2 — cadena de escala 2, TAL CUAL. La cifra elegida esta por encima de 2^53: si alguien
    // proyectara con `aNumero(...)` (o con `Number`, o con `toFixed`), el valor CAMBIA aqui.
    const enorme = "90071992547409919.99";
    const negativo = "-1234567.05";
    const fila = filaDescargaAnaliticaFinanciera(CONTEXTO_A)({
      cubo: "cubo-de-la-cifra-enorme",
      importe: importeConNeto(enorme, negativo, "moneda-A"),
    });

    expect(fila.bruto).toBe(enorme);
    expect(fila.neto).toBe(negativo);
    // Y siguen siendo CADENAS: un `number` aqui abriria la segunda frontera del dinero, cuya
    // respuesta al no finito (`null`) se leeria en el archivo como «no se sabe».
    expect(typeof fila.bruto).toBe("string");
    expect(typeof fila.neto).toBe("string");
    // Sin separador de miles y sin reformateo: el texto es identico al del DTO.
    expect(String(fila.bruto)).not.toMatch(/[,\s]/);

    // SANIDAD DEL CENTINELA: sin esto, el caso pasaria igual con una cifra pequeña, donde
    // convertir a `number` y volver no pierde nada y la mutacion seguiria en verde.
    expect(String(Number(enorme))).not.toBe(enorme);
  });
});
