import { Fragment, type ReactNode } from "react";

/**
 * ⭑ FICHA 433 — el renderizador de Markdown del módulo de ayuda.
 *
 * POR QUÉ NO HAY UNA DEPENDENCIA NUEVA. Se buscó primero: el repo no tiene ningún
 * renderizador de Markdown ni ninguna librería que lo haga (`react-markdown`, `marked`,
 * `remark`, `gray-matter` — ninguna está en `package.json`). Y lo que hay que renderizar está
 * MEDIDO sobre los 31 documentos:
 *
 *   537 negritas · 192 títulos (`#`/`##`) · 110 ítems de lista · 54 filas de tabla
 *    33 citas · 13 cursivas · 10 códigos en línea · 6 líneas de bloque de código
 *     0 ENLACES · 0 IMÁGENES · 0 HTML CRUDO
 *
 * Es un subconjunto cerrado, y el contenido no es entrada de usuario: son archivos del
 * repositorio, revisados, que viajan en el mismo commit que el código. Un `.tsx` de ~150
 * líneas lo cubre entero.
 *
 * ⚠️ NO SE USA `dangerouslySetInnerHTML` EN NINGÚN PUNTO. Este módulo construye elementos de
 * React, así que el texto de un documento no puede convertirse en marcado por accidente: un
 * `<script>` escrito en un `.md` se pinta como las letras que es. Con esa decisión, la
 * superficie de inyección es cero y deja de importar quién escriba el siguiente documento.
 *
 * ⚠️ LO QUE NO ENTIENDE, dicho en voz alta: enlaces, imágenes, HTML crudo, listas anidadas,
 * títulos dentro de una cita y énfasis anidado. Hoy ningún documento usa nada de eso (0
 * ocurrencias, medido). Si mañana uno lo usa, la sintaxis se pinta como texto literal — feo,
 * pero honesto — y la guardia `ayuda-render-sin-filtracion.guardia.test.ts` se pone
 * roja para que la decisión la tome alguien y no el renderizador en silencio.
 *
 * LOS TÍTULOS BAJAN UN NIVEL: `#` → `<h2>`, `##` → `<h3>`. El `<h1>` de la página es el del
 * `PageHeader` («Ayuda»), y duplicarlo rompería el esquema de encabezados. No es una
 * comodidad: `publico/entrar-y-recuperar-contrasena.md` tiene DOS `#` porque cubre dos
 * pantallas, así que «quitar el primer `#` y ascenderlo al título» no era una opción.
 */

/** Los patrones de énfasis en línea, en orden de prioridad (`**` antes que `*`). */
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

/**
 * Renderiza el texto de una línea: negritas, cursivas y código en línea.
 * Todo lo demás es texto literal.
 */
