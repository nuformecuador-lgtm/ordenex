// GUARDIA DEL ARNÉS — SUPERFICIE DE USO.
//
// **El incidente que la motiva.** El 2026-07-31 el commit `54757be4` borró la vista legacy
// `OrdenesRevisionMaestro`. Era la única que montaba `RutearSateliteModal`, el único que llamaba a
// la Server Action `rutearABodegaSatelite`. La acción quedó **sin ninguna superficie de UI**: el
// backend entero, los tests verdes, y cinco días de producción sin que nadie pudiera rutear una
// guía a bodega satélite hasta que un humano lo reportó. Nada en la suite afirmaba que alguien
// pudiera DISPARAR esa acción, así que borrar su última pantalla no rompió nada.
//
// **Por qué el grado de entrada (`in_degree`) no sirve, medido y no supuesto.** El barrido de
// `progress/barrido_acciones_huerfanas.md` contó los importadores de cada acción: 20 candidatas con
// cero, de las cuales **5 eran falsos positivos** (símbolos usados por REFERENCIA: alias,
// `previewAction = previewPlantilla`, `files.map(leerEvidencia)`, `deps.setCookie ?? setSessionCookie`)
// y —lo decisivo— **`rutearABodegaSatelite` NO estaba en la lista**, porque su modal sí la importaba.
// Lo que estaba muerto era el modal. Una guardia sobre `in_degree` habría sido ruidosa Y habría
// dejado pasar justo el caso que la justifica.
//
// **La primitiva correcta es la ALCANZABILIDAD TRANSITIVA desde las raíces de ruta de Next.** Un
// símbolo vive si algún módulo que lo importa cae en el cierre transitivo de
// `app/**/{page,layout,route,…}` + `app/api/**/route.ts` + `middleware.ts`. Con eso, los 5 falsos
// positivos se resuelven solos (la cadena `ChatConversacion → ChatFlotante → RepartoModule →
// reparto/page.tsx` se recorre sin ayuda), las huérfanas reales quedan aisladas y salen además las
// de SEGUNDO ORDEN —`geo.ts`, `arbolZonas`, `rutearABodegaSatelite`— que el conteo no ve.
// (Las dos primeras ya no están en el árbol: el humano decidió borrarlas el 2026-08-07 y esta
// guardia fue quien las puso encima de la mesa. Se citan aquí como el HALLAZGO que justifica la
// primitiva, no como código vigente.)
//
// **Tres capas, porque la superficie se corta en tres sitios distintos:**
//
//  - **R-A · la acción** — una Server Action de `lib/actions/**` que ningún módulo alcanzable
//    importa. Es donde SE NOTA el incidente.
//  - **R-B · el componente** — un componente que nadie monta. Es donde EMPEZÓ el incidente
//    (`RutearSateliteModal` quedó huérfano un nivel antes que la acción). Detectarlo aquí dice
//    «has borrado la vista que montaba esto», que es más útil que decirlo en la acción.
//  - **R-C · dentro del módulo** — el cable suelto que ninguna de las dos anteriores ve: el modal
//    sigue importado y renderizado, pero el handler que lo abre se quedó sin quien lo llame. Es
//    exactamente la mutación (a) de la verificación de abajo, y es la forma en que este mismo
//    incidente puede repetirse SIN borrar ningún archivo.
//
// **La excepción va ANOTADA JUNTO AL EXPORT, no en una allowlist.** `/** @sin-superficie <motivo> */`
// pegado a la declaración. Es la convención que este repo ya adoptó (`fa60b0ce`, «el motivo junto al
// código»); una allowlist central se desincroniza y nadie la poda; y sobre todo **invierte la carga
// de la prueba en el momento correcto**: quien borre la vista que monta algo se encuentra la suite
// roja y tiene que elegir entre volver a montarla o escribir por qué se queda sin superficie. Eso
// es exactamente lo que NO ocurrió el 2026-07-31. Por simetría, la anotación **caduca**: si lo
// anotado vuelve a ser alcanzable, la guardia exige quitarla — una excepción que sobrevive a su
// motivo es basura que crece hasta que nadie lee ninguna.
//
// **Por qué el detector se auto-prueba.** En esta misma feature una guardia pasó VERDE con su
// detector roto: encontraba cero porque no encontraba NADA. Una guardia estática rota no falla,
// calla. Por eso aquí: (0) el detector se prueba contra respuestas conocidas en las dos
// direcciones; (1) se afirma el tamaño del árbol y que ningún archivo leído está vacío; (2) hay
// control positivo sobre el árbol real —incluido `rutearABodegaSatelite`, que es el caso del bug—;
// y (3) todo especificador que el resolvedor NO sepa resolver se REPORTA en rojo, en vez de
// asumirse alcanzable. Un detector que en la duda calla es justo el que falla.
//
// La lectura es ESTÁTICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin
// estar registrada en ninguna lista.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

/** Los árboles de código de PRODUCCIÓN. `tests/`, `e2e/` y `scripts/` quedan fuera a propósito:
 *  que un test importe una acción no es una superficie de usuario — ése es precisamente el estado
 *  en el que estaban las cuatro de `lib/actions/ordenes.ts` cuando el barrido las encontró. */
