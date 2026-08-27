import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { lineasSinComentarios } from "../../fixtures/sin-comentarios";

// FEATURE 287 (T13, R22/R23) — **LA SUPERFICIE DEL SECRETO: DONDE PUEDE ESTAR Y DONDE NO.**
//
// Dos reglas, cada una cerrando un agujero distinto:
//
//   (a) **Ningun `console.*` en el camino del restablecimiento.** Mas estricta que la guardia de
//       credenciales que ya existe (`credenciales-sin-consola-cruda.guardia.test.ts`), que solo
//       mira `console.log` y solo en `lib/clients`/`lib/auth`. Aqui se prohibe `console` ENTERO
//       —`error`, `warn`, `info`, `debug`, `table`, `dir`…— porque el dato que pasa por estos
//       archivos es una contrasena en claro y un `console.error(plain)` la vuelca al log de
//       Vercel igual de bien que un `console.log`. El incidente del 2026-08-14 (un
//       `console.log(token)` olvidado que imprimio un access_token OAuth2 en produccion durante
//       cinco dias) no rompio ningun test y eslint tampoco lo cazo.
//
//   (b) **El nombre del campo con el claro solo vive en los DOS resultados que lo llevan.** El
//       alta (feature 25/R33) y el restablecimiento (287/R21). En ningun DTO de lectura
//       (`UsuarioPublico`, `UsuarioListItem`) ni en las columnas de la descarga (R22). Anadir
//       `generatedPassword` a `UsuarioPublico` es una linea, no rompe nada, y filtraria el claro
//       en cada listado: eso es exactamente lo que este bloque impide.
//
// **El censo de (a) se DESCUBRE en parte.** Los archivos de backend van en una lista cerrada
// (existen hoy y se comprueba que existen); los del frontend entran SOLOS: cualquier archivo bajo
// `app/(app)/configuracion/_components/` que mencione `restablecerContrasena` esta en el camino y
// queda censado. Asi el panel y el modulo que monta la ficha entran sin que nadie tenga que
// acordarse de venir a escribirlos aqui.
//
// Cada detector se AUTOCOMPRUEBA contra un texto que SI infringe y otro que no, y hay control de
// no-vacuidad: una guardia estatica rota no falla, calla.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

function reventar(que: string): never {
  throw new Error(
    `guardia contrasena-generada-superficie: ${que}. La guardia NO pudo leer lo que vigila; se ` +
      `detiene en ROJO en vez de dar por buena una lectura vacia.`,
  );
}

/* ========================================================================== */
/* El censo del camino                                                        */
/* ========================================================================== */

/** Los archivos de backend del camino. Cerrados: si uno se renombra, la guardia revienta. */
const CAMINO_BACKEND = [
  "lib/services/UsuarioService.ts",
  "lib/actions/usuarios.ts",
  "lib/repositories/SessionRepository.ts",
  "lib/repositories/UserRepository.ts",
  "lib/utils/password-generator.ts",
  "lib/utils/password.ts",
] as const;

/** La carpeta donde vive la superficie de usuario del modulo. */
const CARPETA_UI = "app/(app)/configuracion/_components";

/** Marca que identifica un archivo de UI como parte del camino del restablecimiento. */
const MARCA_DEL_CAMINO = /restablecerContrasena/;

interface Modulo {
  ruta: string;
  /** Sin comentarios pero con el MISMO numero de lineas: el indice `i` es la linea `i + 1`. */
  lineas: string[];
}

function cargar(rel: string): Modulo {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) reventar(`falta el archivo censado \`${rel}\``);
  return { ruta: rel, lineas: lineasSinComentarios(fs.readFileSync(abs, "utf8")) };
}

/** Los archivos de UI que mencionan la accion: entran al censo SOLOS. */
function caminoEnLaUi(): Modulo[] {
  const dir = path.join(RAIZ, CARPETA_UI);
  if (!fs.existsSync(dir)) reventar(`la carpeta de UI \`${CARPETA_UI}\` no existe`);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => `${CARPETA_UI}/${e.name}`)
    .filter((rel) => MARCA_DEL_CAMINO.test(fs.readFileSync(path.join(RAIZ, rel), "utf8")))
    .map(cargar);
}

