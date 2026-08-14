// Feature 211 — guardia del MECANISMO que enciende el tema.
//
// El control de la cabecera se prueba en `tests/components/TemaToggle.test.tsx`. Lo que
// aqui se vigila es la parte que ningun test de componente ve, porque no es React: el CSS
// que hace que la clase signifique algo, y el punto del arbol donde esa clase se estampa.
// Las cuatro piezas se rompen en silencio —siguen compilando, siguen pasando 12.000
// tests— y el sintoma solo aparece mirando la aplicacion:
//
//  1. Si el bloque de `.tema-sistema` deja de espejar a `.dark`, el estado POR DEFECTO
//     queda con una paleta a medias.
//  2. Si el variant `dark:` pierde su rama de `prefers-color-scheme`, en «sistema» giran
//     los tokens pero NO las utilidades `dark:` — el bug que la 208 documento como el mas
//     repetido del repo.
//  3. Si desaparece `body:has(...)`, vuelve la franja clara alrededor de la app oscura.
//  4. Si el layout deja de montar el proveedor, el control sigue ahi y no enciende nada.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Feature 223 (R32): el parser de reglas con ancestros vivia AQUI y ahora vive en el fixture
// compartido. Ningun caso de este archivo cambia: cambia de donde salen `reglasDe`,
// `selectoresDe` y `declaracionesDe`.
import { atReglaQueContiene, reglasDe, type Regla } from "../../fixtures/css-reglas";
import { codigoCssSinComentarios, codigoSinComentarios } from "../../fixtures/sin-comentarios";

const GLOBALS = "app/globals.css";
const LAYOUT = path.join("app", "(app)", "layout.tsx");
const HEADER = "components/shared/PageHeader.tsx";

// Con el quitador de CSS, no con el de TypeScript: la pasada de `//` no quita nada en una hoja
// de estilos y en cambio se comeria una `url(//cdn/x)` y la declaracion siguiente (feature 223).
const css = codigoCssSinComentarios(GLOBALS);
const reglas = reglasDe(css);

function reglaCon(selector: string): Regla {
  const hallazgos = reglas.filter((r) => r.selectores.includes(selector));
  expect(hallazgos.length, `no hay ninguna regla para \`${selector}\` en ${GLOBALS}`).toBe(1);
  return hallazgos[0]!;
}