const ARBOLES = ["app", "components", "lib", "hooks", "providers"] as const;

/** Módulos sueltos de la raíz que Next carga por convención (no viven bajo ningún árbol). */
const SUELTOS = ["middleware.ts", "instrumentation.ts"] as const;

const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mts"] as const;

/** Los nombres de archivo que Next.js convierte en punto de entrada. `app/api/**\/route.ts`
 *  (incluidos los 7 crons) entra por `route`. */
const NOMBRE_DE_RAIZ =
  /^(page|layout|template|default|route|loading|error|not-found|global-error)\.(ts|tsx)$/;

/** La anotación de excepción, con su motivo obligatorio en la MISMA línea. */
const ANOTACION = /@sin-superficie[ \t]+(\S[^\n]*)/;

/** Motivos que no son motivos. Una excepción sin razón escrita es la allowlist que no queríamos. */
const MOTIVO_VACIO = /^(todo|tbd|fixme|xxx|pendiente|por decidir|n\/a|-+)\b/i;
const MOTIVO_MINIMO = 20;

// ---------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------

/**
 * Quita comentarios **conservando el número de líneas**: en este repo la prosa nombra símbolos y
 * rutas a propósito (este archivo mismo lo hace), y sin esto el escaneo leería esa prosa como
 * código. Conservar las líneas es lo que permite localizar un export por su nº de línea y luego
 * buscar su anotación en el TEXTO BRUTO, que es donde viven los comentarios.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_todo, previo: string) => previo);
}

function lineasDe(fuente: string): string[] {
  return fuente.split(/\r?\n/);
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.(tsx?|jsx?|mts)$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

/** Resultado de resolver un especificador de import. */
type Resolucion =
  | { tipo: "modulo"; ruta: string }
  | { tipo: "externo" } // paquete de node_modules: fuera del grafo, y está bien
  | { tipo: "no-resuelto" }; // ni un archivo ni un paquete: la guardia TIENE que quejarse

/**
 * Resuelve `@/…`, `./…` y `../…` a un módulo del repo. Cubre extensión implícita, `index.ts` de
 * carpeta y el `.js` que TypeScript deja apuntar a un `.ts`. Un especificador desnudo (`react`,
 * `next/server`) es externo. Cualquier otra cosa es `no-resuelto` — y eso se reporta, porque una
 * arista que el resolvedor pierde es una arista que el cierre transitivo no recorre, y entonces
 * algo VIVO parecería muerto (falso rojo) o, peor, un árbol entero quedaría sin explorar.
 */
function resolverEspecificador(desde: string, especificador: string): Resolucion {
  const raiz = RAIZ.split(path.sep).join("/");
  let base: string;
  if (especificador.startsWith("@/")) base = path.posix.join(raiz, especificador.slice(2));
  else if (especificador.startsWith("."))
    base = path.posix.join(path.posix.dirname(path.posix.join(raiz, desde)), especificador);
  else return { tipo: "externo" };

  const candidatos: string[] = [];
  if (/\.(tsx?|jsx?|mts|json|css|scss|svg|png|jpe?g|webp|gif|md|xlsx|woff2?)$/i.test(base)) {
    candidatos.push(base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  } else {
    for (const ext of EXTENSIONES) candidatos.push(base + ext);
    for (const ext of EXTENSIONES) candidatos.push(base + "/index" + ext);
  }
  for (const candidato of candidatos) {
    if (existsSync(candidato) && statSync(candidato).isFile())
      return { tipo: "modulo", ruta: rutaRelativa(candidato) };
  }
  return { tipo: "no-resuelto" };
}

/** Todo especificador de módulo del archivo: `from "x"`, `import "x"`, `import("x")`, `require("x")`
 *  y `export … from "x"`. `import(` es el que hace falta para `next/dynamic` y para el `await
 *  import()` con el que `HistorialOrdenSheet` llega a su acción. */
function especificadoresDe(codigo: string): string[] {
  const salida: string[] = [];
  for (const m of codigo.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g,
  ))
    salida.push(m[1]);
  for (const m of codigo.matchAll(/\bimport\s+["']([^"']+)["']/g)) salida.push(m[1]);
  return salida;
}

/** Una arista de import a nivel de SÍMBOLO. `comodin` = el importador tomó el módulo entero
 *  (`import * as ns` o `import()` dinámico) y puede usar cualquier export por acceso de miembro. */
interface AristaSimbolo {
  destino: string;
  nombres: string[];
  comodin: boolean;
}

/**
 * Los símbolos que un módulo trae de otro. De un alias `{ a as b }` registra **`a`**, el nombre en
 * el ORIGEN: es lo que separa a `marcarTodasLeidas` (falso positivo nº 16 del barrido) de una
 * huérfana de verdad. Un `export { a } from "x"` cuenta igual: re-exportar es importar.
 */
