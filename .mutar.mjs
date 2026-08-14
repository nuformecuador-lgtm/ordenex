/**
 * Aplica una mutacion nombrada sobre el arbol y la deja ESCRITA en disco, para que
 * `git diff` pueda confirmarla antes de creerse ningun resultado.
 *
 * uso: node .mutar.mjs <nombre>
 * Cada mutacion es un par [buscar, reemplazar] o una funcion sobre el contenido.
 * Autocomprobacion obligatoria: si el `buscar` no aparece, sale con codigo 2 y NO escribe.
 */
import { readFileSync, writeFileSync } from "node:fs";

const GLOBALS = "app/globals.css";
const HOJA = "app/(app)/cierres-admin/_components/cierre-factura.tsx";
const ADMIN = "app/(app)/cierres-admin/_components/CierresAdminModule.tsx";
const MODAL = "components/shared/Modal.tsx";

/** Mueve el bloque `@media print` que contiene `.papel-al-imprimir` al final del archivo. */
function moverBloqueDeLos217AlFinal(css) {
  const regla = css.search(/^\s*\.papel-al-imprimir\s*\{/m);
  if (regla < 0) throw new Error("no se encontro `.papel-al-imprimir`");
  const abre = css.lastIndexOf("@media print", regla);
  if (abre < 0) throw new Error("no se encontro el `@media print` que la envuelve");
  let hondura = 0;
  let i = css.indexOf("{", abre);
  for (; i < css.length; i += 1) {
    if (css[i] === "{") hondura += 1;
    else if (css[i] === "}") {
      hondura -= 1;
      if (hondura === 0) break;
    }
  }
  const bloque = css.slice(abre, i + 1);
  return css.slice(0, abre) + css.slice(i + 1) + "\n\n" + bloque + "\n";
}

const MUTACIONES = {
  // ── T5 / R24 — los anclajes por contenido
  "t5-bloque-217-al-final": [GLOBALS, moverBloqueDeLos217AlFinal],

  // ── §6.7 — las 19 filas, cada una con su variante INOCUA
  "1-borrar-bloque": [GLOBALS, (c) => quitarBloqueDelFlujo(c)],
  "1i-bloque-fuera-de-media-print": [
    GLOBALS,
    (c) => {
      const b = bloqueDelFlujo(c);
      const dentro = b.slice(b.indexOf("{") + 1, b.lastIndexOf("}"));
      return c.replace(b, dentro);
    },
  ],
  "2-quitar-guarda-has": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(
          'body:not(:has([role="dialog"] .hoja-imprimible)):has(.hoja-imprimible)\n    > *',
          "body\n    > *",
        ),
      ),
  ],
  "2i-guarda-solo-en-el-primero": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(
          'body:not(:has([role="dialog"] .hoja-imprimible)):has(.hoja-imprimible)\n    *:has(.hoja-imprimible)',
          "body\n    *:has(.hoja-imprimible)",
        ),
      ),
  ],
  "3-borrar-not-has-dialog-del-nivel-2": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replaceAll('body:not(:has([role="dialog"] .hoja-imprimible)):has', "body:has")),
  ],
  "3i-nivel-2-nunca-aplica": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replaceAll(
          'body:not(:has([role="dialog"] .hoja-imprimible)):has(.hoja-imprimible)',
          "body:not(:has(.hoja-imprimible)):has(.hoja-imprimible)",
        ),
      ),
  ],
  "3bis-i-a1-como-la-escribio-el-spec": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(
          '> *:not(:has([role="dialog"] .hoja-imprimible)):not(:has(.hoja-imprimible)),',
          '> *:not(:has([role="dialog"] .hoja-imprimible)),',
        ),
      ),
  ],
  "4-borrar-rama-nivel-1": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b
          .replace(
            /  body:has\(\[role="dialog"\] \.hoja-imprimible\) > \*:not\(:has\(\[role="dialog"\] \.hoja-imprimible\)\),\n/,
            "",
          )
          .replace(
            /  body:has\(\[role="dialog"\] \.hoja-imprimible\)\n    \*:has\(\[role="dialog"\] \.hoja-imprimible\)\n    > \*:not\(:has\(\[role="dialog"\] \.hoja-imprimible\)\):not\(:has\(\.hoja-imprimible\)\),\n/,
            "",
          ),
      ),
  ],
  "4i-anclar-en-alertdialog": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replaceAll('[role="dialog"]', '[role="alertdialog"]')),
  ],
  "5-quitar-condicion-open": [
    HOJA,
    (c) => c.replace('open && "hoja-imprimible"', '"hoja-imprimible"'),
  ],
  "5i-marcar-con-open-false": [
    HOJA,
    (c) => c.replace('open && "hoja-imprimible"', '!open && "hoja-imprimible"'),
  ],
  "6-quitar-overflow-visible-de-la-cadena": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace(/\n    overflow: visible !important;[^\n]*/, "")),
  ],
  "6i-overflow-visible-en-el-comentario": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(
          /\n    overflow: visible !important;[^\n]*/,
          "\n    /* overflow: visible !important; */",
        ),
      ),
  ],
  "7-quitar-position-static": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace(/\n    position: static !important;[^\n]*/, "")),
  ],
  "7i-position-static-en-la-hoja": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b
          .replace(/\n    position: static !important;[^\n]*/, "")
          .replace(
            "  .hoja-imprimible {\n    overflow: visible;",
            "  .hoja-imprimible {\n    position: static !important;\n    overflow: visible;",
          ),
      ),
  ],
  "8-borrar-page": [GLOBALS, (c) => enFlujo(c, (b) => b.replace(/\n  @page \{[^}]*\}\n/, "\n"))],
  "8i-page-en-un-comentario": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(/\n  @page \{([^}]*)\}\n/, "\n  /* @page { $1 } */\n"),
      ),
  ],
  "9-margin-cero": [GLOBALS, (c) => enFlujo(c, (b) => b.replace("margin: 12mm;", "margin: 0;"))],
  "9i-margin-1px": [GLOBALS, (c) => enFlujo(c, (b) => b.replace("margin: 12mm;", "margin: 1px;"))],
  "10-size-a4-portrait": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace("size: portrait;", "size: A4 portrait;")),
  ],
  "10i-size-en-centimetros": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace("size: portrait;", "size: 21cm 29.7cm;")),
  ],
  "11-anidar-en-layer-utilities": [
    GLOBALS,
    (c) => enFlujo(c, (b) => `@layer utilities {\n${b}\n}`),
  ],
  "11i-anidar-en-layer-a-secas": [GLOBALS, (c) => enFlujo(c, (b) => `@layer {\n${b}\n}`)],
  "12-token-en-el-bloque": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace("  @page {", "  .hoja-imprimible { --foo: #fff; }\n\n  @page {")),
  ],
  "12i-token-dentro-del-page": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace("    size: portrait;", "    --foo: #fff;\n    size: portrait;")),
  ],
  "13-bloque-delante-del-de-la-217": [
    GLOBALS,
    (c) => {
      const b = bloqueDelFlujo(c);
      const sin = c.replace(b, "");
      const regla = sin.search(/^\s*\.papel-al-imprimir\s*\{/m);
      const abre = sin.lastIndexOf("@media print", regla);
      return sin.slice(0, abre) + b + "\n\n" + sin.slice(abre);
    },
  ],
  "13i-tercer-media-print-vacio": [GLOBALS, (c) => c + "\n@media print {\n  .nada-de-nada { color: red; }\n}\n"],
  "14-regla-A-antes-que-la-B": [
    GLOBALS,
    (c) => {
      const b = bloqueDelFlujo(c);
      const cadena = extraerRegla(b, "  body:has(.hoja-imprimible),");
      const oculta = extraerRegla(b, '  body:has([role="dialog"] .hoja-imprimible) > *');
      return c.replace(b, b.replace(cadena, "@@CADENA@@").replace(oculta, cadena).replace("@@CADENA@@", oculta));
    },
  ],
  "14i-igualar-especificidades": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(
          "  body:has(.hoja-imprimible),\n  body:has(.hoja-imprimible) *:has(.hoja-imprimible) {",
          "  body:has(.hoja-imprimible):has(.hoja-imprimible):has(.hoja-imprimible):has(.hoja-imprimible),\n  body:has(.hoja-imprimible) *:has(.hoja-imprimible):has(.hoja-imprimible):has(.hoja-imprimible) {",
        ),
      ),
  ],
  "15-quitar-marca-de-hojafactura": [
    HOJA,
    (c) => c.replace('className="hoja-imprimible papel-al-imprimir', 'className="papel-al-imprimir'),
  ],
  "15i-marca-en-un-div-interior": [
    HOJA,
    (c) =>
      c
        .replace('className="hoja-imprimible papel-al-imprimir', 'className="papel-al-imprimir')
        .replace(
          '<div className="flex flex-col gap-5 p-5">{children}</div>',
          '<div className="hoja-imprimible flex flex-col gap-5 p-5">{children}</div>',
        ),
  ],
  "16-quitar-break-inside-de-la-fila": [
    HOJA,
    (c) => c.replace('"mb-2 break-inside-avoid overflow-hidden', '"mb-2 overflow-hidden'),
  ],
  "16i-break-inside-tambien-en-la-seccion": [
    HOJA,
    (c) =>
      c.replace(
        'aria-label={FACTURA_ORDENES_TITULO} className="flex flex-col"',
        'aria-label={FACTURA_ORDENES_TITULO} className="break-inside-avoid flex flex-col"',
      ),
  ],
  "17-quitar-important-de-max-width": [
    GLOBALS,
    (c) => enFlujo(c, (b) => b.replace("max-width: none !important;", "max-width: none;")),
  ],
  "17i-important-en-todas": [
    GLOBALS,
    (c) =>
      enFlujo(c, (b) =>
        b.replace(/^(    (?:display|inset|transform|max-height|margin|padding|border|box-shadow|background): [^;!]+);$/gm, "$1 !important;"),
      ),
  ],
  "18-borrar-overflow-y-auto-del-modulo": [
    ADMIN,
    (c) => c.replace('className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1"', 'className="flex flex-col gap-6 pr-1"'),
  ],
  "18i-borrar-overflow-auto-del-modal": [
    MODAL,
    (c) => c.replace('<div className="min-h-0 flex-1 overflow-auto">', '<div className="min-h-0 flex-1">'),
  ],
  "19-dos-hojas-en-el-mismo-modal": ["MARCADOR", null],
  "19i-quitar-role-dialog": ["MARCADOR", null],
};

