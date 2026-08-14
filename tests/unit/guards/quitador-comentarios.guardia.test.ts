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
 * Es la misma familia que la 209 dejo fijada arriba («un `//` que abre una cadena si se lo
 * lleva»), girada de lado, y es la razon por la que la 209 dejo `analytics-paleta.test.ts` fuera
 * de su alcance. Desde la 223 ese archivo consume el parser de reglas CSS compartido, asi que la
 * puerta se cierra aqui.
 *
 * Medido en `app/globals.css` el 2026-08-14: **cero** `//` fuera de comentario de bloque, o sea
 * que hoy las dos pasadas dan el mismo resultado byte a byte. Riesgo LATENTE, no vivo — que es
 * justo cuando sale barato cerrarlo.
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

  it("LIMITACION CONOCIDA Y MEDIDA: un `//` que abre una cadena si se lo lleva", () => {
    // `startsWith("//")` (open-redirect) y `` `//iam.googleapis.com/...` `` son las DOS unicas
    // lineas de `lib/ app/ components/ hooks/ scripts/` donde esto pasa hoy (medido en la 209).
    // Se deja fijado para que la limitacion sea un hecho conocido y no una sorpresa: si un dia
    // hace falta cerrarla, el cambio es anadir las comillas a la clase `[^:]` — y este caso es
    // el que dira que se cerro.
    expect(quitarComentarios('if (!p.startsWith("//")) { llamar(); }')).not.toMatch(/llamar/);
  });
});
