// Feature 184 — Tanda H (T H.1) — GUARDIA de cierre de la deuda de los doce listados.
// Cubre **R31** y **R32**, y solo puede existir con las tandas A–G dentro: hasta la G quedaban
// listados sin migrar y la mitad de R32 habría sido falsa.
//
// Qué cierra, y por qué hace falta una guardia y no basta con los dos censos:
//
//  - **R32** — la capa de pantallas no puede conservar NINGUNA llamada al adaptador que relee el
//    listado completo. Los dos censos lo vigilan **listado por listado**: cada uno de los trece
//    declara su adaptador y se comprueba que no usa el contrario. Eso deja un hueco: una pantalla
//    NUEVA —o una que no esté en el Anexo III— puede volver al adaptador viejo sin que ningún
//    censo la mire, porque los censos preguntan por los trece que conocen. Esta guardia pregunta
//    al revés: recorre `app/` ENTERO y exige cero llamadas, conozca o no la pantalla.
//  - **R31** — el censo no puede desactivarse. Un `it.skip` en `paginacion-transversal.test.tsx`
//    deja la suite verde y el censo mudo, y no hay nada en el repo que lo diga. Aquí se lee el
//    TEXTO de los dos censos y se exige que ninguna de sus afirmaciones esté apagada, pendiente,
//    ni reducida a menos casos de los que tiene.
//
// **Por qué el primer caso es un auto-test del detector, y no adorno.** El precedente de la casa:
// en la feature 172, el parser de un test de migración murió ante la mutación que ese test existía
// para cazar —corrían cero casos y el error apuntaba a otro sitio—; y en esta misma feature, la
// tanda F descubrió que siete corridas de mutación no habían arrancado por un `--reporter`
// inexistente y parecían ejecutadas. Una guardia estática cuyo detector se rompa pasa VERDE: no
// encuentra el patrón porque no encuentra nada. Por eso el detector se prueba contra un texto
// sintético con la respuesta conocida, en las dos direcciones (lo que debe ver y lo que debe
// ignorar), y por eso cada escaneo lleva su control positivo sobre el árbol real.
//
// La lectura es ESTÁTICA (lo que el archivo dice), como `cobertura-tablas.guardia.test.ts` y como
// los dos censos. La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin estar
// registrada en ninguna lista.
import { readFileSync, readdirSync } from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

/** El adaptador de la deuda: FAMILIA B paginada, que RELEE el listado sin recorte (R32). */
const ADAPTADOR_RELECTURA = "filasDelConjuntoCompleto";

/** El adaptador al que migraron los trece: FAMILIA A, con el tope en el servidor. */
const ADAPTADOR_DEDICADO = "filasDesdeResultado";

/**
 * Quita comentarios: en este repo la prosa nombra los adaptadores a propósito —cada pantalla
 * migrada explica en su comentario de qué relectura salía— y sin esto el escaneo leería esa prosa
 * como código. Es el mismo helper que usan los dos censos.
 */
function sinComentarios(fuente: string): string {
  return quitarComentarios(fuente);
}

/** `nombre(` como LLAMADA: no la casa un `import { nombre }` ni una mención suelta. */
function llamadaA(nombre: string): RegExp {
  return new RegExp(`\\b${nombre}\\s*\\(`);
}

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

interface Fuente {
  ruta: string;
  /** El archivo SIN comentarios: lo que el código dice, no lo que la prosa cuenta. */
  codigo: string;
}

function fuentesDe(...arboles: string[]): Fuente[] {
  return arboles
    .flatMap((arbol) => listarFuentes(path.join(RAIZ, arbol)))
    .sort()
    .map((archivo) => ({
      ruta: rutaRelativa(archivo),
      codigo: sinComentarios(readFileSync(archivo, "utf8")),
    }));
}

/** Los archivos de `arboles` que LLAMAN a `nombre`. */
function llamantes(nombre: string, ...arboles: string[]): string[] {
  const patron = llamadaA(nombre);
  return fuentesDe(...arboles)
    .filter((f) => patron.test(f.codigo))
    .map((f) => f.ruta);
}

// ---------------------------------------------------------------------------
// 0 — El detector, probado contra la respuesta conocida
// ---------------------------------------------------------------------------

