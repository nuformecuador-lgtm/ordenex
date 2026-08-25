import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  codigoSinComentarios,
  lineasSinComentarios,
  quitarComentarios,
  quitarComentariosCss,
  quitarComentariosSql,
} from "../../fixtures/sin-comentarios";

/**
 * Feature 209 — el test del QUITADOR COMPARTIDO.
 *
 * Vive en `tests/unit/guards/` a proposito: no es un unit test cualquiera, es la pieza de la
 * que cuelgan las decenas de guardias que escanean el fuente. Si se rompe, ninguna de ellas se
 * pone roja —una guardia solo se mueve cuando se mueve el ARBOL— asi que la unica forma de
 * enterarse es que este archivo grite. Por eso entra tambien en `pnpm run test:guardias`.
 *
 * Cada caso esta escrito en las DOS caras: que el quitador quita lo que tiene que quitar, y
 * que NO se lleva por delante el codigo. Un quitador que devolviera `""` pasaria la mitad de
 * los casos de una suite escrita solo en la primera cara, y dejaria a todas las guardias
 * afirmando sobre la nada.
 */

describe("209 — quitarComentarios: comentarios de LINEA", () => {
  it("quita el comentario de linea completa", () => {
    expect(quitarComentarios("  // solo prosa\nconst a = 1;")).not.toMatch(/prosa/);
  });

  it("quita el comentario que va AL FINAL de una linea de codigo", () => {
    // Es lo que se le escapa a `^\s*//.*$` (10 copias del censo de la 207): la linea no
    // empieza por `//`, asi que el comentario sobrevive entero y la guardia lo lee como codigo.
    const fuente = "const a = 1; // aqui NO se llama a parseFloat(\n";
    expect(quitarComentarios(fuente)).not.toMatch(/parseFloat/);
    expect(quitarComentarios(fuente)).toMatch(/const a = 1;/);
  });

  it("quita el comentario PEGADO al codigo, sin espacio delante", () => {
    // Es lo que se le escapa a `(^|\s)//.*$` (50 copias): exige espacio o inicio de linea.
    expect(quitarComentarios("};// nota con Number(\n")).not.toMatch(/Number/);
    expect(quitarComentarios("};// nota\n")).toMatch(/};/);
  });

  it("NO se come el `//` de una URL, ni lo que va detras en la misma linea", () => {
    // Es lo que rompe `//.*$` (10 copias): parte la cadena y con ella el resto de la linea.
    const fuente = 'const u = "https://ordenex.app/x"; const roto = Number(saldo);';
    const limpio = quitarComentarios(fuente);
    expect(limpio).toContain("https://ordenex.app/x");
    expect(limpio).toMatch(/Number\(saldo\)/);
  });

  it("`http://` tambien sobrevive (no solo el esquema seguro)", () => {
    expect(quitarComentarios('const u = "http://localhost:3000";')).toContain(
      "http://localhost:3000",
    );
  });

  it("el comentario que VIENE DESPUES de una URL en la misma linea si se quita", () => {
    const fuente = 'fetch("https://api.x/y"); // TODO: aqui iba un parseFloat(\n';
    const limpio = quitarComentarios(fuente);
    expect(limpio).toContain("https://api.x/y");
    expect(limpio).not.toMatch(/parseFloat/);
  });

  it("el `///` de un doc comment de Prisma se va entero", () => {
    expect(quitarComentarios("/// documenta busqueda_texto\nid String")).not.toMatch(
      /busqueda_texto/,
    );
  });
});

describe("209 — quitarComentarios: comentarios de BLOQUE y de JSX", () => {
  it("quita el bloque de una sola linea", () => {
    expect(quitarComentarios("const a = /* Number( */ 1;")).not.toMatch(/Number/);
  });

  it("quita el bloque MULTILINEA entero (docstrings incluidos)", () => {
    const fuente = ["/**", " * money-safe: sin parseFloat ni Number(", " */", "const a = 1;"].join(
      "\n",
    );
    const limpio = quitarComentarios(fuente);
    expect(limpio).not.toMatch(/parseFloat/);
    expect(limpio).not.toMatch(/money-safe/);
    expect(limpio).toMatch(/const a = 1;/);
  });

  it("el bloque NO es avido: dos bloques seguidos no se comen el codigo de en medio", () => {
    const fuente = "/* uno */ const vivo = 1; /* dos */";
    expect(quitarComentarios(fuente)).toMatch(/const vivo = 1;/);
  });

  it("quita el comentario de JSX `{/* … */}` y deja las llaves equilibradas", () => {
    const fuente = "<div>\n  {/* <DataTable descarga /> */}\n  <p>hola</p>\n</div>";
    const limpio = quitarComentarios(fuente);
    expect(limpio).not.toMatch(/DataTable/);
    expect(limpio.split("{").length).toBe(limpio.split("}").length);
    expect(limpio).toMatch(/<p>hola<\/p>/);
  });
});