const CENSO_BACKEND: Modulo[] = CAMINO_BACKEND.map(cargar);
const CENSO_UI: Modulo[] = caminoEnLaUi();
const CENSO: Modulo[] = [...CENSO_BACKEND, ...CENSO_UI];

/* ========================================================================== */
/* (a) El detector de console                                                 */
/* ========================================================================== */

/** `console.<lo-que-sea>(`, con cualquier espaciado. A diferencia de la guardia de credenciales,
 *  aqui NO se limita a `log`: por estos archivos pasa una contrasena en claro. */
const CONSOLE_CUALQUIERA = /\bconsole\s*\.\s*[a-zA-Z]+\s*\(/;

interface Hallazgo {
  ruta: string;
  linea: number; // 1-based
}

export function consolasDe(modulos: Modulo[]): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const { ruta, lineas } of modulos) {
    lineas.forEach((linea, i) => {
      if (CONSOLE_CUALQUIERA.test(linea)) salida.push({ ruta, linea: i + 1 });
    });
  }
  return salida;
}

/* ========================================================================== */
/* (b) El detector de la superficie del campo                                 */
/* ========================================================================== */

/** El nombre del campo que lleva el claro. */
const CAMPO = "generatedPassword";

/**
 * Los tipos de LECTURA que NO pueden llevarlo nunca. Se comprueba sobre el CUERPO de cada
 * declaracion, no sobre el archivo entero: `lib/types/usuario.ts` menciona el campo de forma
 * legitima (en el resultado del alta) y una busqueda por archivo no distinguiria.
 */
const TIPOS_DE_LECTURA: readonly { readonly ruta: string; readonly nombre: string }[] = [
  { ruta: "lib/interfaces/repositories/IUserRepository.ts", nombre: "UsuarioPublico" },
  { ruta: "lib/interfaces/repositories/IUserRepository.ts", nombre: "UsuarioListItem" },
  { ruta: "lib/interfaces/repositories/IUserRepository.ts", nombre: "UpdateUsuarioData" },
  { ruta: "lib/interfaces/repositories/IUserRepository.ts", nombre: "CreateUsuarioInput" },
];

/**
 * Extrae el cuerpo de una declaracion `interface X {…}` o `type X = …` de una fuente ya sin
 * comentarios. Devuelve `null` si no la encuentra — y quien llame REVIENTA con eso, en vez de
 * dar por buena una busqueda que no encontro nada.
 */
export function cuerpoDeDeclaracion(fuente: string, nombre: string): string | null {
  const re = new RegExp(`^export (?:interface|type) ${nombre}\\b`, "m");
  const m = re.exec(fuente);
  if (!m) return null;
  const desde = fuente.slice(m.index);
  // Hasta el siguiente `export` de nivel cero, que es donde termina de verdad una declaracion
  // multilinea (partir por `}` corta dentro de un objeto anidado).
  const siguiente = /\n(?=export\b)/.exec(desde);
  return siguiente ? desde.slice(0, siguiente.index) : desde;
}

/** Los archivos donde el campo SI puede aparecer, con el porque. */
const PORTADORES_LEGITIMOS: Record<string, string> = {
  "lib/interfaces/services/IUsuarioService.ts":
    "declara los dos resultados que lo llevan: el alta (25/R33) y el restablecimiento (287/R21)",
  "lib/types/usuario.ts": "el mismo par de resultados, en el borde",
  "lib/services/UsuarioService.ts": "es quien lo produce y lo devuelve una sola vez",
  "lib/actions/usuarios.ts": "lo propaga tal cual del servicio al borde",
};

/* ========================================================================== */
/* 0 — Control de no-vacuidad                                                  */
/* ========================================================================== */

