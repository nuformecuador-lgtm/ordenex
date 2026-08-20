import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { aCoberturaPublica, type ResultadoCobertura } from "@/lib/types/cotizador";

// Feature 248 — GUARDIA: LA SUPERFICIE PUBLICA `/cotizador` NO LLEGA AL DINERO (T7.1 + T7.2,
// cubre R10 y R6; de rebote tambien R7).
//
// EL PUNTO ARQUITECTONICO DE LA FEATURE ENTERA (design §1) es que la superficie publica responde
// SOLO COBERTURA —si el distrito se cubre y por que zona— y que un importe no se puede DERIVAR
// desde ahi NI POR DIFERENCIA, porque su grafo de dependencias NO LLEGA AL DINERO. La razon es
// dura y esta en el esquema: las tarifas cuelgan de `tarifas.tienda_id` y un anonimo no tiene
// tienda, asi que el costeo vive UNICAMENTE en el canal por API key.
//
// Ese invariante no se sostiene solo con buena voluntad: se sostiene con dos afirmaciones
// mecanicas, y las dos viven aqui.
//
//   · R10 — AISLAMIENTO. Se recorre el grafo de imports TRANSITIVO (no los imports directos:
//     el requisito dice «ni directa ni transitivamente») desde las cuatro raices publicas, y se
//     falla si en el cierre aparece `ingreso-ordenex`, `TarifaVigentePorTienda` o un acceso
//     `prisma.tarifa`. Un import de mas en cualquier eslabon —por ejemplo, un helper compartido
//     que un dia importe el resolver de tarifas— pone esta guardia roja aunque nadie haya tocado
//     `app/cotizador/`.
//
//   · R6 — CERO IMPORTES EN EL DTO. Las claves de `ResultadoCoberturaPublica` se comparan contra
//     un LITERAL FIRMADO escrito en este archivo. Ni un campo mas. Se refuerza con un barrido
//     lexico de vocabulario monetario y con la comprobacion en TIEMPO DE EJECUCION de lo que
//     `aCoberturaPublica` emite de verdad (el chequeo de propiedades excedentes de TypeScript
//     solo mira literales: un `...spread` que ensanchara la respuesta pasaria el typecheck).
//
// ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO: no mira `git diff` contra `origin/dev`. Una
// guardia que mide el diff de una rama CADUCA en cuanto la rama se mergea: a partir de ahi juzga
// el trabajo de cualquier rama posterior y se convierte en un rojo ajeno que nadie sabe de quien
// es. Es una leccion ya pagada en este repo y esta escrita en
// `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:22-26`. Aqui se mide la PROPIEDAD:
// ninguna asercion depende de la rama en la que se ejecute.
//
// LAS DOS CONTRAPRUEBAS son obligatorias (T7.1/T7.2) y son la razon de que el recorrido acepte un
// LECTOR inyectable: una guardia estatica que nunca se ha visto roja no ha demostrado que sepa
// ponerse roja. La inyeccion es EN MEMORIA —no se escribe una sola linea en el arbol— y una de
// ellas es transitiva a proposito: se ensucia una HOJA del cierre con un import cuyo nombre no
// contiene ninguna palabra prohibida, y aun asi el detector lo caza a dos saltos de distancia.

const RAIZ = path.resolve(__dirname, "../../..");

/* -------------------------------------------------------------------------- */
/* Recorrido del grafo de imports                                              */
/* -------------------------------------------------------------------------- */

/** Lee un archivo del repo por su ruta relativa, ya sin comentarios. Inyectable (contrapruebas). */
type Lector = (rutaRelativa: string) => string;

const LECTOR_REAL: Lector = (rutaRelativa) => codigoSinComentarios(rutaRelativa);

const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx"] as const;

const rel = (absoluta: string): string => path.relative(RAIZ, absoluta).split(path.sep).join("/");

/**
 * Resuelve un especificador de import a una ruta del repo, con las mismas reglas que
 * `tsconfig`/`vitest`: alias `@/…` contra la raiz, rutas relativas contra el archivo que
 * importa, extensiones implicitas y `index.*` de un directorio.
 *
 * Devuelve `null` para los paquetes de `node_modules` (`react`, `next/link`, `@prisma/client`,
 * `zod`): estan fuera del arbol y fuera del alcance del requisito.
 */