describe("guardia del adaptador de conjunto — el detector", () => {
  it("el detector distingue una LLAMADA de una mención en prosa, en las dos direcciones", () => {
    // La mitad que impide el falso verde: el detector TIENE que ver la llamada.
    const conLlamada = sinComentarios(
      `const filas = () => ${ADAPTADOR_RELECTURA}(listarX(), filaX);`,
    );
    expect(
      llamadaA(ADAPTADOR_RELECTURA).test(conLlamada),
      "el detector no ve una llamada real: R32 pasaría verde con la deuda dentro",
    ).toBe(true);

    // La mitad que impide el falso rojo: la prosa de las pantallas migradas nombra el adaptador
    // viejo a propósito, y eso no es una llamada.
    const soloProsa = sinComentarios(
      [
        "/**",
        ` * Antes esto salía de ${ADAPTADOR_RELECTURA}(listarCompuesto(), filaX).`,
        " */",
        `// ${ADAPTADOR_RELECTURA}(otro(), filaY)`,
        "const filas = () => filasDesdeResultado(listarXCompleto(), filaX);",
      ].join("\n"),
    );
    expect(
      llamadaA(ADAPTADOR_RELECTURA).test(soloProsa),
      "el detector lee la prosa como código: la guardia sería un falso rojo permanente",
    ).toBe(false);
    // Y no se ha comido el código que sí había debajo del comentario.
    expect(llamadaA(ADAPTADOR_DEDICADO).test(soloProsa)).toBe(true);

    // Un `import { X }` tampoco es una llamada: si lo fuera, la guardia mediría el grafo de
    // imports en vez de el uso, y una pantalla podría importar sin llamar (o al revés).
    expect(
      llamadaA(ADAPTADOR_RELECTURA).test(`import { ${ADAPTADOR_RELECTURA} } from "@/x";`),
    ).toBe(false);
  });

  it("el recorrido del árbol lee archivos de verdad, y de los dos tipos", () => {
    // Sin esto, un glob mal escrito —o un `app/` que un día se mueva— deja los escaneos de abajo
    // sobre CERO archivos y todos sus `toEqual([])` pasan para siempre.
    const fuentes = fuentesDe("app");
    expect(fuentes.length, "el recorrido de app/ no encontró ningún archivo").toBeGreaterThan(100);
    expect(fuentes.some((f) => f.ruta.endsWith(".tsx"))).toBe(true);
    expect(fuentes.some((f) => f.ruta.endsWith(".ts"))).toBe(true);
    expect(fuentes.every((f) => f.codigo.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R32 — la capa de pantallas no conserva ninguna llamada al adaptador de relectura
// ---------------------------------------------------------------------------

describe("R32 — el adaptador de relectura no vuelve a la capa de pantallas", () => {
  it("no queda ninguna llamada al adaptador de relectura bajo app/", () => {
    expect(
      llamantes(ADAPTADOR_RELECTURA, "app", "components"),
      `alguna pantalla volvió a ${ADAPTADOR_RELECTURA}(: el archivo se produce releyendo el ` +
        "listado completo, que es la deuda que la feature 184 cerró (R32)",
    ).toEqual([]);
  });

  it("el adaptador de relectura ya no existe: no se puede llamar ni por descuido (T H.2)", () => {
    // La forma FUERTE de R32, y lo que la separa del caso de arriba: aquél dice «hoy nadie lo
    // llama», éste dice «no hay nada que llamar». Retirado el export, el modo de fallo que la
    // tanda G midió como el único superviviente —la MEDIA MIGRACIÓN: llamar a la acción nueva y
    // aun así evaluar el tope en el cliente, con lo que el aviso pierde el total y el tope
    // (MG3/MG11)— deja de ser posible por construcción.
    //
    // Se afirma sobre el módulo donde vivía, y no sobre «ningún archivo del repo lo exporta»,
    // porque lo segundo pasaría verde con el adaptador resucitado en otro archivo. El caso de
    // arriba cubre esa mitad: da igual dónde viva, ninguna pantalla puede llamarlo.
    const modulo = readFileSync(
      path.join(RAIZ, "components/shared/descarga-resultado.ts"),
      "utf8",
    );
    const codigo = sinComentarios(modulo);
    expect(
      codigo,
      `${ADAPTADOR_RELECTURA} volvió a exportarse: la media migración vuelve a ser posible`,
    ).not.toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${ADAPTADOR_RELECTURA}\\b`));

    // CONTROL POSITIVO, en el mismo archivo: los DOS adaptadores que sí se conservan siguen
    // exportados. Sin esto, borrar el módulo entero —o renombrarlo— dejaría este caso verde y
    // las 26 tablas sin adaptador común, que es lo contrario de lo que se pretende.
    for (const vivo of [ADAPTADOR_DEDICADO, "filasLocales"]) {
      expect(codigo, `${vivo} desapareció del módulo de adaptadores`).toMatch(
        new RegExp(`export\\s+async\\s+function\\s+${vivo}\\b`),
      );
    }
    // Y la prosa que explica la retirada sigue ahí: es lo único que le dice al próximo lector
    // por qué el módulo tiene dos familias y media, y qué pasó con la tercera.
    expect(modulo, "se perdió el motivo escrito de la retirada").toContain("T H.2");
  });

  it("CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador al que migraron los trece", () => {
    // La anti-vacuidad del caso de arriba. «Cero llamadas» lo cumple igual un escaneo que no mira
    // nada; lo que lo hace una afirmación es que el MISMO recorrido, con el MISMO detector, saque
    // una lista larga y concreta cuando se le pregunta por el adaptador que sí se usa.
    const conDedicado = llamantes(ADAPTADOR_DEDICADO, "app");
    expect(
      conDedicado.length,
      "el escaneo no ve ni las pantallas que SÍ usan el adaptador dedicado: está roto",
    ).toBeGreaterThanOrEqual(13); // los trece del Anexo III, como mínimo

    // Y en un archivo concreto, para que la cifra no sea el único testigo: la última pantalla que
    // migró (tanda G) y la primera (tanda A).
    expect(conDedicado).toContain("app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx");
    expect(conDedicado).toContain(
      "app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx",
    );
  });
});

// ---------------------------------------------------------------------------
// R32 (segunda mitad) — las relecturas que se quedaron sin consumidor
// ---------------------------------------------------------------------------

/**
 * Los listados COMPUESTOS de los que salían los archivos antes de esta feature. Ocho quedaron
 * reducidos; **tres llegaron a CERO consumidores de producción** y esos tres son los de aquí.
 *
 * Se CONSERVAN (tanda H, decisión escrita en `progress/impl_184_tandaH.md`): son el testigo de
 * anti-vacuidad de los casos de R1 de sus tandas —la relectura se ejecuta y se cuenta lo que lee,
 * que es lo único que demuestra que la dedicada lee menos— y el doble VIVO con el que los tests
 * de descarga prueban que no llamarla es una decisión de la pantalla y no un mock muerto.
 *
 * Lo que esta guardia añade es lo que convierte «conservar» en una decisión y no en un olvido:
 * **conservarlas no las devuelve a la capa de pantallas.** Si mañana alguien vuelve a cablear una
 * descarga —o cualquier otra cosa— a una de las tres, este caso lo dice.
 */
const RELECTURAS_SIN_CONSUMIDOR = [
  {
    // Tanda E. Único de los ocho que llegó a cero por su cuenta: la T M.1 de la 170 ya lo había
    // sacado del render de `cierres-admin/page.tsx`, y E.3 se llevó sus dos últimas llamadas.
    nombre: "listarCierresBodegaAdmin",
    dedicadas: ["listarPendientesCierresBodegaCompleto", "listarHistoricoCierresBodegaCompleto"],
  },
  {
    // Tanda G. El panel de plantillas era su único lector.
    nombre: "listarPlantillasAction",
    dedicadas: ["listarPlantillasCompletoAction"],
  },
  {
    // Tanda G. La tabla de saldos era su única lectora, y su relectura salía SIN ORDENAR.
    nombre: "listarSaldosTiendasAction",
    dedicadas: ["listarSaldosTiendasCompletoAction"],
  },
] as const;

describe("R32 — las relecturas sin consumidor no vuelven a la capa de pantallas", () => {
  it("las tres relecturas que llegaron a cero consumidores siguen en cero", () => {
    for (const { nombre } of RELECTURAS_SIN_CONSUMIDOR) {
      expect(
        llamantes(nombre, "app"),
        `${nombre}() volvió a la capa de pantallas: es la relectura compuesta que la feature ` +
          "184 desconectó, y sus sustitutas dedicadas ya existen",
      ).toEqual([]);
    }
  });

  it("CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman", () => {
    // Sin esta mitad, el caso de arriba lo cumpliría igual un árbol en el que nadie descargara
    // nada. Lo que se afirma es el reemplazo, no la ausencia: por cada relectura apagada hay al
    // menos una pantalla llamando a la lectura dedicada que ocupó su sitio.
    for (const { nombre, dedicadas } of RELECTURAS_SIN_CONSUMIDOR) {
      for (const dedicada of dedicadas) {
        expect(
          llamantes(dedicada, "app"),
          `${dedicada}() no la llama ninguna pantalla: entonces «${nombre} está en cero» no ` +
            "dice que se sustituyó, dice que se perdió",
        ).not.toEqual([]);
      }
    }
  });

  it("`listarIncidentes` NO está en esa lista, y su consumidor sigue vivo", () => {
    // El aviso que la tanda F dejó por escrito, hecho ejecutable. `listarIncidentes` perdió DOS
    // de sus tres consumidores en F.3 —las dos descargas— pero conserva el tercero:
    // `app/(app)/incidentes/page.tsx` lo llama para el guard de la pantalla y para el booleano
    // `sinZona`, que no viaja por ninguna otra vía. **No cae por analogía con la tanda E.**
    //
    // Que la deuda anotada por la tanda F —leer el alcance ENTERO para obtener un booleano—
    // siga abierta está escrito en `progress/impl_184_tandaH.md` con su motivo. Este caso es lo
    // que impide cerrarla en silencio: quien rehaga esa lectura tiene que venir aquí y decidir
    // qué pasa con `listarIncidentes`, en vez de encontrársela sin consumidores y borrarla.
    expect(RELECTURAS_SIN_CONSUMIDOR.map((r) => r.nombre)).not.toContain("listarIncidentes");
    expect(
      llamantes("listarIncidentes", "app"),
      "listarIncidentes() perdió su último consumidor: decidir qué pasa con ella es una tarea, " +
        "no un descubrimiento — su caso de R1 la ejecuta como anti-vacuidad",
    ).toEqual(["app/(app)/incidentes/page.tsx"]);
  });
});

// ---------------------------------------------------------------------------
// R31 — el censo no se desactiva, no se deja pendiente y no se relaja
// ---------------------------------------------------------------------------

/**
 * Las formas de apagar un caso en vitest. `.only` entra a propósito: no apaga el caso que marca,
 * apaga TODOS LOS DEMÁS del archivo —incluido el censo— y deja la suite verde.
 * `.skipIf`/`.runIf` también: un censo que solo corre bajo una condición es un censo que puede no
 * correr, y la tanda F ya midió lo que cuesta confundir «no corrió» con «pasó».
 */
const MARCAS_DESACTIVACION =
  /\b(?:it|test|describe|suite)\s*\.\s*(?:skip|todo|only|skipIf|runIf|concurrent\s*\.\s*skip)\s*\(|\bx(?:it|describe)\s*\(/;

/**
 * Los DOS censos de adaptador de esta feature, con lo que cada uno tiene que seguir diciendo.
 *
 * `casos` es un MÍNIMO, no una igualdad: añadir casos a un censo no puede ponerlo rojo; quitarlos,
 * sí. Los números son los que el árbol tiene hoy, leídos del archivo y no de ningún documento.
 */
const CENSOS = [
  {
    ruta: "tests/components/paginacion/paginacion-transversal.test.tsx",
    que: "el censo transversal de los TRECE listados paginados (R29/R30)",
    anclas: ["ANEXO_III", "PENDIENTES_184", "ANEXO_IV"],
    casos: 9,
  },
  {
    ruta: "tests/components/descarga/WalletPropsDescarga.test.tsx",
    que: "el segundo censo, el de los tres módulos de wallet",
    anclas: ["SaldosTiendasTable", "GastosFijosPlantillasPanel", "CuentasPorPagarTable"],
    casos: 12,
  },
] as const;

describe("R31 — los dos censos de adaptador siguen encendidos", () => {
  it("el detector de casos apagados reconoce las formas de apagarlos, y solo esas", () => {
    // Mismo motivo que el auto-test del detector de llamadas: una regex rota no encuentra
    // `.skip` y la guardia pasa verde justo cuando el censo está mudo.
    for (const apagado of [
      "it.skip('x', () => {})",
      "it.todo('x')",
      "describe.skip('x', () => {})",
      "describe.todo('x')",
      "test.skip('x', () => {})",
      "it.only('x', () => {})",
      "it.skipIf(process.env.CI)('x', () => {})",
      "xit('x', () => {})",
      "xdescribe('x', () => {})",
      "it .skip ('x', () => {})",
    ]) {
      expect(MARCAS_DESACTIVACION.test(apagado), `no reconoce: ${apagado}`).toBe(true);
    }
    for (const encendido of [
      "it('x', () => {})",
      "describe('x', () => {})",
      "expect(fuente).not.toMatch(/skip/)",
      "const skipped = false;",
      "// it.skip quedó fuera",
    ]) {
      expect(MARCAS_DESACTIVACION.test(sinComentarios(encendido)), `falso rojo: ${encendido}`).toBe(
        false,
      );
    }
  });

  it("los dos censos de adaptador no tienen casos deshabilitados ni pendientes", () => {
    for (const censo of CENSOS) {
      const bruto = readFileSync(path.join(RAIZ, censo.ruta), "utf8");
      const codigo = sinComentarios(bruto);

      // (a) Ninguna afirmación apagada, pendiente o condicionada.
      const apagados = codigo
        .split("\n")
        .map((linea, i) => ({ linea: linea.trim(), n: i + 1 }))
        .filter(({ linea }) => MARCAS_DESACTIVACION.test(linea))
        .map(({ linea, n }) => `${censo.ruta}:${n} ${linea}`);
      expect(apagados, `${censo.que}: hay casos apagados, pendientes o condicionados`).toEqual([]);

      // (b) El censo sigue siendo ese censo: sus anclas están. Un archivo renombrado o vaciado
      //     pasaría (a) sin decir nada, y esta guardia habría dejado de vigilar en silencio.
      for (const ancla of censo.anclas) {
        expect(codigo, `${censo.que}: perdió su ancla \`${ancla}\``).toContain(ancla);
      }

      // (c) Y no se relaja a menos casos de los que tiene. Es la tercera forma que R31 nombra
      //     —«sustituyendo una afirmación por otra más débil»— en su versión medible: borrar el
      //     caso es la forma más simple de debilitarlo, y no la cazan ni (a) ni (b).
      const casos = codigo.match(/\bit\s*\(/g)?.length ?? 0;
      expect(
        casos,
        `${censo.que}: tenía ${censo.casos} casos y ahora tiene ${casos}`,
      ).toBeGreaterThanOrEqual(censo.casos);
    }
  });

  it("los dos censos conservan la MITAD NEGATIVA: el adaptador declarado es el ÚNICO que se usa", () => {
    // La forma de relajar un censo sin apagar ni borrar nada: quitarle la mitad negativa que T0.2
    // añadió. Con solo la positiva, una pantalla migrada a medias —que llamara a los dos
    // adaptadores— pasa verde con cualquiera de las dos declaraciones, y el censo deja de decir
    // en qué estado está cada listado. La tanda G midió que ése es justamente el modo de fallo
    // que sobrevive (MG3/MG11, «media migración»).
    for (const censo of CENSOS) {
      const codigo = sinComentarios(readFileSync(path.join(RAIZ, censo.ruta), "utf8"));
      expect(codigo, `${censo.que}: perdió el mapa de adaptador CONTRARIO`).toContain("CONTRARIO");
      expect(
        codigo,
        `${censo.que}: ya no afirma que el adaptador contrario NO aparece`,
      ).toMatch(/\.not\s*\.\s*toMatch\(\s*ADAPTADOR\[/);
    }
  });
});
