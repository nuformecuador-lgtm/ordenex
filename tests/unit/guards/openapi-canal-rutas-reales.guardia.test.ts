// GUARDIA DEL ARNÉS — EL CANAL POR API KEY, CONTRASTADO CONTRA EL FILESYSTEM.
//
// **El defecto que la motiva (ficha 322).** Un endpoint del canal integrador puede nacer sin
// documentar y el gate entero se queda VERDE. El contrato del canal vive en cuatro sitios y
// ninguno se actualiza solo:
//   - `lib/api/openapi-spec.ts` — fuente de verdad; es lo que sirve `GET /api/docs/openapi` y lo
//     que renderiza el Swagger UI que abre un integrador.
//   - `docs/api/api-key-openapi.yaml` — espejo textual. Su cabecera dice «GENERADO … no editar a
//     mano», pero **nada lo regenera**: lo sincronizan los asserts de `tests/unit/api/openapi-*`.
//   - `docs/api/ordenex-api-key.postman_collection.json` y `docs/api/CHANGELOG.md`.
//
// **Dónde estaba el agujero.** El censo `PATHS_ESPERADOS` de
// `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` afirma la lista de paths contra el
// objeto TS **y** contra el YAML. Es decir: compara el spec **consigo mismo y con su copia**, y
// nunca contra las rutas que existen de verdad bajo `app/api/ordenes/api-key/**`. Crear una ruta
// nueva sin tocar el spec dejaba las dos afirmaciones en verde. Es la familia de fallo mudo de las
// fichas 313, 315 y 318: el sistema no falla, APARENTA.
//
// **Por qué esta guardia SE SUMA al censo literal en vez de sustituirlo, y no es redundante.**
// `PATHS_ESPERADOS` **es** el contrato publicado, escrito a mano y firmado: su valor está en que
// subir de diez a once endpoints obliga a un humano a escribir el alta y el porqué en el mismo
// commit. Derivarlo de su propia fuente lo dejaría verde para siempre (ver
// `.claude/memory/asercion-contra-su-propia-fuente.md`). Lo que ese censo NO puede hacer —porque
// solo mira los dos artefactos de documentación— es enterarse de que existe un `route.ts` que
// nadie documentó. Eso es lo único que hace este archivo. Si alguien borra esta guardia «porque ya
// está el censo», vuelve a abrir el agujero exacto de la ficha 322. Y si alguien borra el censo
// «porque ya está esta guardia», pierde la firma humana del contrato. Van los dos.
//
// **Por qué se comparan VERBOS y no solo paths, con el caso real que lo demuestra.** La ficha 320
// (2026-08-28) publicó `DELETE /api/ordenes/api-key/orden/{id}`: un verbo NUEVO sobre un path que
// YA existía. El censo de paths no se movió —seguía en diez— y aun así había documentación nueva
// que escribir. Una guardia que solo mirase paths habría dejado pasar ese caso entero. Por eso la
// unidad de comparación aquí es la OPERACIÓN (`VERBO path`), nunca el path suelto.
//
// **QUÉ COMPRUEBA.** Para el árbol `app/api/ordenes/api-key/**` (el prefijo que `middleware.ts`
// declara como auto-autenticado, y de ahí sale la raíz del escaneo, no de un literal suelto):
//   - R1 · toda operación REAL (cada `export … GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS` de un
//     `route.ts`) tiene su operación en `openApiSpec.paths`.
//   - R2 · y al revés: toda operación PUBLICADA existe como ruta real. Un path documentado que ya
//     no existe es un defecto igual de caro —el integrador llama y recibe 404— y es lo que pasa
//     cuando se borra un endpoint sin tocar el contrato.
//   - R3 · el `.yaml` espejo declara exactamente los mismos pares (path, verbo) que el objeto TS.
//     Es un archivo de texto que nada regenera: sin esto, el Swagger UI y el YAML que se le manda
//     a un integrador pueden decir cosas distintas.
//   - R4 · las rutas que a propósito no se publiquen se declaran con `@sin-publicar <motivo>`
//     pegado al export, y la anotación CADUCA: si lo anotado aparece publicado, rojo.
//
// **QUÉ NO COMPRUEBA, dicho para que nadie le suponga más alcance del que tiene.**
//   - El CONTENIDO de cada operación (schemas, códigos, ejemplos, parámetros de query): eso lo
//     cubren las suites por endpoint (`openapi-320-eliminar`, `openapi-266-habilitar`,
//     `openapi-257-filtros-listado`, `openapi-carga-*`…). Aquí solo se afirma la EXISTENCIA.
//   - `docs/api/ordenex-api-key.postman_collection.json` y `docs/api/CHANGELOG.md`. Medido el
//     2026-08-28: la colección de Postman NO tiene carpeta para `GET /api/ordenes/api-key/analitica`
//     (feature 267), así que ese hueco está ABIERTO y esta guardia no lo ve. Se deja anotado a
//     propósito en vez de ampliar el alcance de contrabando: la colección es una comodidad de
//     pruebas, el contrato es el OpenAPI, y ampliar esto exige decidir antes cuántas peticiones de
//     ejemplo son «documentar un endpoint».
//   - `webhooks:` (feature 256/268). Es una petición SALIENTE de Ordenex, no un `route.ts` del
//     canal: no tiene ruta en el filesystem contra la que contrastarla.
//   - Que el verbo exportado HAGA lo que el contrato promete. Esto es existencia, no conducta.
//
// **La excepción va ANOTADA JUNTO AL EXPORT, nunca en una lista de excepciones del test.** Es la
// convención que este repo ya adoptó con `@sin-superficie` («el motivo junto al código»): una
// allowlist central se llena sola, nadie la poda y acaba siendo el sitio donde se esconde
// justamente lo que la guardia buscaba. Anotada junto al export, quien publica la ruta se
// encuentra la suite roja y tiene que elegir entre documentarla o escribir por qué no. Y por
// simetría, la anotación caduca.
//
// **Por qué el detector se auto-prueba (anti-vacuidad).** El modo de fallo de esta familia no es
// «la guardia dice que no», es «la guardia no encuentra nada y calla». Si mañana cambia el
// directorio del canal, el glob o la forma de exportar un handler, un censo vacío daría VERDE y
// habríamos escrito una guardia que no guarda. Por eso: (0) el traductor de rutas y el extractor
// de verbos se prueban contra respuestas conocidas en las dos direcciones; (1) hay suelo mínimo de
// rutas y de operaciones, ningún archivo leído puede estar vacío y ningún `route.ts` puede aportar
// CERO verbos; (2) hay control positivo nominal sobre el árbol real —incluido el
// `DELETE /orden/{id}` de la 320, que es el caso que justifica mirar verbos—; y (3) lo que el
// detector no sepa leer (un `export * from`, un segmento catch-all que OpenAPI no sabe expresar)
// se REPORTA en rojo en vez de asumirse documentado. Un detector que en la duda calla es justo el
// que falla.
//
// La lectura es ESTÁTICA. La selecciona `pnpm exec vitest run guard` por su ruta, sin estar
// registrada en ninguna lista.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");