describe("0 — la guardia recorrio de verdad lo que dice recorrer", () => {
  it("el censo del camino no esta vacio y ningun archivo se leyo en blanco", () => {
    expect(CENSO_BACKEND.length).toBe(CAMINO_BACKEND.length);
    expect(CENSO_BACKEND.length).toBeGreaterThanOrEqual(6);
    for (const m of CENSO) {
      expect(m.lineas.join("\n").trim().length, `${m.ruta} quedo vacio`).toBeGreaterThan(0);
    }
  });

  it("el descubrimiento de la UI FUNCIONA: la carpeta existe y tiene archivos que mirar", () => {
    // Anti-vacuidad del descubrimiento: si el filtro dejara de encajar (rename de la accion,
    // carpeta movida), `CENSO_UI` seria [] y (a) pasaria por no haber mirado la UI. Esto no
    // exige que HAYA archivos —el frontend de esta ficha puede no haber aterrizado aun— pero si
    // que la carpeta se haya podido recorrer y que la marca encuentre algo cuando lo hay.
    const dir = path.join(RAIZ, CARPETA_UI);
    const todos = fs.readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
    expect(todos.length, "la carpeta de la UI del modulo vino vacia").toBeGreaterThan(3);
    expect(MARCA_DEL_CAMINO.test("await restablecerContrasenaUsuario(id)")).toBe(true);
    expect(MARCA_DEL_CAMINO.test("await actualizarUsuario(id, data)")).toBe(false);
  });
});

/* ========================================================================== */
/* (a) R23 — ningun console en el camino                                       */
/* ========================================================================== */

describe("(a) R23 — ningun `console.*` en el camino del restablecimiento", () => {
  it("ni en el servicio, ni en la accion, ni en los repositorios, ni en la UI del camino", () => {
    const hallazgos = consolasDe(CENSO).map((h) => `${h.ruta}:${h.linea}`);

    expect(
      hallazgos,
      "por estos archivos pasa una CONTRASENA EN CLARO. Un `console.error(plain)` la vuelca al " +
        "log de runtime de Vercel, legible por cualquiera con acceso al proyecto, exactamente " +
        "igual que el `console.log(token)` que imprimio un access_token OAuth2 en produccion el " +
        "2026-08-14. R23 no admite excepciones aqui: si necesitas depurar, hazlo sin el valor.",
    ).toEqual([]);
  });
});

/* ========================================================================== */
/* (b) R22 — el campo no se cuela en ningun DTO de lectura                     */
/* ========================================================================== */

describe("(b) R22 — `generatedPassword` no aparece en ningun tipo de lectura", () => {
  it.each(TIPOS_DE_LECTURA)("`$nombre` de `$ruta` no lo declara", ({ ruta, nombre }) => {
    const fuente = lineasSinComentarios(fs.readFileSync(path.join(RAIZ, ruta), "utf8")).join("\n");
    const cuerpo = cuerpoDeDeclaracion(fuente, nombre);
    if (cuerpo === null) {
      reventar(`no se encontro la declaracion \`${nombre}\` en \`${ruta}\` (¿un rename?)`);
    }
    expect(
      cuerpo.includes(CAMPO),
      `anadir \`${CAMPO}\` a \`${nombre}\` filtraria la contrasena en claro en cada lectura ` +
        "(listado, detalle, descarga). Es una linea y no rompe nada: por eso esta guardia.",
    ).toBe(false);
  });

  it("las columnas de la DESCARGA del listado tampoco lo llevan (R22)", () => {
    const ruta = "app/(app)/configuracion/_components/usuarios-descarga-columnas.ts";
    const fuente = lineasSinComentarios(
      fs.readFileSync(path.join(RAIZ, ruta), "utf8"),
    ).join("\n");
    expect(fuente.includes(CAMPO)).toBe(false);
    // Anti-vacuidad: el archivo es el que creemos (si se renombrara, esto lo dice).
    expect(fuente).toContain("COLUMNAS_DESCARGA_USUARIOS");
  });

  it("y el conjunto de archivos que SI lo mencionan es exactamente el declarado", () => {
    // ⭑ La mitad que impide que el campo se propague por sitios nuevos sin que nadie lo note.
    const arboles = ["lib", "app", "components", "hooks", "providers"];
    const encontrados: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(abs);
        else if (/\.tsx?$/.test(e.name) && fs.readFileSync(abs, "utf8").includes(CAMPO)) {
          encontrados.push(path.relative(RAIZ, abs).split(path.sep).join("/"));
        }
      }
    };
    for (const a of arboles) recorrer(path.join(RAIZ, a));

    const inesperados = encontrados
      .filter((r) => PORTADORES_LEGITIMOS[r] === undefined)
      // La UI que lo PINTA es superficie legitima por definicion: son los archivos del camino
      // (el formulario del alta y lo que monte el panel del restablecimiento).
      .filter((r) => !r.startsWith(`${CARPETA_UI}/`));

    expect(
      inesperados,
      `\`${CAMPO}\` es el nombre del campo que lleva la contrasena EN CLARO. Solo puede vivir en ` +
        "los dos resultados que la llevan (alta y restablecimiento), en quien la produce y en la " +
        "superficie que la pinta una vez. Si aparece en un sitio nuevo, di aqui por que.",
    ).toEqual([]);

    // Anti-vacuidad: el barrido encontro los portadores legitimos de verdad.
    for (const legitimo of Object.keys(PORTADORES_LEGITIMOS)) {
      expect(encontrados, `el barrido no vio \`${legitimo}\`: el detector esta roto`).toContain(
        legitimo,
      );
    }
  });
});

