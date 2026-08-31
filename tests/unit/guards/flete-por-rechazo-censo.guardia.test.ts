import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * 💰 FICHA 338 (2026-08-31) — GUARDIA DE CENSO: **ningún texto visible de `app/` puede llamar a
 * este cobro «flete de devolución» ni «flete devuelto».**
 *
 * ── QUÉ PROTEGE, Y POR QUÉ NO ES COSMÉTICA
 * Sólo un RECHAZO cobra este flete. Desde la ficha 301 (2026-08-28) una `devuelta` NO deriva
 * ningún concepto —el paquete sigue vivo en la calle y todavía puede reprogramarse— y
 * `lib/utils/ingreso-ordenex.ts` lo emite únicamente con `resultado === "rechazada"`. El nombre
 * viejo decía JUSTO EL CASO QUE NO COBRA, y no es una hipótesis: el humano abrió esta ficha
 * después de leer «Flete devuelto» en el detalle de un cierre y creer que se le estaba cobrando
 * a una tienda por una devolución. No había plata mal cobrada; había vocabulario que asusta.
 *
 * El nombre, decidido por el humano para toda la app, es **«Flete por rechazo»**. Está en
 * pantallas, wallet, descargas y en la documentación de la API pública.
 *
 * ── POR QUÉ HACE FALTA UNA GUARDIA Y NO BASTAN LOS TESTS
 * El rename tocó nueve archivos de `app/` y dos contratos. Nada impide que el rótulo viejo
 * REAPAREZCA en una pantalla nueva: el compilador no tiene nada que decir sobre un literal, y un
 * test de componente sólo mira los rótulos que ese componente pinta. El vocabulario del dinero
 * es exactamente la clase de decisión que se re-descubre por partes y se vuelve a escribir mal.
 *
 * ── EL BLOQUE DE AUTOCOMPROBACIÓN, Y POR QUÉ ES OBLIGATORIO
 * Una guardia estática rota no falla: **calla**. Si el recorrido dejara de encontrar archivos, o
 * el quitador de comentarios devolviera vacío, o la expresión regular se escribiera mal, el
 * censo saldría sin infractores y el veredicto se leería igual de verde. Por eso hay tres
 * comprobaciones ANTES del censo, y las tres tienen que poder fallar solas:
 *   1. el recorrido ve un número plausible de archivos de `app/`;
 *   2. el MISMO extractor encuentra el nombre NUEVO en `app/` (o sea: sí lee texto visible, y el
 *      rename está puesto);
 *   3. sobre dos fuentes sintéticas, el detector marca el literal y NO marca el comentario.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const APP = path.join(RAIZ, "app");
const EXTENSIONES = [".ts", ".tsx"];

/**
 * Los DOS nombres retirados, con sus variantes de género, número y acento. Exige un ESPACIO
 * entre las dos palabras a propósito: `fleteDevolucion`, `flete_devolucion` e
 * `ingreso_iva_flete_devolucion` son identificadores internos y columnas de base que esta ficha
 * NO renombra —eso es dato histórico y exigiría una migración—. Lo que se persigue es lo que LEE
 * un humano.
 */
const NOMBRE_RETIRADO = /flete\s+(?:de\s+)?(?:devoluci[oó]n(?:es)?|devuelt[oa]s?)/iu;

/** El nombre que sí vale, para la autocomprobación (2) y para el mensaje de error. */
const NOMBRE_VIGENTE = /flete\s+por\s+rechazo/iu;

/** Todos los `.ts`/`.tsx` de `app/**`, recursivo. */
function fuentesDeApp(dir: string = APP): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name === ".next") continue;
      salida.push(...fuentesDeApp(completa));
    } else if (EXTENSIONES.includes(path.extname(entrada.name))) {
      salida.push(completa);
    }
  }
  return salida;
}

/** Ruta relativa a la raíz, con `/`, que es como se lee un hallazgo. */
function relativa(absoluta: string): string {
  return path.relative(RAIZ, absoluta).split(path.sep).join("/");
}