describe("feature 211 — el CSS que enciende el tema", () => {
  it("«sistema» toma EXACTAMENTE los mismos tokens que «oscuro», hasta el ultimo hex", () => {
    const oscuro = reglaCon(".dark");
    const sistema = reglaCon(".tema-sistema");

    // Que no sea un bloque vacio que pase por casualidad.
    expect(Object.keys(oscuro.declaraciones).length).toBeGreaterThan(20);
    expect(Object.keys(sistema.declaraciones)).toEqual(Object.keys(oscuro.declaraciones));
    expect(sistema.declaraciones).toEqual(oscuro.declaraciones);
  });

  it("los tokens de «sistema» viven DENTRO de `prefers-color-scheme: dark` (si no, oscuro siempre)", () => {
    const sistema = reglaCon(".tema-sistema");
    expect(sistema.ancestros.join(" | ")).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);

    const oscuro = reglaCon(".dark");
    expect(
      oscuro.ancestros.join(" | "),
      "`.dark` no puede depender de la preferencia del sistema: es la eleccion EXPLICITA",
    ).not.toMatch(/prefers-color-scheme/);
  });

  it("el `<body>` toma los mismos tokens que el envoltorio: sin eso queda una franja clara", () => {
    const oscuro = reglas.find((r) => r.selectores.includes(".dark"))!;
    const sistema = reglas.find((r) => r.selectores.includes(".tema-sistema"))!;

    expect(oscuro.selectores).toContain("body:has(> .dark)");
    expect(sistema.selectores).toContain("body:has(> .tema-sistema)");
  });

  it("el variant `dark:` dispara por CLASE y tambien por preferencia del sistema", () => {
    const bloque = css.slice(css.indexOf("@custom-variant dark"));
    const cierre = (() => {
      let hondura = 0;
      for (let i = bloque.indexOf("{"); i < bloque.length; i += 1) {
        if (bloque[i] === "{") hondura += 1;
        else if (bloque[i] === "}") {
          hondura -= 1;
          if (hondura === 0) return i;
        }
      }
      return -1;
    })();
    expect(cierre, "no se encontro el bloque de `@custom-variant dark`").toBeGreaterThan(0);
    const cuerpo = bloque.slice(0, cierre + 1);

    expect(cuerpo, "falta la rama por clase (.dark)").toMatch(/&:is\(\.dark \*\)/);
    expect(cuerpo, "falta la rama por preferencia del sistema").toMatch(
      /@media\s*\(prefers-color-scheme:\s*dark\)/,
    );
    expect(cuerpo, "la rama del sistema no se ancla a `.tema-sistema`").toMatch(
      /&:is\(\.tema-sistema \*\)/,
    );
    // Dos `@slot`: uno por rama. Con uno solo, una de las dos no emite nada.
    expect(cuerpo.match(/@slot/g) ?? []).toHaveLength(2);
  });

  // REEXPRESADO por la feature 217, no relajado: el titulo decia «la landing y la FACTURA
  // dependen de ello» y desde la 217 eso es falso —la factura gira con el tema y solo vuelve a
  // claro al imprimir, con su propia clase—. Lo que sigue siendo cierto son los otros dos
  // consumidores, y son los que se nombran. Las aserciones del cuerpo NO cambian: comprueban la
  // definicion de la clase, que sigue teniendo que existir intacta.
  it("`.tema-claro` sigue fijando los valores claros (la landing `app/page.tsx` y la eleccion «claro» del portal `lib/tema/tema.ts` dependen de ello)", () => {
    const claro = reglaCon(".tema-claro");
    expect(claro.selectores).toContain(":root");
    expect(claro.declaraciones["--background"]).toBe("#f7f8fc");
  });
});

/**
 * DONDE ESTA EL BLOQUE DE IMPRESION DE LA 217. Se localiza por lo que CONTIENE.
 *
 * ── Historia de este ancla, porque explica por que ya no es posicional (feature 223, R24/C3)
 *
 * 1. Feature 217: bastaba `@media …print…{`, porque en todo el archivo habia UNA sola at-rule que
 *    nombrara `print`.
 * 2. Feature 221: añade `@media not print` envolviendo el `@custom-variant dark`, 200 lineas MAS
 *    ARRIBA. El patron viejo pasaba a engancharla a ella y los dos casos que lo usan seguian
 *    VERDES sin mirar el bloque que dicen vigilar. Se afino a «`print` pegado al `@media`».
 * 3. Feature 223: añade un SEGUNDO `@media print` —el flujo de impresion— y con el, «el primero
 *    del archivo» vuelve a ser un ancla que puede mover cualquiera. Bastaba escribir el bloque
 *    nuevo DELANTE para que estos casos vigilaran el bloque equivocado **en verde**.
 *
 * La leccion, dos veces pagada: un ancla POSICIONAL caduca cada vez que alguien añade algo. El
 * bloque de la 217 es «el que contiene la regla que declara los tokens de `.papel-al-imprimir`», y
 * asi se busca. Da igual cuantos bloques haya y en que orden esten.
 */
