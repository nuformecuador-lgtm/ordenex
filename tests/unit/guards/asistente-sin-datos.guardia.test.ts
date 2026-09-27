import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * ⭑ FICHA 436 · R3 — GUARDIA: EL ASISTENTE NO TIENE ACCESO A DATOS.
 *
 * ⚠️ QUÉ VIGILA Y POR QUÉ NINGÚN OTRO TEST LO VERÍA. «No consulta datos» es una promesa de
 * producto, y las promesas de producto se erosionan por comodidad: el día que alguien quiera que
 * el asistente conteste «¿cuántas órdenes llevo hoy?», lo natural es inyectarle un repositorio. Ese
 * cambio no rompe ningún test —todos seguirían verdes— y convierte una pieza que sólo lee archivos
 * del repositorio en una que lee la base de datos de la empresa y se la manda a un tercero.
 *
 * Esta guardia mide el ÁRBOL DE IMPORTS del módulo, no su comportamiento: es lo único que se pone
 * rojo ANTES de que exista la consulta.
 *
 * LA LISTA BLANCA TIENE DOS ENTRADAS, Y LAS DOS ESTÁN EN EL SPEC: el contador del tope (R16) y el
 * resolutor de sesión (R7). Las dos viven en el BORDE (`app/api/asistente/route.ts`), que es el
 * único archivo que compone; ni `lib/asistente/**` ni el servicio pueden nombrarlas.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** El módulo del asistente: lo que esta ficha creó y nada más. */
const ARCHIVOS_DEL_MODULO = [
  "lib/interfaces/external/IAsistenteProvider.ts",
  "lib/interfaces/services/IAsistenteService.ts",
  "lib/interfaces/repositories/IAsistenteUsoRepository.ts",
  "lib/clients/anthropic-asistente.ts",
  "lib/services/AsistenteService.ts",
  "lib/config/asistente.ts",
  ...listarTs("lib/asistente"),
  ...listarTs("app/api/asistente"),
];

/** El BORDE: el único archivo al que se le permite componer con la base y la sesión. */
const BORDE = "app/api/asistente/route.ts";

/** Lo que el borde SÍ puede importar, por su nombre y con su motivo. */
const LISTA_BLANCA_DEL_BORDE = [
  "@/lib/repositories/AsistenteUsoRepository", // R16: el contador del tope
  "@/lib/services/AsistenteService", // el servicio de esta misma ficha
  "@/lib/db/prisma-client", // el cliente que el contador necesita
  "@/lib/auth/resolve-actor", // R7: el rol sale de la sesión
];

function listarTs(relativo: string): string[] {
  const dir = path.join(RAIZ, relativo);
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) {
      encontrados.push(...listarTs(`${relativo}/${entrada}`));
    } else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) {
      encontrados.push(`${relativo}/${entrada}`);
    }
  }
  return encontrados;
}

/** Los `import ... from "X"` de un archivo, con la pista de si eran `import type`. */
export interface ImportLeido {
  desde: string;
  soloTipos: boolean;
}

