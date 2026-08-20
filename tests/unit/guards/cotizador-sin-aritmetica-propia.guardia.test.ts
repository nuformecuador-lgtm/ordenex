import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 248 — GUARDIA: EL COTIZADOR NO TIENE ARITMETICA MONETARIA PROPIA (T7, cubre R23).
//
// INVARIANTE QUE FIJA: `CotizadorService` deriva TODOS los conceptos de los dos escenarios
// llamando a `derivarIngresoOrden` de `lib/utils/ingreso-ordenex.ts` —con `resultado:
// "entregada"` y con `resultado: "devuelta"`— y NO reproduce esas formulas por su cuenta.
//
// EL PORQUE ESTA MEDIDO, NO OPINADO. `lib/utils/ingreso-ordenex.ts:121-146` documenta que la
// version que reimplementaba estas mismas formulas en el navegador desviaba UN CENTIMO EN 14 DE
// 66 ORDENES REALES, y que en el caso del monto 16 618,40 no era un problema de binario sino
// OTRA FORMULA (le faltaba un redondeo intermedio). El cotizador enseña dinero que la tienda
// comparara contra su cierre: una divergencia de un centimo hace que la misma plata se lea
// distinta segun por donde se mire. La paridad digito a digito se afirma aparte
// (`tests/unit/services/CotizadorService.paridad-cierre.test.ts`, R24); esta guardia cierra la
// puerta por la que esa paridad se rompe: que alguien "aclare" el codigo escribiendo la formula.
//
// LAS DOS UNICAS OPERACIONES NUEVAS PERMITIDAS, y estan permitidas porque se construyen SOBRE el
// derivado YA REDONDEADO, no al lado de la formula que lo produjo:
//
//   · `.mul(cantidad)` — T5.3/R26: el total por N es el unitario ya redondeado x N;
//   · `.neg()`         — T5.2/R21: el neto de DEVUELTA niega lo que `derivarIngresoOrden` ya
//                        devolvio; la negacion es lo unico nuevo.
//
// Se admite ademas `.plus(` para cerrar los dos `costoTotal`: sumar conceptos YA REDONDEADOS es
// exactamente lo que el cierre hace (`agregarIngresosPorConcepto`, `ingreso-ordenex.ts:285-308`)
// y no reproduce ninguna derivacion. Lo que esta guardia persigue son las DERIVACIONES: aplicar
// porcentajes, dividir entre 100, multiplicar por 1,13 y cualquier salto a `number`.
//
// ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO: no mira `git diff` contra `origin/dev`. Una
// guardia que mide el diff de una rama CADUCA en cuanto la rama se mergea y pasa a juzgar el
// trabajo de cualquier rama posterior (leccion ya pagada:
// `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:22-26`). Aqui se mide la PROPIEDAD
// sobre el fuente, y ninguna asercion depende de la rama en la que se ejecute.

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_SERVICE = "lib/services/CotizadorService.ts";

/**
 * Deja el codigo en condiciones de ser censado por operadores:
 *
 *  1. fuera los literales de cadena y de plantilla — un `"@/lib/utils/x"` de un import lleva una
 *     barra que no es una division, y un mensaje puede llevar un guion;
 *  2. fuera las lineas `import` — su `from` ya quedo sin ruta, pero tampoco aportan nada.
 *
 * (Los comentarios los quita antes `quitarComentarios`, que es el unico quitador del repo: los
 * comentarios de este arbol NOMBRAN A PROPOSITO lo que el codigo tiene prohibido, y censar la
 * prosa como si fuera codigo denuncia la explicacion.)
 */
function soloCodigoOperable(fuenteSinComentarios: string): string {
  return fuenteSinComentarios
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/^\s*import[\s\S]*?;\s*$/gm, "");
}

