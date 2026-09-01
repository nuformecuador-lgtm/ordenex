// @vitest-environment jsdom
//
// FICHA 347 (G3) — GUARDIA: la columna de dinero de la tabla de productos NO SE SUMA (R46/R47),
// y esta guardia SE AUTOCOMPRUEBA (R48).
//
// ─── POR QUE ESTO NO ES UNA COMPROBACION DE ESTILO ──────────────────────────────────────────
//
// El importe COMPLETO de una orden se atribuye a CADA producto que contiene, porque el precio
// unitario NO EXISTE en ninguna parte del sistema —`orden.producto` solo trae `cantidad *
// nombre`— y el 12 % de las ordenes de produccion lleva varios. Es la decision del humano, con
// su medicion detras (`design.md §12/A2` y `A3`).
//
// La consecuencia es que **un total al pie de esa columna cuenta la misma plata varias veces**.
// No daria un error, no rompería ninguna invariante y no se veria roto: daria un numero mayor
// que el real, con aspecto de cifra firme, en una pantalla de dinero. Es exactamente la clase
// de defecto que este repo llama «fallo mudo», y por eso R47 exige que introducirlo ponga algo
// en ROJO en vez de confiar en que alguien recuerde la regla.
//
// ─── LAS TRES MITADES, Y QUE APORTA CADA UNA ────────────────────────────────────────────────
//
//  (a) ESTATICA. Barre la FUENTE de la tabla —sin comentarios, porque esos NOMBRAN a proposito
//      lo que esta prohibido— buscando las formas de escribir un total y las cuatro llamadas
//      que pierden un centimo. Es barata y atrapa el intento evidente.
//  (b) DINAMICA, que es la que de verdad muerde. RENDERIZA la tabla con tres importes elegidos
//      para que su suma sea un numero que no aparece en ninguna otra parte, y afirma que ese
//      numero NO ESTA EN EL DOM. Da igual como se escriba el total —`<tfoot>`, una fila mas,
//      un `<caption>`, un parrafo debajo—: si el numero aparece, cae.
//  (c) AUTOCOMPROBACION (R48). Los dos predicados se aplican ademas a material sintetico que SI
//      infringe, y tienen que detectarlo. Sin esto, un detector roto pasa VERDE para siempre:
//      encuentra cero infracciones porque no busca nada. Este repo ya se lo comio una vez.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";

import { ProductosTabla } from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { FiltroEntregasProvider } from "@/app/(app)/_components/filtro-entregas";
import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import { money } from "@/lib/config/moneda";
import { ToastProvider } from "@/providers/ToastProvider";
import type { ConteoProductosDTO, FilaProductoDTO } from "@/lib/types/conteo-productos";
import { codigoSinComentarios, LLAMADAS_PROHIBIDAS_EN_DINERO } from "@/tests/fixtures/money-safe";