function importsDe(codigo: string): ImportLeido[] {
  const encontrados: ImportLeido[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g;
  for (const m of codigo.matchAll(re)) {
    encontrados.push({ desde: m[3], soloTipos: m[1] !== undefined });
  }
  return encontrados;
}

/**
 * ⭑ EL ANALIZADOR. Se exporta como función para que el CANARIO de más abajo pueda darle un archivo
 * inventado con un import prohibido: una guardia que no se autocomprueba puede estar verde por
 * vacío, y en este repo ya pasó.
 */
export function accesosADatosDe(archivo: string, codigo: string): string[] {
  const ofensas: string[] = [];
  const permitidos = archivo === BORDE ? LISTA_BLANCA_DEL_BORDE : [];

  for (const { desde, soloTipos } of importsDe(codigo)) {
    if (permitidos.includes(desde)) continue;

    // Un `import type` de `@prisma/client` es un TIPO (`RolValue`): se borra al compilar y no trae
    // ningún cliente. Un import de valor sí: ése es el que abre una conexión.
    if (desde === "@prisma/client" && !soloTipos) {
      ofensas.push(`${archivo}: importa @prisma/client como VALOR`);
      continue;
    }
    if (desde.startsWith("@/lib/db/")) ofensas.push(`${archivo}: importa ${desde}`);
    if (/^@\/lib\/repositories\//.test(desde)) ofensas.push(`${archivo}: importa ${desde}`);
    // Los CONTRATOS (`lib/interfaces/**`) no son acceso a datos: son tipos. Las implementaciones sí.
    if (/^@\/lib\/services\//.test(desde)) ofensas.push(`${archivo}: importa ${desde}`);
    if (/^@\/lib\/actions\//.test(desde)) ofensas.push(`${archivo}: importa ${desde}`);
  }

  // Y el atajo sin import: nadie del módulo llama al cliente global.
  if (archivo !== BORDE && /getPrismaClient\s*\(/.test(codigo)) {
    ofensas.push(`${archivo}: llama a getPrismaClient()`);
  }
  return ofensas;
}

const codigoDe = (archivo: string) => readFileSync(path.join(RAIZ, archivo), "utf8");

/**
 * El archivo SIN sus comentarios.
 *
 * ⚠️ HACE FALTA, y lo descubrió esta misma guardia al nacer: el puerto EXPLICA en su cabecera que
 * «no hay `ejecutar()`» y que no lee `process.env`, así que una búsqueda sobre el texto crudo
 * encuentra justo las palabras que el archivo promete no usar y se pone roja por decir la verdad.
 *
 * ⚠️ **ES EL QUITADOR COMPARTIDO DE LA 209, Y NO UNO PROPIO** (revisión de la ficha, `m6`). El que
 * tenía aquí era el naíf de siempre —bloques primero, líneas después— y con él una barra-asterisco
 * dentro de un comentario de LÍNEA abre un bloque y se traga el código de abajo. Es exactamente la
 * mina que esta misma ficha plantó en su ruta. El compartido recorre el fuente sabiendo en qué
 * contexto está, así que un `/*` dentro de un `//` o de una cadena no abre nada — y una URL en una
 * cadena sobrevive intacta, que es lo que los casos de más abajo necesitan.
 */
function sinComentarios(codigo: string): string {
  return quitarComentarios(codigo);
}

describe("436/R3 — el módulo del asistente no accede a datos", () => {
  it("CONTROL DE NO-VACUIDAD: el barrido encuentra los archivos del módulo", () => {
    // Una guardia que no encuentra archivos queda verde por vacío, que es justo lo que viene a
    // cerrar. 12 archivos medidos el 2026-09-17; el número sólo puede crecer.
    expect(ARCHIVOS_DEL_MODULO.length).toBeGreaterThanOrEqual(10);
    expect(ARCHIVOS_DEL_MODULO).toContain(BORDE);
    expect(ARCHIVOS_DEL_MODULO).toContain("lib/asistente/contexto.ts");
    expect(ARCHIVOS_DEL_MODULO).toContain("lib/services/AsistenteService.ts");
    for (const archivo of ARCHIVOS_DEL_MODULO) {
      expect(codigoDe(archivo).length, archivo).toBeGreaterThan(0);
    }
  });

  it("⭑ ningún archivo del módulo importa Prisma, un repositorio o un servicio de dominio", () => {
    const ofensas = ARCHIVOS_DEL_MODULO.flatMap((a) => accesosADatosDe(a, codigoDe(a)));
    // El mensaje nombra al archivo culpable: si alguien le da datos al asistente, el rojo dice
    // CUÁL fue, no sólo que hay uno.
    expect(ofensas).toEqual([]);
  });

  it("⭑ CANARIO: con un import prohibido metido a mano, la guardia se pone roja", () => {
    // Sin esto, «la lista está vacía» podría significar «el analizador no mira nada».
    const inventado = `import { OrdenRepository } from "@/lib/repositories/OrdenRepository";\n`;
    expect(accesosADatosDe("lib/asistente/contexto.ts", inventado)).toEqual([
      "lib/asistente/contexto.ts: importa @/lib/repositories/OrdenRepository",
    ]);
    expect(
      accesosADatosDe("lib/services/AsistenteService.ts", `import { PrismaClient } from "@prisma/client";`),
    ).toHaveLength(1);
    expect(
      accesosADatosDe("lib/asistente/citas.ts", `const p = getPrismaClient();`),
    ).toHaveLength(1);
  });

  it("⭑ CANARIO al revés: lo que la lista blanca permite en el BORDE no se marca", () => {
    // El otro extremo: si el analizador marcara todo, el caso de arriba sería igual de verde y la
    // guardia no distinguiría nada.
    for (const permitido of LISTA_BLANCA_DEL_BORDE) {
      expect(accesosADatosDe(BORDE, `import { X } from "${permitido}";`), permitido).toEqual([]);
    }
    // Y esa misma línea EN OTRO ARCHIVO del módulo sí se marca: la excepción es del borde, no del
    // repositorio.
    expect(
      accesosADatosDe(
        "lib/services/AsistenteService.ts",
        `import { X } from "@/lib/repositories/AsistenteUsoRepository";`,
      ),
    ).toHaveLength(1);
  });
});

describe("436/D13 — el PUERTO es neutral, y por eso esto se puede probar sin credencial", () => {
  const PUERTO = "lib/interfaces/external/IAsistenteProvider.ts";

  it("⭑ no importa `next/*`, ni Prisma, ni lee `process.env`", () => {
    const codigo = sinComentarios(codigoDe(PUERTO));
    for (const { desde } of importsDe(codigo)) {
      expect(desde.startsWith("next/"), `${PUERTO} importa ${desde}`).toBe(false);
      expect(desde, PUERTO).not.toBe("@prisma/client");
    }
    expect(codigo).not.toContain("process.env");
  });

  it("⭑ y no importa NADA que no sean tipos propios (es el contrato, no una implementación)", () => {
    // Un puerto con dependencias deja de ser un molde y pasa a ser código: el doble de los tests
    // heredaría lo que arrastre, y «verificable sin red» se acabaría en silencio.
    expect(importsDe(codigoDe(PUERTO))).toEqual([]);
  });

  it("⭑ el puerto NO ofrece ninguna forma de ejecutar nada (D3)", () => {
    // No hay `herramientas`, `ejecutar`, `tools`… El límite «no ejecuta nada» se sostiene en que
    // la capacidad no existe, no en que el texto de sistema lo pida.
    const codigo = sinComentarios(codigoDe(PUERTO));
    expect(codigo).not.toMatch(/\bejecutar\s*\(/);
    expect(codigo).not.toMatch(/herramienta/i);
    expect(codigo).toContain("responder(consulta: ConsultaAsistente)");
  });
});

describe("436 — el adaptador es el único que sabe que hay una red detrás", () => {
  /**
   * ⭑ EL BARRIDO ES DEL MÓDULO ENTERO, NO DE LOS CUATRO PUROS (revisión de la ficha, `m4`).
   *
   * Antes recorría sólo `lib/asistente/**` —los módulos puros, que por construcción no iban a
   * tener red— y dejaba fuera justo los tres sitios donde una llamada sí cabe: el SERVICIO, el
   * BORDE y la configuración. El adaptador se excluye porque es el único que DEBE tener la URL, y
   * el caso de abajo mide lo suyo: que su `fetch` sea inyectable.
   */
  const SIN_RED = ARCHIVOS_DEL_MODULO.filter((a) => a !== "lib/clients/anthropic-asistente.ts");

  it("CONTROL DE NO-VACUIDAD: el barrido cubre el servicio, el borde y los módulos puros", () => {
    expect(SIN_RED).toContain("lib/services/AsistenteService.ts");
    expect(SIN_RED).toContain(BORDE);
    expect(SIN_RED).toContain("lib/asistente/citas.ts");
    expect(SIN_RED).not.toContain("lib/clients/anthropic-asistente.ts");
  });

  it("⭑ ningún archivo del módulo (salvo el adaptador) menciona `fetch` ni una URL", () => {
    // Si mañana alguien llama al proveedor desde el servicio o desde la ruta, la pieza deja de ser
    // verificable sin red — y un test podría salir a internet sin que nadie lo decidiera.
    for (const archivo of SIN_RED) {
      const codigo = sinComentarios(codigoDe(archivo));
      expect(codigo, archivo).not.toMatch(/\bfetch\s*\(/);
      expect(codigo, archivo).not.toMatch(/https?:\/\//);
    }
  });

  it("y el adaptador declara su `fetch` inyectable (sin eso, la suite tocaría la red)", () => {
    const codigo = codigoDe("lib/clients/anthropic-asistente.ts");
    expect(codigo).toContain("fetchImpl");
    expect(codigo).toContain("opts.fetchImpl ?? fetch");
  });
});

/**
 * ⭑⭑ LA PUERTA QUE FALTABA: **ningún test puede invocar el borde del asistente sin un doble**
 * (revisión de la ficha, `m4`).
 *
 * ⚠️ POR QUÉ NO BASTA CON LO DE ARRIBA, y está medido. `construirServicio()`
 * (`app/api/asistente/route.ts`) construye el cliente REAL, sin `fetchImpl`, con la credencial que
 * salga de `process.env` — y `tests/integration/db/_postgres-real.ts` llama a `process.loadEnvFile()`,
 * así que en el worker de cualquier test que lo importe la clave real está cargada. Hoy no pasa
 * porque los tres archivos que llaman al handler inyectan `service`, pero eso lo sostiene la
 * disciplina: un `POST(req)` o un `handleAsistente(req)` sin `deps` saldría a internet, gastaría
 * dinero y **ningún archivo se pondría rojo**.
 */
const DIR_TESTS = path.join(RAIZ, "tests");

/** Los archivos de `tests/**` que importan el borde del asistente. */
function testsQueLlamanAlBorde(): string[] {
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = path.join(dir, entrada);
      if (statSync(completo).isDirectory()) recorrer(completo);
      // ⚠️ ESTE MISMO ARCHIVO SE EXCLUYE, y no es una excepción cómoda: la guardia lleva escrito el
      // nombre del módulo que busca y los canarios de más abajo son llamadas SIN doble puestas a
      // mano. Sin esto se denunciaría a sí misma por hacer su trabajo. No llama a nadie: sus
      // «llamadas» son cadenas de texto.
      else if (/\.tsx?$/.test(entrada) && completo !== __filename) {
        const codigo = readFileSync(completo, "utf8");
        if (codigo.includes("@/app/api/asistente/route")) {
          encontrados.push(path.relative(RAIZ, completo).split(path.sep).join("/"));
        }
      }
    }
  };
  recorrer(DIR_TESTS);
  return encontrados;
}

/**
 * ⭑ EL ANALIZADOR: las invocaciones del handler que NO llevan un doble.
 *
 * Se extrae el texto de la llamada con un recorrido de paréntesis equilibrados —un regex no puede
 * con un objeto de dos niveles— y se exige que dentro aparezca `service:` o `fetchImpl:`. Se
 * exporta para que el canario pueda darle código inventado.
 */
export function invocacionesSinDoble(codigo: string): string[] {
  const ofensas: string[] = [];
  for (const m of codigo.matchAll(/\b(handleAsistente|POST)\s*\(/g)) {
    const abre = m.index! + m[0].length - 1;
    let profundidad = 0;
    let cierra = abre;
    for (let i = abre; i < codigo.length; i += 1) {
      if (codigo[i] === "(") profundidad += 1;
      else if (codigo[i] === ")") {
        profundidad -= 1;
        if (profundidad === 0) {
          cierra = i;
          break;
        }
      }
    }
    const llamada = codigo.slice(m.index!, cierra + 1);
    if (!/\bservice:|\bfetchImpl:/.test(llamada)) ofensas.push(llamada.split("\n")[0]);
  }
  return ofensas;
}

describe("436/D13 — ningún test invoca el borde del asistente sin doble (no se sale a internet)", () => {
  it("CONTROL DE NO-VACUIDAD: se encuentran los archivos que llaman al borde", () => {
    const archivos = testsQueLlamanAlBorde();
    // DOS medidos el 2026-09-17 —los dos de integración—, y son los únicos que IMPORTAN el módulo:
    // las tres guardias que nombran esa ruta la leen como texto, no la llaman. Si esto bajara a
    // cero, el caso de abajo quedaría verde por vacío, que es justo lo que viene a cerrar.
    expect(archivos.length).toBeGreaterThanOrEqual(2);
    expect(archivos).toContain("tests/integration/asistente-route.test.ts");
    expect(archivos).toContain("tests/integration/asistente-imagenes.test.ts");
  });

  it("⭑⭑ todas las invocaciones llevan `service:` (o `fetchImpl:`)", () => {
    const ofensas = testsQueLlamanAlBorde().flatMap((archivo) =>
      invocacionesSinDoble(readFileSync(path.join(RAIZ, archivo), "utf8")).map(
        (linea) => `${archivo}: ${linea}`,
      ),
    );
    expect(ofensas).toEqual([]);
  });

  it("⭑ CANARIO: una llamada sin doble se caza, y una con doble no", () => {
    expect(invocacionesSinDoble(`await handleAsistente(peticion(cuerpo), { getActor });`)).toEqual([
      "handleAsistente(peticion(cuerpo), { getActor })",
    ]);
    // El `POST` exportado NO acepta dependencias: llamarlo desde un test es salir a internet por
    // definición, así que se caza siempre.
    expect(invocacionesSinDoble(`const res = await POST(req);`)).toHaveLength(1);
    expect(
      invocacionesSinDoble(
        `await handleAsistente(peticion(c), {\n  getActor: async () => A,\n  service: servicioReal(p),\n});`,
      ),
    ).toEqual([]);
  });
});