/** El prefijo del canal integrador. `middleware.ts` lo declara en `SELF_AUTH_ROUTES` (se autentica
 *  solo, con la API key) y de ahí sale la raíz del escaneo: si alguien mueve el canal, esto se
 *  entera —hay un test que exige que el prefijo siga declarado allí y que el directorio exista—. */
const PREFIJO_CANAL = "/api/ordenes/api-key";

const DIR_CANAL = path.join(RAIZ, "app", ...PREFIJO_CANAL.split("/").filter(Boolean));
const YAML_PATH = path.join(RAIZ, "docs", "api", "api-key-openapi.yaml");

/** Los verbos que Next.js reconoce como handlers en un `route.ts`. */
const VERBOS_HTTP = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const ES_VERBO = new Set<string>(VERBOS_HTTP);

/** Claves de un Path Item de OpenAPI que NO son operaciones. Cualquier otra que no sea un verbo se
 *  reporta: en la duda, rojo. */
const CLAVES_NO_OPERACION = new Set(["parameters", "summary", "description", "servers", "$ref"]);

/** La anotación de excepción, con su motivo obligatorio en la MISMA línea. */
const ANOTACION = /@sin-publicar[ \t]+(\S[^\n]*)/;
/** Motivos que no son motivos. Una excepción sin razón escrita es la allowlist que no queríamos. */
const MOTIVO_VACIO = /^(todo|tbd|fixme|xxx|pendiente|por decidir|n\/a|-+)\b/i;
const MOTIVO_MINIMO = 20;