vi.mock("@/lib/actions/conteo-productos", () => ({
  consultarConteoProductos: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoProductos);

/** Los archivos de la ficha por los que pasa un importe. */
const FUENTES_CON_DINERO = [
  "app/(app)/analitica/_components/entregas/ProductosTabla.tsx",
  "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx",
  "app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts",
];

/**
 * La fuente de un archivo del repo, YA sin comentarios.
 *
 * ⚠ SIN COMENTARIOS, Y NO ES UN DETALLE: los docstrings de esta ficha NOMBRAN a proposito lo
 * que esta prohibido («no hay ni un `<tfoot>`», «prohibido `Number(`»), asi que un barrido
 * sobre el texto crudo fallaria por CITARLO. Se persigue la LLAMADA, no la palabra.
 */
function fuenteSinComentarios(relativa: string): string {
  return codigoSinComentarios(relativa);
}

/* ========================================================================== */
/* (a) el predicado ESTATICO                                                  */
/* ========================================================================== */

/**
 * Las formas de escribir un total al pie de una tabla en este arbol.
 *
 * `<tfoot` es la del HTML; `totalizar(`/`sumarColumna(` son los nombres que tendria una funcion
 * escrita para ello; y `reduce(` sobre una clave de dinero es la forma que tomaria si alguien
 * lo montara inline. Se persigue la LLAMADA o la ETIQUETA, nunca la palabra suelta: este mismo
 * archivo y los docstrings de la tabla las NOMBRAN a proposito.
 */
const FORMAS_DE_TOTAL: readonly RegExp[] = [
  /<tfoot[\s>]/,
  /\btotalizar\s*\(/,
  /\bsumarColumna\s*\(/,
  // Un acumulador sobre cualquiera de las claves de dinero del DTO. La ventana de 120
  // caracteres ATRAVIESA parentesis a proposito: el cuerpo de un acumulador empieza siempre por
  // `(acc, fila)`, asi que una expresion que se parase en el primer `)` no llegaria nunca al
  // nombre del campo y el detector estaria de adorno. `reduce` sobre `filas` para contar
  // ORDENES no cae aqui: la expresion exige que dentro aparezca una clave de IMPORTE.
  /\breduce\s*\([\s\S]{0,120}?\b(recaudado|ordenex|liquidado|pendiente|retorno)\b/,
];

/** Devuelve las infracciones del predicado estatico sobre un codigo YA sin comentarios. */
function totalesEnFuente(codigo: string): string[] {
  return FORMAS_DE_TOTAL.filter((re) => re.test(codigo)).map((re) => re.source);
}

/** Devuelve las llamadas prohibidas sobre dinero que aparecen en un codigo sin comentarios. */
function llamadasProhibidas(codigo: string): string[] {
  return LLAMADAS_PROHIBIDAS_EN_DINERO.filter((re) => re.test(codigo)).map((re) => re.source);
}

describe("FICHA 347 · (a) la fuente de la tabla no escribe ningún total (R46/R47)", () => {
  it.each(FUENTES_CON_DINERO)("`%s` no contiene ninguna forma de total al pie", (relativa) => {
    expect(totalesEnFuente(fuenteSinComentarios(relativa))).toEqual([]);
  });

  it.each(FUENTES_CON_DINERO)("`%s` es money-safe: ni una de las cuatro llamadas", (relativa) => {
    // R22 — `Number(`, `parseFloat(`, `parseInt(` y `.toFixed(` sobre un importe. Un
    // `DECIMAL(12,2)` de once dígitos no cabe exacto en un `number`, y este repo ya perdió un
    // céntimo por una conversión (feature 204).
    expect(llamadasProhibidas(fuenteSinComentarios(relativa))).toEqual([]);
  });

  it("(c) AUTOCOMPROBACIÓN — el predicado estático detecta un total introducido a propósito", () => {
    // ⚠ SIN ESTE CASO LA MITAD (a) ESTARÍA VERDE POR VACÍO, que es el modo de fallo que este
    // árbol ha visto tres veces: un detector roto no encuentra infracciones porque no busca
    // nada, y se queda de adorno para siempre.
    const conTfoot = `
      function Tabla() {
        return <table><tbody /><tfoot><tr><td>{total}</td></tr></tfoot></table>;
      }
    `;
    const conTotalizar = "const pie = totalizar(filas.map((f) => f.dinero));";
    const conReduce = "const suma = filas.reduce((n, f) => n + f.dinero.recaudado, 0);";

    expect(totalesEnFuente(conTfoot)).not.toEqual([]);
    expect(totalesEnFuente(conTotalizar)).not.toEqual([]);
    expect(totalesEnFuente(conReduce)).not.toEqual([]);
    // Y no marca lo que NO es un total: un acumulador de CONTEOS es legítimo y aditivo.
    expect(totalesEnFuente("const n = filas.reduce((n, f) => n + f.ordenes, 0);")).toEqual([]);
  });

  it("(c) AUTOCOMPROBACIÓN — el barrido money-safe detecta una conversión introducida", () => {
    expect(llamadasProhibidas("const x = Number(fila.dinero.recaudado);")).not.toEqual([]);
    expect(llamadasProhibidas("const x = parseFloat(fila.dinero.recaudado);")).not.toEqual([]);
    expect(llamadasProhibidas("const x = importe.toFixed(2);")).not.toEqual([]);
    // Y NO marca `Number.isFinite`, que no convierte nada y vive en el cálculo de porcentajes.
    expect(llamadasProhibidas("if (!Number.isFinite(f)) return null;")).toEqual([]);
  });
});

/* ========================================================================== */
/* (b) la mitad DINÁMICA                                                      */
/* ========================================================================== */

/**
 * LOS TRES IMPORTES, elegidos para que sus sumas sean números que NO aparecen en ninguna otra
 * parte de la pantalla: 1.000 + 200 + 30 = 1.230 para lo recaudado, 100 + 20 + 3 = 123 para lo
 * de Ordenex y 900 + 180 + 27 = 1.107 para lo de la tienda.
 *
 * Ninguna de las tres sumas es subcadena de ninguno de los nueve importes pintados, así que si
 * el texto aparece en el DOM sólo puede venir de alguien que los haya sumado.
 */
const IMPORTES = [
  { recaudado: "1000.00", ordenex: "100.00", tienda: "900.00" },
  { recaudado: "200.00", ordenex: "20.00", tienda: "180.00" },
  { recaudado: "30.00", ordenex: "3.00", tienda: "27.00" },
] as const;

/** Las tres sumas prohibidas, YA formateadas como las pintaría la pantalla. */
const SUMAS_PROHIBIDAS = [money("1230.00"), money("123.00"), money("1107.00")];

function fila(i: number): FilaProductoDTO {
  const importe = IMPORTES[i];
  return {
    tiendaId: `t${i}`,
    tienda: "Tienda Uno",
    producto: `Producto ${i}`,
    unidades: 1,
    ordenes: 1,
    porStatus: [{ status: "entregada", conteo: 1 }],
    ordenesAcompanadas: 0,
    dinero: {
      recaudado: importe.recaudado,
      liquidado: {
        recaudado: importe.recaudado,
        ordenex: importe.ordenex,
        tienda: importe.tienda,
        ordenes: 1,
      },
      pendiente: { recaudado: "0.00", ordenes: 0 },
      retorno: null,
    },
  };
}

function datos(): ConteoProductosDTO {
  return {
    filas: [fila(0), fila(1), fila(2)],
    ordenes: 3,
    ordenesSinProducto: 0,
    dinero: { estado: "concedido" },
    lastSync: "2026-09-01T18:30:00.000Z",
  };
}

/** El predicado DINÁMICO: qué sumas prohibidas aparecen en un texto. */
function sumasEnTexto(texto: string): string[] {
  return SUMAS_PROHIBIDAS.filter((suma) => texto.includes(suma));
}

const MATCH_MEDIA_REAL = window.matchMedia;

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = MATCH_MEDIA_REAL;
});
afterEach(cleanup);

function renderTabla() {
  return render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        React.createElement(
          FiltroEntregasProvider,
          null,
          React.createElement(ProductosTabla, { dinero: true }),
        ),
      ),
    ),
  );
}