function resolverImport(especificador: string, desde: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(RAIZ, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(path.join(RAIZ, desde)), especificador);
  else return null;

  for (const extension of EXTENSIONES) if (existsSync(base + extension)) return rel(base + extension);
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const extension of EXTENSIONES) {
      const indice = path.join(base, "index" + extension);
      if (existsSync(indice)) return rel(indice);
    }
  }
  if (existsSync(base) && statSync(base).isFile()) return rel(base);
  return null;
}

/** Los especificadores que un fuente (ya sin comentarios) importa: estaticos, dinamicos y `require`. */
function especificadoresDe(codigo: string): string[] {
  return [
    ...[...codigo.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...codigo.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
}

interface Cierre {
  /** Todos los archivos del arbol alcanzables desde las raices, ordenados. */
  readonly archivos: string[];
  /** Imports locales (`@/…` o relativos) que el resolvedor NO supo resolver. Debe estar vacio. */
  readonly noResueltos: string[];
}

/** Cierre TRANSITIVO del grafo de imports a partir de unas raices. */
function cierreTransitivo(raices: readonly string[], leer: Lector): Cierre {
  const vistos = new Set<string>();
  const noResueltos = new Set<string>();
  const pila = [...raices];
  while (pila.length > 0) {
    const archivo = pila.pop() as string;
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    for (const especificador of especificadoresDe(leer(archivo))) {
      const destino = resolverImport(especificador, archivo);
      if (destino !== null) pila.push(destino);
      else if (especificador.startsWith("@/") || especificador.startsWith("."))
        noResueltos.add(`${archivo} -> ${especificador}`);
    }
  }
  return { archivos: [...vistos].sort(), noResueltos: [...noResueltos].sort() };
}

/** Todos los fuentes de un directorio del repo, recursivamente. */
function fuentesDe(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(path.join(RAIZ, directorio), { withFileTypes: true })) {
    const ruta = `${directorio}/${entrada.name}`;
    if (entrada.isDirectory()) salida.push(...fuentesDe(ruta));
    else if ((EXTENSIONES as readonly string[]).includes(path.extname(entrada.name))) salida.push(ruta);
  }
  return salida;
}

/**
 * LAS RAICES DE LA SUPERFICIE PUBLICA. `app/cotizador/**` se enumera del disco a proposito: una
 * pagina o un componente nuevo bajo esa ruta entra en el alcance de la guardia SOLO, sin que
 * nadie tenga que acordarse de anotarlo aqui.
 */
const RAICES_PUBLICAS: string[] = [
  "lib/actions/cobertura-publica.ts",
  "lib/services/CoberturaService.ts",
  "lib/repositories/CoberturaDistritoRepository.ts",
  ...fuentesDe("app/cotizador"),
];

/* -------------------------------------------------------------------------- */
/* El vocabulario del dinero, y quien lo dice                                  */
/* -------------------------------------------------------------------------- */

/**
 * Las tres puertas al dinero, tal como las nombra el design (§7):
 *
 * · `ingreso-ordenex`            — las formulas monetarias (`derivarIngresoOrden` y compania);
 * · `TarifaVigentePorTienda`     — el resolver de tarifas, y con el mismo patron su interfaz
 *                                  `ITarifaVigentePorTiendaRepository`;
 * · `prisma.tarifa`              — el acceso directo al modelo desde el cliente Prisma, en
 *                                  cualquier forma (`this.prisma.tarifa`, `db.tarifa`, …). El
 *                                  `\b` final deja fuera `tarifaVigente` y `tarifasTienda`, que
 *                                  no son el accesor del modelo.
 */
const PUERTAS_AL_DINERO: readonly { nombre: string; patron: RegExp }[] = [
  { nombre: "ingreso-ordenex", patron: /ingreso-ordenex/ },
  { nombre: "TarifaVigentePorTienda", patron: /TarifaVigentePorTienda/ },
  { nombre: "prisma.tarifa", patron: /\.\s*tarifa\b/ },
];

interface Violacion {
  readonly archivo: string;
  readonly puerta: string;
}

function violacionesEn(archivos: readonly string[], leer: Lector): Violacion[] {
  const salida: Violacion[] = [];
  for (const archivo of archivos) {
    const codigo = leer(archivo);
    for (const { nombre, patron } of PUERTAS_AL_DINERO)
      if (patron.test(codigo)) salida.push({ archivo, puerta: nombre });
  }
  return salida;
}

/** Un lector que sustituye EN MEMORIA el fuente de un archivo. Solo para las contrapruebas. */
function lectorConInyeccion(archivo: string, fuenteFalso: string): Lector {
  return (rutaRelativa) => (rutaRelativa === archivo ? fuenteFalso : LECTOR_REAL(rutaRelativa));
}

/* -------------------------------------------------------------------------- */
/* T7.1 — R10: el grafo del publico no alcanza el dinero                       */
/* -------------------------------------------------------------------------- */

describe("guardia 248: la superficie publica no alcanza el dinero (R10)", () => {
  it("el grafo de imports del público no alcanza ingreso-ordenex ni el resolver de tarifas", () => {
    const cierre = cierreTransitivo(RAICES_PUBLICAS, LECTOR_REAL);

    // ── Control de no-vacuidad ────────────────────────────────────────────────
    // Sin esto, un fallo del resolvedor de rutas dejaria el cierre en las puras raices (o vacio)
    // y la guardia afirmaria «no hay dinero» sobre un conjunto que no ha mirado nada.
    expect(cierre.noResueltos).toEqual([]);
    expect(RAICES_PUBLICAS.length).toBeGreaterThanOrEqual(5);
    for (const raiz of RAICES_PUBLICAS) expect(cierre.archivos).toContain(raiz);
    expect(cierre.archivos.length).toBeGreaterThan(3);
    // El cierre TRANSITIVO tiene que ser estrictamente mayor que las raices: si fuera igual,
    // se estarian midiendo imports directos y el requisito habla de transitivos.
    expect(cierre.archivos.length).toBeGreaterThan(RAICES_PUBLICAS.length);

    // ── La propiedad ─────────────────────────────────────────────────────────
    expect(violacionesEn(cierre.archivos, LECTOR_REAL)).toEqual([]);
  });

  it("contraprueba: la guardia se pone roja si se inyecta un import de tarifa en memoria", () => {
    // (a) DIRECTA — el dinero entra por una de las raices.
    const conIngreso = lectorConInyeccion(
      "lib/services/CoberturaService.ts",
      'import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";\nexport class CoberturaService {}\n',
    );
    const cierreA = cierreTransitivo(RAICES_PUBLICAS, conIngreso);
    expect(cierreA.archivos).toContain("lib/utils/ingreso-ordenex.ts");
    expect(violacionesEn(cierreA.archivos, conIngreso)).toContainEqual({
      archivo: "lib/services/CoberturaService.ts",
      puerta: "ingreso-ordenex",
    });

    // (b) EL ACCESO CRUDO — un `prisma.tarifa` en el repositorio del catalogo, sin importar nada.
    const conPrismaTarifa = lectorConInyeccion(
      "lib/repositories/CoberturaDistritoRepository.ts",
      "export class CoberturaDistritoRepository {\n  async x() { return this.prisma.tarifa.findFirst(); }\n}\n",
    );
    expect(
      violacionesEn(cierreTransitivo(RAICES_PUBLICAS, conPrismaTarifa).archivos, conPrismaTarifa),
    ).toContainEqual({ archivo: "lib/repositories/CoberturaDistritoRepository.ts", puerta: "prisma.tarifa" });

    // (c) TRANSITIVA, que es la que de verdad justifica recorrer el grafo. Se ensucia una HOJA
    // del cierre —`lib/utils/normalize.ts`, que NO es raiz— con un import cuyo especificador no
    // contiene ninguna palabra prohibida. El archivo inyectado queda LIMPIO para el detector, y
    // aun asi la guardia cae: el dinero esta a dos saltos, dentro de `CotizadorService`.
    const HOJA = "lib/utils/normalize.ts";
    expect(cierreTransitivo(RAICES_PUBLICAS, LECTOR_REAL).archivos).toContain(HOJA);
    expect(RAICES_PUBLICAS).not.toContain(HOJA);

    const fuenteHoja = `import { CotizadorService } from "@/lib/services/CotizadorService";\n${LECTOR_REAL(HOJA)}\nexport const _ = CotizadorService;\n`;
    const conSalto = lectorConInyeccion(HOJA, fuenteHoja);
    const cierreC = cierreTransitivo(RAICES_PUBLICAS, conSalto);
    const violacionesC = violacionesEn(cierreC.archivos, conSalto);

    expect(cierreC.archivos).toContain("lib/services/CotizadorService.ts");
    expect(violacionesC.map((v) => v.archivo)).toContain("lib/services/CotizadorService.ts");
    // El eslabon inyectado NO es el que denuncia: el hallazgo viene del salto, no del texto.
    expect(violacionesC.map((v) => v.archivo)).not.toContain(HOJA);
  });
});

/* -------------------------------------------------------------------------- */
/* T7.2 — R6/R7: las claves del DTO publico, contra literal firmado            */
/* -------------------------------------------------------------------------- */

const RUTA_TIPOS = "lib/types/cotizador.ts";

/**
 * EL LITERAL FIRMADO (design §4.1). Las cuatro variantes del DTO publico y sus claves, escritas
 * AQUI. Mientras nadie toque este objeto, la guardia caza cualquier campo nuevo en el DTO —y
 * cualquier campo que desaparezca—, hoy y dentro de veinte features.
 */
const DTO_PUBLICO_FIRMADO: Record<string, string[]> = {
  cubierto: ["estado", "zonaNombre"], // R2 — el NOMBRE de la zona, nada mas
  sin_cobertura: ["estado"], // R3
  no_determinado: ["estado"], // R4 — sin `cuantas`
  validation_error: ["estado", "campos"], // R5
};

/**
 * VOCABULARIO PROHIBIDO EN EL DTO PUBLICO. Los primeros nueve son R6 (ningun importe ni campo
 * del que se derive uno); los tres ultimos son R7 (ni el flag `es_central` ni ids de zona,
 * tarifa o tienda).
 */
const VOCABULARIO_PROHIBIDO = [
  "flete",
  "iva",
  "comision",
  "monto",
  "costo",
  "total",
  "neto",
  "tarifa",
  "precio",
  "esCentral",
  "zonaId",
  "tiendaId",
] as const;

/** El cuerpo de un `export type NOMBRE = …;`, cortando en el `;` de nivel CERO. */
function bloqueDeTipo(fuente: string, nombre: string): string {
  const inicio = fuente.search(new RegExp(`export\\s+type\\s+${nombre}\\s*=`));
  if (inicio < 0) throw new Error(`el fuente ya no declara el tipo ${nombre}`);
  const cuerpo = fuente.slice(fuente.indexOf("=", inicio) + 1);
  let profundidad = 0;
  for (let i = 0; i < cuerpo.length; i += 1) {
    const c = cuerpo[i];
    if (c === "{" || c === "<" || c === "(" || c === "[") profundidad += 1;
    else if (c === "}" || c === ">" || c === ")" || c === "]") profundidad -= 1;
    else if (c === ";" && profundidad === 0) return cuerpo.slice(0, i);
  }
  throw new Error(`la declaracion de ${nombre} no termina en ';'`);
}

/** Corta por los `|` de nivel cero: las variantes de una union. */
function variantesDe(bloque: string): string[] {
  const salida: string[] = [];
  let profundidad = 0;
  let actual = "";
  for (const c of bloque) {
    if (c === "{" || c === "<" || c === "(" || c === "[") profundidad += 1;
    if (c === "}" || c === ">" || c === ")" || c === "]") profundidad -= 1;
    if (c === "|" && profundidad === 0) {
      salida.push(actual);
      actual = "";
    } else actual += c;
  }
  salida.push(actual);
  return salida.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Las claves declaradas por una variante `{ readonly a: X; readonly b: Y }`, en orden. */
function clavesDe(variante: string): string[] {
  const cuerpo = variante.trim().replace(/^\{/, "").replace(/\}$/, "");
  const salida: string[] = [];
  let profundidad = 0;
  let actual = "";
  const empujar = (): void => {
    const m = actual.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/);
    if (m !== null) salida.push(m[1]);
    actual = "";
  };
  for (const c of cuerpo) {
    if (c === "{" || c === "<" || c === "(" || c === "[") profundidad += 1;
    if (c === "}" || c === ">" || c === ")" || c === "]") profundidad -= 1;
    if ((c === ";" || c === ",") && profundidad === 0) empujar();
    else actual += c;
  }
  empujar();
  return salida;
}

/** El DTO declarado en un fuente, indexado por el literal de su discriminante `estado`. */
function dtoDeclaradoEn(fuente: string): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const variante of variantesDe(bloqueDeTipo(fuente, "ResultadoCoberturaPublica"))) {
    const estado = variante.match(/estado\s*:\s*"([^"]+)"/);
    if (estado === null) throw new Error(`una variante del DTO publico no discrimina por estado: ${variante}`);
    salida[estado[1]] = clavesDe(variante);
  }
  return salida;
}

