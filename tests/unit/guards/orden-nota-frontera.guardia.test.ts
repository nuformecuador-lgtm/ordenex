// GUARDIA DEL ARNÉS — LA FRONTERA DEL HILO DE NOTAS (FEATURE 227): NO SE EDITA, NO SE REGISTRA.
//
// Cubre **R2** (el módulo del hilo no ofrece ninguna forma de EDITAR el cuerpo de una nota ya
// publicada: las únicas operaciones son crear, leer y eliminar) y **R29** (los módulos del hilo no
// registran el cuerpo ni datos personales, no se tragan errores en `catch` vacíos y sus textos de
// rechazo son fijos y sin PII).
//
// **Por qué R2 necesita una guardia y no le basta con «hoy no está».** «No hay edición» no es un
// estado del código: es una PROMESA sobre lo que el hilo significa. Una nota publicada es la
// evidencia de una conversación entre la tienda y el mensajero sobre una devolución; si el texto se
// puede reescribir después, deja de ser evidencia y pasa a ser un relato editable, y el borrado
// lógico —que conserva el hueco, el autor y la hora precisamente para que se vea que alguien
// retiró algo (R34)— se puede saltar por el camino corto: reescribo el cuerpo y no queda rastro.
// Un `editarNota` es exactamente lo que alguien añadiría de buena fe («el mensajero se equivocó de
// número, déjalo corregirlo»), y compilaría perfectamente. La decisión P3d dice que no: se borra y
// se vuelve a publicar, y eso se ve.
//
// **Y por eso se mira en DOS planos.** El primero, la superficie pública: los símbolos exportados y
// las operaciones declaradas en las interfaces, que es por donde una edición entraría con nombre.
// El segundo, el repositorio: una edición también puede entrar SIN nombre, escondida dentro de una
// operación que se llame otra cosa, así que se comprueba que ningún `update`/`updateMany`/`upsert`
// de `orden_nota` toca la columna `cuerpo`. El único `update` legítimo del hilo es el que pone
// `deletedAt`.
//
// **R29 y el cuerpo en los logs.** El cuerpo de una nota es texto libre escrito por un humano sobre
// una entrega concreta: nombres, teléfonos, direcciones y motivos de una devolución acaban ahí. Un
// `console.error("no se pudo publicar", input)` en un `catch` lo vuelca entero al log de la
// plataforma, donde lo lee quien nunca tuvo permiso para verlo — y no falla nada, así que nadie se
// entera. Por eso la prohibición es de `console` A SECAS en estos módulos, y no de «console con el
// cuerpo»: la variante inocente de hoy es la que mañana recibe el objeto entero.
//
// **Los `catch` vacíos van en el mismo requisito por el mismo motivo:** un rechazo que se traga
// deja al usuario mirando una pantalla que no cambió, sin saber si su nota se publicó. El
// componente del hilo tiene dos `catch` y ninguno está vacío: los dos pintan el fallo de transporte
// y conservan el borrador.
//
// **El censo se DESCUBRE del árbol** (por el nombre de archivo y por quién importa el hilo), no se
// escribe a mano: un módulo nuevo del hilo entra solo en el barrido en vez de quedarse fuera en
// silencio, que es como envejece un censo declarado. Lo que sí está escrito es el control de
// no-vacuidad: si el descubrimiento deja de encontrar los archivos que se sabe que existen, esto se
// pone rojo antes de afirmar ninguna ausencia.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");

// =============================================================================================
// Censo — descubierto del árbol, con control de no-vacuidad
// =============================================================================================

const RAICES = ["lib", "components", "app"];
const IGNORADOS = new Set(["node_modules", ".next", ".git", "dist", "coverage", "out"]);

function listar(dir: string, acumulado: string[] = []): string[] {
  if (!existsSync(dir)) return acumulado;
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORADOS.has(entrada.name)) continue;
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listar(completo, acumulado);
    else if (/\.tsx?$/.test(entrada.name)) acumulado.push(completo);
  }
  return acumulado;
}

interface Modulo {
  ruta: string;
  codigo: string;
}