describe("FICHA 347 · (b) la tabla renderizada no contiene NINGUNA suma de la columna (R47)", () => {
  it("con tres importes en pantalla, su suma NO está en el DOM", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos() });
    renderTabla();

    await screen.findByText("Producto 0");
    // Los tres importes SÍ están: si no, este caso pasaría por no haber pintado nada.
    for (const importe of IMPORTES) {
      expect(document.body.textContent).toContain(money(importe.recaudado));
    }

    expect(sumasEnTexto(document.body.textContent ?? "")).toEqual([]);
  });

  it("R46 — y no hay `<tfoot>` en el DOM de la tabla de productos", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos() });
    renderTabla();

    // El ancla es el CONTENIDO —el nombre del primer producto—, no un conteo de nodos: durante
    // la carga la tabla también tiene `<thead>` y su fila `role="status"`, así que esperar «que
    // haya cero `<tfoot>`» se cumpliría a media carga y el caso pasaría sin haber pintado nada.
    // Lo vigila `tests/unit/guards/ancla-de-carga.guardia.test.ts`, y este caso se vio caer en
    // él antes de escribirlo así.
    await screen.findByText("Producto 2");
    expect(document.querySelectorAll("tfoot")).toHaveLength(0);
  });

  it("(c) AUTOCOMPROBACIÓN — el predicado dinámico detecta el total si alguien lo pinta", () => {
    // ⚠ ÉSTA ES LA MITAD QUE HACE QUE (b) VALGA ALGO. El mismo predicado, sobre el texto que
    // dejaría en el DOM un pie de columna escrito a mano. Si mañana alguien añade el total, el
    // caso de arriba cae exactamente así.
    const domConTotal = `Producto 0 ${money("1000.00")} … Total ${money("1230.00")}`;

    expect(sumasEnTexto(domConTotal)).toEqual([money("1230.00")]);
    // Y no se dispara con el texto legítimo: los tres importes solos no son ninguna suma.
    expect(sumasEnTexto(IMPORTES.map((i) => money(i.recaudado)).join(" "))).toEqual([]);
  });
});