describe("guardia 248: el DTO publico no lleva ni un importe (R6/R7)", () => {
  it("las claves del DTO público son EXACTAMENTE las firmadas", () => {
    const fuente = LECTOR_REAL(RUTA_TIPOS);
    const declarado = dtoDeclaradoEn(fuente);

    // ── Control de no-vacuidad ───────────────────────────────────────────────
    // Un parser que no encontrara nada devolveria `{}` y `toEqual` fallaria, si; pero un parser
    // que encontrara las variantes SIN claves diria «cero campos» y eso se lee como «no hay
    // importes». Se exige que haya leido claves de verdad.
    expect(Object.keys(declarado)).toHaveLength(4);
    expect(Object.values(declarado).flat().length).toBeGreaterThanOrEqual(6);

    // ── La propiedad: contra el literal firmado, ni un campo mas ─────────────
    expect(declarado).toEqual(DTO_PUBLICO_FIRMADO);

    // ── Refuerzo lexico: ninguna clave (ni el texto del tipo) nombra dinero ──
    const claves = Object.values(declarado).flat();
    const bloque = bloqueDeTipo(fuente, "ResultadoCoberturaPublica");
    for (const palabra of VOCABULARIO_PROHIBIDO) {
      expect(claves.filter((c) => c.toLowerCase().includes(palabra.toLowerCase()))).toEqual([]);
      expect(bloque.toLowerCase()).not.toContain(palabra.toLowerCase());
    }

    // ── Y lo que la proyeccion EMITE de verdad, no solo lo que el tipo promete ─
    // El chequeo de propiedades excedentes de TypeScript solo mira literales: un `...resultado`
    // ensancharia la respuesta en ejecucion sin poner rojo el typecheck.
    const dominio: ResultadoCobertura[] = [
      { estado: "cubierto", distritoId: "d1", zonaId: "z1", zonaNombre: "GAM", esCentral: true },
      { estado: "sin_cobertura" },
      { estado: "no_determinado", cuantas: 2 },
      { estado: "validation_error", campos: { distrito: "requerido" } },
    ];
    for (const entrada of dominio) {
      const publico = aCoberturaPublica(entrada);
      expect(Object.keys(publico).sort()).toEqual([...DTO_PUBLICO_FIRMADO[entrada.estado]].sort());
    }
  });

  it("contraprueba: la comparación caza un campo monetario añadido al DTO", () => {
    const fuenteSucio = `
export type ResultadoCoberturaPublica =
  | { readonly estado: "cubierto"; readonly zonaNombre: string; readonly montoCobrar: string }
  | { readonly estado: "sin_cobertura" }
  | { readonly estado: "no_determinado" }
  | { readonly estado: "validation_error"; readonly campos: Record<string, string> };
`;
    const declarado = dtoDeclaradoEn(fuenteSucio);

    // El parser SI lo ve (si no lo viera, la contraprueba no probaria nada)...
    expect(declarado.cubierto).toEqual(["estado", "zonaNombre", "montoCobrar"]);
    // ...y las dos afirmaciones de la guardia caen.
    expect(declarado).not.toEqual(DTO_PUBLICO_FIRMADO);
    expect(Object.values(declarado).flat().some((c) => c.toLowerCase().includes("monto"))).toBe(true);

    // Y tambien el caso contrario, el que un `toEqual` ingenuo dejaria pasar si solo mirase
    // «que no sobren»: una clave firmada que DESAPARECE.
    const fuenteMenguado = fuenteSucio.replace('; readonly montoCobrar: string', "").replace("; readonly zonaNombre: string", "");
    expect(dtoDeclaradoEn(fuenteMenguado)).not.toEqual(DTO_PUBLICO_FIRMADO);
  });
});
