import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * ⭑ FICHA 380 / T4 (R4) — GUARDIA MONEY-SAFE del comparador del pago al mensajero.
 *
 * ## Que se prohibe, y por que la guardia se acota a UN modulo
 *
 * `cambioElPagoAlMensajero` decide si se escribe la fila de historial que documenta un cambio en
 * LO QUE COBRA UNA PERSONA. Compara `Decimal(12,2)` contra `Decimal(12,2)`, y R4 exige que no los
 * convierta a coma flotante EN NINGUN PUNTO: un `Number(...)` intermedio empata dos importes que
 * difieren en un centimo y el cambio no deja rastro — sin un solo error, y sin romper nada.
 *
 * ⚠️ ESTA REGLA NO SE PUEDE ESCRIBIR SOBRE `ZonaRepository.ts`, y por eso el comparador vive en su
 * propio modulo: `tarifaToDTO` usa `.toNumber()` ahi de forma LEGITIMA para el DTO de la pantalla
 * de zonas (preexistente y fuera del alcance de esta ficha, `design §10`). Una guardia a nivel de
 * ese archivo naceria ROJA y habria que llenarla de excepciones hasta que dejara de cubrir nada.
 * Sobre un modulo de veinte lineas que solo compara dinero, el barrido es TOTAL.
 *
 * ## Que SI se admite, y por que
 *
 * `.toFixed(2)` del PROPIO `Prisma.Decimal` es exactamente la conversion correcta —no pasa por
 * `number`—, y es la que ya bendicen `TarifaZonaMensajeroRepository.toPagoTarifa` y
 * `HistorialAccionService`. Lo prohibido es `.toNumber(`, que si sale del mundo decimal.
 *
 * ## Como afirma
 *
 * Sobre el fuente SIN COMENTARIOS: el docstring del modulo NOMBRA a proposito lo que esta
 * prohibido («ni `Number(`, ni `parseFloat(`, ni `.toNumber(`»), asi que un barrido sobre el texto
 * crudo denunciaria la EXPLICACION y obligaria a borrarla para pasar.
 *
 * Y con CONTRAPRUEBA: una guardia estatica rota no falla, CALLA. El bloque (0) inyecta cada
 * conversion prohibida en un fuente de mentira y comprueba que el detector la ve.
 *
 * La lectura es ESTATICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** El modulo vigilado. UNO, y acotado: ese es el punto (ver el docstring). */
const MODULO = "lib/repositories/_shared/pago-mensajero-cambio.ts";

