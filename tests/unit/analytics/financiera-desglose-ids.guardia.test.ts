import { existsSync, readFileSync, readdirSync } from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  IDS_FINANCIERAS_SERVIDAS,
} from "@/lib/types/analitica-financiera";

// Feature 180 (T3.1 / T5.4) — GUARDIA DEL R2: EL CONJUNTO CON DESGLOSE POR FECHA ES UNA
// UNICA CONSTANTE EXPORTADA, Y NINGUNA OTRA LISTA DE IDS SE ESCRIBE A MANO EN LA FEATURE.
//
// POR QUE ESTE ARCHIVO EXISTE, QUE ES LA PARTE QUE NO SE LEE SOLA.
//
// Ya hay un censo de ids en el repo: `listasDeIdsAMano`
// (`tests/unit/guards/tablero-financiero.guardia.test.ts`). NO SIRVE PARA EL R2, y no es una
// opinion: su propio codigo lo dice —«con dos o mas ya es una lista […] un id suelto (una
// comparacion, una clave de test) no cuenta»— y la ficha de la 183 lo declaro como DEUDA VIVA
// Y SIN DUENO. El ⟨L2⟩ de `specs/180-.../requirements.md` lo repite con todas las letras:
// «no des ese guardia por bueno para probar el R2».
//
// La razon es concreta. El R2 no persigue la lista REESCRITA (el catalogo copiado), que es lo
// que aquel censo caza; persigue la DECISION tomada fuera de la constante. Y una decision se
// toma perfectamente con UN SOLO id:
//
//     const esCaja = consulta.metrica.id === "egresos";     // pasa `listasDeIdsAMano`
//     const CON_SERIE = ["egresos"];                        // pasa `listasDeIdsAMano`
//
// Las dos violan el R2 y las dos quedarian verdes. Aqui CON UNO SOLO YA BASTA. La tecnica es
// la de `decisionesPorIdDeMetrica` (mismo archivo, el censo (f) de la 183), que SI caza el id
// suelto; lo que cambia es el universo censado: alli `app/`, aqui el BACKEND de la feature.
//
// EL ESPERADO SE ESCRIBE A MANO, mismo patron que `FORMA_ESPERADA` en
// `financiera-forma-importe.guardia.test.ts` y que el mapa de R43 en `financiera-contratos.test.ts`:
// derivar el esperado de la constante que se juzga convertiria el caso en una tautologia y
// quitar un id seguiria pareciendo correcto.
//
// LOS IDS DEL DETECTOR, EN CAMBIO, NO SE ESCRIBEN: salen de `IDS_FINANCIERAS_SERVIDAS`, que es
// la fuente unica que el censo defiende. Un id financiero nuevo entra en el censo solo.
//
// AUTOCOMPROBACION (patron de §R34 de `financiera-fuente.guardia.test.ts`): el detector se
// ejercita contra fixtures sinteticos en memoria —uno legitimo y varios infractores, incluido
// el array de UN SOLO id y la comparacion `=== "…"`—. Si dejara de discriminar, ESTE archivo se
// pone rojo aunque el repo siga limpio, en vez de quedarse verde por vacio para siempre.

const RAIZ = process.cwd();

/* -------------------------------------------------------------------------- */
/* 1. El esperado, escrito a mano (Q1 = (a), humano, 2026-08-05)               */
/* -------------------------------------------------------------------------- */

/**
 * Las SIETE del conjunto con desglose por fecha, escritas. Son las unicas que hoy no tienen
 * NINGUN cubo: las SEIS de caja (la ficha decia «cuatro»; desde la 173 son seis) mas la cuenta
 * de mensajeros.
 */
const ESPERADAS_CON_DESGLOSE: readonly string[] = [
  "ingreso_flete",
  "ingreso_comision_cod",
  "ingreso_iva",
  "egresos",
  "dinero_en_caja",
  "ganancia_ordenex",
  "cuenta_por_pagar_mensajero",
];