/** Suelo del censo del FILESYSTEM, firmado el 2026-08-28 con DIEZ `route.ts` y ONCE operaciones
 *  (el `DELETE` de la 320 es la undécima). No es el censo del contrato —ése vive en
 *  `PATHS_ESPERADOS` y se firma allí—: es el ANTI-VACUIDAD. Existe para que el día que el escaneo
 *  deje de encontrar rutas —porque cambió el directorio, la extensión o la convención de Next— la
 *  guardia se ponga ROJA en vez de aprobar un árbol vacío. Bajarlo solo tiene sentido si de verdad
 *  se retiraron endpoints, y entonces se baja a mano y con su motivo, igual que el otro.
 *
 *  BAJADA A MANO (2026-08-31), con su motivo: DIEZ → NUEVE `route.ts` y ONCE → DIEZ operaciones.
 *  Se retiró `app/api/ordenes/api-key/[numGuia]/route.ts` (`GET` de detalle por guía, feature
 *  106). No es un detector que dejó de ver el árbol: es una BAJA real del contrato, publicada en
 *  `docs/api/CHANGELOG.md` el mismo día. `GET /api/ordenes/api-key/orden/{id}` (177) sirve el
 *  MISMO `OrdenDetalle` y además resuelve por `num_remision`, que es lo único que alcanza a una
 *  orden nacida en `en_preparacion` sin guía. */
const MINIMO_RUTAS = 9;
const MINIMO_OPERACIONES = 10;

// ---------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------

/**
 * Quitar los comentarios NO es opcional aquí y no se escribe a mano: en este repo la prosa nombra
 * rutas y verbos a propósito —este archivo mismo escribe `export async function DELETE` en un
 * comentario, tres veces— y un escaneo del texto crudo los leería como código. Se usa el quitador
 * COMPARTIDO de la feature 209 (`tests/fixtures/sin-comentarios.ts`), que es un escáner con
 * estado y está probado en las dos caras; el censo de la 207 encontró 74 copias hechas a mano con
 * cinco semánticas distintas, y ésta no va a ser la 75.ª. Conserva los saltos de línea, que es lo
 * que permite localizar un export por su nº de línea y luego buscar su anotación en el TEXTO
 * BRUTO, que es donde viven los comentarios.
 */
function lineasDe(fuente: string): string[] {
  return fuente.split(/\r?\n/);
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/**
 * Traduce la convención de carpetas de Next a un path de OpenAPI.
 *
 *   app/api/ordenes/api-key/[numGuia]/cancelar/route.ts → /api/ordenes/api-key/{numGuia}/cancelar
 *
 * Reglas, todas de la convención del App Router:
 *   - `[x]`        → `{x}` (segmento dinámico).
 *   - `[...x]`     → `{...x}`, y `[[...x]]` igual. OpenAPI **no sabe expresar un catch-all**: se
 *     traduce a una forma que ningún path del contrato puede tener, así que la ruta sale
 *     reportada como no documentada y obliga a decidir. En la duda, rojo — no silencio.
 *   - `(grupo)`    → desaparece de la URL (route group).
 *   - `@slot`      → no es una ruta (parallel route; ni siquiera aplica a route handlers).
 *   - `_privada`   → Next no la rutea (private folder).
 * Devuelve `null` cuando el archivo no corresponde a ninguna URL.
 */
export function rutaOpenApiDe(archivoRelativo: string): string | null {
  const partes = archivoRelativo.split("/");
  if (partes[0] !== "app") return null;
  const segmentos = partes.slice(1, -1); // sin `app` y sin el `route.ts` final
  const salida: string[] = [];
  for (const seg of segmentos) {
    if (seg.startsWith("@") || seg.startsWith("_")) return null;
    if (/^\(.+\)$/.test(seg)) continue;
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) salida.push(`{...${seg.slice(5, -2)}}`);
    else if (/^\[\.\.\..+\]$/.test(seg)) salida.push(`{...${seg.slice(4, -1)}}`);
    else if (/^\[.+\]$/.test(seg)) salida.push(`{${seg.slice(1, -1)}}`);
    else salida.push(seg);
  }
  return `/${salida.join("/")}`;
}

