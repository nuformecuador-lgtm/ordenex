import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { consultaRastreoSchema } from "@/lib/types/rastreo-publico";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// Feature 229 — GUARDIA DE AISLAMIENTO DEL BORDE PUBLICO (T4.2).
// Cubre R4 (parte), R12, R13, R24 y R25.
//
// Las cuatro afirmaciones son de AUSENCIA, y una ausencia solo prueba algo si el archivo que se
// lee existe, tiene contenido y es el que se cree que es: de ahi el CONTROL DE NO-VACUIDAD con
// un ancla por modulo.
//
// El barrido va SOBRE EL CODIGO SIN COMENTARIOS y no es un detalle de estilo: los docstrings de
// esta feature NOMBRAN A PROPOSITO lo que tienen prohibido —«no importa `OrdenHistorialService`
// ni su DTO», «nada de `direccion`, `montoCobrar`, `motivo`»— porque esa prosa es la mitad del
// diseño (design §1, §2.1). Un barrido sobre el texto crudo denunciaria la EXPLICACION y
// obligaria a borrarla para pasar la guardia, que es exactamente al reves de lo que se quiere.

const RAIZ = path.resolve(__dirname, "../../..");

/** Los siete modulos de la feature, con el ancla que prueba que se leyo el archivo correcto. */
const MODULOS: { ruta: string; ancla: string }[] = [
  { ruta: "lib/types/rastreo-publico.ts", ancla: "consultaRastreoSchema" },
  { ruta: "lib/config/rastreo-publico.ts", ancla: "loadRastreoPublicoConfig" },
  { ruta: "lib/repositories/RastreoPublicoRepository.ts", ancla: "RastreoPublicoRepository" },
  { ruta: "lib/services/RastreoPublicoService.ts", ancla: "RastreoPublicoService" },
  { ruta: "lib/actions/rastreo-publico.ts", ancla: "consultarRastreoPublico" },
  { ruta: "lib/interfaces/services/IRastreoPublicoService.ts", ancla: "IRastreoPublicoService" },
  {
    ruta: "lib/interfaces/repositories/IRastreoPublicoRepository.ts",
    ancla: "IRastreoPublicoRepository",
  },
];

const CODIGO: ReadonlyMap<string, string> = new Map(
  MODULOS.map(({ ruta }) => [ruta, codigoSinComentarios(ruta)]),
);

function codigo(ruta: string): string {
  const fuente = CODIGO.get(ruta);
  if (fuente === undefined) throw new Error(`modulo fuera del censo: ${ruta}`);
  return fuente;
}

