/**
 * ⭑ FICHA 433 — el frontmatter de `docs/ayuda/**`, leído SIN dependencia de YAML.
 *
 * POR QUÉ UN PARSER PROPIO Y NO `gray-matter`. Lo que hay que leer no es YAML: es el
 * subconjunto CERRADO que `docs/ayuda/README.md` declara como contrato de la carpeta —seis
 * campos, tres formas (escalar, lista en línea, lista en bloque)— y está MEDIDO sobre los 31
 * documentos. Traer un parser de YAML completo para eso añade superficie (anclas, tipos
 * implícitos, `!!` tags) que ningún documento usa y que nadie va a revisar.
 *
 * LO QUE ESTE PARSER NO HACE, dicho en voz alta para que nadie lo confunda con YAML:
 * no entiende anidamiento de más de un nivel, ni comillas, ni multilínea (`|`, `>`), ni
 * comentarios. Si un documento futuro los usa, el campo llega vacío o crudo y la guardia
 * `ayuda-pantalla-ruta-existe.guardia.test.ts` es la que se pone roja — no se adivina.
 *
 * Es una función PURA sobre el texto del archivo: no toca `fs` y por eso puede correr en un
 * test sin entorno y del lado que sea.
 */

/** Los campos del frontmatter, ya leídos. Todo es opcional: el archivo manda, no este tipo. */
export interface FrontmatterAyuda {
  titulo?: string;
  modulo?: string;
  /**
   * La ruta —o LAS rutas— de la aplicación que el documento explica. Se guarda CRUDO,
   * tal cual lo escribió el documento: `publico/entrar-y-recuperar-contrasena.md` declara
   * dos separadas por coma (`/login, /recuperar-contrasena`) y partirlas es trabajo de
   * `rutasDeDocumento`, no de este parser.
   */
  pantalla?: string;
  roles?: readonly string[];
  actualizado?: string;
  /**
   * De dónde sale lo que el documento afirma. **NUNCA se muestra al usuario** (regla del
   * README de la carpeta): existe para auditar y para saber qué documento revisar cuando
   * un archivo cambie. Se lee igualmente porque las guardias lo miran.
   */
  fuentes?: readonly string[];
}

/** El resultado de partir un `.md`: sus metadatos y su cuerpo Markdown. */
export interface ArchivoConFrontmatter {
  datos: FrontmatterAyuda;
  /** El Markdown, ya sin el bloque de metadatos. */
  cuerpo: string;
}

/** Los campos que este parser reconoce. Un campo fuera de esta lista se ignora en silencio. */
const CAMPOS_LISTA = ["roles", "fuentes"] as const;

/** `[a, b]` -> `["a","b"]`. Una lista vacía (`[]`) devuelve `[]`, no `[""]`. */
function leerListaEnLinea(valor: string): string[] {
  const interior = valor.slice(1, -1).trim();
  if (interior === "") return [];
  return interior
    .split(",")
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "");
}

/**
 * Parte un `.md` en frontmatter + cuerpo.
 *
 * Un archivo SIN frontmatter no es un error: devuelve `datos` vacío y el texto entero como
 * cuerpo. Quien necesite que el frontmatter exista (el catálogo) lo exige por su cuenta; así
 * un documento a medio escribir no revienta la lectura de los otros treinta.
 */
export function partirFrontmatter(texto: string): ArchivoConFrontmatter {
  // `\r?\n` en todas las expresiones de este archivo: el repo guarda LF (`.gitattributes`),
  // pero un `.md` que llegue con CRLF tiene que leerse igual — si no, el valor de cada campo
  // se quedaría con un `\r` pegado al final y `pantalla` dejaría de casar con ninguna ruta.
  const apertura = /^---\r?\n/.exec(texto);
  if (!apertura) return { datos: {}, cuerpo: texto };

  const resto = texto.slice(apertura[0].length);
  const cierre = /^---[ \t]*\r?\n?/m.exec(resto);
  if (!cierre || cierre.index === undefined) return { datos: {}, cuerpo: texto };

  const bloque = resto.slice(0, cierre.index);
  const cuerpo = resto.slice(cierre.index + cierre[0].length);

  return { datos: leerBloque(bloque), cuerpo };
}

/** Lee el interior del bloque `---` … `---`. */
function leerBloque(bloque: string): FrontmatterAyuda {
  const datos: Record<string, string | string[]> = {};
  // El campo de lista EN BLOQUE (`fuentes:` y luego `  - x`) necesita recordar a qué clave
  // pertenecen las líneas siguientes. Es el único estado del parser.
  let listaAbierta: string | null = null;

  for (const linea of bloque.split(/\r?\n/)) {
    const item = /^[ \t]*-[ \t]+(.*)$/.exec(linea);
    if (item && listaAbierta) {
      (datos[listaAbierta] as string[]).push(item[1].trim());
      continue;
    }

    const campo = /^([A-Za-zÀ-ÿ_][\w-]*):[ \t]*(.*)$/.exec(linea);
    if (!campo) {
      // Línea en blanco o algo que no se reconoce: cierra la lista abierta para que un
      // `- x` posterior no acabe colgando de la clave equivocada.
      if (linea.trim() === "") listaAbierta = null;
      continue;
    }

    const [, clave, valorCrudo] = campo;
    const valor = valorCrudo.trim();
    listaAbierta = null;

    if (valor.startsWith("[") && valor.endsWith("]")) {
      datos[clave] = leerListaEnLinea(valor);
      continue;
    }
    if (valor === "" && (CAMPOS_LISTA as readonly string[]).includes(clave)) {
      datos[clave] = [];
      listaAbierta = clave;
      continue;
    }
    datos[clave] = valor;
  }

  return {
    titulo: texto(datos.titulo),
    modulo: texto(datos.modulo),
    pantalla: texto(datos.pantalla),
    roles: lista(datos.roles),
    actualizado: texto(datos.actualizado),
    fuentes: lista(datos.fuentes),
  };
}

function texto(valor: string | string[] | undefined): string | undefined {
  return typeof valor === "string" && valor !== "" ? valor : undefined;
}

function lista(valor: string | string[] | undefined): string[] | undefined {
  return Array.isArray(valor) ? valor : undefined;
}