const REGLA_DE_TOKENS_DE_LA_HOJA = /^\s*\.papel-al-imprimir\s*\{/m;

/** El `@media` que envuelve la regla de tokens de la 217, con su indice y su linea. */
function bloqueDeLa217() {
  const bloque = atReglaQueContiene(css, REGLA_DE_TOKENS_DE_LA_HOJA);
  expect(
    bloque.prelude,
    "la regla de tokens de la 217 dejo de vivir dentro de un `@media print`: o se movio, o " +
      "quedo envuelta en otra at-rule, y en los dos casos la hoja deja de volver a claro en papel",
  ).toMatch(/^@media\s+print\b/);
  return bloque;
}

/**
 * Feature 217 — la regla que hace que la factura del cierre salga BLANCA en papel.
 *
 * En pantalla las dos hojas giran con el tema (la 217 les quito el pin `tema-claro`). Al
 * imprimir vuelven a los valores claros, y eso lo hace `.papel-al-imprimir` dentro de un
 * `@media print`. Lo que estos casos vigilan es lo que se rompe EN SILENCIO:
 *
 *  - Si la regla pierde su `@media print`, la hoja se queda fija en claro EN PANTALLA: la 217
 *    entera quedaria revertida sin que ningun otro test se entere.
 *  - Si un hex diverge del bloque `:root, .tema-claro`, la hoja impresa deja de ser el tema
 *    claro y nadie lo ve: no hay forma de mirar una impresion desde el gate.
 *  - Si el bloque fija solo las superficies y no la TINTA, imprimir desde tema oscuro da
 *    blanco sobre blanco — los navegadores no imprimen fondos salvo que se marque «graficos
 *    de fondo», que viene desmarcado.
 *
 * Verificacion ESTRUCTURAL, y se llama asi: ninguna pieza del gate renderiza en papel.
 */
describe("feature 217 — al imprimir, la hoja de la factura es clara", () => {
  it("hay UNA regla `.papel-al-imprimir` y vive dentro de `@media print`", () => {
    const impresion = reglaCon(".papel-al-imprimir");
    expect(
      impresion.ancestros.join(" | "),
      "sin `@media print` la regla aplica EN PANTALLA: la hoja volveria a estar fijada a claro",
    ).toMatch(/@media\s+print/);
  });

  it("declara los MISMOS tokens y los MISMOS valores que el tema claro, hex a hex", () => {
    const claro = reglaCon(".tema-claro");
    const impresion = reglaCon(".papel-al-imprimir");

    // Igualdad, no subconjunto: un token añadido a uno y no al otro tambien es divergencia.
    expect(Object.keys(impresion.declaraciones)).toEqual(Object.keys(claro.declaraciones));
    expect(impresion.declaraciones).toEqual(claro.declaraciones);
  });

  it("fija la TINTA y no solo la superficie (si no, en papel sale blanco sobre blanco)", () => {
    const impresion = reglaCon(".papel-al-imprimir");
    expect(impresion.declaraciones["--foreground"]).toBe("#12233f");
    expect(impresion.declaraciones["--card-foreground"]).toBe("#12233f");
    for (const familia of ["success", "warning", "danger", "info"]) {
      expect(
        impresion.declaraciones[`--${familia}-strong`],
        `el bloque de impresion no fija --${familia}-strong: ese texto saldria con el valor de ` +
          "tema oscuro sobre papel blanco",
      ).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Que no sea un bloque a medias que pase por casualidad.
    expect(Object.keys(impresion.declaraciones).length).toBeGreaterThan(20);
  });

  /**
   * R15 — el LIMITE de esta regla tiene que estar escrito JUNTO a ella, no solo en el spec.
   *
   * La regla de impresion NO apaga el variant `dark:`: se resuelve contra el ancestro, no contra
   * los tokens, asi que al imprimir desde tema oscuro las utilidades `dark:` de las primitivas
   * siguen disparando dentro de la hoja. Se acepta —el resultado impreso es el que la hoja ya
   * mostraba antes de la 217— pero quien lea la regla tiene que encontrar ahi su limite. Un
   * limite que solo vive en un spec es un limite que el siguiente no va a leer.
   *
   * ⚠️ LA PRIMERA VERSION DE ESTE CASO NO PODIA PONERSE ROJA, y conviene que quede escrito.
   * Anclaba en `crudo.indexOf("@media print")`, y ese literal aparece ANTES en la PROSA del
   * comentario de `.tema-claro` (:134), 120 lineas por encima de la regla real. La ventana que
   * inspeccionaba no era la del bloque de impresion sino la de otro comentario, y el `` `dark:` ``
   * que lo satisfacia era prosa de la feature 211. Se podia borrar entera la declaracion que R15
   * exige y el caso seguia verde.
   *
   * Es EXACTAMENTE el fallo que la feature 209 vino a cerrar: leer prosa como si fuera codigo. La
   * localizacion va ahora sobre el CODIGO —comentarios fuera, con el quitador compartido— y se usa
   * que ese quitador CONSERVA LOS SALTOS DE LINEA: el numero de linea de la regla en el codigo es
   * el mismo que en el archivo crudo, asi que se puede volver al crudo a leer su comentario.
   */
  it("junto a la regla de impresion queda escrito su limite: no apaga el variant `dark:` (R15)", () => {
    const crudo = readFileSync(path.join(__dirname, "../../..", GLOBALS), "utf8");
    const lineasCrudas = crudo.split("\n");
    const lineasCodigo = css.split("\n"); // mismo recuento de lineas que `crudo` (feature 209)
    expect(lineasCodigo.length).toBe(lineasCrudas.length);

    // Feature 223 (R24): la linea sale del bloque que CONTIENE la regla de tokens de la 217, no de
    // «el primer `@media print`». Con dos bloques en el archivo, lo segundo es un ancla que mueve
    // cualquiera sin que nada se ponga rojo.
    const regla = bloqueDeLa217().linea;
    expect(regla, "no se encontro la REGLA `@media print` en el codigo de " + GLOBALS).toBeGreaterThan(
      -1,
    );
    expect(
      lineasCodigo[regla],
      "la linea localizada no es la apertura del bloque de impresion de la 217",
    ).toMatch(/@media\s+print\b/);

    // El comentario ATADO a la regla: el bloque `/* … */` que la precede inmediatamente. Si no hay
    // ninguno, o si hay codigo en medio, es que la declaracion no esta donde R15 la pide.
    let i = regla - 1;
    while (i >= 0 && lineasCrudas[i].trim() === "") i -= 1;
    expect(
      lineasCrudas[i]?.trim(),
      "la regla de impresion no lleva un comentario pegado encima. R15 pide que su limite este " +
        "declarado JUNTO a ella, no en `specs/`: quien lee la regla tiene que encontrarlo ahi.",
    ).toBe("*/");

    const fin = i;
    while (i >= 0 && !lineasCrudas[i].trimStart().startsWith("/*")) i -= 1;
    expect(i, "el comentario de la regla de impresion no abre en ningun sitio").toBeGreaterThan(-1);

    const comentarioDeLaRegla = lineasCrudas.slice(i, fin + 1).join("\n");
    expect(
      comentarioDeLaRegla,
      "el comentario de la regla de impresion no nombra el variant `dark:`. Ese es su limite " +
        "conocido —no lo apaga— y va declarado ahi con su razon.",
    ).toMatch(/`dark:`/);
  });

  /**
   * R19 — ninguna prosa del CSS puede seguir afirmando que la factura se fija a tema claro.
   * La mencion que queda es la que explica que DEJO de usar la clase y por que; una que la
   * vuelva a listar como consumidora manda al siguiente lector a buscar un olvido inexistente.
   */
  it("la prosa de `.tema-claro` ya no lista la factura entre sus consumidores (R19)", () => {
    const crudo = readFileSync(path.join(__dirname, "../../..", GLOBALS), "utf8");
    // El comentario que documenta la clase es el que precede a su declaracion. La regla de
    // impresion tambien nombra la hoja, y ahi es correcto: dice a que se aplica.
    const declaracion = crudo.indexOf(":root,\n.tema-claro");
    expect(declaracion, "no se encontro la declaracion de `.tema-claro`").toBeGreaterThan(0);

    // Se busca la PALABRA, no la ruta del archivo. Contar solo `cierre-factura` dejaba pasar un
    // «2. Las dos hojas de la factura del cierre», que es exactamente la afirmacion que R19
    // prohibe: la lista de consumidores no se escribe con rutas, se escribe en prosa.
    const menciones = [...crudo.slice(0, declaracion).matchAll(/factura/gi)];
    expect(
      menciones.length,
      "el comentario de `.tema-claro` no deberia nombrar la factura fuera del parrafo que explica " +
        "que dejo de usar la clase",
    ).toBeGreaterThan(0);

    for (const m of menciones) {
      const alrededor = crudo.slice(Math.max(0, m.index - 500), m.index + 500);
      expect(
        alrededor,
        "si el comentario de `.tema-claro` nombra la factura, tiene que ser para decir que DEJO " +
          "de usar la clase en la feature 217, no para listarla como consumidora",
      ).toMatch(/feature 217/);
    }
  });

  it("NO fuerza la impresion de fondos: nada de `print-color-adjust`", () => {
    expect(
      css,
      "`print-color-adjust: exact` obligaria a imprimir la superficie… oscura, que es justo el " +
        "gasto de toner que la decision humana descarta",
    ).not.toMatch(/print-color-adjust/);
  });

  /**
   * REEXPRESADO por la feature 223, NO borrado ni relajado. Y conviene leer por que.
   *
   * Este caso decia: «no se cuela un flujo de impresion por el CSS: **nada de `@page`**… el
   * formato de impresion es otra ficha, no esta». **Esa otra ficha llego, y es la 223**: hoy hay
   * un `@page`, y borrar el caso porque «ya no aplica» habria retirado la unica vigilancia que
   * existia sobre el formato de pagina.
   *
   * Lo que sigue siendo cierto —y es lo que este caso defiende ahora— son DOS cosas:
   *
   *  1. **El formato NO se mezcla con el bloque de tokens de la 217.** Ese bloque tiene un unico
   *     trabajo, el COLOR, y su regla `.papel-al-imprimir` se compara `toEqual` contra
   *     `.tema-claro`: una declaracion de formato ahi dentro la pondria roja sin que nada
   *     estuviera mal, y peor, un `@page` colgado de la regla de tokens se llevaria el formato a
   *     donde nadie lo busca.
   *  2. **No aparece por sorpresa en un tercer sitio.** Hay UNA `@page` en todo el archivo, y
   *     vive en el bloque de la 223. Dos formatos compitiendo es la clase de bug que solo se ve
   *     en papel.
   *
   * Su censo completo —orientacion, margen, que no fuerza papel— vive en
   * `tests/unit/guards/impresion-flujo.guardia.test.ts`. Aqui queda el limite entre las dos
   * fichas, que es lo que esta guardia sabe vigilar.
   */
  it("el formato de pagina no se mezcla con el bloque de COLOR de la 217, ni aparece en un tercer sitio (R14, 223/R28)", () => {
    const paginas = css.match(/@page\b/g) ?? [];
    expect(
      paginas,
      "hay mas de una regla `@page` en el archivo, o ninguna. Dos formatos de pagina compitiendo " +
        "solo se ven en papel; cero significa que el flujo de la 223 se fue sin que nadie lo note.",
    ).toHaveLength(1);

    const tokens = reglaCon(".papel-al-imprimir");
    expect(
      Object.keys(tokens.declaraciones).filter((d) => !d.startsWith("--")),
      "la regla de tokens de la 217 declara algo que no es un token. Su unico trabajo es el " +
        "COLOR: el formato vive en el bloque de la 223, y mezclarlos rompe la comparacion " +
        "`toEqual` contra `.tema-claro` sin que nada este mal de verdad.",
    ).toEqual([]);

    // Y el `@page` no cuelga del bloque de la 217: se busca dentro de SU cuerpo, localizado por
    // contenido (no por posicion), igual que todo lo demas de esta seccion.
    const bloque = bloqueDeLa217();
    let hondura = 0;
    let i = css.indexOf("{", bloque.indice);
    for (; i < css.length; i += 1) {
      if (css[i] === "{") hondura += 1;
      else if (css[i] === "}") {
        hondura -= 1;
        if (hondura === 0) break;
      }
    }
    expect(
      css.slice(bloque.indice, i + 1),
      "aparecio un `@page` DENTRO del bloque de color de la 217. El formato es de la 223 y vive " +
        "en su propio bloque: ahi es donde lo busca quien lea el archivo.",
    ).not.toMatch(/@page\b/);
  });

  /**
   * La colocacion del bloque de impresion ANTES de `.dark` no es cosmetica: es la SEGUNDA de las
   * dos defensas contra la trampa del lector de tokens (la primera es `quitarBloquesDeImpresion`,
   * en el fixture). Si el bloque cae detras del `.dark` Y del espejo `prefers-color-scheme`, sus
   * hexes CLAROS pasan a ser los ultimos de la mitad «oscuro» y ganan: toda la verificacion de
   * tema oscuro pasaria a medir los pares claros, en verde.
   *
   * Hasta ahora las dos defensas solo se podian ver fallar JUNTAS, asi que cada una se podia
   * retirar sola sin que el gate dijese nada. Esto clava el segundo tirante.
   */
  it("el bloque de impresion va ANTES de `.dark`, o el lector de tokens mide el tema equivocado", () => {
    // Feature 223 (R24): por CONTENIDO. Con el ancla posicional, escribir el bloque del flujo
    // delante del de la 217 dejaba este caso midiendo el bloque nuevo —que no declara ni un
    // token— y aprobando aunque el de la 217 se hubiera ido al final del archivo.
    const impresion = bloqueDeLa217().indice;
    const oscuro = css.search(/^\.dark[,\s{]/m);
    expect(impresion, "no se encontro la regla `@media print`").toBeGreaterThan(-1);
    expect(oscuro, "no se encontro el selector `.dark` a principio de linea").toBeGreaterThan(-1);
    expect(
      impresion,
      "el bloque `@media print` quedo DESPUES de `.dark`. Sus hexes son los del tema CLARO: si " +
        "caen en esa mitad del archivo, `token(\"oscuro\", …)` empieza a devolverlos y todas las " +
        "comprobaciones de tema oscuro pasan a medir el tema claro EN VERDE.",
    ).toBeLessThan(oscuro);
  });
});

describe("feature 211 — donde se estampa la clase", () => {
  const layout = codigoSinComentarios(LAYOUT);

  it("el layout del portal lee la cookie EN EL SERVIDOR y monta el proveedor", () => {
    expect(layout, "no lee la cookie del tema").toMatch(/cookies\(\)/);
    expect(layout).toMatch(/COOKIE_TEMA/);
    expect(layout, "no normaliza el valor de la cookie").toMatch(/normalizarTema/);
    expect(layout, "no monta el proveedor: el control no encenderia nada").toMatch(
      /<TemaProvider\s+temaInicial=/,
    );
  });

  it("la cookie NO se lee en el layout raiz: eso volveria dinamica la landing publica", () => {
    const raiz = codigoSinComentarios("app/layout.tsx");
    expect(raiz).not.toMatch(/cookies\(\)/);
    expect(raiz).not.toMatch(/ordenex_tema|COOKIE_TEMA|TemaProvider/);
  });

  it("el interruptor vive en el encabezado, que es la unica pieza de toda pagina autenticada", () => {
    const header = codigoSinComentarios(HEADER);
    expect(header).toMatch(/<TemaToggle\s*\/>/);
  });
});
