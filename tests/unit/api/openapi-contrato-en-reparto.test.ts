import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { EVENTOS_PUBLICOS } from "@/lib/types/webhook-eventos";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 153 (R13) — contrato EXTERNO del canal por API key y del webhook de estado.
// El rename del value viaja al integrador sin capa de traduccion (decision del gate,
// misma politica que la 135: no se bumpea `info.version`). Este test cubre los TRES
// artefactos del contrato a la vez y, sobre todo, que el .yaml publicado siga siendo
// espejo EXACTO del objeto TS (es un archivo de texto: nada mas lo mantiene sincronizado).
//
// El value ANTIGUO se construye en piezas a proposito: escribirlo literal haria que este
// archivo apareciera como ofensor del guard de censo (censo-order-status-rename.test.ts).
const VALUE_ANTIGUO = ["en", "ruta"].join("_");
const RE_VALUE_ANTIGUO = new RegExp(`\\b${VALUE_ANTIGUO}\\b`);
const VALUE_NUEVO = "en_reparto";

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");

/**
 * ¿Es este `enum` el catalogo de ESTADOS de orden? Se exige `entregada` Y `por_recoger`:
 * `enum: ["entregada", "rechazada"]` (resultado de gestion) tambien cita `entregada` y NO
 * es el catalogo de estados.
 */
function esEnumDeEstado(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string") &&
    (value as string[]).includes("entregada") &&
    (value as string[]).includes("por_recoger")
  );
}

/** Recolecta todos los arrays `enum` del objeto OpenAPI que enumeran estados de orden. */
function enumsDeEstado(node: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    for (const item of node) enumsDeEstado(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "enum" && esEnumDeEstado(value)) out.push(value);
      enumsDeEstado(value, out);
    }
  }
  return out;
}

/** Extrae del YAML las listas que siguen a una linea `enum:` (items `- valor`). */
function enumsDelYaml(texto: string): string[][] {
  const lineas = texto.split(/\r?\n/);
  const bloques: string[][] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!/^\s*enum:\s*$/.test(lineas[i])) continue;
    const items: string[] = [];
    for (let j = i + 1; j < lineas.length; j++) {
      const m = /^\s*-\s+([A-Za-z0-9_]+)\s*$/.exec(lineas[j]);
      if (!m) break;
      items.push(m[1]);
    }
    if (esEnumDeEstado(items)) bloques.push(items);
  }
  return bloques;
}