describe("209 — quitarComentarios: NO se lleva por delante el codigo", () => {
  it("un fuente sin comentarios sale identico salvo blancos", () => {
    const fuente = 'export const A = { b: 1, c: "d" };\nfunction f() { return A.b / 2 / 3; }\n';
    expect(quitarComentarios(fuente).replace(/\s+/g, " ").trim()).toBe(
      fuente.replace(/\s+/g, " ").trim(),
    );
  });

  it("una division no es un comentario", () => {
    expect(quitarComentarios("const r = a / b / c;")).toMatch(/a \/ b \/ c/);
  });

  it("el codigo que comparte linea con un comentario sobrevive", () => {
    expect(quitarComentarios("prisma.orden.findMany(); // lectura")).toMatch(
      /prisma\.orden\.findMany\(\)/,
    );
  });

  it("CONTRAPRUEBA: un quitador que devolviera vacio fallaria estos casos", () => {
    // El caso que impide que este archivo se satisfaga con `const fuente = ""`, que es la
    // mutacion mas barata y la que dejaria a todas las guardias afirmando sobre la nada.
    const vacio = (_fuente: string) => "";
    expect(vacio("prisma.orden.findMany();")).not.toMatch(/findMany/);
    expect(quitarComentarios("prisma.orden.findMany();")).toMatch(/findMany/);
  });
});

describe("209 — quitarComentarios: conserva el NUMERO DE LINEAS", () => {
  it("un bloque multilinea no pega la linea de antes con la de despues", () => {
    const fuente = ["const antes = 1;", "/* uno", "   dos", "   tres */", "const despues = 2;"].join(
      "\n",
    );
    const lineas = lineasSinComentarios(fuente);
    expect(lineas.length).toBe(5);
    expect(lineas[0]).toMatch(/const antes = 1;/);
    expect(lineas[4]).toMatch(/const despues = 2;/);
    expect(lineas[1]).not.toMatch(/const despues/);
  });

  it("`lineasSinComentarios(f)[i]` es la linea i+1 de `f` (un censo que informa `archivo:linea` depende de esto)", () => {
    const fuente = ["/**", " * cabecera", " */", "import x from 'y';", "", "const z = 3;"].join(
      "\n",
    );
    const lineas = lineasSinComentarios(fuente);
    expect(lineas.length).toBe(fuente.split("\n").length);
    expect(lineas[3]).toMatch(/import x/);
    expect(lineas[5]).toMatch(/const z = 3;/);
  });
});

describe("209 — quitarComentariosSql", () => {
  it("quita el comentario `--` de linea completa y el de cola", () => {
    const sql = "-- crea la tabla\nCREATE TABLE t (id uuid); -- y su pk\n";
    const limpio = quitarComentariosSql(sql);
    expect(limpio).not.toMatch(/crea la tabla/);
    expect(limpio).not.toMatch(/y su pk/);
    expect(limpio).toMatch(/CREATE TABLE t \(id uuid\);/);
  });

  it("quita tambien los bloques `/* … */` conservando los saltos", () => {
    const sql = "/* nota\n   larga */\nALTER TABLE t ADD COLUMN c int;";
    const limpio = quitarComentariosSql(sql);
    expect(limpio).not.toMatch(/nota/);
    expect(limpio.split("\n").length).toBe(3);
  });

  it("la pasada de `--` va APARTE: `quitarComentarios` no se come un decremento", () => {
    // Si `--` viviera dentro de `quitarComentarios`, esta linea perderia todo lo que sigue al
    // decremento y cualquier censo de prohibiciones sobre el archivo daria un falso VERDE.
    const ts = "for (let i = n; i-- > 0; ) { prisma.orden.deleteMany(); }";
    expect(quitarComentarios(ts)).toMatch(/deleteMany/);
    expect(quitarComentariosSql(ts)).not.toMatch(/deleteMany/);
  });
});