/** El bloque `@media print` DEL FLUJO: el que NO contiene `.papel-al-imprimir`. */
function bloqueDelFlujo(css) {
  const bloques = [];
  const re = /@media print\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let hondura = 0;
    let i = m.index + m[0].length - 1;
    for (; i < css.length; i += 1) {
      if (css[i] === "{") hondura += 1;
      else if (css[i] === "}") {
        hondura -= 1;
        if (hondura === 0) break;
      }
    }
    bloques.push(css.slice(m.index, i + 1));
    re.lastIndex = i + 1;
  }
  const flujo = bloques.filter((b) => !b.includes(".papel-al-imprimir"));
  if (flujo.length !== 1) {
    throw new Error(`se esperaba 1 bloque de flujo, hay ${flujo.length} (de ${bloques.length} @media print)`);
  }
  return flujo[0];
}

function enFlujo(css, fn) {
  const b = bloqueDelFlujo(css);
  const nuevo = fn(b);
  if (nuevo === b) throw new Error("la mutacion no cambio nada dentro del bloque del flujo");
  return css.replace(b, nuevo);
}

function quitarBloqueDelFlujo(css) {
  return css.replace(bloqueDelFlujo(css), "");
}

/** Extrae la regla completa cuyo texto empieza en `inicio`. */
function extraerRegla(bloque, inicio) {
  const i = bloque.indexOf(inicio);
  if (i < 0) throw new Error(`no se encontro la regla que empieza en ${JSON.stringify(inicio)}`);
  const j = bloque.indexOf("}", bloque.indexOf("{", i));
  return bloque.slice(i, j + 1);
}

const nombre = process.argv[2];
const mut = MUTACIONES[nombre];
if (!mut) {
  console.error(`mutacion desconocida: ${nombre}\ndisponibles:\n  ${Object.keys(MUTACIONES).join("\n  ")}`);
  process.exit(2);
}
const [archivo, fn] = mut;
if (archivo === "MARCADOR") {
  console.error(`la mutacion ${nombre} se aplica A MANO sobre el test (ver progress/impl_223.md)`);
  process.exit(2);
}
const antes = readFileSync(archivo, "utf8");
let despues;
try {
  despues = fn(antes);
} catch (e) {
  console.error(`AUTOCOMPROBACION FALLIDA en ${nombre}: ${e.message}`);
  process.exit(2);
}
if (despues === antes) {
  console.error(`AUTOCOMPROBACION FALLIDA en ${nombre}: el archivo no cambio. NO hubo mutacion.`);
  process.exit(2);
}
writeFileSync(archivo, despues);
console.log(`mutacion ${nombre} aplicada sobre ${archivo} (${antes.length} -> ${despues.length} bytes)`);