/**
 * Las TRES que quedan fuera, tambien escritas, y no por simetria decorativa: si el esperado solo
 * listara las de dentro, ampliar el conjunto con `cod_recaudado` fallaria por longitud y el
 * mensaje no diria cual sobra. `cod_recaudado` y `cuenta_por_pagar_tienda` YA tienen cubo (por
 * metodo y por tienda) y abrirles una vista nueva no lo ha pedido ninguna pantalla;
 * `conciliacion_cierres` ni siquiera produce importes por cubo.
 */
const ESPERADAS_FUERA: readonly string[] = [
  "cod_recaudado",
  "cuenta_por_pagar_tienda",
  "conciliacion_cierres",
];

/* -------------------------------------------------------------------------- */
/* 2. El universo censado: el BACKEND de la feature                            */
/* -------------------------------------------------------------------------- */

/**
 * LA UNICA EXCEPCION PERMITIDA, y queda escrita porque una excepcion que no se justifica se
 * convierte en la puerta por la que entra todo lo demas.
 *
 * `lib/types/analitica-financiera.ts` es donde viven las TRES constantes canonicas
 * (`IDS_FINANCIERAS_SERVIDAS`, `IDS_FINANCIERAS_ACUMULADAS`,
 * `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`). Es la fuente unica QUE ESTE CENSO DEFIENDE: si se
 * censara a si misma, el guardia prohibiria la propia declaracion que exige el R2. Todo lo
 * demas —servicio, repositorios, interfaces, modulo de cubos, Server Action— va a rojo con un
 * solo id entre comillas.
 */
const DECLARACION_CANONICA = "lib/types/analitica-financiera.ts";

/** Los ficheros sueltos del backend de la feature. */
const SUELTOS: readonly string[] = [
  "lib/services/AnaliticaFinancieraService.ts",
  "lib/interfaces/services/IAnaliticaFinancieraService.ts",
  "lib/analytics/cubo-temporal.ts",
  "lib/actions/analitica-financiera.ts",
];

/**
 * Los repositorios financieros y sus interfaces se RECORREN por sufijo en vez de escribirse uno
 * a uno: los cuatro de la 127 acaban en `AnaliticaRepository.ts` y los de la analitica operativa
 * no (`AnaliticaOperativaRollupRepository.ts`, `AnaliticaRollupRepository.ts`…). Asi un
 * repositorio financiero nuevo entra en el censo solo, que es la propiedad que un censo escrito
 * a mano pierde en el primer archivo que alguien anade.
 */
function porSufijo(dir: string, sufijo: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((n) => n.endsWith(sufijo))
    .map((n) => `${dir}/${n}`);
}

const RUTAS_CENSADAS: readonly string[] = [
  ...SUELTOS,
  ...porSufijo("lib/repositories", "AnaliticaRepository.ts"),
  ...porSufijo("lib/interfaces/repositories", "AnaliticaRepository.ts"),
]
  .filter((ruta) => ruta !== DECLARACION_CANONICA)
  .filter((ruta) => existsSync(path.join(RAIZ, ruta)));

/**
 * Misma decision (y mismas dos sustituciones) que `tablero-financiero.guardia.test.ts` y que
 * `modulo-puro.guardia.test.ts`: la documentacion de estos archivos esta OBLIGADA a nombrar los
 * ids —la cabecera de `IngresosAnaliticaRepository` enumera las cuatro metricas que sirve— y
 * censar el texto crudo convertiria el contrato escrito en una violacion.
 *
 * Los STRINGS no se ignoran: un id decidiendo algo vive precisamente dentro de comillas.
 */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

interface ArchivoCensado {
  readonly ruta: string;
  readonly codigo: string;
}

const CENSADOS: readonly ArchivoCensado[] = RUTAS_CENSADAS.map((ruta) => ({
  ruta,
  codigo: soloCodigo(readFileSync(path.join(RAIZ, ruta), "utf8")),
}));