describe("CONTROL DE NO-VACUIDAD — los siete modulos de la feature existen y son los que dicen ser", () => {
  it("cada modulo tiene contenido y conserva su ancla", () => {
    for (const { ruta, ancla } of MODULOS) {
      const crudo = readFileSync(path.join(RAIZ, ruta), "utf8");
      expect(crudo.length, `${ruta} esta vacio`).toBeGreaterThan(200);
      expect(crudo, `${ruta} ya no contiene \`${ancla}\``).toContain(ancla);
      expect(codigo(ruta).trim().length, `${ruta} es todo comentarios`).toBeGreaterThan(100);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (a) R4 / R24 — el borde publico no reutiliza nada del historial interno      */
/*     ni de la etiqueta privada del paquete                                    */
/* -------------------------------------------------------------------------- */

/**
 * Simbolos y modulos que esta feature NO puede tocar, con el porque de cada uno:
 *
 *  - `OrdenHistorialService` / `IOrdenHistorialService` / `OrdenHistorialEntradaDTO` (R24):
 *    aquel contrato exige un `Actor` en la primera linea y su DTO ya lleva `actorNombre`,
 *    `origenTipo` y `motivo`. Un modo publico dentro de el tendria que QUITAR campos, y quitar
 *    es una operacion que se olvida (design §2.1).
 *  - `resolveActorFromSession` (R13): el borde publico NO resuelve actor, y es deliberado.
 *  - `obtenerEtiquetaPorGuia` / `lib/utils/paquete-url` (R4/R35): la etiqueta y su QR son de la
 *    feature 79 y siguen siendo privados. Importarlos desde aqui seria abrir `/paquete` al
 *    publico por la puerta de atras.
 */
const SIMBOLOS_PROHIBIDOS = [
  "OrdenHistorialService",
  "IOrdenHistorialService",
  "OrdenHistorialEntradaDTO",
  "resolveActorFromSession",
  "obtenerEtiquetaPorGuia",
  "PAQUETE_BASE_PATH",
  "buildPaqueteUrl",
  "paquete-url",
] as const;

describe("R24 — ningún módulo de la feature importa OrdenHistorialService ni su DTO", () => {
  for (const { ruta } of MODULOS) {
    it(`\`${ruta}\` no nombra el service interno de historial ni su contrato`, () => {
      const fuente = codigo(ruta);
      for (const simbolo of ["OrdenHistorialService", "IOrdenHistorialService", "OrdenHistorialEntradaDTO"]) {
        expect(fuente, `${ruta} nombra ${simbolo}`).not.toContain(simbolo);
      }
    });
  }
});

describe("R4/R35 — ningún módulo de la feature importa la etiqueta del paquete", () => {
  for (const { ruta } of MODULOS) {
    it(`\`${ruta}\` no nombra la etiqueta privada ni su URL impresa`, () => {
      const fuente = codigo(ruta);
      for (const simbolo of [
        "obtenerEtiquetaPorGuia",
        "PAQUETE_BASE_PATH",
        "buildPaqueteUrl",
        "paquete-url",
      ]) {
        expect(fuente, `${ruta} nombra ${simbolo}`).not.toContain(simbolo);
      }
    });
  }
});

describe("R13 — el borde público no resuelve actor", () => {
  it("ningun modulo nombra `resolveActorFromSession` ni lee la cookie de sesion", () => {
    for (const { ruta } of MODULOS) {
      const fuente = codigo(ruta);
      expect(fuente, `${ruta} resuelve actor`).not.toContain("resolveActorFromSession");
      expect(fuente, `${ruta} lee cookies`).not.toMatch(/\bcookies\s*\(/);
      expect(fuente, `${ruta} importa el modulo de sesion`).not.toMatch(/from\s+"@\/lib\/auth/);
    }
  });

  it("CONTRAPRUEBA: el barrido caza un import prohibido inyectado en el borde", () => {
    // Sin esto, todo lo anterior podria estar pasando por no mirar nada.
    const real = codigo("lib/actions/rastreo-publico.ts");
    const mutado = `import { resolveActorFromSession } from "@/lib/auth/actor";\n${real}`;

    const caza = (fuente: string): string[] =>
      SIMBOLOS_PROHIBIDOS.filter((simbolo) => fuente.includes(simbolo));

    expect(caza(real)).toEqual([]);
    expect(caza(mutado)).toEqual(["resolveActorFromSession"]);
  });
});

/* -------------------------------------------------------------------------- */
/* (b) R13 — el schema de la accion publica tiene DOS claves y ninguna mas      */
/* -------------------------------------------------------------------------- */

describe("R13 — el schema de la acción pública tiene exactamente dos campos y no resuelve actor", () => {
  it("las claves del schema son exactamente `numGuia` y `factor`", () => {
    // Se lee el SCHEMA REAL importado, no el texto del archivo: un barrido por regex sobre el
    // fuente confundiria un campo declarado dentro de un `.refine`, un comentario o un tipo, y
    // se lo perderia o lo contaria de mas. Aqui se pregunta al objeto que la accion valida.
    const claves = Object.keys(consultaRastreoSchema.shape).sort();
    expect(claves).toEqual(["factor", "numGuia"]);
  });

  it("no acepta ningun filtro del negocio: zona, tienda, mensajero, fecha ni paginacion", () => {
    // R13 dicho por su motivo: un borde sin sesion CON filtros es un oraculo del negocio
    // (precedente documentado en `lib/actions/conteos-publicos.ts:19-24`). Cualquier campo
    // nuevo cae en la asercion de arriba; estos se nombran por ser los que de verdad tentarian.
    const shape: Record<string, unknown> = consultaRastreoSchema.shape;
    for (const filtro of [
      "zonaId",
      "tiendaId",
      "mensajeroId",
      "desde",
      "hasta",
      "fecha",
      "page",
      "limit",
      "cursor",
      "estatus",
    ]) {
      expect(shape[filtro], `el schema acepta el filtro ${filtro}`).toBeUndefined();
    }
  });

  it("CONTRAPRUEBA: la comparacion caza una tercera clave añadida al schema", () => {
    const ampliado = consultaRastreoSchema.extend({
      zonaId: consultaRastreoSchema.shape.factor,
    });
    expect(Object.keys(ampliado.shape).sort()).not.toEqual(["factor", "numGuia"]);
  });
});

/* -------------------------------------------------------------------------- */
/* (c) R25 — el `select` del repositorio no nombra ningun campo prohibido       */
/* -------------------------------------------------------------------------- */

/**
 * Los campos que design §1 declara NO LEIDOS. La lista es la del requisito R23/R25 tal cual:
 * los seis de la orden mas los cuatro de la fila de historial, mas las dos claves foraneas que
 * situarian al cliente en la geografia interna de la operacion.
 */
const CAMPOS_PROHIBIDOS = [
  "actorUsuarioId",
  "origenTipo",
  "motivo",
  "gestionOrdenId",
  "direccion",
  "montoCobrar",
  "producto",
  "notas",
  "destinatario",
  "mensajeroAsignadoId",
  "tiendaId",
  "zonaId",
] as const;

describe("R25 — el select del repositorio público no nombra ningún campo prohibido", () => {
  it("ninguno de los doce campos prohibidos aparece en el repositorio", () => {
    const fuente = codigo("lib/repositories/RastreoPublicoRepository.ts");
    const encontrados = CAMPOS_PROHIBIDOS.filter((campo) => fuente.includes(campo));
    expect(encontrados, "el repositorio publico lee campos que no le corresponden").toEqual([]);
  });

  it("MEDIDO: los dos `select` son EXPLICITOS y enumeran exactamente lo que design §1 permite", () => {
    // La ausencia sola no basta: un `include: true` o una fila completa proyectada despues no
    // nombraria ningun campo prohibido y seria la fuga entera. Se afirma la ESTRUCTURA.
    const fuente = codigo("lib/repositories/RastreoPublicoRepository.ts");

    expect(fuente).toContain(
      "select: { id: true, numGuia: true, telefonoDest: true, deletedAt: true }",
    );
    expect(fuente).toContain(
      "select: { createdAt: true, estatusDestino: { select: { value: true } } }",
    );

    // Exactamente DOS `select` y ningun `include`: nada de traer la fila entera.
    expect([...fuente.matchAll(/\bselect:/g)]).toHaveLength(3); // los 2 raiz + el anidado del catalogo
    expect(fuente).not.toContain("include:");
  });

  it("CONTRAPRUEBA: el barrido caza un campo prohibido añadido al select", () => {
    const real = codigo("lib/repositories/RastreoPublicoRepository.ts");
    const mutado = real.replace("telefonoDest: true", "telefonoDest: true, direccion: true");

    const caza = (fuente: string): string[] =>
      CAMPOS_PROHIBIDOS.filter((campo) => fuente.includes(campo));

    expect(caza(real)).toEqual([]);
    expect(caza(mutado)).toEqual(["direccion"]);
  });

  it("los campos prohibidos tampoco cruzan por el contrato ni por el service", () => {
    // El `select` limpio no serviria de nada si el contrato de la fila los declarara o si el
    // service los reconstruyera por su cuenta desde otra lectura.
    for (const ruta of [
      "lib/interfaces/repositories/IRastreoPublicoRepository.ts",
      "lib/services/RastreoPublicoService.ts",
      "lib/types/rastreo-publico.ts",
    ]) {
      const fuente = codigo(ruta);
      const encontrados = CAMPOS_PROHIBIDOS.filter((campo) => fuente.includes(campo));
      expect(encontrados, `${ruta} nombra campos prohibidos`).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (d) R12 — ni logs de la entrada, ni catch vacios, ni textos interpolados     */
/* -------------------------------------------------------------------------- */

/** Lo que jamas puede acabar en un log, un mensaje de error o una telemetria. */
const ENTRADA_SENSIBLE = /num\s*guia|numguia|factor|guia|telefono|destinatario|parsed\.data|entrada/i;

describe("R12 — los módulos de la feature no registran la guía ni el segundo factor y no tragan errores", () => {
  it("ningun modulo llama a `console.*`", () => {
    for (const { ruta } of MODULOS) {
      expect(codigo(ruta), `${ruta} escribe en consola`).not.toMatch(/\bconsole\s*\./);
    }
  });

  it("ningun modulo tiene un `catch` vacio", () => {
    // `catch {}` y `catch (e) {}`: tragarse el error deja la fuga —o el fallo— invisible.
    for (const { ruta } of MODULOS) {
      expect(codigo(ruta), `${ruta} tiene un catch vacio`).not.toMatch(
        /catch\s*(\([^)]*\)\s*)?\{\s*\}/,
      );
    }
  });

  it("ningun texto de la feature interpola la entrada del usuario", () => {
    // Se recogen TODAS las interpolaciones `${...}` del arbol de la feature y se comprueba que
    // ninguna nombra la guia, el factor ni el telefono. Medido: las unicas vivas son las partes
    // de la fecha formateada (service) y la IP de la clave del limitador (accion).
    const interpolaciones: { ruta: string; expresion: string }[] = [];
    for (const { ruta } of MODULOS) {
      for (const match of codigo(ruta).matchAll(/\$\{([^}]*)\}/g)) {
        interpolaciones.push({ ruta, expresion: match[1] });
      }
    }

    // Control de no-vacuidad: si el recolector no encontrara ninguna interpolacion, el filtro
    // de abajo estaria juzgando una lista vacia.
    expect(interpolaciones.length).toBeGreaterThan(0);

    const contaminadas = interpolaciones.filter(({ expresion }) =>
      ENTRADA_SENSIBLE.test(expresion),
    );
    expect(contaminadas).toEqual([]);
  });

  it("los mensajes de rechazo del schema son literales FIJOS, sin interpolacion", () => {
    // R28/R12: el texto que ve el rechazado no puede llevar dentro lo que tecleo.
    const fuente = codigo("lib/types/rastreo-publico.ts");
    const mensajes = [...fuente.matchAll(/const MENSAJE_\w+\s*=\s*("[^"]*")/g)].map((m) => m[1]);

    expect(mensajes.length).toBeGreaterThan(0);
    for (const mensaje of mensajes) {
      expect(mensaje).not.toContain("${");
      expect(mensaje).not.toMatch(ENTRADA_SENSIBLE);
    }
  });

  it("CONTRAPRUEBA: los tres barridos cazan su violacion inyectada", () => {
    const real = codigo("lib/actions/rastreo-publico.ts");

    const conLog = `${real}\nconsole.log("consulta", parsed.data.numGuia);`;
    expect(real).not.toMatch(/\bconsole\s*\./);
    expect(conLog).toMatch(/\bconsole\s*\./);

    const conCatchVacio = `${real}\ntry { hacer(); } catch {}`;
    expect(real).not.toMatch(/catch\s*(\([^)]*\)\s*)?\{\s*\}/);
    expect(conCatchVacio).toMatch(/catch\s*(\([^)]*\)\s*)?\{\s*\}/);

    const conTextoInterpolado = `${real}\nconst msg = \`No encontramos la guia \${parsed.data.numGuia}\`;`;
    const interpolacionesDe = (fuente: string): string[] =>
      [...fuente.matchAll(/\$\{([^}]*)\}/g)]
        .map((m) => m[1])
        .filter((expresion) => ENTRADA_SENSIBLE.test(expresion));
    expect(interpolacionesDe(real)).toEqual([]);
    expect(interpolacionesDe(conTextoInterpolado)).toEqual(["parsed.data.numGuia"]);
  });
});