describe("153/R13 — enum de estados del OpenAPI por API key", () => {
  const enumsTs = enumsDeEstado(openApiSpec);

  it("el objeto TS expone el enum de estados en sus 4 sitios", () => {
    expect(enumsTs).toHaveLength(4);
  });

  it("cada enum contiene en_reparto y NINGUNO conserva el value antiguo", () => {
    for (const lista of enumsTs) {
      expect(lista).toContain(VALUE_NUEVO);
      expect(lista.some((v) => RE_VALUE_ANTIGUO.test(v))).toBe(false);
      // R5: los vecinos siguen en el contrato, intactos.
      expect(lista).toContain("en_ruta_bodega_central");
      expect(lista).toContain("en_ruta_bodega_satelite");
    }
  });

  it("todo value del enum existe en el catalogo (ORDER_STATUS_SEED)", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    for (const lista of enumsTs) {
      for (const value of lista) expect(catalogo.has(value)).toBe(true);
    }
  });

  it("el .yaml publicado sigue siendo espejo EXACTO del objeto TS (4 bloques identicos)", () => {
    const enumsYaml = enumsDelYaml(yaml);
    expect(enumsYaml).toHaveLength(4);
    for (let i = 0; i < enumsYaml.length; i++) {
      expect(enumsYaml[i]).toEqual(enumsTs[i]);
    }
  });

  it("el .yaml no menciona el value antiguo en ninguna linea", () => {
    const ofensoras = yaml
      .split(/\r?\n/)
      .map((linea, idx) => ({ linea, n: idx + 1 }))
      .filter(({ linea }) => RE_VALUE_ANTIGUO.test(linea));
    expect(ofensoras).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 155/R42 — el contrato publico tras el retiro del estado de fulfillment y el cambio
// del estado en que nacen las ordenes creadas por API. El literal retirado se construye por
// concatenacion (patron de este archivo) para no aparecer como ofensor del censo.
// ---------------------------------------------------------------------------------------------
const VALUE_RETIRADO_155 = ["en", "fulfillment"].join("_");
const RE_VALUE_RETIRADO_155 = new RegExp(`\\b${VALUE_RETIRADO_155}\\b`);
const VALUE_NACIMIENTO_API = "por_recolectar_en_tienda";

describe("155/R42 — el contrato del canal por API key tras el retiro", () => {
  const enumsTs = enumsDeEstado(openApiSpec);

  it("ningun enum del objeto TS documenta ya el estado retirado", () => {
    expect(enumsTs).toHaveLength(4);
    for (const lista of enumsTs) {
      expect(lista.some((v) => RE_VALUE_RETIRADO_155.test(v))).toBe(false);
    }
  });

  it("todo enum documenta el estado en que nacen las ordenes creadas por API", () => {
    for (const lista of enumsTs) expect(lista).toContain(VALUE_NACIMIENTO_API);
  });

  it("el .yaml no menciona el value retirado en NINGUNA linea (enum ni prosa)", () => {
    const ofensoras = yaml
      .split(/\r?\n/)
      .map((linea, idx) => ({ linea, n: idx + 1 }))
      .filter(({ linea }) => RE_VALUE_RETIRADO_155.test(linea))
      .map(({ n }) => n);
    expect(ofensoras).toEqual([]);
  });

  // ⏳ 2026-09-01 — AQUI VIVIA «la descripcion del endpoint de carga anuncia el estado nuevo y el
  // cambio incompatible». Era el UNICO sitio del contrato donde el CAMBIO INCOMPATIBLE de la 155
  // estaba anunciado en palabras; se fue con las descripciones de nivel operacion (peticion
  // explicita). El estado nuevo sigue publicado en los enums y en los ejemplos, que son los dos
  // tests que rodean a esta nota.

  it("los ejemplos publicados NO siguen mostrando el estado inicial viejo", () => {
    const ejemplo = JSON.stringify(
      openApiSpec.paths["/api/ordenes/api-key/carga"].post.responses["200"],
    );
    expect(ejemplo).not.toContain('"estatus":"en_ruta_bodega_central"');
    expect(ejemplo).toContain(`"estatus":"${VALUE_NACIMIENTO_API}"`);
    expect(ejemplo).toContain(`"estado":"${VALUE_NACIMIENTO_API}"`);
  });
});

describe("153/R13 — eventos publicos de webhook", () => {
  // Feature 155/R43: pasa de 9 a 10 con `por_recolectar_en_tienda`. La ampliacion es ADITIVA:
  // el conteo sube y ningun estado sale (lo verifica el test siguiente, contra la foto de la 153).
  //
  // ⏳ 2026-08-22 (FEATURE 268/R1/R2/R18) — este aserto se puso ROJO A PROPOSITO y se actualiza CON
  // LA DECISION ESCRITA AL LADO, que es su funcion (alternativa A6 del design 268, descartada:
  // NUNCA se relaja a un `size` suelto ni se borra). Pasa de 10 a 12 porque la 268 REVIERTE
  // DELIBERADAMENTE la decision 235/P4 (firmada el 2026-08-19) y mete en la politica las dos
  // mitades del ciclo que hoy el integrador no ve: `ayuda_tienda` (la IDA) e `incidente` (el
  // desenlace). Las dos mitades van juntas o no van: emitir la ida sin la vuelta —el rescate, que
  // vuelve a emitir al vaciarse `ORIGENES_SIN_EVENTO_PUBLICO`— dejaria al integrador viendo entrar
  // la orden en ayuda y no verla salir nunca, que es peor que el silencio de hoy.
  //
  // El conteo va ACOMPAÑADO, nunca solo: el `it` de abajo afirma value a value que los DOCE estan,
  // asi que un intercambio (uno entra, otro sale) no puede colarse con el tamaño intacto.
  //
  // ⏳ 2026-08-31 — pasa de 12 a 13: entra `en_preparacion`, el evento de NACIMIENTO de las ordenes
  // de fulfillment, que hasta hoy no producian NINGUN evento hasta llegar a `en_bodega_central` al
  // emitirse la guia. Misma razon que la 155/R43 para `por_recolectar_en_tienda`. La igualdad value
  // a value que ACOMPAÑA a este conteo vive en `tests/unit/types/webhook-eventos.test.ts`.
  it("EVENTOS_PUBLICOS tiene 13 elementos (los 12 de la 268 + `en_preparacion`)", () => {
    expect(EVENTOS_PUBLICOS.size).toBe(13);
    // El value nuevo, afirmado aqui tambien: el conteo solo no distingue un alta de un intercambio.
    expect(EVENTOS_PUBLICOS.has("en_preparacion")).toBe(true);
  });

  it("155/R43 + 268/R3: los 10 eventos previos siguen TODOS en la politica, y los 2 nuevos entran", () => {
    // R3: el cambio de la 268 es estrictamente ADITIVO — ningun integrador deja de recibir un
    // evento que hoy recibe. Los diez primeros son la foto previa a la 268 y NO PUEDEN SALIR.
    for (const previo of [
      "en_ruta_bodega_central",
      "en_bodega_central",
      "en_reparto",
      "entregada",
      "reprogramada",
      "devuelta",
      "rechazada",
      "devolviendo_a_tienda",
      "devuelta_a_tienda",
      "por_recolectar_en_tienda",
    ] as const) {
      expect(EVENTOS_PUBLICOS.has(previo), `dejo de ser evento publico: ${previo}`).toBe(true);
    }
    // 268/R1 y 268/R2: las dos altas, junto a los previos y no en un test aparte, para que la
    // lista completa se lea de un vistazo.
    for (const nuevo of ["ayuda_tienda", "incidente"] as const) {
      expect(EVENTOS_PUBLICOS.has(nuevo), `no entro en la politica: ${nuevo}`).toBe(true);
    }
    // 268/R4: `devolucion_por_confirmar` SIGUE FUERA (239/P2, firmada). No entra «por simetria».
    expect(EVENTOS_PUBLICOS.has("devolucion_por_confirmar")).toBe(false);
  });

  it("155/R43: el estado de nacimiento de la rama (b) ES evento publico", () => {
    // Sin esto, el integrador que hoy recibe un evento al crear una orden dejaria de recibir
    // cualquier cosa hasta que la orden llegue a la bodega central, y el silencio se leeria
    // como "no se creo".
    expect(EVENTOS_PUBLICOS.has("por_recolectar_en_tienda")).toBe(true);
  });

  it("incluye en_reparto y no el value antiguo; los vecinos no cambian", () => {
    expect(EVENTOS_PUBLICOS.has(VALUE_NUEVO)).toBe(true);
    expect([...EVENTOS_PUBLICOS].some((v) => RE_VALUE_ANTIGUO.test(v))).toBe(false);
    expect(EVENTOS_PUBLICOS.has("en_ruta_bodega_central")).toBe(true);
  });

  it("todo evento publico existe en el catalogo (no hay estado desconocido, R14)", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    for (const evento of EVENTOS_PUBLICOS) expect(catalogo.has(evento)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 268 — el VOCABULARIO PUBLICADO acompaña a la politica (R15/R16) y las evidencias de
// incidente pasan a ser una forma legitima de `Evidencia.resultado` (R31).
//
// Por que aqui y no en `openapi-webhook-contrato.test.ts`: estos dos casos son sobre el catalogo
// de estados de las RESPUESTAS REST y sobre un schema de `components`, que es exactamente lo que
// este archivo custodia (los 4 bloques y su espejo). El archivo nuevo custodia la seccion
// `webhooks:`, que es otra cosa.
// ---------------------------------------------------------------------------------------------
describe("268/R15/R16 — los dos values nuevos estan publicados en los 4 enums y en el .yaml", () => {
  const enumsTs = enumsDeEstado(openApiSpec);

  it("los 4 enums del objeto TS documentan `ayuda_tienda` e `incidente`", () => {
    expect(enumsTs).toHaveLength(4);
    for (const lista of enumsTs) {
      expect(lista).toContain("ayuda_tienda");
      expect(lista).toContain("incidente");
      // Van AL FINAL, tras `devuelta_a_tienda`: el espejo del .yaml se compara posicionalmente,
      // asi que la posicion es parte del contrato, no un detalle de estilo.
      expect(lista.slice(-2)).toEqual(["ayuda_tienda", "incidente"]);
    }
  });

  it("los 4 bloques del .yaml los documentan en la MISMA posicion (espejo posicional)", () => {
    const enumsYaml = enumsDelYaml(yaml);
    expect(enumsYaml).toHaveLength(4);
    for (let i = 0; i < enumsYaml.length; i++) {
      expect(enumsYaml[i].slice(-2)).toEqual(["ayuda_tienda", "incidente"]);
      expect(enumsYaml[i]).toEqual(enumsTs[i]);
    }
  });

  it("268/R17: los dos values nuevos existen en ORDER_STATUS_SEED (sin estados fantasma)", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    expect(catalogo.has("ayuda_tienda")).toBe(true);
    expect(catalogo.has("incidente")).toBe(true);
  });
});

describe("268/R31 — `Evidencia.resultado` admite `incidente`, en el TS y en el .yaml", () => {
  // El detalle por API key deja de exponer solo entrega y rechazo: las evidencias del incidente
  // (por las DOS procedencias, mensajero y admin) viajan con el mismo shape y `resultado:
  // "incidente"`. Sin este value publicado, el enlace `evidenciasUrl` del webhook apuntaria a un
  // campo cuyo contrato niega lo que devuelve.
  const resultadoTs = openApiSpec.components.schemas.Evidencia.properties.resultado;

  it("el enum del objeto TS son exactamente los tres resultados, con `incidente` al final", () => {
    expect(resultadoTs.enum).toEqual(["entregada", "rechazada", "incidente"]);
    // Y NO es el catalogo de estados: no contiene `por_recoger`, asi que `esEnumDeEstado` no lo
    // cuenta y los cuatro bloques del guard de arriba siguen siendo cuatro.
    expect(esEnumDeEstado(resultadoTs.enum)).toBe(false);
  });

  it("el .yaml publica el MISMO enum de tres values", () => {
    const bloque = /\n {8}resultado:\n {10}type: string\n {10}enum:\n((?: {12}- \w+\n)+)/.exec(yaml);
    expect(bloque, "no se encontro el enum de `Evidencia.resultado` en el .yaml").not.toBeNull();
    const values = bloque![1]
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.trim().replace(/^-\s+/, ""));
    expect(values).toEqual(["entregada", "rechazada", "incidente"]);
  });
});