/**
 * Feature 223 — LA PASADA DE CSS, y por que no puede ser la de TypeScript.
 *
 * En CSS **no existe el comentario de linea `//`**. Aplicarle la pasada de `//` a una hoja de
 * estilos no quita ni un comentario —no hay ninguno que quitar— y en cambio se lleva por delante
 * una URL protocolo-relativa `url(//cdn/x)` **y todo lo que le siga en esa linea**. Lo que
 * desaparece es una DECLARACION, y a un censo al que le falta una declaracion no le pasa nada
 * ruidoso: **afirma de menos y sigue verde**.
 *
 * Es la familia de fallo que la 209 dejo fijada como limitacion conocida, girada de lado, y es la
 * razon por la que aquella dejo `analytics-paleta.test.ts` fuera de su alcance. Desde la 223 ese
 * archivo consume el parser de reglas CSS compartido, asi que la puerta se cierra aqui.
 *
 * **Desde la 283 las dos hermanas ya no comparten la ceguera.** `quitarComentarios` entiende
 * cadenas desde el 2026-08-25; `quitarComentariosCss` NO, y es deliberado (`design.md` §6.3: el
 * daño medido en el unico `.css` real del repo es cero). Lo que se decia arriba —«la misma
 * familia»— dejo de describir el estado: hoy la ceguera es solo de esta pasada, y por eso el
 * bloque «283 — cables trampa de las hermanas» del final del archivo la afirma directamente en
 * vez de dejarla colgando de una equivalencia.
 *
 * Medido en `app/globals.css` el 2026-08-14 y re-medido el 2026-08-25: **cero** `//` fuera de
 * comentario de bloque y **cero** `/*` entrecomillado, o sea que hoy las dos pasadas dan el mismo
 * resultado byte a byte. Riesgo LATENTE, no vivo — que es justo cuando sale barato cerrarlo.
 */
describe("223 — quitarComentariosCss: en CSS, la pasada de `//` solo puede hacer daño", () => {
  /** Una hoja con una URL protocolo-relativa y, detras, una declaracion que tiene que vivir. */
  const HOJA = [
    "/* prosa que menciona --color-inventado */",
    "@font-face { src: url(//cdn.ordenex.app/f.woff2); font-weight: 700; }",
    ".x { color: #123456; }",
  ].join("\n");

  it("EL CASO: la declaracion que sigue a `url(//…)` SOBREVIVE", () => {
    const limpio = quitarComentariosCss(HOJA);
    expect(limpio, "se perdio la URL protocolo-relativa").toContain("url(//cdn.ordenex.app/f.woff2)");
    expect(
      limpio,
      "se perdio `font-weight: 700`, que iba DETRAS de la URL en la misma linea. Un censo que " +
        "leyera esta hoja diria que la declaracion no existe, y lo diria en verde.",
    ).toContain("font-weight: 700");
    expect(limpio).toContain("color: #123456");
  });

  it("CONTRAPRUEBA: el quitador de TypeScript SI se la lleva (por eso van aparte)", () => {
    const conElDeTs = quitarComentarios(HOJA);
    expect(conElDeTs, "la URL sobrevive al quitador de TS: entonces este caso no prueba nada")
      .not.toContain("cdn.ordenex.app");
    expect(
      conElDeTs,
      "si `font-weight: 700` sobreviviera al quitador de TypeScript, las dos pasadas serian " +
        "equivalentes y esta separacion no compraria nada",
    ).not.toContain("font-weight: 700");
  });

  it("y si quita los comentarios de BLOQUE, que son los unicos que hay en CSS", () => {
    const limpio = quitarComentariosCss(HOJA);
    expect(limpio).not.toMatch(/--color-inventado/);
    expect(limpio).not.toMatch(/prosa/);
  });

  it("conserva el numero de lineas: los censos que vuelven al fuente crudo dependen de ello", () => {
    const multilinea = ["/* uno", "   dos", "   tres */", ".a { color: red; }"].join("\n");
    expect(quitarComentariosCss(multilinea).split("\n")).toHaveLength(4);
    expect(quitarComentariosCss(HOJA).split("\n")).toHaveLength(HOJA.split("\n").length);
  });

  it("CONTRAPRUEBA: un quitador que devolviera vacio fallaria estos casos", () => {
    const vacio = (_fuente: string) => "";
    expect(vacio(HOJA)).not.toContain("color: #123456");
    expect(quitarComentariosCss(HOJA)).toContain("color: #123456");
  });

  it("y sobre el CSS de HOY las dos pasadas coinciden: el riesgo era latente, no vivo", () => {
    // NOTA DE LA 283 (2026-08-25): esta equivalencia se ESTRECHO sin que su asercion cambiara.
    // Desde que `quitarComentarios` entiende cadenas, un `//` que llegara ENTRECOMILLADO
    // —`src: url("//cdn/x")`— dejaria a las dos pasadas coincidiendo igual, y este caso no diria
    // nada aunque `quitarComentariosCss` siguiera sin proteger cadenas. Ese hueco lo cubre ahora
    // el caso «DEUDA DECLARADA» del bloque de cables trampa, al final del archivo.
    const crudo = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(
      quitarComentariosCss(crudo),
      "dejaron de coincidir: `app/globals.css` estrenó un `//` fuera de comentario. Con el " +
        "quitador viejo, lo que hubiera detrás en esa línea habría desaparecido de todos los " +
        "censos que leen este archivo, en verde. Ya no, pero conviene mirar qué se añadió.",
    ).toBe(quitarComentarios(crudo));
  });
});

