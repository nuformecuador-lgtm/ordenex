import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

/**
 * FICHA 368 (T8) — GUARDIA: LOS DOS MODALES DE ASIGNACIÓN COMPARTEN EL VOCABULARIO DE
 * MOTIVO -> MENSAJE, NUNCA UNO PROPIO COPIADO.
 *
 * `mensajeDireccionPorMotivo` (R11) traduce el `motivo` de una orden bloqueada por el gate de
 * asignabilidad por coordenadas (feature 92) a un mensaje de usuario. R5 exige el MISMO criterio
 * y el MISMO vocabulario en la bodega central y en la satélite — y eso solo está garantizado si
 * los dos modales IMPORTAN la función de un único sitio. Si alguno definiera su propio mapa
 * motivo->mensaje (copiando los literales), los dos textos podrían divergir en silencio el día
 * que `MOTIVO_A_MENSAJE` cambie en `geocodificacion-motivo-messages.ts` y nadie actualice la
 * copia — exactamente el defecto que este guardia convierte en rojo.
 *
 * Lee el CÓDIGO REAL de los dos archivos (no una copia de su texto): un `grep` de este mismo
 * archivo citando los literales prohibidos pasaría por casualidad; leer el árbol no.
 */

const RAIZ = path.resolve(__dirname, "../../..");

const RUTA_BODEGA = "app/(app)/ordenes/_components/AsignarBodegaModal.tsx";
const RUTA_SATELITE = "app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx";
const MODULO_COMPARTIDO = "@/app/(app)/_components/geocodificacion-motivo-messages";

/**
 * La UNIÓN COMPLETA de `EstadoAsignabilidad`, escrita a mano (feature 92, R6 de la 368).
 *
 * FEATURE 400 (T16, R23): eran los CINCO motivos bloqueantes; ahora son los SIETE estados,
 * porque los dos que DEJAN PASAR la asignación también tienen que estar prohibidos en los
 * modales. El estado nuevo, `asignable_sin_ubicacion`, es el que más tienta a tratar a mano
 * ("si esta orden no tiene ubicación, pinto algo distinto") y esa divergencia es
 * exactamente la que este guardia existe para cazar: la clasificación vive en el gate y el
 * vocabulario en `geocodificacion-motivo-messages.ts`, nunca en el modal. Lo que el modal
 * SÍ recibe de la 400 es una CIFRA (`sinUbicacion`), que no es un literal de estado.
 */
const MOTIVOS_DEL_GATE = [
  "asignable",
  "asignable_sin_ubicacion",
  "direccion_no_geocodificable",
  "geocodificacion_agotada",
  "geocodificacion_en_curso",
  "geocodificacion_encolada",
  "geocodificacion_no_encolable",
] as const;

function leer(rutaRelativa: string): string {
  return readFileSync(path.join(RAIZ, rutaRelativa), "utf8");
}

/**
 * El módulo del que un archivo importa `mensajeDireccionPorMotivo`, o `null` si no lo importa.
 * Exige que el nombre viaje DENTRO de las llaves de un `import { ... } from "...";` — así una
 * mención suelta en un comentario no cuenta como import real.
 */