/** Un handler HTTP exportado, con la línea en la que se declara. */
export interface VerboExportado {
  verbo: string; // en MAYÚSCULAS, como lo exporta Next
  linea: number; // índice 0-based sobre las líneas del archivo
}

/**
 * Los handlers HTTP que un `route.ts` exporta. Se cubren las TRES formas con las que Next acepta
 * un handler, porque bastaría con usar la que el detector no mire para colarse:
 *   - `export async function GET(…)` / `export function GET(…)`
 *   - `export const GET = …` (y `let`/`var`)
 *   - `export { GET }` / `export { handler as GET }` (con o sin `from`)
 * Lo que NO se sabe leer se devuelve en `noResueltos` y el llamador lo pone en rojo.
 */
export function verbosDeFuente(fuente: string): {
  verbos: VerboExportado[];
  noResueltos: string[];
} {
  const codigo = quitarComentarios(fuente);
  const lineas = lineasDe(codigo);
  const verbos: VerboExportado[] = [];
  const noResueltos: string[] = [];

  const anota = (nombre: string, linea: number) => {
    if (!ES_VERBO.has(nombre.toLowerCase())) return;
    if (nombre !== nombre.toUpperCase()) return; // `Get` no es un handler de Next
    if (verbos.some((v) => v.verbo === nombre)) return;
    verbos.push({ verbo: nombre, linea });
  };

  lineas.forEach((linea, i) => {
    const funcion = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*[(<]/.exec(linea);
    if (funcion) anota(funcion[1], i);
    const constante = /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*[:=]/.exec(linea);
    if (constante) anota(constante[1], i);
  });

  // `export { … }`, que puede ocupar varias líneas. La línea que se registra es la del `export`.
  for (const m of codigo.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    const linea = codigo.slice(0, m.index ?? 0).split("\n").length - 1;
    for (const clausula of m[1].split(",")) {
      const texto = clausula.trim();
      if (texto === "") continue;
      if (/^type\s/.test(texto)) continue;
      const conAlias = /^[A-Za-z0-9_$]+\s+as\s+([A-Za-z0-9_$]+)$/.exec(texto);
      anota(conAlias ? conAlias[1] : texto, linea);
    }
  }

  // Un re-export con comodín puede traer handlers que este detector no ve: se reporta.
  for (const m of codigo.matchAll(/\bexport\s+\*(?:\s+as\s+[A-Za-z0-9_$]+)?\s*from\s*["']([^"']+)["']/g))
    noResueltos.push(`export * from "${m[1]}"`);

  return { verbos, noResueltos };
}

/**
 * El bloque de comentario **pegado** a la línea `linea`: se sube mientras haya comentario y se
 * corta en la primera línea en blanco o de código. Es lo que impide que un `@sin-publicar` de otro
 * export, cincuenta líneas más arriba, cuente como excepción de éste.
 */
function comentarioPegadoA(lineasBrutas: string[], linea: number): string {
  const bloque: string[] = [];
  for (let i = linea - 1; i >= 0; i--) {
    const t = lineasBrutas[i].trim();
    if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) bloque.unshift(lineasBrutas[i]);
    else break;
  }
  return bloque.join("\n");
}

/** La anotación de excepción de un export, o `null`. Un motivo ausente, telegráfico o de relleno
 *  (`TODO`, `pendiente`) NO cuenta: la anotación existe para que se lea, no para callar la suite. */
export function anotacionDe(lineasBrutas: string[], linea: number): string | null {
  const m = ANOTACION.exec(comentarioPegadoA(lineasBrutas, linea));
  if (!m) return null;
  const motivo = m[1].replace(/\*\/\s*$/, "").trim();
  if (motivo.length < MOTIVO_MINIMO || MOTIVO_VACIO.test(motivo)) return null;
  return motivo;
}

// ---------------------------------------------------------------------------
// El censo del FILESYSTEM, construido una vez
// ---------------------------------------------------------------------------

const ES_ROUTE = /^route\.(ts|tsx|js|jsx|mts)$/;