describe("209 — codigoSinComentarios lee del arbol de verdad", () => {
  it("devuelve el codigo del archivo, ya despiojado", () => {
    const codigo = codigoSinComentarios("tests/fixtures/sin-comentarios.ts");
    expect(codigo).toMatch(/export function quitarComentarios/);
    // La cabecera del modulo CITA a proposito las cinco semanticas del censo; si el quitador
    // no funcionara, esa prosa saldria en el resultado.
    expect(codigo).not.toMatch(/setenta y|74 archivos/);
  });

  it("el archivo que lee existe (si se renombrara, este caso avisa en vez de callar)", () => {
    expect(
      fs.existsSync(path.join(process.cwd(), "tests/fixtures/sin-comentarios.ts")),
    ).toBe(true);
  });
});

describe("209 — las CUATRO semanticas que este helper sustituye", () => {
  // Fijadas como test para que el motivo de la unificacion quede medido y no contado. Si
  // alguien vuelve a escribir una de estas a mano, aqui esta lo que se le escapa.
  const conCola = "const a = 1; // menciona parseFloat(";
  const pegado = "};// menciona parseFloat(";
  const conUrl = 'const u = "https://x/y"; const b = Number(c);';

  it("`^\\s*//.*$` deja vivo el comentario de cola", () => {
    expect(conCola.replace(/^\s*\/\/.*$/gm, "")).toMatch(/parseFloat/);
    expect(quitarComentarios(conCola)).not.toMatch(/parseFloat/);
  });

  it("`(^|\\s)//.*$` deja vivo el comentario pegado al codigo", () => {
    expect(pegado.replace(/(^|\s)\/\/.*$/gm, "$1")).toMatch(/parseFloat/);
    expect(quitarComentarios(pegado)).not.toMatch(/parseFloat/);
  });

  it("`//.*$` se come la URL y el codigo que la sigue", () => {
    expect(conUrl.replace(/\/\/.*$/gm, "")).not.toMatch(/Number\(c\)/);
    expect(quitarComentarios(conUrl)).toMatch(/Number\(c\)/);
  });

  it("CERRADA POR LA 283: un `//` dentro de una cadena YA NO se lleva el codigo que le sigue", () => {
    // Este caso ERA la limitacion conocida de la 209, dejada fijada con la frase «si un dia hace
    // falta cerrarla ... este caso es el que dira que se cerro». Se cerro el 2026-08-25 con la
    // ficha 283, y NO como la 209 preveia —anadir las comillas a la clase `[^:]`—: eso habria
    // cerrado solo este caso y no el que hacia el daño grande, un `/*` dentro de un `//` o de una
    // cadena abriendo bloque y tragandose el archivo hasta el siguiente `*/`. La linea real del
    // arbol que lo motivo es `LoginForm.tsx`, `!redirectParam.startsWith("//")` (guarda de
    // open-redirect): con el quitador viejo, el `)) {` que la sigue desaparecia del texto que
    // leen las guardias.
    const fuente = 'if (!p.startsWith("//")) { llamar(); }';
    expect(quitarComentarios(fuente)).toMatch(/llamar/);
    expect(quitarComentarios(fuente)).toContain('"//"');
    // La otra cara, para que el caso no pase por haber dejado de quitar nada:
    expect(quitarComentarios(fuente + " // y aqui un parseFloat(")).not.toMatch(/parseFloat/);
  });
});

/**
 * Feature 283 — EL DEFECTO QUE SE CIERRA: un `/*` escrito dentro de un `//` o dentro de una
 * cadena abria comentario de bloque y se tragaba el codigo hasta el siguiente `*\/` del archivo.
 *
 * Los casos van CONTRA LAS DOS IMPLEMENTACIONES a la vez —el quitador de la 209 inlineado y el
 * de hoy— porque la suite verde no demuestra nada aqui: la suite YA estaba verde con el defecto
 * dentro. Ese es literalmente el problema. Lo unico que demuestra el arreglo es un caso que
 * FALLA con el viejo y PASA con el nuevo, y por eso los dos lados estan escritos en el mismo
 * `it`.
 *
 * Es el mismo patron que este archivo ya usa mas arriba con las cuatro semanticas de la 207.
 */