function moduloDeImport(codigo: string, nombreImportado: string): string | null {
  const patron = new RegExp(
    `import\\s*\\{[^}]*\\b${nombreImportado}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
  );
  const match = codigo.match(patron);
  return match ? match[1]! : null;
}

describe("368/T8 — AsignarBodegaModal y AsignarSateliteModal importan mensajeDireccionPorMotivo del MISMO módulo", () => {
  it("AsignarBodegaModal.tsx importa mensajeDireccionPorMotivo de geocodificacion-motivo-messages", () => {
    const modulo = moduloDeImport(leer(RUTA_BODEGA), "mensajeDireccionPorMotivo");
    expect(modulo).toBe(MODULO_COMPARTIDO);
  });

  it("AsignarSateliteModal.tsx importa mensajeDireccionPorMotivo del MISMO módulo", () => {
    const modulo = moduloDeImport(leer(RUTA_SATELITE), "mensajeDireccionPorMotivo");
    expect(modulo).toBe(MODULO_COMPARTIDO);
  });

  it("los dos importan EXACTAMENTE el mismo módulo — ninguno lo trae de otro sitio", () => {
    const deBodega = moduloDeImport(leer(RUTA_BODEGA), "mensajeDireccionPorMotivo");
    const deSatelite = moduloDeImport(leer(RUTA_SATELITE), "mensajeDireccionPorMotivo");

    // No-vacuidad: si alguno no importara la función, esto ya habría fallado en los dos casos
    // de arriba, pero se repite aquí para que ESTA aserción no pase por comparar dos `null`.
    expect(deBodega).not.toBeNull();
    expect(deSatelite).not.toBeNull();

    expect(deBodega).toBe(deSatelite);
  });

  it("ninguno de los dos declara su PROPIO mapa motivo->mensaje: NINGÚN literal de la unión del gate aparece como string en el modal", () => {
    for (const ruta of [RUTA_BODEGA, RUTA_SATELITE]) {
      const codigo = leer(ruta);
      for (const motivo of MOTIVOS_DEL_GATE) {
        const comoStringDoble = codigo.includes(`"${motivo}"`);
        const comoStringSimple = codigo.includes(`'${motivo}'`);
        expect(
          comoStringDoble || comoStringSimple,
          `${ruta} no debe citar el literal "${motivo}" — el mapeo vive SOLO en geocodificacion-motivo-messages.ts`,
        ).toBe(false);
      }
    }
  });

  it("CONTRAPRUEBA: el detector SÍ caza un import de OTRO módulo (import ajeno, no import ausente)", () => {
    const importAjeno = `import { mensajeDireccionPorMotivo } from "./motivo-messages-copiado";`;
    const modulo = moduloDeImport(importAjeno, "mensajeDireccionPorMotivo");

    expect(modulo).toBe("./motivo-messages-copiado");
    expect(modulo).not.toBe(MODULO_COMPARTIDO);
  });

  it("CONTRAPRUEBA: el detector devuelve null cuando la función NO se importa en absoluto", () => {
    const sinImport = `const x = 1;\nfunction foo() { return "mensajeDireccionPorMotivo"; }`;
    expect(moduloDeImport(sinImport, "mensajeDireccionPorMotivo")).toBeNull();
  });

  it("CONTRAPRUEBA (400/R23): el barrido caza un modal que tratara `asignable_sin_ubicacion` a mano", () => {
    // Es la divergencia concreta que la 400 hace posible: el estado nuevo no bloquea, así que
    // un modal podría sentirse tentado de reconocerlo por su literal y pintar su propio aviso.
    const modalQueLoTrataAMano = [
      `const sinUbicacion = bloqueadas.filter(`,
      `  (b) => b.motivo === "asignable_sin_ubicacion",`,
      `).length;`,
    ].join("\n");

    const cazados = MOTIVOS_DEL_GATE.filter(
      (motivo) =>
        modalQueLoTrataAMano.includes(`"${motivo}"`) ||
        modalQueLoTrataAMano.includes(`'${motivo}'`),
    );
    expect(cazados).toEqual(["asignable_sin_ubicacion"]);
  });

  it("CONTRAPRUEBA: el barrido de literales SÍ caza un mapa propio copiado con los motivos del gate", () => {
    const literalPropioCopiado = [
      `const MOTIVO_A_MENSAJE_LOCAL = new Map([`,
      `  ["direccion_no_geocodificable", "Dirección no encontrada"],`,
      `  ["geocodificacion_agotada", "Dirección no encontrada"],`,
      `]);`,
    ].join("\n");

    const cazados = MOTIVOS_DEL_GATE.filter(
      (motivo) =>
        literalPropioCopiado.includes(`"${motivo}"`) ||
        literalPropioCopiado.includes(`'${motivo}'`),
    );
    expect(cazados).toEqual(["direccion_no_geocodificable", "geocodificacion_agotada"]);
  });
});

/**
 * FICHA 400 (T13/T16, R25) — GUARDIA: EL MAPA `motivo -> mensaje` ESTÁ TIPADO POR LA LISTA
 * DE ESTADOS BLOQUEANTES, NO POR `string`.
 *
 * Por qué hace falta un guardia y no basta un test de comportamiento: la exhaustividad de
 * R25 la sostiene UNA anotación de tipo (`Record<EstadoBloqueante, string>`) y las
 * anotaciones no se pueden observar en runtime. Medido el 2026-09-09 con una mutación:
 * cambiar esa anotación a `Record<string, string>` y añadir un estado nuevo a
 * `EstadoAsignabilidad` deja el `typecheck` VERDE y los 42 tests del módulo VERDES — el
 * estado nuevo cae al `null` defensivo y el operador ve el mensaje genérico. Es el fallo
 * MUDO exacto que esta ficha vino a cerrar, así que se cierra leyendo el árbol real.
 *
 * (Con la anotación puesta, esa misma mutación es `error TS2741: Property … is missing in
 * type … but required in type 'Record<EstadoBloqueante, string>'`.)
 */
describe("400/T13 — el mapa de mensajes se tipa por `EstadoBloqueante`, y el tipo viene de su único módulo", () => {
  const RUTA_MENSAJES = "app/(app)/_components/geocodificacion-motivo-messages.ts";
  const RUTA_CONTRATO = "lib/interfaces/services/IAsignabilidadCoordenadasService.ts";
  const MODULO_DEL_TIPO = "@/lib/interfaces/services/IAsignabilidadCoordenadasService";

  /**
   * El tipo con el que se declara `MOTIVO_A_MENSAJE`, o `null` si no se declara así.
   *
   * REVISIÓN DEL 2026-09-09, `menor-2` (MUT-1c): esto se aplica sobre el código YA SIN
   * COMENTARIOS. `String.match` devuelve la PRIMERA coincidencia, así que un comentario con
   * la anotación buena escrito encima de la declaración real la enmascaraba y el guardia
   * leía el señuelo. El quitador de comentarios del repo (`tests/fixtures/sin-comentarios`)
   * existe exactamente para esto y lo usan 171 suites: aquí se hereda sin escribir una regla
   * propia.
   */
  function tipoDelMapa(codigo: string): string | null {
    const match = quitarComentarios(codigo).match(/const\s+MOTIVO_A_MENSAJE\s*:\s*([^=]+?)\s*=/);
    return match ? match[1]!.trim() : null;
  }

  /**
   * La parte DERECHA de `export type EstadoBloqueante = …;`, con los espacios normalizados.
   * También sobre el código sin comentarios, por la misma razón que arriba.
   */
  function declaracionDeEstadoBloqueante(codigo: string): string | null {
    const match = quitarComentarios(codigo).match(
      /export\s+type\s+EstadoBloqueante\s*=\s*([^;]+);/,
    );
    return match ? match[1]!.replace(/\s+/g, " ").trim() : null;
  }

  it("`MOTIVO_A_MENSAJE` se declara como `Record<EstadoBloqueante, string>`", () => {
    expect(tipoDelMapa(leer(RUTA_MENSAJES))).toBe("Record<EstadoBloqueante, string>");
  });

  it("no queda ningún `Map<string, string>` ni `Record<string, string>`: eso era el silencio de antes de la 400", () => {
    // Sobre el código sin comentarios: la cabecera del módulo NOMBRA las formas prohibidas
    // para explicar por qué lo están, y denunciar esa explicación obligaría a borrarla.
    const codigo = quitarComentarios(leer(RUTA_MENSAJES));
    expect(codigo).not.toContain("Record<string, string>");
    expect(codigo).not.toContain("Map<string, string>");
  });

  // ── REVISIÓN DEL 2026-09-09, `menor-1` — EL ESLABÓN DE ARRIBA ────────────────────────
  //
  // Los tres `it` de arriba cierran el eslabón de ABAJO: que el mapa se anote con el tipo.
  // Pero la exhaustividad de R25 cuelga de DOS eslabones, y el de arriba no lo protegía
  // nadie. Medido por el reviewer (MUT-2): reescribir `EstadoBloqueante` A MANO —los cinco
  // literales en vez de `Exclude<EstadoAsignabilidad, EstadoAsignable>`— y añadir un sexto
  // estado bloqueante deja el TYPECHECK LIMPIO y 1999 tests verdes en 129 archivos de
  // guardias. El mensaje del estado nuevo caería al `null` defensivo y el operador vería el
  // genérico: el mismo silencio que esta ficha vino a cerrar, una capa más afuera.
  //
  // Por qué la derivación es lo único que funciona: `Exclude` se recalcula solo cuando
  // alguien amplía `EstadoAsignabilidad`, así que el estado nuevo entra AUTOMÁTICAMENTE en
  // `EstadoBloqueante` y el `Record` deja de compilar. Una lista escrita a mano no se entera
  // de nada, y su desactualización es indistinguible de estar al día.
  //
  // Importa ahora y no algún día: la ficha 401 se apoya en este marcador y en esta cadena de
  // tipos; conviene que herede el eslabón cerrado y no uno suelto.
  it("menor-1: `EstadoBloqueante` se DERIVA con `Exclude`, nunca se escribe a mano", () => {
    expect(declaracionDeEstadoBloqueante(leer(RUTA_CONTRATO))).toBe(
      "Exclude<EstadoAsignabilidad, EstadoAsignable>",
    );
  });

  it("menor-1: y su declaración no contiene NI UN literal de estado (eso sería la lista a mano)", () => {
    const declaracion = declaracionDeEstadoBloqueante(leer(RUTA_CONTRATO));
    // No-vacuidad: si el detector devolviera `null`, las dos aserciones de abajo pasarían
    // por vacío y el guardia estaría verde sin haber leído nada.
    expect(declaracion).not.toBeNull();
    expect(declaracion).not.toContain('"');
    expect(declaracion).not.toContain("'");
    // Y ninguno de los siete estados aparece nombrado ahí: la lista vive UNA sola vez, en
    // `EstadoAsignabilidad`, y `EstadoAsignable` es la única partición escrita a mano.
    for (const estado of MOTIVOS_DEL_GATE) {
      expect(declaracion).not.toContain(estado);
    }
  });

  it("CONTRAPRUEBA menor-1: el detector SÍ caza la unión escrita a mano, y el señuelo en comentario ya no lo engaña", () => {
    const aMano = [
      "export type EstadoBloqueante =",
      '  | "direccion_no_geocodificable"',
      '  | "geocodificacion_agotada"',
      '  | "geocodificacion_en_curso"',
      '  | "geocodificacion_encolada"',
      '  | "geocodificacion_no_encolable";',
    ].join("\n");
    const cazada = declaracionDeEstadoBloqueante(aMano);
    expect(cazada).not.toBe("Exclude<EstadoAsignabilidad, EstadoAsignable>");
    expect(cazada).toContain("direccion_no_geocodificable");

    // Y la forma buena se reconoce como tal (mitad positiva del detector).
    expect(
      declaracionDeEstadoBloqueante(
        "export type EstadoBloqueante = Exclude<EstadoAsignabilidad, EstadoAsignable>;",
      ),
    ).toBe("Exclude<EstadoAsignabilidad, EstadoAsignable>");

    // MUT-1c / menor-2: con un comentario señuelo ENCIMA de la declaración real, el detector
    // tiene que leer la REAL. Sin el quitador de comentarios, `String.match` devolvía la
    // primera coincidencia — el señuelo — y la mutación sobrevivía.
    const conSenuelo = [
      "// export type EstadoBloqueante = Exclude<EstadoAsignabilidad, EstadoAsignable>;",
      'export type EstadoBloqueante = "direccion_no_geocodificable";',
    ].join("\n");
    expect(declaracionDeEstadoBloqueante(conSenuelo)).toBe('"direccion_no_geocodificable"');
  });

  it("`EstadoBloqueante` se importa del contrato del gate, no se redeclara aquí", () => {
    const codigo = leer(RUTA_MENSAJES);
    // `import type` para que el tipo no cree acoplamiento en runtime (design §6.1).
    expect(codigo).toMatch(
      new RegExp(
        `import\\s+type\\s*\\{[^}]*\\bEstadoBloqueante\\b[^}]*\\}\\s*from\\s*["']${MODULO_DEL_TIPO.replace(
          /[/]/g,
          "\\/",
        )}["']`,
      ),
    );
    expect(codigo).not.toMatch(/type\s+EstadoBloqueante\s*=/);
  });

  it("CONTRAPRUEBA: el detector caza la forma vieja (`Record<string, string>`) y la anterior (`new Map`)", () => {
    expect(
      tipoDelMapa(`const MOTIVO_A_MENSAJE: Record<string, string> = {};`),
    ).toBe("Record<string, string>");
    // La forma que tenía el módulo hasta la 400 no lleva anotación ninguna: `null`.
    expect(
      tipoDelMapa(`const MOTIVO_A_MENSAJE = new Map<string, string>([]);`),
    ).toBeNull();
    // Y la buena se reconoce como tal.
    expect(
      tipoDelMapa(`const MOTIVO_A_MENSAJE: Record<EstadoBloqueante, string> = {};`),
    ).toBe("Record<EstadoBloqueante, string>");
  });
});