/* -------------------------------------------------------------------------- */
/* 3. El detector                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Un id de metrica financiera escrito ENTRE COMILLAS en cualquiera de las cuatro formas en las
 * que un id decide algo. **CON UNO SOLO YA BASTA** — esa es toda la diferencia con
 * `listasDeIdsAMano`, que exige dos.
 *
 *   1. literal de array (`["egresos"]`), aunque sea de un elemento;
 *   2. comparacion, en cualquiera de los dos ordenes (`x === "egresos"`, `"egresos" === x`);
 *   3. rama de `switch` (`case "egresos":`);
 *   4. pertenencia (`.includes("egresos")`, `.startsWith(…)`, `.indexOf(…)`);
 *   5. ASIGNACION a un nombre (`const METRICA_CON_SERIE = "egresos";`). Es la forma que se
 *      escapaba de las cuatro anteriores: el `if` de mas abajo compara contra la CONSTANTE, no
 *      contra el literal, asi que la comparacion queda limpia y la decision por id suelto se
 *      cuela igual. Se exige un `=` que NO sea parte de `==`, `===`, `!=`, `<=` ni `>=`, para
 *      no volver a marcar la comparacion (que ya cae por la forma 2) dos veces.
 *
 * El literal se exige COMPLETO entre comillas (`["']id["']`), igual que en el censo (f) de la
 * 183: asi un id de VISTA —`"cod_recaudado__por_metodo"`— NO se marca, porque tras
 * `cod_recaudado` viene `_` y no la comilla de cierre. Decidir por el id de una VISTA es
 * legitimo y el servicio lo hace; decidir por el id de una METRICA es lo que el R2 prohibe.
 *
 * Lo que NO se marca, declarado como limite: un id como CLAVE de objeto SIN comillas, que es
 * como el despacho del servicio declara sus diez manejadores (`ingreso_flete: cajaSoloBruto`).
 * Ese mapa es la tabla de productores, no una decision tomada a un lado; y el R6 de la 127 ya lo
 * compara contra el catalogo por otro test.
 */