/** Las dos operaciones permitidas por T5.2/T5.3, marcadas para que el censo las ignore. */
function marcarPermitidas(codigo: string): string {
  return codigo
    .replace(/\.mul\(cantidad\)/g, ".OPERACION_PERMITIDA_MUL_POR_N")
    .replace(/\.neg\(\)/g, ".OPERACION_PERMITIDA_NEGAR")
    .replace(/\.plus\(/g, ".SUMA_DE_CONCEPTOS_YA_REDONDEADOS(");
}

/** Cada familia de aritmetica monetaria propia, con el nombre con el que se reporta. */
const PROHIBIDO: Array<{ nombre: string; patron: RegExp }> = [
  { nombre: "salto a punto flotante (parseFloat/parseInt)", patron: /\bparse(Float|Int)\s*\(/ },
  { nombre: "salto a number (Number(...))", patron: /\bNumber\s*\(/ },
  { nombre: "aritmetica con Math", patron: /\bMath\s*\./ },
  { nombre: "division entre 100 (porcentaje a mano)", patron: /\/\s*100\b/ },
  { nombre: "factor de IVA a mano (* 1.13)", patron: /\*\s*1\.\d/ },
  { nombre: "division con Decimal (.div/.dividedBy)", patron: /\.(div|dividedBy)\s*\(/ },
  { nombre: "multiplicacion con Decimal fuera de .mul(cantidad)", patron: /\.(mul|times)\s*\(/ },
  { nombre: "negacion/resta con Decimal fuera de .neg()", patron: /\.(neg|minus|sub)\s*\(/ },
  { nombre: "redondeo propio (toDecimalPlaces/ROUND_*)", patron: /toDecimalPlaces|ROUND_/ },
  { nombre: "operador * o / entre expresiones", patron: /[\w)\]]\s*[*/]\s*[\w("]/ },
  { nombre: "operador + o - entre expresiones", patron: /[\w)\]]\s*[+-]\s*[\w("]/ },
];

/** Las familias de aritmetica propia que aparecen en un fuente ya sin comentarios. */
function aritmeticaPropia(fuenteSinComentarios: string): string[] {
  const codigo = marcarPermitidas(soloCodigoOperable(fuenteSinComentarios));
  return PROHIBIDO.filter(({ patron }) => patron.test(codigo)).map(({ nombre }) => nombre);
}

describe("guardia 248: el cotizador no reimplementa la aritmetica del dinero (R23)", () => {
  it("CotizadorService no contiene fórmulas monetarias propias y llama a derivarIngresoOrden", () => {
    // Control de no-vacuidad: sin esto, un renombrado del archivo dejaria la guardia "verde"
    // censando una cadena vacia. Una guardia que no encuentra nada que mirar no falla: AFIRMA
    // ALGO FALSO, y su veredicto se lee igual de verde.
    expect(existsSync(path.join(RAIZ, RUTA_SERVICE)), `${RUTA_SERVICE} no existe`).toBe(true);
    const fuente = codigoSinComentarios(RUTA_SERVICE);
    expect(fuente.trim().length).toBeGreaterThan(500);

    // (a) LA ARITMETICA SE LLAMA: los dos resultados, con el derivador compartido.
    expect(fuente).toMatch(/derivarIngresoOrden\(\s*\{\s*resultado:\s*"entregada"/);
    expect(fuente).toMatch(/derivarIngresoOrden\(\s*\{\s*resultado:\s*"devuelta"/);
    // Y el neto de ENTREGADA sale de la funcion del cierre, no de una resta escrita aqui (R19).
    expect(fuente).toMatch(/pagoTiendaOrdenex\(/);

    // (b) LA ARITMETICA NO SE COPIA.
    expect(aritmeticaPropia(fuente)).toEqual([]);

    // (c) Y el whitelist no es vacuo: las dos operaciones permitidas existen de verdad en el
    // fuente, con la forma EXACTA que se permite (si alguien escribiera `.mul(otraCosa)`, el
    // censo de arriba lo cazaria porque solo `.mul(cantidad)` esta marcada).
    expect(fuente).toMatch(/\.mul\(cantidad\)/);
    expect(fuente).toMatch(/\.neg\(\)/);
  });

  it("contraprueba: el censo caza las formas de reimplementar la formula", () => {
    // CONTRAPRUEBA EN MEMORIA (no toca el arbol): una version "clara" del cotizador, con las
    // mismas formulas escritas a mano. Es exactamente el codigo que la feature 204 ya pago.
    const impostor = quitarComentarios(`
      import { Prisma } from "@prisma/client";
      // ivaFlete es un porcentaje 0..100
      export function cotizar(flete: string, ivaFlete: string, monto: string) {
        const iva = new Prisma.Decimal(flete).mul(ivaFlete).div(100).toFixed(2);
        const comision = Number(monto) * 0.035;
        const conIva = parseFloat(comision.toFixed(2)) * 1.13;
        const factor = Number(ivaFlete) / 100;
        const neto = Number(monto) - Number(flete) - conIva;
        return { iva, comision, conIva, factor, neto };
      }
    `);

    const cazadas = aritmeticaPropia(impostor);
    expect(cazadas).toContain("salto a punto flotante (parseFloat/parseInt)");
    expect(cazadas).toContain("salto a number (Number(...))");
    expect(cazadas).toContain("division entre 100 (porcentaje a mano)");
    expect(cazadas).toContain("factor de IVA a mano (* 1.13)");
    expect(cazadas).toContain("division con Decimal (.div/.dividedBy)");
    expect(cazadas).toContain("multiplicacion con Decimal fuera de .mul(cantidad)");
    expect(cazadas).toContain("operador * o / entre expresiones");
    expect(cazadas).toContain("operador + o - entre expresiones");

    // Y el comentario del impostor —que NOMBRA el porcentaje— no es lo que lo delata: el censo
    // corre sobre codigo sin comentarios.
    expect(aritmeticaPropia(quitarComentarios("/* mul(ivaFlete).div(100) */\nconst a = b;")))
      .toEqual([]);
  });
});