/** Las formas de perder un centimo saliendo del mundo `Decimal`. */
const CONVERSIONES_PROHIBIDAS: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "Number(", patron: /\bNumber\s*\(/ },
  { nombre: "parseFloat(", patron: /\bparseFloat\s*\(/ },
  { nombre: "parseInt(", patron: /\bparseInt\s*\(/ },
  { nombre: ".toNumber(", patron: /\.toNumber\s*\(/ },
  { nombre: "Number.parseFloat/parseInt", patron: /\bNumber\.parse(?:Float|Int)\s*\(/ },
  { nombre: "+cobro (unario)", patron: /[^\w)\]]\+\s*(?:\w+\.)?cobro\w*\b/ },
];

/**
 * Aritmetica sobre un importe. Es la regla que la feature 204 midio que el barrido de conversiones
 * NO ve: `a - b` no lleva ni un `Number(`. Se persigue el identificador `cobro…` (que es como se
 * llaman las dos columnas de dinero de `tarifa_zona_mensajero`) a un lado de un operador.
 */
const ARITMETICA_SOBRE_COBRO: readonly RegExp[] = [
  /(?:\w+\.)?cobro\w*\s*[-*/%]\s*[\w("'`]/,
  /[\w)"'`]\s*[-*/%]\s*(?:\w+\.)?cobro\w*\b/,
  /(?:\w+\.)?cobro\w*\s*\+\s*[\w("'`]/,
];

function reventar(que: string): never {
  throw new Error(
    `guardia pago-mensajero-money-safe: ${que}. La guardia NO pudo leer lo que vigila; se ` +
      `detiene en ROJO en vez de dar por buena una lectura vacia.`,
  );
}

function codigo(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!existsSync(ruta)) reventar(`falta el modulo vigilado \`${rel}\``);
  const fuente = readFileSync(ruta, "utf8");
  if (fuente.trim().length === 0) reventar(`\`${rel}\` se leyo en blanco`);
  return quitarComentarios(fuente);
}

describe("(0) autocomprobacion — la guardia lee algo y sus detectores detectan", () => {
  it("el modulo existe, no se leyo en blanco y sigue hablando de dinero", () => {
    const fuente = codigo(MODULO);
    expect(fuente.length, `${MODULO} vacio`).toBeGreaterThan(200);
    // Si dejara de nombrar los dos importes, esta guardia estaria vigilando otra cosa.
    expect(fuente).toMatch(/\bcobroEntregado\b/);
    expect(fuente).toMatch(/\bcobroRechazado\b/);
  });

  it("⭑ CONTRAPRUEBA: el detector VE cada conversion prohibida cuando se le inyecta", () => {
    // Una guardia estatica rota no falla: CALLA. Sin este caso, los barridos de abajo podrian
    // estar pasando porque los patrones no encuentran nada nunca.
    const inyecciones = [
      "const n = Number(pago.cobroEntregado);",
      "const n = parseFloat(pago.cobroEntregado);",
      "const n = parseInt(pago.cobroEntregado);",
      "const n = pago.cobroEntregado.toNumber();",
      "const n = Number.parseFloat(pago.cobroEntregado);",
      "const n = +pago.cobroEntregado;",
    ];
    for (const linea of inyecciones) {
      expect(
        CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test(linea)),
        `el detector NO vio: ${linea}`,
      ).toBe(true);
    }
  });

  it("⭑ CONTRAPRUEBA: el detector de ARITMETICA caza lo que el de conversiones no ve", () => {
    const sinConversion = "const delta = a.cobroEntregado - b.cobroEntregado;";
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test(sinConversion))).toBe(false);
    expect(ARITMETICA_SOBRE_COBRO.some((p) => p.test(sinConversion))).toBe(true);
    expect(ARITMETICA_SOBRE_COBRO.some((p) => p.test("const x = pago.cobroRechazado * 2;"))).toBe(
      true,
    );
  });

  it("y NO marcan lo correcto: transportar, comparar o serializar con `Decimal.toFixed`", () => {
    // La otra direccion de la contraprueba. Un detector que marca todo es igual de inutil que uno
    // que no marca nada: obligaria a desactivarlo el primer dia.
    const legitimas = [
      "cobroEntregado: pago.cobroEntregado,",
      "return `${pago.cobroEntregado.toFixed(2)}|${pago.cobroRechazado.toFixed(2)}`;",
      "if (pendientes.get(clave) !== huellaDelPago(nuevo)) return true;",
    ];
    for (const linea of legitimas) {
      expect(
        CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test(linea)),
        `falso positivo de conversiones en: ${linea}`,
      ).toBe(false);
      expect(
        ARITMETICA_SOBRE_COBRO.some((p) => p.test(linea)),
        `falso positivo de aritmetica en: ${linea}`,
      ).toBe(false);
    }
  });
});

describe("380/R4 — el comparador NO convierte un importe a coma flotante", () => {
  it("⭑ ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toNumber(`, ni un `+` unario", () => {
    const fuente = codigo(MODULO);
    const hallazgos = CONVERSIONES_PROHIBIDAS.filter((p) => p.patron.test(fuente)).map(
      (p) => `${MODULO}: ${p.nombre}`,
    );
    expect(
      hallazgos,
      "un `number` intermedio empata dos importes que difieren en un centimo y el cambio se " +
        "queda SIN fila de historial, en silencio",
    ).toEqual([]);
  });

  it("⭑ ninguna ARITMETICA sobre un importe", () => {
    const fuente = codigo(MODULO);
    const hallazgos: string[] = [];
    for (const patron of ARITMETICA_SOBRE_COBRO) {
      const m = patron.exec(fuente);
      if (m !== null) hallazgos.push(`${MODULO}: ${m[0].trim()}`);
    }
    expect(hallazgos, "se opero con un importe fuera de `Prisma.Decimal`").toEqual([]);
  });

  it("⭑ CONTROL POSITIVO: SI serializa, y lo hace con `Decimal.toFixed(2)`", () => {
    // Sin este control, los dos casos de arriba pasarian igual si el modulo hubiera dejado de
    // comparar importes — que es el otro modo de fallo, y el silencioso.
    const fuente = codigo(MODULO);
    expect(fuente).toMatch(/cobroEntregado\.toFixed\(2\)/);
    expect(fuente).toMatch(/cobroRechazado\.toFixed\(2\)/);
  });

  it("⭑ R3: el tipo `PagoComparable` NO declara `id`", () => {
    // El guardado REGENERA los `id` en cada reemplazo. Si el tipo los admitiera, el dia que
    // alguien los añadiera al `select` de la lectura previa el comparador diria «cambio» SIEMPRE
    // y la fila de historial dejaria de significar nada. No se puede mirar lo que no se declara.
    const fuente = codigo(MODULO);
    const bloque = /export interface PagoComparable \{([\s\S]*?)\n\}/.exec(fuente);
    expect(bloque, "no se pudo recortar `PagoComparable`").not.toBeNull();
    expect(bloque![1], "`PagoComparable` declara `id`").not.toMatch(/\bid\s*[?:]/);
  });
});