const FUENTES: Modulo[] = RAICES.flatMap((raiz) => listar(path.join(RAIZ, raiz))).map((completo) => ({
  ruta: path.relative(RAIZ, completo).split(path.sep).join("/"),
  codigo: quitarComentarios(readFileSync(completo, "utf8")),
}));

/**
 * NÚCLEO: los archivos cuyo SUJETO es el hilo —tipos, contratos, repositorio, servicio, Server
 * Actions y la UI del hilo—, reconocidos por su nombre. Sobre ellos caen todas las reglas.
 */
const NUCLEO = FUENTES.filter(({ ruta }) =>
  /(^|\/)(orden-notas?|ventana-hilo-notas|I?OrdenNota[A-Za-z]*|HiloNotas[A-Za-z]*)\.tsx?$/.test(ruta),
);

/** Lo que el descubrimiento TIENE que haber encontrado (design §2 y §5). */
const NUCLEO_ESPERADO = [
  "app/(app)/novedades/_components/HiloNotasNovedadModal.tsx",
  // Feature 235 (T5.2, R35, 2026-08-19): el montaje del hilo del lado MENSAJERO, para las ordenes
  // en `ayuda_tienda`. Entra al NUCLEO por la puerta y con su requisito delante: sin el, el
  // mensajero tendria la ventana de escritura abierta (`ayuda_tienda` esta en su ventana, R34) y
  // NINGUN sitio donde ejercerla, porque su hilo vivia dentro de `GestionarOrdenPanel` y ese panel
  // ya no alcanza a estas ordenes. Es el mismo montaje que el modal de la tienda, sobre el MISMO
  // componente compartido: no se escribio ningun hilo nuevo.
  "app/(app)/mis-asignaciones/_components/HiloNotasAyudaModal.tsx",
  "components/shared/HiloNotasOrden.tsx",
  "lib/actions/orden-notas.ts",
  "lib/interfaces/repositories/IOrdenNotaRepository.ts",
  "lib/interfaces/services/IOrdenNotaService.ts",
  "lib/repositories/OrdenNotaRepository.ts",
  "lib/services/OrdenNotaService.ts",
  "lib/types/orden-nota.ts",
  "lib/types/ventana-hilo-notas.ts",
];

/** Las tres referencias por las que una pantalla MONTA el hilo. */
const IMPORTA_EL_HILO =
  /@\/lib\/actions\/orden-notas|@\/components\/shared\/HiloNotasOrden|@\/lib\/types\/orden-nota/;

/**
 * MONTAJES: pantallas que no son del hilo pero lo montan (hoy, el panel de gestión del
 * mensajero). Se descubren por el import, así que un tercer montaje entra solo.
 */
const MONTAJES = FUENTES.filter(
  ({ ruta, codigo }) =>
    IMPORTA_EL_HILO.test(codigo) && !NUCLEO.some((m) => m.ruta === ruta),
);

const VIGILADOS = [...NUCLEO, ...MONTAJES];

function moduloDe(ruta: string): Modulo {
  const m = VIGILADOS.find((x) => x.ruta === ruta);
  if (!m) throw new Error(`guardia orden-nota-frontera: \`${ruta}\` no está en el censo vigilado`);
  return m;
}

// =============================================================================================
// Utilidades de lectura estructural
// =============================================================================================