/* ========================================================================== */
/* AUTOCOMPROBACION                                                            */
/* ========================================================================== */

describe("autocomprobacion: los detectores no estan rotos", () => {
  it("(a) `CONSOLE_CUALQUIERA` caza TODOS los metodos, no solo `log`", () => {
    for (const m of ["log", "error", "warn", "info", "debug", "trace", "table", "dir"]) {
      expect(CONSOLE_CUALQUIERA.test(`console.${m}('x')`), `no cazo console.${m}`).toBe(true);
    }
    expect(CONSOLE_CUALQUIERA.test("  console . error(  'x'  )")).toBe(true); // espaciado atipico
    expect(CONSOLE_CUALQUIERA.test("optlog('paso', { token })")).toBe(false);
    // El `\b` y las minusculas evitan confundir un identificador propio con el global.
    expect(CONSOLE_CUALQUIERA.test("miConsole.log('x')")).toBe(false);
    expect(CONSOLE_CUALQUIERA.test("const console = 1;")).toBe(false); // sin `(` no es llamada
  });

  it("(a) `consolasDe` localiza la linea exacta de un console inyectado en un archivo REAL", () => {
    const real = CENSO_BACKEND[0];
    const conInyeccion = [...real.lineas];
    conInyeccion.splice(4, 0, "console.error('la contrasena es', plain)");

    expect(consolasDe([real]), `${real.ruta} ya tenia un console: el control positivo no vale`).toEqual(
      [],
    );
    expect(consolasDe([{ ruta: real.ruta, lineas: conInyeccion }])).toEqual([
      { ruta: real.ruta, linea: 5 },
    ]);
  });

  it("(b) `cuerpoDeDeclaracion` corta en la declaracion correcta y no se come la siguiente", () => {
    const fuente = [
      "export interface Uno {",
      "  a: string;",
      "}",
      "",
      "export interface Dos {",
      "  generatedPassword: string;",
      "}",
      "",
    ].join("\n");

    expect(cuerpoDeDeclaracion(fuente, "Uno")).toContain("a: string;");
    expect(
      cuerpoDeDeclaracion(fuente, "Uno"),
      "si se comiera la siguiente declaracion, (b) daria falsos positivos",
    ).not.toContain("generatedPassword");
    expect(cuerpoDeDeclaracion(fuente, "Dos")).toContain("generatedPassword");
    expect(cuerpoDeDeclaracion(fuente, "NoExiste")).toBeNull();
  });

  it("(b) el detector CAZA el campo si alguien lo cuela en un tipo de lectura", () => {
    // ⭑ Sin esta contraprueba, (b) estaria verde por no encontrar nunca nada.
    const ruta = "lib/interfaces/repositories/IUserRepository.ts";
    const fuente = lineasSinComentarios(fs.readFileSync(path.join(RAIZ, ruta), "utf8")).join("\n");
    const mutado = fuente.replace(
      /^export interface UsuarioPublico \{$/m,
      "export interface UsuarioPublico {\n  generatedPassword?: string;",
    );
    expect(mutado, "la mutacion no encajo: el detector estaria midiendo el vacio").not.toBe(fuente);
    expect(cuerpoDeDeclaracion(mutado, "UsuarioPublico")!.includes(CAMPO)).toBe(true);
  });

  it("los portadores legitimos declaran su motivo, y no son una lista vacia", () => {
    expect(Object.keys(PORTADORES_LEGITIMOS).length).toBe(4);
    for (const motivo of Object.values(PORTADORES_LEGITIMOS)) {
      expect(motivo.length).toBeGreaterThan(25);
    }
  });
});