export function renderizarInline(texto: string, claveBase: string): ReactNode {
  const trozos = texto.split(INLINE).filter((trozo) => trozo !== "");

  return trozos.map((trozo, i) => {
    const clave = `${claveBase}-${i}`;
    if (trozo.startsWith("**") && trozo.endsWith("**") && trozo.length > 4) {
      return (
        <strong key={clave} className="font-semibold text-foreground">
          {trozo.slice(2, -2)}
        </strong>
      );
    }
    if (trozo.startsWith("*") && trozo.endsWith("*") && trozo.length > 2) {
      return <em key={clave}>{trozo.slice(1, -1)}</em>;
    }
    if (trozo.startsWith("`") && trozo.endsWith("`") && trozo.length > 2) {
      return (
        <code
          key={clave}
          className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {trozo.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={clave}>{trozo}</Fragment>;
  });
}

const CLASES_TITULO: Record<number, string> = {
  2: "mt-8 text-xl font-semibold tracking-tight text-foreground first:mt-0",
  3: "mt-6 text-lg font-semibold tracking-tight text-foreground first:mt-0",
  4: "mt-5 text-base font-semibold text-foreground first:mt-0",
};

/** Es la fila separadora de una tabla (`| --- | --- |`), no una fila de datos. */
function esSeparadorDeTabla(linea: string): boolean {
  return /^\|[\s:|-]+\|$/.test(linea.trim()) && linea.includes("-");
}

/** `| a | b |` -> `["a","b"]`. */
function celdas(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((celda) => celda.trim());
}

/**
 * Markdown -> elementos de React. Devuelve la lista de bloques; quien llama decide el
 * envoltorio (y con él el ancho de línea).
 */
export function renderizarMarkdown(markdown: string): ReactNode[] {
  const lineas = markdown.split(/\r?\n/);
  const bloques: ReactNode[] = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];
    const clave = `b${i}`;

    if (linea.trim() === "") {
      i += 1;
      continue;
    }

    // Bloque de código: se copia TAL CUAL, sin tocar el interior.
    const apertura = /^```\s*(\S*)\s*$/.exec(linea);
    if (apertura) {
      const dentro: string[] = [];
      i += 1;
      while (i < lineas.length && !/^```\s*$/.test(lineas[i])) {
        dentro.push(lineas[i]);
        i += 1;
      }
      i += 1; // la línea de cierre
      bloques.push(
        <pre
          key={clave}
          className="mt-4 overflow-x-auto rounded-md border border-border bg-muted p-3 text-sm"
        >
          <code className="font-mono text-foreground">{dentro.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const titulo = /^(#{1,6})\s+(.*)$/.exec(linea);
    if (titulo) {
      // +1: el `<h1>` de la página ya lo pone el `PageHeader`. Tope en 6 (no existe `<h7>`).
      const nivel = Math.min(titulo[1].length + 1, 6);
      const Etiqueta = `h${nivel}` as "h2" | "h3" | "h4" | "h5" | "h6";
      bloques.push(
        <Etiqueta key={clave} className={CLASES_TITULO[nivel] ?? CLASES_TITULO[4]}>
          {renderizarInline(titulo[2], clave)}
        </Etiqueta>,
      );
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(linea)) {
      bloques.push(<hr key={clave} className="mt-6 border-border" />);
      i += 1;
      continue;
    }

    // Tabla: una fila con tuberías seguida de la fila separadora.
    if (linea.trim().startsWith("|") && i + 1 < lineas.length && esSeparadorDeTabla(lineas[i + 1])) {
      const cabecera = celdas(linea);
      i += 2;
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith("|")) {
        filas.push(celdas(lineas[i]));
        i += 1;
      }
      bloques.push(
        // `overflow-x-auto`: a 390px una tabla de tres columnas no cabe, y lo correcto es que
        // scrollee ELLA y no la página entera (mismo criterio que el `overflow-x-clip` del
        // portal). Sin esto, el módulo rompe el ancho del viewport en el teléfono.
        <div key={clave} className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {cabecera.map((celda, c) => (
                  <th
                    key={`${clave}-th${c}`}
                    scope="col"
                    className="px-3 py-2 text-left font-semibold text-foreground"
                  >
                    {renderizarInline(celda, `${clave}-th${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, f) => (
                <tr key={`${clave}-tr${f}`} className="border-b border-border last:border-0">
                  {fila.map((celda, c) => (
                    <td key={`${clave}-td${f}-${c}`} className="px-3 py-2 align-top">
                      {renderizarInline(celda, `${clave}-td${f}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Cita: el aviso de riesgo del README («los avisos de riesgo se destacan»).
    if (/^>\s?/.test(linea)) {
      const dentro: string[] = [];
      while (i < lineas.length && /^>\s?/.test(lineas[i])) {
        dentro.push(lineas[i].replace(/^>\s?/, ""));
        i += 1;
      }
      bloques.push(
        // Barra lateral con el acento de marca y fondo `muted`: los dos giran con el tema, así
        // que no cae en el par «color fijo sobre superficie que gira» de `DESIGN.md`.
        <blockquote
          key={clave}
          className="mt-4 border-l-4 border-primary bg-muted/60 px-4 py-3 text-foreground"
        >
          {renderizarInline(dentro.join(" "), clave)}
        </blockquote>,
      );
      continue;
    }

    // Listas. Sin anidamiento: ningún documento lo usa (medido) y soportarlo a medias es peor.
    const vinieta = /^\s*[-*+]\s+(.*)$/.exec(linea);
    const numerada = /^\s*\d+\.\s+(.*)$/.exec(linea);
    if (vinieta || numerada) {
      const ordenada = numerada !== null;
      const patron = ordenada ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (i < lineas.length) {
        const item = patron.exec(lineas[i]);
        if (item) {
          items.push(item[1]);
          i += 1;
          continue;
        }
        // Continuación del ítem anterior (el Markdown de la carpeta parte líneas a ~100
        // columnas, así que casi todo ítem largo tiene una segunda línea sangrada).
        if (items.length > 0 && /^\s+\S/.test(lineas[i]) && !/^\s*$/.test(lineas[i])) {
          items[items.length - 1] += ` ${lineas[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      const Lista = ordenada ? "ol" : "ul";
      bloques.push(
        <Lista
          key={clave}
          className={`mt-4 space-y-2 pl-6 ${ordenada ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, n) => (
            <li key={`${clave}-li${n}`} className="pl-1">
              {renderizarInline(item, `${clave}-li${n}`)}
            </li>
          ))}
        </Lista>,
      );
      continue;
    }

    // Párrafo: todas las líneas seguidas hasta una en blanco o el arranque de otro bloque.
    const parrafo: string[] = [];
    while (i < lineas.length && lineas[i].trim() !== "" && !arrancaOtroBloque(lineas[i])) {
      parrafo.push(lineas[i].trim());
      i += 1;
    }
    if (parrafo.length > 0) {
      bloques.push(
        <p key={clave} className="mt-4 leading-relaxed text-foreground">
          {renderizarInline(parrafo.join(" "), clave)}
        </p>,
      );
      continue;
    }
    i += 1;
  }

  return bloques;
}

/** ¿Esta línea empieza un bloque distinto? Corta el párrafo en curso. */
function arrancaOtroBloque(linea: string): boolean {
  return (
    /^#{1,6}\s/.test(linea) ||
    /^>\s?/.test(linea) ||
    /^```/.test(linea) ||
    /^\s*[-*+]\s+/.test(linea) ||
    /^\s*\d+\.\s+/.test(linea) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(linea) ||
    linea.trim().startsWith("|")
  );
}