function cierreDe(fuente: string, apertura: number, abre: string, cierra: string): number {
  let nivel = 0;
  for (let i = apertura; i < fuente.length; i += 1) {
    if (fuente[i] === abre) nivel += 1;
    else if (fuente[i] === cierra) {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  throw new Error(`guardia orden-nota-frontera: \`${abre}\` sin cerrar en la posición ${apertura}`);
}

/** El cuerpo `{ … }` del `interface`/`class` llamado `nombre`. Revienta si no está. */
function cuerpoDeDeclaracion(fuente: string, nombre: string): string {
  const cabecera = new RegExp(`\\b(?:interface|class)\\s+${nombre}\\b`).exec(fuente);
  if (!cabecera) {
    throw new Error(
      `guardia orden-nota-frontera: no se encontró la declaración de \`${nombre}\`. La guardia ` +
        `no puede leer lo que vigila: se detiene en ROJO en vez de afirmar una ausencia sobre la nada.`,
    );
  }
  const abre = fuente.indexOf("{", cabecera.index);
  if (abre < 0) throw new Error(`guardia orden-nota-frontera: \`${nombre}\` no tiene cuerpo`);
  return fuente.slice(abre + 1, cierreDe(fuente, abre, "{", "}"));
}

/** Palabras que abren un paréntesis y no son una operación. */
const NO_ES_OPERACION = new Set([
  "constructor",
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "await",
  "typeof",
]);

/**
 * Los nombres de las OPERACIONES declaradas en el PRIMER NIVEL de un cuerpo de interfaz o clase.
 * El nivel se mide contando llaves, no indentación: así sobrevive a un reformateo y no confunde
 * una llamada anidada (`this.prisma.ordenNota.updateMany(`) con un método declarado. Se ignoran
 * `constructor` y los métodos `private`: no son superficie pública.
 */
function operacionesDe(cuerpo: string): string[] {
  const salida: string[] = [];
  for (const m of cuerpo.matchAll(
    /(?:^|[\n;{}])\s*(?:(private|public|protected)\s+)?(?:readonly\s+)?(?:async\s+)?(\w+)\s*\(/g,
  )) {
    // Hasta el NOMBRE, no hasta el inicio del match: el match se come el delimitador previo
    // (`}` al cerrar el método anterior) y sin él la cuenta de llaves saldría desplazada en uno.
    const previo = cuerpo.slice(0, m.index + m[0].lastIndexOf(m[2]));
    const nivel =
      (previo.match(/\{/g)?.length ?? 0) - (previo.match(/\}/g)?.length ?? 0);
    if (nivel !== 0) continue;
    if (m[1] === "private" || NO_ES_OPERACION.has(m[2])) continue;
    salida.push(m[2]);
  }
  return salida;
}

/** Los símbolos exportados con nombre de un módulo (`export function|const|class|interface|type`). */
function exportadosDe(codigo: string): string[] {
  return [
    ...codigo.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/g),
  ].map((m) => m[1]);
}

/** Los argumentos, en crudo, de cada llamada a `.<nombre>(` dentro de `codigo`. */
function llamadas(codigo: string, nombres: string[]): { metodo: string; argumentos: string }[] {
  const salida: { metodo: string; argumentos: string }[] = [];
  const patron = new RegExp(`\\.(${nombres.join("|")})\\s*\\(`, "g");
  for (const m of codigo.matchAll(patron)) {
    const abre = codigo.indexOf("(", m.index);
    salida.push({ metodo: m[1], argumentos: codigo.slice(abre + 1, cierreDe(codigo, abre, "(", ")")) });
  }
  return salida;
}

// =============================================================================================
// 0 — El censo existe y es el que se cree
// =============================================================================================

describe("0 — el censo de esta guardia no está vacío", () => {
  it("el árbol se recorrió entero y ningún archivo salió vacío", () => {
    expect(FUENTES.length).toBeGreaterThan(300);
    expect(FUENTES.filter((f) => f.codigo.length === 0)).toEqual([]);
  });

  it("el NÚCLEO descubierto es exactamente el inventario del hilo (design §2 y §5)", () => {
    // Censo cerrado en las dos direcciones: si falta uno, el descubrimiento dejó de ver un
    // módulo y todas las ausencias de abajo valdrían menos; si sobra uno, hay un módulo del hilo
    // que nadie decidió y que conviene mirar.
    expect([...NUCLEO.map((m) => m.ruta)].sort()).toEqual([...NUCLEO_ESPERADO].sort());
  });

  it("los MONTAJES descubiertos incluyen el panel del mensajero", () => {
    expect(MONTAJES.length).toBeGreaterThan(0);
    expect(MONTAJES.map((m) => m.ruta)).toContain(
      "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx",
    );
  });

  it("CONTROL POSITIVO: los módulos leídos dicen lo que tienen que decir", () => {
    // Sin esto, un archivo movido o truncado dejaría todas las comprobaciones verdes por vacío.
    expect(moduloDe("lib/services/OrdenNotaService.ts").codigo).toContain("class OrdenNotaService");
    expect(moduloDe("lib/repositories/OrdenNotaRepository.ts").codigo).toContain("ordenNota.create");
    expect(moduloDe("lib/actions/orden-notas.ts").codigo).toContain('"use server"');
    expect(moduloDe("components/shared/HiloNotasOrden.tsx").codigo).toContain("function HiloNotasOrden");
  });
});

// =============================================================================================
// R2 — no existe ninguna operación que reescriba el cuerpo
// =============================================================================================

/** Las TRES operaciones del hilo (decisión P3d): crear, leer y eliminar. Ni una más. */
const OPERACIONES_DEL_SERVICIO = ["listar", "publicar", "borrar"];
const OPERACIONES_DEL_REPOSITORIO = ["listarPorOrden", "crear", "marcarBorrada", "findOrdenParaHilo"];
const ACCIONES_DEL_BORDE = ["listarNotasOrden", "publicarNotaOrden", "borrarNotaOrden"];

/**
 * El vocabulario con el que llegaría una edición. No es una lista de palabras prohibidas por
 * gusto: es que una operación de reescritura del cuerpo se llamaría con una de ellas, y quien la
 * escriba con otro nombre tendrá que pasar además por el censo cerrado de arriba y por la
 * comprobación del repositorio.
 */
const VOCABULARIO_DE_EDICION =
  /(editar|edicion|actualizar|modificar|reescribir|reemplazar|corregir|renombrar|update|patch|upsert)/i;

describe("227 / R2 — una nota publicada no se reescribe", () => {
  it("el módulo del hilo no exporta ninguna operación que reescriba el cuerpo", () => {
    // 1. Las interfaces: el CONTRATO del hilo son tres operaciones y cuatro accesos, cerrados.
    const iService = moduloDe("lib/interfaces/services/IOrdenNotaService.ts").codigo;
    const iRepo = moduloDe("lib/interfaces/repositories/IOrdenNotaRepository.ts").codigo;
    expect(operacionesDe(cuerpoDeDeclaracion(iService, "IOrdenNotaService")).sort()).toEqual(
      [...OPERACIONES_DEL_SERVICIO].sort(),
    );
    expect(operacionesDe(cuerpoDeDeclaracion(iRepo, "IOrdenNotaRepository")).sort()).toEqual(
      [...OPERACIONES_DEL_REPOSITORIO].sort(),
    );

    // 2. Las implementaciones: ningún método público de más (los `private` no son superficie).
    const service = moduloDe("lib/services/OrdenNotaService.ts").codigo;
    const repo = moduloDe("lib/repositories/OrdenNotaRepository.ts").codigo;
    expect(operacionesDe(cuerpoDeDeclaracion(service, "OrdenNotaService")).sort()).toEqual(
      [...OPERACIONES_DEL_SERVICIO].sort(),
    );
    expect(operacionesDe(cuerpoDeDeclaracion(repo, "OrdenNotaRepository")).sort()).toEqual(
      [...OPERACIONES_DEL_REPOSITORIO].sort(),
    );

    // 3. Las Server Actions: el borde expone exactamente tres, y son las mismas tres.
    const acciones = exportadosDe(moduloDe("lib/actions/orden-notas.ts").codigo).filter((s) =>
      /^[a-z]/.test(s),
    );
    expect(acciones.sort()).toEqual([...ACCIONES_DEL_BORDE].sort());

    // 4. Y ningún símbolo exportado ni operación declarada del núcleo suena a edición.
    const sospechosos: string[] = [];
    for (const modulo of NUCLEO) {
      for (const simbolo of exportadosDe(modulo.codigo)) {
        if (VOCABULARIO_DE_EDICION.test(simbolo)) sospechosos.push(`${modulo.ruta} — ${simbolo}`);
      }
    }
    expect(
      sospechosos,
      "R2 / decisión P3d: una nota publicada no se reescribe, se borra (con su hueco marcado, " +
        "R34) y se publica otra. Un `editarNota` convierte la evidencia del hilo en un relato " +
        "editable y deja el borrado lógico sin sentido.",
    ).toEqual([]);
  });

  it("ninguna escritura del repositorio toca la columna `cuerpo` salvo el `create`", () => {
    const repo = moduloDe("lib/repositories/OrdenNotaRepository.ts").codigo;

    const escrituras = llamadas(repo, ["update", "updateMany", "upsert"]);
    // Control de no-vacuidad: hay exactamente UNA escritura de este tipo y es el borrado lógico.
    expect(escrituras.map((e) => e.metodo)).toEqual(["updateMany"]);

    const conCuerpo = escrituras.filter((e) => {
      const data = /data\s*:\s*\{/.exec(e.argumentos);
      if (!data) return false;
      const abre = e.argumentos.indexOf("{", data.index + data[0].length - 1);
      return /\bcuerpo\b/.test(e.argumentos.slice(abre, cierreDe(e.argumentos, abre, "{", "}") + 1));
    });
    expect(
      conCuerpo.map((e) => e.metodo),
      "una edición del cuerpo también entra SIN nombre: dentro de un método que se llame de otra " +
        "forma. El único `update` legítimo del hilo es el que pone `deletedAt`.",
    ).toEqual([]);

    // Y dicho en positivo: el único `updateMany` es el borrado lógico e idempotente.
    expect(escrituras[0].argumentos).toMatch(/data\s*:\s*\{\s*deletedAt\s*:\s*new Date\(\)\s*,?\s*\}/);
    expect(escrituras[0].argumentos).toContain("deletedAt: null");
  });

  it("CONTRAPRUEBA: el detector caza una edición, con nombre y sin él", () => {
    // Sin esto, los dos tests de arriba podrían estar pasando por no mirar nada.
    const conNombre = "export async function editarNotaOrden(input: unknown) {}";
    expect(exportadosDe(conNombre).some((s) => VOCABULARIO_DE_EDICION.test(s))).toBe(true);
    expect(exportadosDe("export async function publicarNotaOrden(i: unknown) {}").some((s) =>
      VOCABULARIO_DE_EDICION.test(s),
    )).toBe(false);

    const sinNombre = `class R {
      async reponer(id: string, cuerpo: string) {
        return this.prisma.ordenNota.updateMany({ where: { id }, data: { cuerpo } });
      }
    }`;
    const escritura = llamadas(sinNombre, ["update", "updateMany", "upsert"]);
    expect(escritura).toHaveLength(1);
    expect(escritura[0].argumentos).toMatch(/data\s*:\s*\{\s*cuerpo\s*\}/);

    // Y el método nuevo asomaría también por el censo cerrado de operaciones:
    expect(operacionesDe(cuerpoDeDeclaracion(sinNombre, "R"))).toEqual(["reponer"]);
  });
});

// =============================================================================================
// R29 — ni logs del cuerpo, ni errores tragados, ni textos con PII
// =============================================================================================

/** `console.<lo que sea>(`. La prohibición es de `console` a secas: ver la cabecera. */
const CONSOLA = /\bconsole\s*\.\s*\w+\s*\(/;

/** `catch {}` y `catch (e) {}`, con cualquier espacio o salto de línea dentro. */
const CATCH_VACIO = /\bcatch\s*(?:\([^)]*\)\s*)?\{\s*\}/;

/** El vocabulario que NO puede acabar interpolado en un texto de rechazo: el cuerpo de la nota y
 *  los datos del destinatario. `CUERPO_MAX` no casa (no hay frontera de palabra tras `CUERPO`). */
const PII = /\b(cuerpo|borrador|destinatario|telefono|direccion|autorNombre|email|cedula)\b/i;

/** Las claves cuyo valor es un texto que se le enseña a alguien tras un fallo. */
const CLAVE_DE_RECHAZO = /^(rechazo|fallo|error|aviso|sesion|forbidden|unauthenticated)/i;

/** Textos de rechazo del núcleo: valores de esas claves + argumentos de `throw new Error(`. */
function textosDeRechazo(): { ruta: string; texto: string }[] {
  const salida: { ruta: string; texto: string }[] = [];
  for (const { ruta, codigo } of NUCLEO) {
    for (const m of codigo.matchAll(/(\w+)\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
      if (CLAVE_DE_RECHAZO.test(m[1])) salida.push({ ruta, texto: m[2] });
    }
    for (const m of codigo.matchAll(/throw\s+new\s+\w*Error\s*\(([^;]*?)\)\s*;/g)) {
      salida.push({ ruta, texto: m[1] });
    }
  }
  return salida;
}

const TEXTOS_DE_RECHAZO = textosDeRechazo();

describe("227 / R29 — el hilo no deja rastro del cuerpo ni se traga los fallos", () => {
  it("los módulos del hilo no registran el cuerpo ni tragan errores", () => {
    const hallazgos: string[] = [];

    for (const { ruta, codigo } of VIGILADOS) {
      if (CONSOLA.test(codigo)) {
        hallazgos.push(
          `${ruta} — llama a \`console\`: el cuerpo de una nota es texto libre con nombres, ` +
            `teléfonos y direcciones; volcarlo al log lo pone delante de quien nunca tuvo permiso`,
        );
      }
      if (CATCH_VACIO.test(codigo)) {
        hallazgos.push(
          `${ruta} — tiene un \`catch\` vacío: un rechazo tragado deja al usuario mirando una ` +
            `pantalla que no cambió, sin saber si su nota se publicó`,
        );
      }
    }

    expect(hallazgos, "R29").toEqual([]);

    // Control de no-vacuidad del propio barrido: los `catch` del componente EXISTEN (dos) y no
    // están vacíos. Si el detector estuviera roto, esta cuenta se vendría abajo.
    const hilo = moduloDe("components/shared/HiloNotasOrden.tsx").codigo;
    expect([...hilo.matchAll(/\bcatch\b/g)]).toHaveLength(2);
    expect(hilo).toContain("setError(TEXTOS.falloRed)");
  });

  it("los textos de rechazo son FIJOS y sin PII", () => {
    // No-vacuidad: el hilo tiene textos de rechazo de verdad y se encontraron.
    expect(TEXTOS_DE_RECHAZO.length).toBeGreaterThan(5);

    const conPii = TEXTOS_DE_RECHAZO.flatMap(({ ruta, texto }) =>
      [...texto.matchAll(/\$\{([^}]*)\}/g)]
        .filter((m) => PII.test(m[1]))
        .map((m) => `${ruta} — interpola \`${m[1].trim()}\` en un texto de rechazo`),
    );
    expect(
      conPii,
      "R29: los textos de rechazo se le enseñan al usuario y viajan a los logs del navegador y " +
        "del servidor. Un motivo accionable no necesita repetir el cuerpo de la nota ni el nombre " +
        "del destinatario para ser útil.",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: el detector caza un log del cuerpo, un `catch` vacío y un texto con PII", () => {
    expect(CONSOLA.test("console.error('no se pudo publicar', input);")).toBe(true);
    expect(CONSOLA.test("console.log(cuerpo);")).toBe(true);
    expect(CONSOLA.test("const consolaDeMandos = 1;")).toBe(false);

    expect(CATCH_VACIO.test("try { f(); } catch {}")).toBe(true);
    expect(CATCH_VACIO.test("try { f(); } catch (e) {\n  }")).toBe(true);
    expect(CATCH_VACIO.test("try { f(); } catch { setError(TEXTOS.falloRed); }")).toBe(false);

    expect(PII.test("input.cuerpo")).toBe(true);
    expect(PII.test("orden.destinatario")).toBe(true);
    expect(PII.test("CUERPO_MAX")).toBe(false); // el tope SÍ puede interpolarse
    expect(PII.test("shape.code")).toBe(false);
  });
});