function decisionesPorIdDeMetrica(codigo: string): string[] {
  const limpio = soloCodigo(codigo);
  return IDS_FINANCIERAS_SERVIDAS.flatMap((id) => {
    const literal = `["'\`]${id}["'\`]`;
    const formas: readonly RegExp[] = [
      new RegExp(`\\[[^[\\]]*${literal}[^[\\]]*\\]`, "g"),
      new RegExp(`[=!]==?\\s*${literal}`, "g"),
      new RegExp(`${literal}\\s*[=!]==?`, "g"),
      new RegExp(`\\bcase\\s+${literal}\\s*:`, "g"),
      new RegExp(
        `\\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf)\\s*\\(\\s*${literal}`,
        "g",
      ),
      new RegExp(`[^=!<>]=\\s*${literal}`, "g"),
    ];
    return formas.flatMap((forma) =>
      (limpio.match(forma) ?? []).map((c) => `${id}: ${c.trim()}`),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* 4. R2 — la constante                                                        */
/* -------------------------------------------------------------------------- */

describe("R2 · el conjunto con desglose por fecha es UNA constante, con SIETE ids", () => {
  it("R2 · la constante contiene exactamente las siete esperadas, escritas a mano", () => {
    expect([...IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA]).toEqual(ESPERADAS_CON_DESGLOSE);
    expect(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA).toHaveLength(7);
  });

  it("R2 · es subconjunto ESTRICTO de IDS_FINANCIERAS_SERVIDAS", () => {
    const servidas = new Set<string>(IDS_FINANCIERAS_SERVIDAS);
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      expect(servidas.has(id), `${id} no es una metrica financiera servida`).toBe(true);
    }
    expect(
      IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.length,
      "el conjunto dejo de ser un SUBCONJUNTO ESTRICTO: cubre todas las servidas",
    ).toBeLessThan(IDS_FINANCIERAS_SERVIDAS.length);
  });

  it("R2 · cod_recaudado, cuenta_por_pagar_tienda y conciliacion_cierres quedan FUERA", () => {
    const dentro = new Set<string>(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA);
    for (const id of ESPERADAS_FUERA) {
      expect(
        dentro.has(id),
        `${id} entro en el conjunto con desglose: Q1 = (a) (2026-08-05) la deja fuera`,
      ).toBe(false);
    }
    // Y las diez quedan repartidas sin huecos: ninguna servida se queda sin clasificar.
    expect([...ESPERADAS_CON_DESGLOSE, ...ESPERADAS_FUERA].sort()).toEqual(
      [...IDS_FINANCIERAS_SERVIDAS].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R2 — el censo de texto sobre el backend de la feature                    */
/* -------------------------------------------------------------------------- */

describe("cobertura del censo · mira archivos de verdad", () => {
  it("censa el servicio, su contrato, los cuatro repositorios, sus interfaces y el Server Action", () => {
    for (const ruta of SUELTOS) {
      expect(RUTAS_CENSADAS, `${ruta} no esta en el censo`).toContain(ruta);
    }
    for (const nombre of [
      "IngresosAnaliticaRepository.ts",
      "RecaudoAnaliticaRepository.ts",
      "CuentasPorPagarAnaliticaRepository.ts",
      "ConciliacionCierresAnaliticaRepository.ts",
    ]) {
      expect(RUTAS_CENSADAS, `falta el repositorio ${nombre}`).toContain(
        `lib/repositories/${nombre}`,
      );
      expect(RUTAS_CENSADAS, `falta la interfaz de ${nombre}`).toContain(
        `lib/interfaces/repositories/I${nombre}`,
      );
    }
    expect(RUTAS_CENSADAS.length).toBeGreaterThanOrEqual(12);
  });

  it("la unica exclusion es la declaracion canonica, y esa exclusion es deliberada", () => {
    expect(RUTAS_CENSADAS).not.toContain(DECLARACION_CANONICA);
    // Contrapeso: si el archivo se moviera o se renombrara, la exclusion pasaria a no excluir
    // nada y este caso avisaria antes de que el censo se volviera incoherente.
    expect(existsSync(path.join(RAIZ, DECLARACION_CANONICA))).toBe(true);
    // Y ahi SI viven los ids entre comillas: es la fuente unica, no una infraccion.
    expect(
      decisionesPorIdDeMetrica(readFileSync(path.join(RAIZ, DECLARACION_CANONICA), "utf8")).length,
    ).toBeGreaterThan(0);
  });

  it("ningun archivo censado quedo vacio al retirar comentarios", () => {
    for (const { ruta, codigo } of CENSADOS) {
      expect(codigo.trim().length, `${ruta} quedo vacio: el censo no mira nada`).toBeGreaterThan(0);
    }
  });

  it("el dominio de ids no esta vacio: el detector no puede pasar por ciego", () => {
    expect(IDS_FINANCIERAS_SERVIDAS.length).toBe(10);
    expect(IDS_FINANCIERAS_SERVIDAS.every((id) => id.length > 0)).toBe(true);
  });
});

describe("R2 · ningun archivo del backend decide por un id de metrica financiera", () => {
  it("R2 · el censo no encuentra ni un id suelto entre comillas fuera de la declaracion", () => {
    const infractores = CENSADOS.flatMap(({ ruta, codigo }) =>
      decisionesPorIdDeMetrica(codigo).map((c) => `${ruta}: ${c}`),
    );
    expect(
      infractores,
      "escriben un id de metrica a mano: el conjunto con desglose es UNA constante (R2), y la granularidad sale del rango o de un literal por manejador, nunca de un `if` por id",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Autocomprobacion: el detector discrimina                                 */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion · el detector caza el id SUELTO, que es donde el otro guardia falla", () => {
  const [PRIMERO, SEGUNDO] = IDS_FINANCIERAS_SERVIDAS;

  it("marca las CINCO formas, incluido el array de UN SOLO id y la asignacion a un nombre", () => {
    const infractores = [
      // 1. array de un solo elemento — el caso exacto que `listasDeIdsAMano` deja pasar.
      `const CON_SERIE = ["${PRIMERO}"];`,
      `const CON_SERIE = ['${PRIMERO}'] as const;`,
      // 2. comparacion, en los dos ordenes.
      `const esCaja = consulta.metrica.id === "${PRIMERO}";`,
      `if (consulta.metrica.id !== '${PRIMERO}') return null;`,
      `if ("${PRIMERO}" === consulta.metrica.id) return null;`,
      // 3. rama de switch.
      `switch (id) { case "${PRIMERO}": return this.deCaja(c); }`,
      // 4. pertenencia.
      `if (CON_SERIE.includes("${PRIMERO}")) return trocear(c.rango);`,
      `if (id.startsWith("${PRIMERO}")) return null;`,
      `if (ids.indexOf("${PRIMERO}") >= 0) return null;`,
      // 5. asignacion a un nombre, con la comparacion ya limpia mas abajo.
      `const METRICA_CON_SERIE = "${PRIMERO}";`,
      `let elegida = '${PRIMERO}';`,
      `this.conSerie = "${PRIMERO}";`,
      // Y la lista de dos o mas, que el otro censo si veria: aqui tambien.
      `const IDS = ["${PRIMERO}", "${SEGUNDO}"];`,
    ];
    for (const caso of infractores) {
      expect(decisionesPorIdDeMetrica(caso), caso).not.toEqual([]);
    }
  });

  it("NO marca lo legitimo: la clave del despacho, el id de vista y la mencion en comentario", () => {
    const legitimos = [
      // El despacho del servicio: clave de objeto SIN comillas.
      `this.despacho = { ${PRIMERO}: cajaSoloBruto, egresos: cajaConNeto };`,
      // El id de una VISTA, que empieza por el id de una metrica y NO es el id de la metrica.
      'if (vista.id === "cod_recaudado__por_metodo") return <GraficaDonut />;',
      // Decidir por la FORMA del DTO o por el grano, que es lo que el repo hace hoy.
      'if (total.forma === "solo_bruto") return importeSoloBruto(bruto);',
      'granularidad: "no_temporal",',
      "granularidad: granularidadDe(consulta.rango),",
      // Recorrer o consultar la fuente unica no es decidir por un nombre.
      "return (IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA as readonly string[]).includes(metricaId);",
      "IDS_FINANCIERAS_SERVIDAS.map((id) => consultar(id));",
      // La mencion en un comentario sigue siendo obligatoria, no una violacion.
      `// las cuatro de caja son "${PRIMERO}", "${SEGUNDO}" y las otras dos`,
      `/* el conjunto NO se decide con id === "${PRIMERO}" (R2) */`,
    ];
    for (const caso of legitimos) {
      expect(decisionesPorIdDeMetrica(caso), caso).toEqual([]);
    }
  });

  it("y demuestra el agujero heredado: `listasDeIdsAMano` dejaria pasar el id suelto", () => {
    // No se importa el otro guardia (es un archivo de test); se reproduce su regla literal —
    // «presentes.length >= 2»— sobre el mismo fixture. El ⟨L2⟩ de la 180 pide DEMOSTRAR que
    // ese censo no cubre el R2, no afirmarlo. Si algun dia se endurece, este caso se pone rojo
    // y la deuda quedara cerrada con dueno.
    const reglaHeredada = (codigo: string): string[] =>
      (soloCodigo(codigo).match(/\[[^[\]]*\]/g) ?? []).filter(
        (bloque) =>
          IDS_FINANCIERAS_SERVIDAS.filter((id) => new RegExp(`["'\`]${id}["'\`]`).test(bloque))
            .length >= 2,
      );

    const idSuelto = `const CON_SERIE = ["${PRIMERO}"];`;
    const comparacion = `const esCaja = consulta.metrica.id === "${PRIMERO}";`;
    expect(reglaHeredada(idSuelto), "el censo heredado ya no deja pasar el id suelto").toEqual([]);
    expect(reglaHeredada(comparacion)).toEqual([]);
    // El de aqui SI los caza: esa es la razon de ser de este archivo.
    expect(decisionesPorIdDeMetrica(idSuelto)).not.toEqual([]);
    expect(decisionesPorIdDeMetrica(comparacion)).not.toEqual([]);
  });
});
