import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";

import { HOJAS_ETIQUETA, type HojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import { drawEtiqueta } from "@/lib/pdf/etiquetas-dibujo";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { registrarFuente } from "@/lib/pdf/etiquetas-fuente-registro";
import { crearLayout } from "@/lib/pdf/etiquetas-layout";
import { CUERPOS_BASE, CUERPO_MINIMO_PT } from "@/lib/pdf/etiquetas-maqueta";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { fuentesDePagina, textoLegible, textosDePagina } from "./pdf-inspector";

// Feature 350 (T13) — LA CAPACIDAD DECLARADA (R8) Y LA MONOTONIA (R11).
//
// Este es el test que mata el defecto de fondo. Con la maqueta anterior habria
// salido verde POR EMPATE —el cupo era de 10 lineas en las cuatro hojas, y el
// propio test de la 282 presumia de ello— y aqui se exige lo contrario: que la
// capacidad CREZCA estrictamente con el area de la hoja.
//
// Los tres numeros que se declaran por hoja, y que significan:
//
//  · `sinBajarBase`   — el mayor largo de direccion con el que el destinatario
//    conserva su cuerpo base (13 pt). Es la lectura de R11 «sin bajar del cuerpo
//    base» con el cuerpo base ABSOLUTO de la maqueta. Ver la nota de abajo.
//  · `antesDelSuelo`  — el mayor largo con el que NINGUN texto ha llegado
//    todavia al suelo de legibilidad (R8, primera mitad).
//  · `antesDeR7`      — el mayor largo que la etiqueta llega a emitir; uno mas y
//    salta `ErrorEtiquetaNoCabe` (R8, segunda mitad).
//
// Cada numero se comprueba POR SUS DOS LADOS: con ese largo la propiedad se
// cumple, y con UNO MAS deja de cumplirse. Un test que solo comprobara el lado
// bueno pasaria aunque la capacidad real fuese diez veces mayor —o menor sin que
// nadie lo notara—, que es lo que R8 pide impedir: «la verificacion DEBE ponerse
// en rojo si alguna de esas capacidades baja respecto de la declarada».
//
// ⚠️ SOBRE LA LECTURA DE «CUERPO BASE» EN R11, y es un hallazgo de esta ficha:
// si «cuerpo base» se leyera como el cuerpo base YA ESCALADO por `k` (13 · k, es
// decir 29,25 pt en A4), R11 seria ARITMETICAMENTE IMPOSIBLE de satisfacer junto
// con §5.1. Medido: 106 / 699 / 645 (a4) / 538 (carta) — decrece al pasar de
// 4 x 6 in a A4. La causa no es un defecto: con la tipografia proporcional al
// ANCHO, el texto disponible medido en lineas de la celda base sale
// `altoUtil / k`, que depende de la RELACION DE ASPECTO de la hoja (1,57 en
// 4 x 6 in contra 1,44 en A4), no de su area. Con el cuerpo base ABSOLUTO —la
// lectura que se implementa— la monotonia si se cumple, y es la que hace
// verdadera la segunda frase de R11: «un papel mas grande nunca debe dar menos
// capacidad que uno mas pequeño». Queda anotado en `progress/impl_350.md`.

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Texto semilla del que se recortan direcciones de longitud creciente. Es prosa
 * de direccion real (palabras cortas, comas, sin caracteres raros): la FORMA
 * importa tanto como la longitud, y una cadena de «A» daria otra capacidad.
 */
const SEMILLA =
  "Del supermercado La Central de Barrio Escalante, doscientos metros al sur y ciento cincuenta al oeste, casa esquinera de dos plantas color verde agua con porton negro y tapia baja, frente al parqueo del taller de motos, entrada por el callejon sin salida contiguo a la panaderia. ";

/** Los demas campos, en su forma CORTA: se mide la capacidad de la direccion. */
const DESTINATARIO = "Jose Andres Pena";

function direccionDe(largo: number): string {
  return SEMILLA.repeat(Math.ceil((largo + 1) / SEMILLA.length) + 1).slice(0, largo);
}

function dto(direccion: string): EtiquetaGuiaDTO {
  return {
    ordenId: "ord-1",
    numGuia: 19887906,
    numRemision: "REM-2201",
    destinatario: DESTINATARIO,
    telefonoDest: "8888 7777",
    direccion,
    producto: "Caja x2",
    montoCobrar: 18000,
    tiendaNombre: "Tienda Rios",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Mora",
    distritoNombre: "Colon",
    fechaCreacion: "2026-08-25",
    qrValue: "19887906",
    barcodeValue: "19887906",
  };
}

interface Medida {
  emite: boolean;
  cuerpoMin: number;
  cuerpoDestinatario: number;
}

function medir(hoja: HojaEtiqueta, largo: number): Medida {
  const doc = new jsPDF({ unit: "mm", format: [hoja.anchoMm, hoja.altoMm] });
  registrarFuente(doc, fuenteEtiqueta);
  try {
    drawEtiqueta(
      doc,
      crearLayout(hoja),
      dto(direccionDe(largo)),
      { qr: PNG_1X1, barcode: PNG_1X1 },
      fuenteEtiqueta,
    );
  } catch {
    // El unico fallo posible aqui es `ErrorEtiquetaNoCabe` (R7): el resto de
    // datos son fijos y validos. Es la respuesta que se esta midiendo, no un
    // error que se traga: quien llama distingue por `emite`.
    return { emite: false, cuerpoMin: 0, cuerpoDestinatario: 0 };
  }
  const u8 = new Uint8Array(Buffer.from(doc.output("arraybuffer")));
  const fuentes = fuentesDePagina(u8);
  const textos = textosDePagina(u8);
  expect(textos.length, "el PDF no trae texto: la medida no valdria nada").toBeGreaterThan(5);
  const destinatario = textos.find(
    (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === DESTINATARIO,
  );
  expect(destinatario, "no se encontro el destinatario en el PDF").toBeDefined();
  return {
    emite: true,
    cuerpoMin: Math.min(...textos.map((t) => t.tamano)),
    cuerpoDestinatario: destinatario!.tamano,
  };
}

/** La capacidad DECLARADA de cada hoja, medida el 2026-09-01 (R8). */
const CAPACIDAD: Record<string, { sinBajarBase: number; antesDelSuelo: number; antesDeR7: number }> =
  {
    "100x100": { sinBajarBase: 106, antesDelSuelo: 286, antesDeR7: 391 },
    "4x6in": { sinBajarBase: 699, antesDelSuelo: 1266, antesDeR7: 1765 },
    a4: { sinBajarBase: 4115, antesDelSuelo: 6729, antesDeR7: 8864 },
    carta: { sinBajarBase: 3618, antesDelSuelo: 6200, antesDeR7: 7639 },
  };

const PREDICADOS = {
  sinBajarBase: (m: Medida) =>
    m.emite && m.cuerpoDestinatario >= CUERPOS_BASE.destinatario - 1e-9,
  antesDelSuelo: (m: Medida) => m.emite && m.cuerpoMin > CUERPO_MINIMO_PT + 1e-9,
  antesDeR7: (m: Medida) => m.emite,
} as const;

type Metrica = keyof typeof PREDICADOS;

describe("R8 — la capacidad declarada de cada hoja, comprobada por sus dos lados", () => {
  for (const hoja of HOJAS_ETIQUETA) {
    for (const metrica of Object.keys(PREDICADOS) as Metrica[]) {
      it(`${hoja.id} · ${metrica} = ${CAPACIDAD[hoja.id][metrica]} caracteres`, () => {
        const declarada = CAPACIDAD[hoja.id][metrica];
        const predicado = PREDICADOS[metrica];

        expect(
          predicado(medir(hoja, declarada)),
          `${hoja.id}: la capacidad BAJO de la declarada (${metrica} ya no llega a ${declarada} caracteres)`,
        ).toBe(true);

        expect(
          predicado(medir(hoja, declarada + 1)),
          `${hoja.id}: la capacidad SUBIO de la declarada (${metrica} aguanta ${declarada + 1} caracteres o mas; actualiza el numero y anota por que)`,
        ).toBe(false);
      });
    }
  }
});

describe("R11 — mas papel nunca da menos capacidad", () => {
  const porArea = [...HOJAS_ETIQUETA].sort(
    (a, b) => a.anchoMm * a.altoMm - b.anchoMm * b.altoMm,
  );

  it("el orden por area es 100x100 < 4x6in < carta < a4", () => {
    // Se afirma el orden porque de el depende la lectura de las tres siguientes:
    // A4 tiene MAS area que carta aunque sea mas estrecha.
    expect(porArea.map((h) => h.id)).toEqual(["100x100", "4x6in", "carta", "a4"]);
  });

  for (const metrica of Object.keys(PREDICADOS) as Metrica[]) {
    it(`la capacidad «${metrica}» CRECE estrictamente con el area`, () => {
      const valores = porArea.map((h) => CAPACIDAD[h.id][metrica]);
      for (let i = 1; i < valores.length; i++) {
        expect(
          valores[i],
          `${porArea[i].id} (${valores[i]}) da menos capacidad que ${porArea[i - 1].id} (${valores[i - 1]}) teniendo mas papel`,
        ).toBeGreaterThan(valores[i - 1]);
      }
    });
  }

  it("y el salto NO es un empate disimulado: la hoja mayor multiplica la capacidad", () => {
    // La maqueta anterior habria pasado el test de arriba con un `>=`; con `>`
    // habria salido roja por empate exacto (10 lineas en las cuatro hojas). Aqui
    // se exige ademas que el crecimiento sea de otro orden de magnitud.
    expect(CAPACIDAD.a4.antesDeR7).toBeGreaterThan(CAPACIDAD["100x100"].antesDeR7 * 10);
    expect(CAPACIDAD["4x6in"].antesDeR7).toBeGreaterThan(
      CAPACIDAD["100x100"].antesDeR7 * 4,
    );
  });
});

describe("R7/R8 — el peor caso medido y el margen que queda", () => {
  it("la celda base admite 391 caracteres de direccion: 105 mas que el maximo de produccion", () => {
    // El maximo medido en produccion sobre 887 etiquetas es 286 caracteres. Con
    // 391 de capacidad, R7 no se dispara con ningun dato real conocido — y ese
    // es el numero con el que se decide si el fallo visible es teorico o no.
    expect(CAPACIDAD["100x100"].antesDeR7).toBe(391);
    expect(CAPACIDAD["100x100"].antesDeR7 - 286).toBe(105);
  });

  it("uno mas que la capacidad lanza ErrorEtiquetaNoCabe, no una etiqueta recortada", () => {
    const hoja = HOJAS_ETIQUETA[0];
    expect(() =>
      drawEtiqueta(
        (() => {
          const doc = new jsPDF({ unit: "mm", format: [hoja.anchoMm, hoja.altoMm] });
          registrarFuente(doc, fuenteEtiqueta);
          return doc;
        })(),
        crearLayout(hoja),
        dto(direccionDe(CAPACIDAD["100x100"].antesDeR7 + 1)),
        { qr: PNG_1X1, barcode: PNG_1X1 },
        fuenteEtiqueta,
      ),
    ).toThrow(/no cabe en la hoja/);
  });
});