/**
 * Las líneas de `fuente` que casan `patron` **una vez fuera los comentarios**.
 *
 * La prosa de este árbol nombra a propósito lo que el código tiene prohibido —este mismo archivo
 * es el ejemplo—, así que un barrido sobre el texto crudo denunciaría la EXPLICACIÓN y obligaría
 * a borrarla para pasar. Se usa el quitador único del repo (`tests/fixtures/sin-comentarios.ts`),
 * que conserva el número de líneas para que el hallazgo apunte donde dice.
 */
function lineasQueCasan(fuente: string, patron: RegExp): number[] {
  const lineas = quitarComentarios(fuente).split("\n");
  const salida: number[] = [];
  lineas.forEach((linea, i) => {
    if (patron.test(linea)) salida.push(i + 1);
  });
  return salida;
}

/** El censo entero: un hallazgo por línea infractora. */
function censar(patron: RegExp): string[] {
  const hallazgos: string[] = [];
  for (const archivo of fuentesDeApp()) {
    const fuente = readFileSync(archivo, "utf8");
    for (const linea of lineasQueCasan(fuente, patron)) {
      hallazgos.push(`${relativa(archivo)}:${linea}`);
    }
  }
  return hallazgos;
}

describe("338 — autocomprobación del censo (una guardia estática rota no falla: calla)", () => {
  it("el recorrido ve los fuentes de `app/**`, y no una lista vacía", () => {
    // El 2026-08-31 había 432. El umbral es holgado a propósito: mide que el recorrido FUNCIONA,
    // no cuántas pantallas tiene la app.
    expect(fuentesDeApp().length).toBeGreaterThan(200);
  });

  it("el MISMO extractor encuentra el nombre VIGENTE en `app/`", () => {
    // Si esto sale vacío, el censo de abajo no prueba nada: o el extractor no lee texto visible,
    // o el rename de la ficha 338 no está puesto. En cualquiera de los dos casos hay que mirar
    // ESTE test antes de creerle al de abajo.
    const vigentes = censar(NOMBRE_VIGENTE);
    expect(vigentes.length, "el nombre «Flete por rechazo» no aparece en app/").toBeGreaterThan(5);
  });

  it("el detector marca el literal y NO marca el comentario", () => {
    const conLiteral = 'export const X = "Flete de devolución + IVA";';
    const enComentario = "// El flete de devolución se llamaba así hasta la ficha 338.\nconst y = 1;";
    const enBloque = "/**\n * IVA del flete devuelto, que ya no se llama así.\n */\nconst z = 2;";

    expect(lineasQueCasan(conLiteral, NOMBRE_RETIRADO)).toEqual([1]);
    expect(lineasQueCasan(enComentario, NOMBRE_RETIRADO)).toEqual([]);
    expect(lineasQueCasan(enBloque, NOMBRE_RETIRADO)).toEqual([]);
    // Y las variantes: si la expresión se escribiera de menos, esto lo dice.
    expect(lineasQueCasan('"Flete devuelto"', NOMBRE_RETIRADO)).toEqual([1]);
    expect(lineasQueCasan('"IVA del flete de devolucion"', NOMBRE_RETIRADO)).toEqual([1]);
    // Lo que NO se persigue: identificadores internos y columnas de base (dato histórico).
    expect(lineasQueCasan("ingreso_iva_flete_devolucion: dec,", NOMBRE_RETIRADO)).toEqual([]);
    expect(lineasQueCasan("const fleteDevolucion = ing.fleteDevolucion;", NOMBRE_RETIRADO)).toEqual(
      [],
    );
  });
});

describe("338 — censo: ningún texto visible de `app/` dice «flete de devolución» ni «flete devuelto»", () => {
  it("no queda ni una etiqueta con el nombre retirado", () => {
    expect(
      censar(NOMBRE_RETIRADO),
      "este cobro sólo lo genera un RECHAZO (ficha 301). Se llama «Flete por rechazo»: " +
        "nombrarlo por la devolución dice justo el caso que NO cobra.",
    ).toEqual([]);
  });
});