describe("283 — el defecto: un `/*` mal colocado abria bloque y se comia el archivo", () => {
  /** El quitador de la 209, tal cual estaba. No se usa fuera de este bloque. */
  const quitadorViejo = (f: string) =>
    f
      .replace(/\/\*[\s\S]*?\*\//g, (bloque) => " " + bloque.replace(/[^\n]/g, ""))
      .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");

  it("R7 un `/*` dentro de un comentario de LINEA ya no abre bloque", () => {
    // El caso real del arbol: `novedad-acciones-sin-maqueta.guardia.test.ts:295` cita
    // `lib/actions/**` dentro de un `//`, y el `/*` de ese comodin abria un bloque que cerraba
    // 248 lineas mas abajo, en el `*/` de un docstring.
    const fuente = [
      "// aqui no hay import de `lib/actions/**` y por tanto no hay productor que valga",
      "const vive = 1;",
      "/** un docstring cualquiera, mas abajo */",
      "const tambienVive = 2;",
    ].join("\n");

    expect(
      quitadorViejo(fuente),
      "el quitador viejo NO se comia el codigo: entonces este caso no reproduce el defecto",
    ).not.toMatch(/const vive/);
    expect(quitarComentarios(fuente)).toMatch(/const vive = 1;/);
    expect(quitarComentarios(fuente)).toMatch(/const tambienVive = 2;/);
    // La otra cara: los comentarios de verdad siguen desapareciendo.
    expect(quitarComentarios(fuente)).not.toMatch(/no hay productor que valga/);
    expect(quitarComentarios(fuente)).not.toMatch(/un docstring cualquiera/);
  });

  it("R8 un `/*` dentro de una CADENA ya no abre bloque", () => {
    // El peor caso del arbol: `cotizacion-orden-service.test.ts:243` escribe `next/*` dentro del
    // titulo de un `it`, y el bloque cerraba en la linea 752. 386 lineas de codigo invisibles.
    const fuente = [
      'it("el service no conoce HTTP: no importa nada de next/* ni recibe Request", () => {});',
      "const vive = 1;",
      "/** El lote donde `z1` resuelve y `z3` no. */",
      "const tambienVive = 2;",
    ].join("\n");

    expect(
      quitadorViejo(fuente),
      "el quitador viejo NO se comia el codigo: entonces este caso no reproduce el defecto",
    ).not.toMatch(/const vive/);
    expect(quitarComentarios(fuente)).toMatch(/const vive = 1;/);
    expect(quitarComentarios(fuente)).toMatch(/const tambienVive = 2;/);
    // La cadena sale entera, con su `next/*` dentro.
    expect(quitarComentarios(fuente)).toContain("next/*");
    // Y el docstring de verdad si se va.
    expect(quitarComentarios(fuente)).not.toMatch(/El lote donde/);
  });

  it("R9 un `//` dentro de una CADENA ya no se lleva el resto de la linea", () => {
    // El caso real: `LoginForm.tsx:34`, `!redirectParam.startsWith("//")`, la guarda de
    // open-redirect. Con el quitador viejo, el `)) {` que la sigue desaparecia.
    const fuente = 'if (!redirectParam.startsWith("//")) { llamar(); }';

    expect(
      quitadorViejo(fuente),
      "el quitador viejo NO se comia el codigo: entonces este caso no reproduce el defecto",
    ).not.toMatch(/llamar/);
    expect(quitarComentarios(fuente)).toMatch(/llamar\(\);/);
    expect(quitarComentarios(fuente)).toContain('"//"');
    // La otra cara: un comentario de verdad detras de esa misma cadena si se va.
    expect(quitarComentarios(fuente + " // con un parseFloat( dentro")).not.toMatch(/parseFloat/);
  });

  it("R10 NO-REGRESION: una URL en una cadena sigue entera, y con ella el codigo que la sigue", () => {
    // Esta fila es deliberadamente distinta de las tres de arriba: aqui el quitador viejo YA
    // acertaba —para eso estaba el `[^:]`— y el escaner nuevo tiene que seguir dandole la razon.
    const fuente = 'const u = "https://ordenex.app/x"; const b = Number(saldo);';

    expect(quitadorViejo(fuente), "el viejo tambien acierta aqui: es una no-regresion").toMatch(
      /Number\(saldo\)/,
    );
    expect(quitarComentarios(fuente)).toContain("https://ordenex.app/x");
    expect(quitarComentarios(fuente)).toMatch(/Number\(saldo\)/);

    const conHttp = 'fetch("http://localhost:3000/api/x"); const c = Number(otro);';
    expect(quitadorViejo(conHttp)).toMatch(/Number\(otro\)/);
    expect(quitarComentarios(conHttp)).toContain("http://localhost:3000/api/x");
    expect(quitarComentarios(conHttp)).toMatch(/Number\(otro\)/);

    // Y una URL SIN comillas dentro de un docstring: tampoco se lleva el cierre del bloque.
    const enBloque = "/** ver https://ordenex.app/docs */\nconst vive = 1;";
    expect(quitarComentarios(enBloque)).toMatch(/const vive = 1;/);
    expect(quitarComentarios(enBloque)).not.toMatch(/ordenex\.app\/docs/);
  });
});

describe("283 — cadenas, plantillas y la comilla sin pareja", () => {
  it("R13 una comilla sin pareja EN SU LINEA no abre cadena (el texto JSX de un `.tsx`)", () => {
    // Sin esta regla el escaner introduciria un defecto NUEVO en vez de cerrar el viejo: en un
    // `.tsx` el texto JSX no va entrecomillado, asi que el apostrofo de `Don't` abriria una
    // cadena hasta el siguiente `'` del archivo y todos los comentarios de por medio dejarian de
    // quitarse. En JavaScript una cadena `'…'` no puede abarcar varias lineas: si no hay pareja
    // antes del `\n`, no era una cadena.
    const fuente = [
      "<p>Don't panic</p>",
      "// aqui un comentario con parseFloat(",
      "const vivo = 1; // y otro con Number(",
      "const s = 'texto normal';",
    ].join("\n");
    const limpio = quitarComentarios(fuente);

    expect(limpio, "el comentario de linea dejo de quitarse: la comilla abrio cadena").not.toMatch(
      /parseFloat/,
    );
    expect(limpio).not.toMatch(/Number\(/);
    expect(limpio).toMatch(/const vivo = 1;/);
    expect(limpio).toContain("Don't panic");
    expect(limpio).toContain("'texto normal'");
  });

  it("R13 una comilla invertida sin pareja EN EL RESTO DEL ARCHIVO tampoco abre plantilla", () => {
    const fuente = [
      "<p>El separador es ` y nada mas</p>",
      "// comentario con parseFloat(",
      "const vivo = 2;",
    ].join("\n");
    const limpio = quitarComentarios(fuente);

    expect(limpio, "la comilla invertida suelta se trago el resto del archivo").not.toMatch(
      /parseFloat/,
    );
    expect(limpio).toMatch(/const vivo = 2;/);
    expect(limpio).toContain("El separador es `");
  });

  it("R11 una comilla ESCAPADA no termina la cadena", () => {
    // Si el escape no se respetara, la cadena cerraria en la comilla escapada y el `//` que
    // viene despues —que es TEXTO de la cadena— se leeria como comentario.
    const fuente = "const a = 'no \\' termina aqui, y este // no es comentario';\nconst vivo = 1;";
    const limpio = quitarComentarios(fuente);

    expect(limpio, "la cadena cerro en la comilla escapada").toContain("// no es comentario");
    expect(limpio).toMatch(/const vivo = 1;/);

    const conComillaDoble = 'const b = "ni \\" aqui, con su // dentro"; const c = 1;';
    expect(quitarComentarios(conComillaDoble)).toContain("// dentro");
    expect(quitarComentarios(conComillaDoble)).toMatch(/const c = 1;/);
  });

  it("R12 una plantilla MULTILINEA sale entera, con su `//` de texto dentro", () => {
    const fuente = [
      "const t = `",
      "  http://ordenex.app/x",
      "  // esto NO es un comentario: es texto de la plantilla",
      "`;",
      "const vivo = 1; // esto SI lo es, y menciona parseFloat(",
    ].join("\n");
    const lineas = lineasSinComentarios(fuente);

    expect(lineas).toHaveLength(5);
    expect(lineas[1]).toContain("http://ordenex.app/x");
    expect(lineas[2]).toContain("// esto NO es un comentario");
    expect(lineas[4]).toMatch(/const vivo = 1;/);
    expect(lineas[4], "el comentario de verdad sobrevivio").not.toMatch(/parseFloat/);
  });

  it("R12 una plantilla anidada dentro de un `${…}` no cierra la de fuera", () => {
    // Con una bandera booleana en vez de una pila, la plantilla de fuera cerraria en la primera
    // comilla invertida de dentro y a partir de ahi el escaner leeria codigo donde hay texto —y
    // texto donde hay codigo—.
    const fuente = "const s = `a${b ? `x` : `y`}c`; // con parseFloat(\nconst vivo = 1;";
    const limpio = quitarComentarios(fuente);

    expect(limpio, "el comentario de despues de la plantilla no se quito").not.toMatch(
      /parseFloat/,
    );
    expect(limpio).toContain("`a${b ? `x` : `y`}c`");
    expect(limpio).toMatch(/const vivo = 1;/);
  });

  it("R4 un bloque abierto DENTRO DE UNA CADENA ya no desalinea el archivo entero", () => {
    // Es el caso que desalineaba `cotizacion-orden-service.test.ts` desde su linea 243: el
    // barrido viejo vaciaba 500 lineas de golpe y cualquier censo que informara `archivo:linea`
    // seguia contando bien las lineas... sobre un texto en el que el codigo ya no estaba.
    const fuente = [
      'const t = "cita next/* dentro de una cadena";',
      "const uno = 1;",
      "const dos = 2;",
      "/** y aqui un docstring que cerraba el bloque fantasma */",
      "const tres = 3;",
    ].join("\n");
    const lineas = lineasSinComentarios(fuente);

    expect(lineas).toHaveLength(5);
    expect(lineas[0]).toContain("next/*");
    expect(lineas[1]).toMatch(/const uno = 1;/);
    expect(lineas[2]).toMatch(/const dos = 2;/);
    expect(lineas[3], "el docstring de verdad sobrevivio").not.toMatch(/docstring/);
    expect(lineas[4]).toMatch(/const tres = 3;/);
  });

  it("R22 sobre un archivo REAL del arbol, el recuento de lineas no se mueve", () => {
    const crudo = fs.readFileSync(
      path.join(process.cwd(), "tests/fixtures/sin-comentarios.ts"),
      "utf8",
    );
    expect(lineasSinComentarios(crudo)).toHaveLength(crudo.split("\n").length);
    // Y `lineasSinComentarios` no tiene reglas propias: es `quitarComentarios` partido en lineas.
    expect(lineasSinComentarios(crudo).join("\n")).toBe(quitarComentarios(crudo));
  });

  it("LIMITACION QUE QUEDA (283): una regex con `/*` sin escapar SI abre comentario", () => {
    // Escrito con el mismo formato con el que la 209 y la 223 dejaron las suyas, y describiendo
    // el comportamiento REAL, no el deseado. Distinguir un literal de expresion regular de una
    // division exige el token anterior, o sea un parser de TypeScript: este modulo esta en el
    // camino caliente de 159 suites y un parse por archivo no se paga.
    //
    // Como se sabria si dejara de ser teorico: el censo diferencial de la 283 recorre los 2.697
    // `.ts`/`.tsx` del arbol y exige CERO lineas perdidas frente al barrido viejo. El dia que una
    // regex asi se escriba, ese censo la nombra con archivo y linea. Hoy son cero.
    const conRegex = [
      "const re = /[/*]/;",
      "const vivo = 1;",
      "/** un docstring cualquiera */",
      "const tras = 2;",
    ].join("\n");
    expect(quitarComentarios(conRegex), "la limitacion se cerro: actualiza este caso").not.toMatch(
      /const vivo/,
    );

    // Y la forma de esquivarla, que es la que se escribe naturalmente: escapar el asterisco.
    const escapada = [
      "const re = /[/\\*]/;",
      "const vivo = 1;",
      "/** un docstring cualquiera */",
      "const tras = 2;",
    ].join("\n");
    expect(quitarComentarios(escapada)).toMatch(/const vivo = 1;/);
    expect(quitarComentarios(escapada)).not.toMatch(/docstring/);
  });
});

/**
 * Feature 283 — LOS DOS CABLES TRAMPA DE LAS HERMANAS.
 *
 * `quitarComentariosSql` y `quitarComentariosCss` quedaron FUERA del arreglo del 2026-08-25, y
 * no por comodidad: el daño medido ese dia es **cero lineas en cero archivos** en las dos (307
 * `.sql`, de los que 8 llevan un `/*` dentro de una linea `--` pero NINGUNO tiene un `*\/`
 * posterior que haga casar el regex; y 1 solo `.css` real, con cero `//` y cero `/*`
 * entrecomillado). En SQL, ademas, el arreglo correcto no es este escaner: haria falta un lexer
 * propio (dollar-quoting `$tag$` con tags anidados, escape `''`, identificadores `"…"` y bloques
 * que en Postgres ANIDAN).
 *
 * Acotar no es abandonar, y la diferencia entre las dos cosas es exactamente este bloque: dos
 * casos que se ponen rojos NOMBRANDO EL ARCHIVO el dia que aparezca la precondicion del daño.
 * Es el mismo patron con el que la 223 dejo su canario sobre `app/globals.css`: riesgo LATENTE,
 * no vivo, que es justo cuando sale barato cerrarlo.
 */
describe("283 — cables trampa de las hermanas (SQL y CSS)", () => {
  /**
   * Escaner minimo de SQL: literales `'…'` con escape `''`, dollar-quoting `$tag$` (con el tag
   * exacto, porque este arbol ya anida `$q$` dentro de `$$`) y comentarios de linea `--`.
   * Devuelve las posiciones donde vive la precondicion del daño.
   */
  function marcasSql(src: string): { barraEnComentario: number[]; barraEnLiteral: number[]; guionesEnLiteral: number[] } {
    const marcas = { barraEnComentario: [] as number[], barraEnLiteral: [] as number[], guionesEnLiteral: [] as number[] };
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "'") {
        let j = i + 1;
        while (j < src.length) {
          if (src[j] === "'" && src[j + 1] === "'") {
            j += 2;
            continue;
          }
          if (src[j] === "'") break;
          j++;
        }
        const cuerpo = src.slice(i + 1, j);
        if (cuerpo.includes("/*")) marcas.barraEnLiteral.push(i + 1 + cuerpo.indexOf("/*"));
        if (cuerpo.includes("--")) marcas.guionesEnLiteral.push(i + 1 + cuerpo.indexOf("--"));
        i = j + 1;
        continue;
      }
      if (c === "$") {
        const m = /^\$[A-Za-z_0-9]*\$/.exec(src.slice(i));
        if (m) {
          const tag = m[0];
          const fin = src.indexOf(tag, i + tag.length);
          const dentro = marcasSql(fin === -1 ? src.slice(i + tag.length) : src.slice(i + tag.length, fin));
          const base = i + tag.length;
          marcas.barraEnComentario.push(...dentro.barraEnComentario.map((p) => p + base));
          marcas.barraEnLiteral.push(...dentro.barraEnLiteral.map((p) => p + base));
          marcas.guionesEnLiteral.push(...dentro.guionesEnLiteral.map((p) => p + base));
          i = fin === -1 ? src.length : fin + tag.length;
          continue;
        }
      }
      if (c === "-" && src[i + 1] === "-") {
        const salto = src.indexOf("\n", i);
        const fin = salto === -1 ? src.length : salto;
        const cuerpo = src.slice(i, fin);
        if (cuerpo.includes("/*")) marcas.barraEnComentario.push(i + cuerpo.indexOf("/*"));
        i = fin;
        continue;
      }
      i++;
    }
    return marcas;
  }

  function sqlDelArbol(): string[] {
    const raiz = path.join(process.cwd(), "db/migrations");
    const salida: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (e.name.endsWith(".sql")) salida.push(p);
      }
    };
    recorrer(raiz);
    return salida;
  }

  it("CABLE TRAMPA SQL: ninguna migracion cumple todavia la precondicion del daño", () => {
    const archivos = sqlDelArbol();
    expect(archivos.length, "no se encontro ni un `.sql`: el cable trampa no esta midiendo nada")
      .toBeGreaterThan(200);

    const culpables: string[] = [];
    for (const f of archivos) {
      const src = fs.readFileSync(f, "utf8");
      const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
      const m = marcasSql(src);
      for (const pos of [...m.barraEnComentario, ...m.barraEnLiteral]) {
        if (src.indexOf("*/", pos + 2) !== -1) {
          culpables.push(rel + " — un `/*` fuera de codigo CON un `*/` posterior");
          break;
        }
      }
      if (m.guionesEnLiteral.length > 0) culpables.push(rel + " — un `--` dentro de un literal");
    }

    expect(
      culpables,
      "la deuda de `quitarComentariosSql` acaba de pasar de LATENTE a VIVA. Estos archivos " +
        "cumplen la precondicion del daño: el regex de bloque va a casar donde no hay comentario, " +
        "o la pasada de `--` va a partir un literal. Desde ese momento cualquier censo que lea SQL " +
        "afirma de menos, en verde. El motivo por el que se difirio esta en " +
        "`specs/283-quitador-comentarios/design.md` §6.2, y el arreglo pedia un lexer propio:\n" +
        culpables.join("\n"),
    ).toEqual([]);
  });

  it("CABLE TRAMPA CSS: `app/globals.css` no ha estrenado un `/*` dentro de una cadena", () => {
    const crudo = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const dentroDeCadena: string[] = [];
    let i = 0;
    while (i < crudo.length) {
      const c = crudo[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < crudo.length && crudo[j] !== c) {
          if (crudo[j] === "\\") j++;
          j++;
        }
        const cuerpo = crudo.slice(i + 1, j);
        if (cuerpo.includes("/*")) dentroDeCadena.push(cuerpo.slice(0, 60));
        i = j + 1;
        continue;
      }
      i++;
    }
    expect(
      dentroDeCadena,
      "`app/globals.css` estreno un `/*` dentro de una cadena. `quitarComentariosCss` sigue sin " +
        "entender cadenas —a proposito, ver `design.md` §6.3— asi que va a tratarlo como apertura " +
        "de comentario y se va a comer hasta el siguiente `*/` de la hoja. Toca meterle el escaner.",
    ).toEqual([]);
  });

  it("DEUDA DECLARADA: `quitarComentariosCss` sigue SIN proteger las cadenas, y `quitarComentarios` ya no", () => {
    // Hasta la 283 las dos funciones compartian esta ceguera, asi que el canario de equivalencia
    // de la 223 (mas arriba) la cubria de rebote. Ya no: desde el 2026-08-25 solo la comparte la
    // de CSS, y una deuda que nadie afirma directamente se vuelve invisible. Este caso la afirma.
    const hoja = ['.a { content: "/* no soy un comentario */"; color: red; }'].join("\n");

    expect(
      quitarComentariosCss(hoja),
      "`quitarComentariosCss` dejo de comerse el contenido entrecomillado: la deuda se cerro y " +
        "este caso hay que actualizarlo (y el docstring de la funcion tambien).",
    ).not.toContain("no soy un comentario");
    expect(quitarComentarios(hoja), "el escaner de la 283 SI respeta la cadena").toContain(
      "/* no soy un comentario */",
    );
    // Las dos cara a cara: es la divergencia lo que hace visible la deuda.
    expect(quitarComentariosCss(hoja)).not.toBe(quitarComentarios(hoja));
  });
});