function listarRouteHandlers(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarRouteHandlers(completo, acc);
    else if (ES_ROUTE.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

interface RutaReal {
  archivo: string; // relativa a la raíz del repo
  ruta: string; // path de OpenAPI
  vacio: boolean;
  verbos: VerboExportado[];
  noResueltos: string[];
  /** Verbos con `@sin-publicar` y su motivo. */
  anotados: Map<string, string>;
}

function censarCanal(): RutaReal[] {
  return listarRouteHandlers(DIR_CANAL)
    .map((archivo) => {
      const relativa = rutaRelativa(archivo);
      const bruto = readFileSync(archivo, "utf8");
      const { verbos, noResueltos } = verbosDeFuente(bruto);
      const lineasBrutas = lineasDe(bruto);
      const anotados = new Map<string, string>();
      for (const v of verbos) {
        const motivo = anotacionDe(lineasBrutas, v.linea);
        if (motivo) anotados.set(v.verbo, motivo);
      }
      return {
        archivo: relativa,
        ruta: rutaOpenApiDe(relativa) ?? "",
        vacio: bruto.trim() === "",
        verbos,
        noResueltos,
        anotados,
      };
    })
    .filter((r) => r.ruta !== "")
    .sort((a, b) => a.archivo.localeCompare(b.archivo));
}

interface Operacion {
  ruta: string;
  verbo: string; // MAYÚSCULAS
  origen: string; // archivo o artefacto, para que el rojo diga dónde mirar
}

function formatear(op: Operacion): string {
  return `${op.verbo} ${op.ruta}`;
}

const rutasReales = censarCanal();

const operacionesReales: Operacion[] = rutasReales.flatMap((r) =>
  r.verbos.map((v) => ({ ruta: r.ruta, verbo: v.verbo, origen: r.archivo })),
);

/** Las operaciones REALES que se publican: las anotadas `@sin-publicar` quedan fuera. */
const operacionesRealesPublicables = operacionesReales.filter(
  (op) => !rutasReales.find((r) => r.archivo === op.origen)?.anotados.has(op.verbo),
);

// ---------------------------------------------------------------------------
// El censo del CONTRATO (objeto TS y espejo .yaml)
// ---------------------------------------------------------------------------

const pathsTs = openApiSpec.paths as unknown as Record<string, Record<string, unknown>>;

const clavesRarasDelSpec: string[] = [];
const operacionesDelSpec: Operacion[] = Object.entries(pathsTs).flatMap(([ruta, item]) =>
  Object.keys(item).flatMap((clave) => {
    if (ES_VERBO.has(clave)) return [{ ruta, verbo: clave.toUpperCase(), origen: "openapi-spec.ts" }];
    if (!CLAVES_NO_OPERACION.has(clave)) clavesRarasDelSpec.push(`${ruta} → ${clave}`);
    return [];
  }),
);

const yamlBruto = readFileSync(YAML_PATH, "utf8");

/** Los pares (path, verbo) del `.yaml`. Mismo parseo por sangría que usan los guards hermanos de
 *  `tests/unit/api/`: el archivo es texto plano y no hay parser de yaml en el proyecto. */
export function operacionesDelYaml(texto: string): Operacion[] {
  const lineas = texto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === "paths:");
  if (inicio === -1) throw new Error("el .yaml no declara `paths:`");
  const salida: Operacion[] = [];
  let actual: string | null = null;
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea.trim() === "") continue;
    const sangria = linea.length - linea.trimStart().length;
    if (sangria === 0) break; // fin de la sección `paths:`
    const esPath = /^ {2}"([^"]+)":\s*$/.exec(linea);
    if (esPath) {
      actual = esPath[1];
      continue;
    }
    const esVerbo = /^ {4}([a-z]+):\s*$/.exec(linea);
    if (esVerbo && actual !== null && ES_VERBO.has(esVerbo[1]))
      salida.push({ ruta: actual, verbo: esVerbo[1].toUpperCase(), origen: "api-key-openapi.yaml" });
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0 · EL DETECTOR SE PRUEBA A SÍ MISMO
// ═══════════════════════════════════════════════════════════════════════════
describe("322 · el detector responde bien en las DOS direcciones (si esto falla, nada de abajo vale)", () => {
  it("traduce la convención de carpetas de Next a paths de OpenAPI", () => {
    const casos: Array<[string, string | null]> = [
      ["app/api/ordenes/api-key/route.ts", "/api/ordenes/api-key"],
      ["app/api/ordenes/api-key/carga/route.ts", "/api/ordenes/api-key/carga"],
      // El caso que la ficha pone como ejemplo, palabra por palabra.
      [
        "app/api/ordenes/api-key/[numGuia]/cancelar/route.ts",
        "/api/ordenes/api-key/{numGuia}/cancelar",
      ],
      [
        "app/api/ordenes/api-key/carga/[cargaId]/generate/route.ts",
        "/api/ordenes/api-key/carga/{cargaId}/generate",
      ],
      // Route group: no aparece en la URL.
      ["app/api/(publico)/salud/route.ts", "/api/salud"],
      // Catch-all: se traduce a una forma que NINGÚN path de OpenAPI puede tener, para que salga
      // reportado como no documentado en vez de colarse.
      ["app/api/x/[...resto]/route.ts", "/api/x/{...resto}"],
      ["app/api/x/[[...resto]]/route.ts", "/api/x/{...resto}"],
      // Lo que Next no rutea.
      ["app/api/x/_interno/route.ts", null],
      ["app/api/x/@slot/route.ts", null],
      ["lib/api/route.ts", null],
    ];
    for (const [entrada, esperado] of casos) {
      expect(rutaOpenApiDe(entrada), `traducción de ${entrada}`).toBe(esperado);
    }
  });

  it("encuentra las tres formas de exportar un handler", () => {
    const fuente = [
      "export async function GET(req: Request) {}",
      "export function HEAD(req: Request) {}",
      "export const POST = withErrorHandler(handler);",
      "const interno = () => {};",
      "export { interno as DELETE };",
      "export {",
      "  PUT,",
      "};",
    ].join("\n");
    const { verbos } = verbosDeFuente(fuente);
    expect(verbos.map((v) => v.verbo).sort()).toEqual(["DELETE", "GET", "HEAD", "POST", "PUT"]);
  });

  it("NO cuenta lo que no es un handler exportado del módulo", () => {
    const fuente = [
      "// export async function DELETE(req: Request) {}",
      "/** Ojo: aquí vivía un `export async function PATCH`. */",
      "function GET() {}", // sin `export`
      "export async function handleCargaApi() {}", // no es un verbo
      "export const GETTER = 1;", // no es un verbo, aunque empiece igual
      "export const Post = 2;", // Next exige MAYÚSCULAS
      "export type PUT = never;",
    ].join("\n");
    const { verbos } = verbosDeFuente(fuente);
    expect(verbos, "un comentario o un símbolo parecido NO es un handler").toEqual([]);
  });

  it("reporta lo que no sabe leer en vez de callarlo", () => {
    const { noResueltos } = verbosDeFuente('export * from "./handlers";');
    expect(noResueltos).toEqual(['export * from "./handlers"']);
  });

  it("lee la anotación `@sin-publicar` solo cuando está pegada y trae un motivo de verdad", () => {
    const conMotivo = [
      "/**",
      " * @sin-publicar borde interno del cron de purga, feature 999.",
      " */",
      "export async function GET() {}",
    ];
    expect(anotacionDe(conMotivo, 3)).toBe("borde interno del cron de purga, feature 999.");

    // Despegada por una línea en blanco: no cuenta.
    const despegada = ["/** @sin-publicar borde interno del cron de purga, feature 999. */", "", "export async function GET() {}"];
    expect(anotacionDe(despegada, 2)).toBeNull();

    // Motivo de relleno o telegráfico: tampoco.
    expect(anotacionDe(["/** @sin-publicar TODO */", "export async function GET() {}"], 1)).toBeNull();
    expect(anotacionDe(["/** @sin-publicar aún no */", "export async function GET() {}"], 1)).toBeNull();
  });

  it("lee del `.yaml` los pares (path, verbo) y no confunde una clave que no es un verbo", () => {
    const yamlDePrueba = [
      "openapi: 3.1.0",
      "paths:",
      '  "/api/x":',
      "    parameters:",
      "      - name: id",
      "    get:",
      "      summary: uno",
      "    delete:",
      "      summary: dos",
      '  "/api/y":',
      "    post:",
      "      summary: tres",
      "components:",
      "  schemas: {}",
    ].join("\n");
    expect(operacionesDelYaml(yamlDePrueba).map(formatear)).toEqual([
      "GET /api/x",
      "DELETE /api/x",
      "POST /api/y",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · ANTI-VACUIDAD: un censo vacío es un ROJO, no un aprobado
// ═══════════════════════════════════════════════════════════════════════════
describe("322 · el censo del filesystem no puede salir vacío ni a medias", () => {
  it("el prefijo del canal sigue declarado en `middleware.ts` y su directorio existe", () => {
    const middleware = readFileSync(path.join(RAIZ, "middleware.ts"), "utf8");
    const declaracion = /const SELF_AUTH_ROUTES\s*=\s*\[([^\]]*)\]/.exec(middleware);
    expect(declaracion, "`middleware.ts` ya no declara `SELF_AUTH_ROUTES`: esta guardia escanea un árbol que quizá ya no es el canal").not.toBeNull();
    expect(
      declaracion?.[1],
      `el canal se autentica solo bajo ${PREFIJO_CANAL}; si el prefijo se movió, mueve también la raíz de esta guardia`,
    ).toContain(`"${PREFIJO_CANAL}"`);
    expect(existsSync(DIR_CANAL), `no existe ${rutaRelativa(DIR_CANAL)}`).toBe(true);
  });

  it("encuentra al menos las rutas y operaciones firmadas: si el escaneo se rompe, esto se pone rojo", () => {
    expect(
      rutasReales.length,
      `el escaneo de ${rutaRelativa(DIR_CANAL)} encontró ${rutasReales.length} route handlers. ` +
        "Un censo por debajo del suelo firmado significa casi siempre que el detector dejó de ver el árbol " +
        "(cambió el directorio, la extensión o la convención), NO que se hayan retirado endpoints. " +
        "Si de verdad se retiraron, baja el suelo A MANO y escribe por qué.",
    ).toBeGreaterThanOrEqual(MINIMO_RUTAS);
    expect(operacionesReales.length).toBeGreaterThanOrEqual(MINIMO_OPERACIONES);
  });

  it("ningún `route.ts` del canal se leyó vacío ni aportó CERO verbos", () => {
    const vacios = rutasReales.filter((r) => r.vacio).map((r) => r.archivo);
    expect(vacios, "archivos leídos vacíos: el lector está roto").toEqual([]);
    const sinVerbos = rutasReales.filter((r) => r.verbos.length === 0).map((r) => r.archivo);
    expect(
      sinVerbos,
      "estos `route.ts` no exportan NINGÚN handler que el detector sepa ver. O son código muerto, " +
        "o exportan el handler de una forma que este detector no cubre — y entonces el detector miente en verde.",
    ).toEqual([]);
  });

  it("control positivo sobre el árbol REAL: el censo nombra operaciones que sabemos que existen", () => {
    const encontradas = operacionesReales.map(formatear);
    // `DELETE /orden/{id}` es EL caso de la ficha 320: verbo nuevo sobre path viejo. Si el
    // detector dejara de ver verbos y solo viera paths, esta línea se pondría roja.
    expect(encontradas).toContain("DELETE /api/ordenes/api-key/orden/{id}");
    expect(encontradas).toContain("GET /api/ordenes/api-key/orden/{id}");
    expect(encontradas).toContain("PUT /api/ordenes/api-key/{numGuia}/cancelar");
    expect(encontradas).toContain("POST /api/ordenes/api-key/carga");
    expect(encontradas).toContain("GET /api/ordenes/api-key");
  });

  it("nada del canal quedó sin resolver: en la duda, rojo", () => {
    const dudas = rutasReales.flatMap((r) => r.noResueltos.map((n) => `${r.archivo}: ${n}`));
    expect(
      dudas,
      "el detector no sabe qué handlers trae un re-export con comodín. Escribe los `export` a mano " +
        "en el `route.ts` o enséñale al detector a seguirlos; asumir que están documentados es el fallo mudo.",
    ).toEqual([]);
    expect(clavesRarasDelSpec, "claves de un Path Item que no son ni verbo ni metadato conocido").toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · R1 — toda ruta REAL del canal está publicada (path Y verbo)
// ═══════════════════════════════════════════════════════════════════════════
describe("322/R1 · ningún endpoint del canal existe sin estar en el contrato publicado", () => {
  it("toda operación de `app/api/ordenes/api-key/**` tiene su entrada en `openApiSpec.paths`", () => {
    const publicadas = new Set(operacionesDelSpec.map(formatear));
    const huerfanas = operacionesRealesPublicables
      .filter((op) => !publicadas.has(formatear(op)))
      .map((op) => `${formatear(op)}  (${op.origen})`)
      .sort();
    expect(
      huerfanas,
      "estas operaciones EXISTEN en el filesystem y NO están en `lib/api/openapi-spec.ts`. Un integrador " +
        "abre el Swagger UI y no las ve: para él no existen. Documéntalas en el objeto TS y en el espejo " +
        "`docs/api/api-key-openapi.yaml` (y sube el censo de `openapi-177-paths-pdf-y-carga-id.test.ts` si " +
        "es un path nuevo), o anota el export con `/** @sin-publicar <motivo real> */` diciendo por qué no.",
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · R2 — y al revés: nada publicado se quedó sin ruta
// ═══════════════════════════════════════════════════════════════════════════
describe("322/R2 · ninguna operación publicada apunta a una ruta que ya no existe", () => {
  it("toda operación de `openApiSpec.paths` tiene su `route.ts` con ese verbo exportado", () => {
    const reales = new Set(operacionesReales.map(formatear));
    const fantasmas = operacionesDelSpec
      .filter((op) => !reales.has(formatear(op)))
      .map(formatear)
      .sort();
    expect(
      fantasmas,
      "estas operaciones están PUBLICADAS y no existen en el filesystem: el integrador que las llame " +
        "recibe un 404 contra un contrato que se lo prometía. Retíralas del objeto TS y del `.yaml` " +
        "(y baja el censo de `openapi-177-paths-pdf-y-carga-id.test.ts` si el path desaparece entero).",
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · R3 — el espejo `.yaml` declara las MISMAS operaciones
// ═══════════════════════════════════════════════════════════════════════════
describe("322/R3 · el `.yaml` publicado y el objeto TS declaran las mismas operaciones", () => {
  it("los dos artefactos coinciden par a par (path + verbo), no solo en la lista de paths", () => {
    // El censo hermano ya compara la lista de PATHS de los dos artefactos. Aquí se comparan los
    // VERBOS, que es lo que la 320 movió sin mover ningún path: sin esto, el YAML podía quedarse
    // sin el `delete` y nada lo decía.
    const enTs = operacionesDelSpec.map(formatear).sort();
    const enYaml = operacionesDelYaml(yamlBruto).map(formatear).sort();
    expect(
      enYaml,
      "el `.yaml` dice «GENERADO … no editar a mano» y NADA lo regenera: si uno de los dos gana o " +
        "pierde un verbo, el otro se queda mintiendo. Ponlos iguales a mano, en el mismo commit.",
    ).toEqual(enTs);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · R4 — la excepción va anotada, y caduca
// ═══════════════════════════════════════════════════════════════════════════
describe("322/R4 · `@sin-publicar` es la única forma de dejar un endpoint fuera del contrato", () => {
  it("ninguna anotación `@sin-publicar` sobrevive a su motivo", () => {
    const publicadas = new Set(operacionesDelSpec.map(formatear));
    const caducadas = rutasReales.flatMap((r) =>
      [...r.anotados.keys()]
        .filter((verbo) => publicadas.has(`${verbo} ${r.ruta}`))
        .map((verbo) => `${verbo} ${r.ruta}  (${r.archivo})`),
    );
    expect(
      caducadas,
      "estas operaciones llevan `@sin-publicar` pero SÍ están en el contrato: la excepción caducó. " +
        "Quítala — una excepción que sobrevive a su motivo es basura que crece hasta que nadie lee ninguna.",
    ).toEqual([]);
  });

  it("las anotaciones vivas se pueden enumerar y cada una trae su motivo escrito", () => {
    // Hoy no hay ninguna (2026-08-28). Este test no exige que sean cero: exige que, si aparecen,
    // estén enumeradas con su motivo aquí, a la vista, en vez de escondidas en una allowlist.
    const vivas = rutasReales.flatMap((r) =>
      [...r.anotados.entries()].map(([verbo, motivo]) => `${verbo} ${r.ruta}: ${motivo}`),
    );
    for (const linea of vivas) {
      expect(linea.split(": ").slice(1).join(": ").length).toBeGreaterThanOrEqual(MOTIVO_MINIMO);
    }
    expect(Array.isArray(vivas)).toBe(true);
  });
});