function aristasDeSimbolo(desde: string, codigo: string): AristaSimbolo[] {
  const salida: AristaSimbolo[] = [];
  const anota = (especificador: string, nombres: string[], comodin: boolean) => {
    const r = resolverEspecificador(desde, especificador);
    if (r.tipo === "modulo") salida.push({ destino: r.ruta, nombres, comodin });
  };

  // `import { a, b as c } from "x"` / `export { a } from "x"`. Un import de TIPO —el clausal
  // `import type { … }` o el `{ type X }` en línea— NO es superficie de ejecución: se borra al
  // compilar. Contarlo daría por viva una acción que nadie puede disparar.
  for (const m of codigo.matchAll(
    /\b(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    if (m[1]) continue;
    const nombres = m[2]
      .split(",")
      .map((pieza) => pieza.trim())
      .filter((pieza) => pieza && !/^type\s/.test(pieza))
      .map((pieza) => pieza.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    anota(m[3], nombres, false);
  }
  // `import * as ns from "x"` / `export * from "x"` / `import("x")` → comodín
  for (const m of codigo.matchAll(/\bimport\s+\*\s+as\s+[\w$]+\s*from\s*["']([^"']+)["']/g))
    anota(m[1], [], true);
  for (const m of codigo.matchAll(/\bexport\s+\*(?:\s+as\s+[\w$]+)?\s*from\s*["']([^"']+)["']/g))
    anota(m[1], [], true);
  for (const m of codigo.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) anota(m[1], [], true);

  return salida;
}

/** Un `export` de VALOR (no `type`/`interface`), con la línea en la que está declarado. */
interface ExportDeValor {
  nombre: string;
  linea: number; // índice 0-based sobre las líneas del archivo
  asincrona: boolean;
}

const EXPORT_DE_VALOR =
  /^\s*export\s+(?:default\s+)?(?:(async)\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/;

function exportsDeValor(codigoAlineado: string): ExportDeValor[] {
  return lineasDe(codigoAlineado).flatMap((linea, i) => {
    const m = EXPORT_DE_VALOR.exec(linea);
    return m ? [{ nombre: m[2], linea: i, asincrona: Boolean(m[1]) }] : [];
  });
}

/**
 * El bloque de comentario **pegado** a la línea `linea`: se sube mientras haya comentario y se
 * corta en la primera línea en blanco o de código. Es lo que impide que un `@sin-superficie` de
 * otro export, cincuenta líneas más arriba, cuente como excepción de éste.
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
function anotacionDe(lineasBrutas: string[], linea: number): string | null {
  const m = ANOTACION.exec(comentarioPegadoA(lineasBrutas, linea));
  if (!m) return null;
  const motivo = m[1].replace(/\*\/\s*$/, "").trim();
  if (motivo.length < MOTIVO_MINIMO || MOTIVO_VACIO.test(motivo)) return null;
  return motivo;
}

// ---------------------------------------------------------------------------
// El grafo, construido una vez
// ---------------------------------------------------------------------------

interface Modulo {
  ruta: string;
  bruto: string;
  /** El archivo sin comentarios pero con las MISMAS líneas: lo que el código dice. */
  codigo: string;
  lineas: string[];
  aristas: AristaSimbolo[];
  /** Especificadores relativos o con alias que el resolvedor no supo resolver. */
  noResueltos: string[];
}

interface Grafo {
  modulos: Map<string, Modulo>;
  raices: string[];
  alcanzables: Set<string>;
  inalcanzables: string[];
}

function construirGrafo(): Grafo {
  const modulos = new Map<string, Modulo>();
  const rutas = [
    ...ARBOLES.flatMap((arbol) => listarFuentes(path.join(RAIZ, arbol)).map(rutaRelativa)),
    ...SUELTOS.filter((s) => existsSync(path.join(RAIZ, s))),
  ].sort();

  for (const ruta of rutas) {
    const bruto = readFileSync(path.join(RAIZ, ruta), "utf8");
    const codigo = sinComentarios(bruto);
    const noResueltos = especificadoresDe(codigo).filter(
      (e) => resolverEspecificador(ruta, e).tipo === "no-resuelto",
    );
    modulos.set(ruta, {
      ruta,
      bruto,
      codigo,
      lineas: lineasDe(bruto),
      aristas: aristasDeSimbolo(ruta, codigo),
      noResueltos,
    });
  }

  // Vecinos por MÓDULO (une aristas de símbolo, comodines y los `import "x"` sin nombres).
  const vecinos = new Map<string, string[]>();
  for (const [ruta, m] of modulos) {
    const destinos = new Set<string>();
    for (const especificador of especificadoresDe(m.codigo)) {
      const r = resolverEspecificador(ruta, especificador);
      if (r.tipo === "modulo" && modulos.has(r.ruta)) destinos.add(r.ruta);
    }
    vecinos.set(ruta, [...destinos]);
  }

  const raices = [...modulos.keys()].filter(
    (m) =>
      (m.startsWith("app/") && NOMBRE_DE_RAIZ.test(m.slice(m.lastIndexOf("/") + 1))) ||
      (SUELTOS as readonly string[]).includes(m),
  );

  const alcanzables = new Set<string>();
  const pila = [...raices];
  while (pila.length) {
    const actual = pila.pop() as string;
    if (alcanzables.has(actual)) continue;
    alcanzables.add(actual);
    for (const vecino of vecinos.get(actual) ?? []) if (!alcanzables.has(vecino)) pila.push(vecino);
  }

  return {
    modulos,
    raices,
    alcanzables,
    inalcanzables: [...modulos.keys()].filter((m) => !alcanzables.has(m)).sort(),
  };
}

const GRAFO = construirGrafo();

/** Una Server Action: `export async function` en un módulo de `lib/actions/**` con `"use server"`. */
interface Accion {
  modulo: string;
  nombre: string;
  linea: number;
}

function censarAcciones(grafo: Grafo): Accion[] {
  const salida: Accion[] = [];
  for (const [ruta, m] of grafo.modulos) {
    if (!ruta.startsWith("lib/actions/")) continue;
    if (!/^\s*["']use server["'];?/m.test(m.codigo)) continue; // helpers como `_shared/` fuera
    for (const e of exportsDeValor(m.codigo))
      if (e.asincrona) salida.push({ modulo: ruta, nombre: e.nombre, linea: e.linea });
  }
  return salida.sort((a, b) => `${a.modulo}#${a.nombre}`.localeCompare(`${b.modulo}#${b.nombre}`));
}

const ACCIONES = censarAcciones(GRAFO);

/**
 * Los módulos ALCANZABLES que importan `accion`. Dos vías, ninguna exige un call site (la lección
 * de los 5 falsos positivos: `previewAction = previewPlantilla` es uso, aunque no sea llamada):
 *  - arista nombrada al símbolo;
 *  - arista comodín al módulo (`import * as` / `import()`) + mención del nombre en el código, que
 *    es como `HistorialOrdenSheet` usa `obtenerHistorialOrden`.
 */
const CACHE_SUPERFICIES = new Map<string, string[]>();

function superficiesDe(accion: Accion): string[] {
  const clave = `${accion.modulo}#${accion.nombre}`;
  const memo = CACHE_SUPERFICIES.get(clave);
  if (memo) return memo;
  const salida: string[] = [];
  const mencion = new RegExp(`\\b${accion.nombre}\\b`);
  for (const ruta of GRAFO.alcanzables) {
    if (ruta === accion.modulo) continue;
    const m = GRAFO.modulos.get(ruta);
    if (!m) continue;
    for (const arista of m.aristas) {
      if (arista.destino !== accion.modulo) continue;
      if (arista.nombres.includes(accion.nombre) || (arista.comodin && mencion.test(m.codigo))) {
        salida.push(ruta);
        break;
      }
    }
  }
  salida.sort();
  CACHE_SUPERFICIES.set(clave, salida);
  return salida;
}

const VIVAS = ACCIONES.filter((a) => superficiesDe(a).length > 0);
const SIN_SUPERFICIE = ACCIONES.filter((a) => superficiesDe(a).length === 0);

/** Un componente: cualquier módulo de `components/**` o de un `_components/` colocado bajo `app/`. */
function esComponente(ruta: string): boolean {
  return ruta.startsWith("components/") || /^app\/.*\/_components\//.test(ruta);
}

const COMPONENTES = [...GRAFO.modulos.keys()].filter(esComponente).sort();

/** Un módulo está anotado si ALGUNO de sus exports de valor lleva la anotación con motivo. */
function anotacionDeModulo(ruta: string): string | null {
  const m = GRAFO.modulos.get(ruta);
  if (!m) return null;
  for (const e of exportsDeValor(m.codigo)) {
    const motivo = anotacionDe(m.lineas, e.linea);
    if (motivo) return motivo;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 0 — El detector, probado contra la respuesta conocida
// ---------------------------------------------------------------------------

describe("superficie de uso — el detector", () => {
  it("el resolvedor cubre alias @/, relativos, index.ts y extensión implícita, y separa lo externo de lo inexistente", () => {
    // Sobre archivos REALES del repo, para que un movimiento de árbol se note aquí y no en silencio.
    const desde = "app/(app)/ordenes/_components/OrdenesListado.tsx";
    expect(resolverEspecificador(desde, "@/lib/actions/ordenes-guia")).toEqual({
      tipo: "modulo",
      ruta: "lib/actions/ordenes-guia.ts",
    });
    expect(resolverEspecificador(desde, "./RutearSateliteModal")).toEqual({
      tipo: "modulo",
      ruta: "app/(app)/ordenes/_components/RutearSateliteModal.tsx",
    });
    // `index.ts` de carpeta: sin esto, `@/lib/errors` no resolvería y media `lib/` quedaría fuera
    // del cierre transitivo — con lo que la guardia inventaría huérfanas a mansalva.
    expect(resolverEspecificador(desde, "@/lib/errors")).toEqual({
      tipo: "modulo",
      ruta: "lib/errors/index.ts",
    });
    // Un paquete es externo, no un agujero.
    expect(resolverEspecificador(desde, "react").tipo).toBe("externo");
    expect(resolverEspecificador(desde, "next/navigation").tipo).toBe("externo");
    // Y lo que NO existe se declara no resuelto: es la mitad que impide que la guardia,
    // en la duda, dé por alcanzable lo que no ha sabido leer.
    expect(resolverEspecificador(desde, "@/lib/actions/no-existe-esto").tipo).toBe("no-resuelto");
    expect(resolverEspecificador(desde, "./TampocoExiste").tipo).toBe("no-resuelto");
  });

  it("el lector de especificadores ve `from`, `export … from` e `import()` dinámico, y no lee la prosa", () => {
    const codigo = sinComentarios(
      [
        "// import { mentira } from \"@/lib/actions/prosa\";",
        "/** Aquí se menciona from \"@/lib/actions/tambien-prosa\" a propósito. */",
        'import { a } from "@/lib/actions/uno";',
        'export { b } from "./dos";',
        'const m = await import("@/lib/actions/tres");',
        'const C = dynamic(() => import("../cuatro"));',
        'import "@/app/globals.css";',
        'const url = "https://ejemplo/no-es-import";',
      ].join("\n"),
    );
    expect(especificadoresDe(codigo).sort()).toEqual([
      "../cuatro",
      "./dos",
      "@/app/globals.css",
      "@/lib/actions/tres",
      "@/lib/actions/uno",
    ]);
    // La mitad que impide el falso rojo: la prosa NO es una arista…
    expect(especificadoresDe(codigo)).not.toContain("@/lib/actions/prosa");
    expect(especificadoresDe(codigo)).not.toContain("@/lib/actions/tambien-prosa");
    // …y el `//` de una URL no se come la línea entera (el bug clásico de este helper).
    expect(codigo).toContain("https://ejemplo/no-es-import");
    // Y las líneas se conservan: la localización de exports por nº de línea depende de esto.
    expect(lineasDe(codigo).length).toBe(8);
  });

  it("el lector de símbolos registra el nombre en ORIGEN de un alias y marca el comodín de `import *`/`import()`", () => {
    // Éste es, literalmente, el detector que separa los 5 falsos positivos de las huérfanas.
    const codigo = sinComentarios(
      [
        'import { marcarTodasLeidas as marcarTodasLeidasAction } from "@/lib/actions/notificaciones";',
        // El ancla del import nombrado + tipo era `@/lib/actions/geo`; ese módulo se borró entero
        // el 2026-08-07 (chore de código muerto, tanda 2) y `resolverEspecificador` exige que el
        // archivo EXISTA, así que el ancla tiene que ser un módulo vivo o este caso se cae solo.
        // `lib/actions/zonas.ts` sirve igual: import nombrado de valor + import de tipo en línea.
        'import { listarZonas, type ZonaDTO } from "@/lib/actions/zonas";',
        'const mod = await import("@/lib/actions/orden-historial");',
      ].join("\n"),
    );
    const aristas = aristasDeSimbolo("app/(app)/x/page.tsx", codigo);
    const notificaciones = aristas.find((a) => a.destino === "lib/actions/notificaciones.ts");
    expect(
      notificaciones?.nombres,
      "un alias oculta el símbolo de origen: `marcarTodasLeidas` parecería huérfana",
    ).toContain("marcarTodasLeidas");
    const zonas = aristas.find((a) => a.destino === "lib/actions/zonas.ts");
    expect(zonas?.nombres).toContain("listarZonas");
    expect(zonas?.nombres, "un `type` importado no es una superficie de ejecución").not.toContain(
      "ZonaDTO",
    );
    const dinamico = aristas.find((a) => a.destino === "lib/actions/orden-historial.ts");
    expect(dinamico?.comodin, "sin comodín, todo `await import()` daría falso rojo").toBe(true);
  });

  it("el lector de anotaciones exige motivo escrito y solo mira el comentario PEGADO al export", () => {
    const pegada = lineasDe(
      ["/**", " * @sin-superficie deuda: nunca tuvo botón, feature 107.", " */", "export async function x() {}"].join("\n"),
    );
    expect(anotacionDe(pegada, 3)).toBe("deuda: nunca tuvo botón, feature 107.");

    // Separada por una línea en blanco: NO es la anotación de este export.
    const separada = lineasDe(
      ["/** @sin-superficie deuda: nunca tuvo botón, feature 107. */", "", "export async function x() {}"].join("\n"),
    );
    expect(
      anotacionDe(separada, 2),
      "una anotación suelta arriba del archivo excusaría a todos los exports de golpe",
    ).toBeNull();

    // Motivos que no son motivos.
    for (const relleno of ["TODO", "pendiente de decidir", "-", "x"]) {
      const floja = lineasDe([`/** @sin-superficie ${relleno} */`, "export async function x() {}"].join("\n"));
      expect(anotacionDe(floja, 1), `«${relleno}» pasó como motivo`).toBeNull();
    }
    // Y sin anotación, null.
    expect(anotacionDe(lineasDe(["/** Nada. */", "export async function x() {}"].join("\n")), 1)).toBeNull();
  });

  it("el censo de exports distingue `export async function` de un tipo o de una función interna", () => {
    const codigo = sinComentarios(
      [
        "export interface NoEsUnValor { a: string }",
        "export type TampocoLoEs = string;",
        "async function interna() {}",
        "export async function sesenta() {}",
        "export const constante = 1;",
      ].join("\n"),
    );
    const exports = exportsDeValor(codigo);
    expect(exports.map((e) => e.nombre)).toEqual(["sesenta", "constante"]);
    expect(exports.find((e) => e.nombre === "sesenta")?.asincrona).toBe(true);
    expect(exports.find((e) => e.nombre === "constante")?.asincrona).toBe(false);
    expect(exports.find((e) => e.nombre === "sesenta")?.linea).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 1 — Anti-vacuidad: el árbol existe, se leyó entero y se entendió entero
// ---------------------------------------------------------------------------

describe("superficie de uso — anti-vacuidad", () => {
  it("el grafo encontró raíces de ruta, módulos y aristas, y ningún archivo leído está vacío", () => {
    // Sin esto, un `ARBOLES` mal escrito o un `app/` que se mueva dejan los escaneos de abajo sobre
    // CERO archivos, y todos sus `toEqual([])` pasan para siempre. Es el modo de fallo que ya
    // ocurrió en esta feature: la guardia verde porque no encontraba nada.
    expect(GRAFO.raices.length, "no se encontró ninguna raíz de ruta de Next").toBeGreaterThanOrEqual(
      40,
    );
    expect(GRAFO.modulos.size, "el recorrido de los árboles de producción no leyó nada").toBeGreaterThan(
      800,
    );
    expect(
      GRAFO.alcanzables.size,
      "el cierre transitivo no salió de las raíces: el resolvedor está roto",
    ).toBeGreaterThan(850);

    // Las raíces son de los dos tipos que Next tiene: pantallas y route handlers.
    expect(GRAFO.raices.some((r) => r.endsWith("/page.tsx"))).toBe(true);
    expect(GRAFO.raices.some((r) => r.startsWith("app/api/") && r.endsWith("/route.ts"))).toBe(true);
    expect(GRAFO.raices).toContain("middleware.ts");

    // Ni un archivo vacío, y ni un módulo sin aristas donde debería tenerlas.
    const vacios = [...GRAFO.modulos.values()].filter((m) => m.bruto.trim().length === 0);
    expect(vacios.map((m) => m.ruta), "hay archivos leídos como vacíos").toEqual([]);
    const conAristas = [...GRAFO.modulos.values()].filter((m) => m.aristas.length > 0).length;
    expect(conAristas, "ningún módulo importa a otro: el lector de imports no ve nada").toBeGreaterThan(
      500,
    );
  });

  it("todo especificador relativo o con alias resuelve a un archivo real", () => {
    // Un especificador que el resolvedor no sabe leer es una arista PERDIDA, y una arista perdida
    // convierte código vivo en huérfano de mentira. La guardia se queja en vez de asumir.
    const rotos = [...GRAFO.modulos.values()]
      .filter((m) => m.noResueltos.length > 0)
      .map((m) => `${m.ruta} -> ${m.noResueltos.join(", ")}`);
    expect(
      rotos,
      "el resolvedor de imports no supo resolver estos especificadores: o el archivo no existe " +
        "(y es un import roto) o al resolvedor le falta un caso, y entonces esta guardia mide un " +
        "grafo incompleto",
    ).toEqual([]);
  });

  it("el censo de Server Actions ve las de `lib/actions/**` y solo las de ahí", () => {
    expect(ACCIONES.length, "el censo de Server Actions no encontró casi nada").toBeGreaterThan(150);
    expect(ACCIONES.every((a) => a.modulo.startsWith("lib/actions/"))).toBe(true);
    // Un par de anclas concretas, para que la cifra no sea el único testigo.
    const claves = ACCIONES.map((a) => `${a.modulo}#${a.nombre}`);
    expect(claves).toContain("lib/actions/ordenes-guia.ts#rutearABodegaSatelite");
    // El ancla de este segundo modulo era `marcarNotificacionLeida`, borrada el 2026-08-07 por
    // no tener boton. `descartarNotificacion` sirve igual y ademas esta VIVA, que para un ancla
    // del censo es mejor: no volvera a desaparecer por una limpieza de codigo muerto.
    expect(claves).toContain("lib/actions/notificaciones.ts#descartarNotificacion");
    // `_shared/to-action-error.ts` no lleva `"use server"`: es un helper, no una acción.
    expect(claves.some((c) => c.includes("to-action-error"))).toBe(false);

    expect(COMPONENTES.length, "no se encontró ningún componente").toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// 2 — Control positivo: el detector SÍ ve vivo lo que está vivo
// ---------------------------------------------------------------------------

describe("superficie de uso — control positivo", () => {
  it("CONTROL POSITIVO: `rutearABodegaSatelite` y su modal son alcanzables — el caso del incidente", () => {
    // Éste es el control que más importa: es la acción que estuvo cinco días sin superficie. Si
    // alguna vez vuelve a caer, este caso se pone rojo ANTES que el censo de abajo y nombra el
    // incidente por su nombre.
    const rutear = ACCIONES.find((a) => a.nombre === "rutearABodegaSatelite");
    expect(rutear, "desapareció `rutearABodegaSatelite` de `lib/actions/ordenes-guia.ts`").toBeDefined();
    expect(
      superficiesDe(rutear as Accion),
      "`rutearABodegaSatelite` se quedó otra vez sin superficie de UI: es el bug del 2026-07-31 " +
        "(commit 54757be4), reparado por dc275e87. Alguien tiene que volver a montar su modal.",
    ).toContain("app/(app)/ordenes/_components/RutearSateliteModal.tsx");
    expect(
      GRAFO.alcanzables.has("app/(app)/ordenes/_components/RutearSateliteModal.tsx"),
      "`RutearSateliteModal` volvió a quedarse sin quien lo monte",
    ).toBe(true);
    expect(GRAFO.alcanzables.has("app/(app)/ordenes/_components/OrdenesListado.tsx")).toBe(true);
  });

  it("CONTROL POSITIVO: las cinco que `in_degree` marcaba en falso salen VIVAS", () => {
    // La demostración de que la primitiva cambió a mejor y no solo a distinto. Estas cinco son
    // usos por REFERENCIA (alias, valor por defecto de prop, paso como argumento, `.map(fn)`,
    // fallback de `??`) y un conteo de llamadas las daba por muertas. La alcanzabilidad las
    // resuelve sola, sin una línea de excepción.
    for (const nombre of ["marcarTodasLeidas", "previewPlantilla", "listarPlantillasActivasParaEnvio"]) {
      const accion = ACCIONES.find((a) => a.nombre === nombre);
      expect(accion, `desapareció la acción ${nombre}`).toBeDefined();
      expect(
        superficiesDe(accion as Accion),
        `${nombre} salió sin superficie: era un falso positivo conocido del conteo de llamadas ` +
          "(uso por referencia), así que si sale huérfana es el detector el que se rompió",
      ).not.toEqual([]);
    }
    // `previewPlantilla` llega a una raíz por una cadena de TRES saltos; que siga viva es la
    // prueba de que el cierre es transitivo de verdad y no un nivel.
    expect(GRAFO.alcanzables.has("app/(app)/configuracion/plantillas/_components/VariablesInsert.tsx")).toBe(
      true,
    );
  });

  it("CONTROL POSITIVO: la acción que solo se alcanza por `import()` dinámico sale VIVA", () => {
    // `HistorialOrdenSheet` carga su acción con `await import("@/lib/actions/orden-historial")` y
    // la usa por acceso de miembro. Sin el comodín, ésta es la primera huérfana de mentira que la
    // guardia inventaría, y la primera anotación que alguien pondría por error.
    const historial = ACCIONES.find((a) => a.nombre === "obtenerHistorialOrden");
    expect(historial, "desapareció `obtenerHistorialOrden`").toBeDefined();
    expect(superficiesDe(historial as Accion)).toContain(
      "app/(app)/ordenes/_components/HistorialOrdenSheet.tsx",
    );
  });

  it("CONTROL POSITIVO: la inmensa mayoría de las acciones y de los componentes están vivos", () => {
    // La forma agregada del control: si el detector se rompiera «hacia el rojo», esta proporción
    // se desplomaría y lo veríamos aquí en vez de en 180 fallos sueltos.
    expect(VIVAS.length / ACCIONES.length, "más del 20% de las acciones sin superficie: revisa el detector").toBeGreaterThan(
      0.8,
    );
    const componentesVivos = COMPONENTES.filter((c) => GRAFO.alcanzables.has(c));
    expect(componentesVivos.length / COMPONENTES.length).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// R-A — ninguna Server Action se queda sin superficie en silencio
// ---------------------------------------------------------------------------

describe("R-A — toda Server Action tiene superficie, o dice por escrito por qué no", () => {
  it("ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`", () => {
    const huerfanas = SIN_SUPERFICIE.filter((a) => {
      const m = GRAFO.modulos.get(a.modulo) as Modulo;
      return anotacionDe(m.lineas, a.linea) === null;
    }).map((a) => `${a.modulo}:${a.linea + 1} ${a.nombre}`);

    expect(
      huerfanas,
      "estas Server Actions no las importa NINGÚN módulo alcanzable desde una raíz de ruta: no " +
        "hay forma de que un usuario las dispare. Es el estado en el que estuvo " +
        "`rutearABodegaSatelite` cinco días. O se les vuelve a dar superficie, o se anota junto " +
        "al export `/** @sin-superficie <motivo real> */` diciendo por qué se queda sin ella.",
    ).toEqual([]);
  });

  it("ninguna anotación `@sin-superficie` de acción sobrevive a su motivo", () => {
    // La otra mitad, y la que evita que en un año haya 40 tags y ninguna señal: si la acción
    // recuperó superficie, la excusa sobra y hay que borrarla.
    const caducadas = VIVAS.filter((a) => {
      const m = GRAFO.modulos.get(a.modulo) as Modulo;
      return anotacionDe(m.lineas, a.linea) !== null;
    }).map((a) => `${a.modulo}:${a.linea + 1} ${a.nombre} -> ${superficiesDe(a).join(", ")}`);

    expect(
      caducadas,
      "estas acciones llevan `@sin-superficie` pero SÍ son alcanzables desde una raíz de ruta: " +
        "la excepción caducó y hay que quitarla, o la anotación deja de significar nada",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R-B — ningún componente se queda sin quien lo monte
// ---------------------------------------------------------------------------

describe("R-B — todo componente tiene quien lo monte, o dice por escrito por qué no", () => {
  it("ningún componente es inalcanzable desde una raíz de ruta sin su anotación `@sin-superficie`", () => {
    // **Por qué esto FALLA y no solo informa.** Un informe es exactamente la señal que ya existía
    // el 2026-07-31 —cualquiera podía haber corrido un barrido— y nadie lo miró en cinco días. Y
    // es el nivel en el que EMPEZÓ el incidente: `RutearSateliteModal` quedó huérfano antes que su
    // acción, así que aquí el mensaje es «has borrado la vista que montaba esto», que es accionable,
    // en vez de «esta acción ya no se usa», que invita a borrarla. El coste está acotado: hoy son
    // cinco módulos, cada uno con una línea de motivo.
    const huerfanos = COMPONENTES.filter(
      (c) => !GRAFO.alcanzables.has(c) && anotacionDeModulo(c) === null,
    );
    expect(
      huerfanos,
      "estos componentes no los monta NINGÚN módulo alcanzable desde una raíz de ruta: están en " +
        "el árbol pero no en la aplicación. O se vuelven a montar, o se anota junto a su export " +
        "`/** @sin-superficie <motivo real> */`.",
    ).toEqual([]);
  });

  it("ninguna anotación `@sin-superficie` de componente sobrevive a su motivo", () => {
    const caducadas = COMPONENTES.filter(
      (c) => GRAFO.alcanzables.has(c) && anotacionDeModulo(c) !== null,
    );
    expect(
      caducadas,
      "estos componentes llevan `@sin-superficie` pero SÍ los monta alguien: la excepción caducó",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R-C — la superficie no se corta DENTRO del módulo que la monta
// ---------------------------------------------------------------------------

/** Declaración de función (exportada o no) con su nombre, para el escaneo intra-módulo. */
const DECLARACION_FUNCION = /(?:^|\n)[ \t]*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;

describe("R-C — ningún handler se queda sin quien lo llame dentro de su propio módulo", () => {
  it("el detector de funciones sin referencia ve la huérfana y no marca la que sí se usa", () => {
    const modulo = sinComentarios(
      [
        "export function Componente() {",
        "  function abrirVivo() { setModal('vivo'); }",
        "  function abrirMuerto() { setModal('muerto'); }",
        "  return <Boton onRun={abrirVivo} />;",
        "}",
      ].join("\n"),
    );
    expect(funcionesSinReferencia(modulo)).toEqual(["abrirMuerto"]);
  });

  it("ninguna función declarada bajo `app/` o `components/` se queda sin una sola referencia", () => {
    // **Ésta es la capa que caza la repetición del incidente SIN borrar ningún archivo.** El
    // 2026-07-31 desapareció la vista entera; la variante barata del mismo fallo es quitar la
    // entrada de la acción del menú por lote y dejar el modal importado y renderizado: el grafo de
    // módulos sigue intacto, R-A y R-B siguen verdes, y el botón desaparece igual. Lo que queda
    // colgando es el handler que abría el modal, declarado y sin una sola referencia.
    //
    // No lo cubre el compilador: este repo NO tiene `noUnusedLocals` en `tsconfig.json`, así que
    // `pnpm run typecheck` pasa con el handler muerto dentro.
    const colgando = [...GRAFO.modulos.keys()]
      .filter((m) => m.startsWith("app/") || m.startsWith("components/"))
      .flatMap((m) =>
        funcionesSinReferencia((GRAFO.modulos.get(m) as Modulo).codigo).map((f) => `${m}#${f}`),
      )
      .sort();

    expect(
      colgando,
      "estas funciones están declaradas y NADIE las referencia en su propio módulo. La forma " +
        "típica: un handler que abría un modal y cuya única entrada (la acción del menú por lote, " +
        "el `onClick` de un botón) se retiró. El modal sigue importado y renderizado, así que el " +
        "grafo de módulos no se entera; el usuario se queda sin el botón igual.",
    ).toEqual([]);
  });
});

/** Funciones DECLARADAS en el módulo, no exportadas, y sin ninguna otra mención en él. */
function funcionesSinReferencia(codigo: string): string[] {
  const salida: string[] = [];
  for (const m of codigo.matchAll(DECLARACION_FUNCION)) {
    if (m[1]) continue; // exportada: su superficie es de otro módulo, la miden R-A y R-B
    const nombre = m[2];
    const menciones = codigo.match(new RegExp(`\\b${nombre}\\b`, "g"))?.length ?? 0;
    if (menciones <= 1) salida.push(nombre);
  }
  return [...new Set(salida)].sort();
}
