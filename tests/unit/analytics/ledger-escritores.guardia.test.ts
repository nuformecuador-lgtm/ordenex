import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ARCHIVOS_ESCRITORES,
  ESCRITORES_DE_LEDGER,
  REPOSITORIOS_DE_LEDGER,
  type EscritorDeLedger,
} from "@/lib/analytics/escritores-ledger";

// Feature 179 / T4.2 — EL CENSO DE ESCRITORES DE LEDGER (R17, R18, R19).
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**: censa CONTENIDO del arbol, no el diff contra `dev`. No
// caduca, no juzga ramas ajenas y no hay que acordarse de retirarlo.
//
// ─── ES EL HEREDERO DE D2 DE LA 128, Y ESO NO ES UNA METAFORA ────────────────────────────────
//
// La 128 cacheo el dominio `operativa` y dejo el dinero FUERA a proposito, con un guardia vivo
// que lo prohibia (`tests/unit/analytics/cache-financiera.guardia.test.ts`). El motivo escrito
// alli era exacto: cachear dinero solo es aceptable si TODOS los escritores de los tres ledgers
// invalidan, no cuatro de cinco. Este archivo es lo que ocupa su sitio: aquel guardia impedia
// cachear; este obliga a invalidar. **Retirar aquel sin poner este deja el agujero abierto y en
// silencio, y por eso R19 comprueba las dos cosas a la vez** (ultimo bloque).
//
// ─── POR QUE UN CENSO DEL ARBOL Y NO UNA LISTA EN PROSA ──────────────────────────────────────
//
// La ficha de esta feature traia CINCO escritores. El arbol tiene OCHO. **La lista ya estaba
// desactualizada antes de que nadie escribiera codigo** — y no por descuido: una lista de rutas
// en prosa no la actualiza nadie cuando aparece un servicio nuevo. Lo que le faltaba era, entre
// otros, `WalletService.registrarMovimientoManual`, que mueve `egresos`, `dinero_en_caja` y
// `ganancia_ordenex`.
//
// Un servicio nuevo que mueva dinero aparece en el eje 2 el dia que se escribe y pone esto rojo
// con un mensaje que dice que hacer. **No hace falta que nadie se acuerde de esta feature.**

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

/** El ambito del censo: donde puede vivir un escritor de dinero. Los tests quedan fuera. */
const AMBITO = ["lib", "app", "scripts"];

/** Las tres tablas de ledger que alimentan el tablero financiero. */
const TABLAS = ["walletMovimiento", "walletTiendaMovimiento", "pagoMensajeroMovimiento"];

const ESCRITURA_CRUDA = new RegExp(
  `\\.(?:${TABLAS.join("|")})\\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\\s*\\(`,
);

/** Una LLAMADA a `crearMovimientos`, no su declaracion: exige receptor (`algo.crearMovimientos(`). */
const LLAMA_CREAR_MOVIMIENTOS = /\.\s*crearMovimientos\s*\(/;

function archivos(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      salida.push(...archivos(rel));
    } else if (EXT.has(path.extname(e.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

/**
 * Se censa SOLO EL CODIGO: los comentarios se retiran antes de buscar. Misma decision (y mismas
 * dos funciones) que `cache-aislamiento.guardia.test.ts` y `modulo-puro.guardia.test.ts`, y por
 * la misma razon: `escritores-ledger.ts` esta OBLIGADO a nombrar `.crearMovimientos(` en su
 * cabecera para explicar que censa. Nombrar la trampa es obligatorio; usarla es lo prohibido.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function leer(rel: string): string {
  return soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

const TODOS = AMBITO.flatMap((d) => archivos(d));
const QUE_HACER =
  "Un escritor de ledger sin invalidador sirve DINERO RANCIO en silencio: nada falla y la cifra " +
  "se queda quieta hasta que expire el TTL (una hora). Si has anadido una pieza que llama a " +
  "`crearMovimientos`, declarala en `lib/analytics/escritores-ledger.ts` con su invalidador, su " +
  "origen y el archivo de test de cinco pasos que lo cubre (design.md §5.2 de la feature 179). " +
  "Si has retirado una, borra su entrada.";

describe("R17 · eje 1: la escritura cruda de los tres ledgers vive SOLO en sus repositorios", () => {
  it("ningun archivo de `lib/`, `app/` ni `scripts/` escribe las tres tablas por Prisma", () => {
    const infractores = TODOS.filter(
      (rel) => !REPOSITORIOS_DE_LEDGER.includes(rel) && ESCRITURA_CRUDA.test(leer(rel)),
    );

    expect(
      infractores,
      "hay una escritura CRUDA de un ledger fuera de los tres repositorios. Eso rompe la unica " +
        "frontera que hace posible el censo del eje 2: la lista de llamadores de " +
        "`crearMovimientos` dejaria de ser la lista de quien mueve dinero. Archivos: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("los tres repositorios SI escriben (si no, este eje seria verde por vacio)", () => {
    for (const repo of REPOSITORIOS_DE_LEDGER) {
      expect(ESCRITURA_CRUDA.test(leer(repo)), repo).toBe(true);
    }
    expect(TODOS.length).toBeGreaterThan(300);
  });
});

describe("R17 · eje 2: los llamadores de `crearMovimientos` cuadran con el registro, EN LAS DOS DIRECCIONES", () => {
  const llamadores = TODOS.filter((rel) => LLAMA_CREAR_MOVIMIENTOS.test(leer(rel))).sort();

  it("todo escritor del arbol tiene invalidador declarado (por DEFECTO)", () => {
    const sinRegistrar = llamadores.filter((rel) => !ARCHIVOS_ESCRITORES.includes(rel));

    expect(
      sinRegistrar,
      `hay escritores de ledger que NO estan en el registro. ${QUE_HACER} Archivos: ` +
        sinRegistrar.join(", "),
    ).toEqual([]);
  });

  it("toda entrada del registro corresponde a un llamador que existe (por EXCESO)", () => {
    const muertas = ARCHIVOS_ESCRITORES.filter((rel) => !llamadores.includes(rel));

    expect(
      muertas,
      "hay entradas en el registro cuyo escritor ya no llama a `crearMovimientos`. Un registro " +
        "que acumula muertos deja de poder leerse como el censo de quien mueve dinero. " +
        "Entradas: " + muertas.join(", "),
    ).toEqual([]);
  });

  it("y son los OCHO de `requirements.md §0.a`, ni uno menos", () => {
    // El numero esta escrito a proposito: la ficha decia cinco. Si manana son nueve, este caso
    // obliga a mirar el censo en vez de dejar que el conteo cambie sin que nadie se entere.
    expect(llamadores).toHaveLength(8);
    expect([...ARCHIVOS_ESCRITORES].sort()).toEqual(llamadores);
  });
});

describe("R17 · el censo DISCRIMINA: no es verde por construccion", () => {
  it("un escritor nuevo sin registrar caeria por el eje 2", () => {
    const fragmento = `
      export class ServicioNuevoQueMueveDinero {
        async pagar(tx: unknown) {
          await this.walletRepo.crearMovimientos(tx, []);
        }
      }`;
    expect(LLAMA_CREAR_MOVIMIENTOS.test(soloCodigo(fragmento))).toBe(true);
    expect(ARCHIVOS_ESCRITORES).not.toContain("lib/services/ServicioNuevoQueMueveDinero.ts");
  });

  it("una escritura cruda desde un servicio caeria por el eje 1", () => {
    const fragmento = `await tx.walletMovimiento.createMany({ data: filas, skipDuplicates: true });`;
    expect(ESCRITURA_CRUDA.test(soloCodigo(fragmento))).toBe(true);
  });

  it("pero una MENCION EN PROSA no cae: se censa el codigo, no el texto", () => {
    const prosa = `// algun dia esto llamara a .crearMovimientos( y hara tx.walletMovimiento.createMany(`;
    expect(LLAMA_CREAR_MOVIMIENTOS.test(soloCodigo(prosa))).toBe(false);
    expect(ESCRITURA_CRUDA.test(soloCodigo(prosa))).toBe(false);
  });

  it("y la DECLARACION del metodo en el repositorio no cuenta como llamada", () => {
    const declaracion = `  async crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]) { return 0; }`;
    expect(LLAMA_CREAR_MOVIMIENTOS.test(soloCodigo(declaracion))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R17 — EL REGISTRO SE CRUZA CONTRA EL ARBOL                                   */
/* -------------------------------------------------------------------------- */
//
// ═══ LO QUE ESTE BLOQUE MIDE, DICHO SIN INFLAR ══════════════════════════════════════════════
//
// Para cada entrada del registro, que **en la cadena de ESE escritor exista escrita la llamada
// de invalidacion y el literal de SU origen**, y que ese origen no sea el de ningun otro. Es
// una comprobacion TEXTUAL sobre el codigo (sin comentarios) de archivos que tienen que
// pertenecer a esa cadena.
//
// **NO demuestra que la invalidacion se EJECUTE.** Un guardia estatico no puede juzgar
// alcanzabilidad sin un parser de flujo. Verificado por el reviewer (sondeo P2, 2026-08-10):
// meter la llamada real dentro de una rama muerta —`if (NUNCA) { await invalidar... }`— deja
// esto verde. Se acepta como limite y no como agujero por dos motivos: exige escribir codigo
// muerto A PROPOSITO, que es sabotaje visible en cualquier revision; y quien de verdad mide la
// EJECUCION son los tests de cinco pasos de cada escritor, que afirman sobre la cifra servida
// (`cache-financiera-escritor-*.test.ts`, y R18 obliga a que cada entrada nombre el suyo).
// **Este bloque no los sustituye: les impide quedarse huerfanos.**
//
// El bloque se llamaba «el registro DEMUESTRA su invalidador» y eso prometia mas de lo que
// comprueba. Se renombro el 2026-08-10 (B2 del review): un guardia que promete de mas es peor
// que uno modesto, porque el siguiente que lo lea deja de mirar lo que cree cubierto.
//
// ═══ POR QUE EXISTE, CON SUS DOS SONDEOS ════════════════════════════════════════════════════
//
// **RONDA 1 (P1) — bastaba con NO RELLENAR.** El reviewer creo un noveno escritor sintetico que
// llamaba a `crearMovimientos` y no invalidaba nada; el censo lo cazo (eje 2 «por DEFECTO» + el
// conteo). Entonces lo REGISTRO con `invalidadores: []`, `requisitos: []`, `invalidaEn: []` y un
// `tests:` ajeno, y subio los conteos de 8 a 9 —lo que el propio mensaje de fallo le pedia—:
// **22 tests, verde entero**. Tres puertas: `invalidadores` y `requisitos` no se comprobaban ni
// no-vacios, y como el chequeo de titulos de R18 ITERA sobre `requisitos`, con la lista vacia
// **R18 se volvia vacuo**; `invalidaEn` no lo leia nadie.
//
// **RONDA 2 (P3) — bastaba con RELLENAR CON LO DEL VECINO.** Con las comprobaciones de la ronda
// 1 puestas, el reviewer copio la entrada de al lado y le cambio solo el `archivo`:
// `invalidaEn` y `origen` de `WalletEgresoService`, `tests` de `WalletEgresoService`. **41
// tests, verde entero.** El criterio era textual y no exigia que quien invalida fuera EL
// escritor. Y no es rebuscado: copiar la fila de al lado es exactamente como se anade una fila a
// una tabla asi.
//
// Lo que cierra P3, y por que son dos cosas y no una:
//
//   · **Unicidad del origen.** Cada `OrigenInvalidacion` pertenece a EXACTAMENTE una entrada. Es
//     lo que R24 pide con todas las letras —«un origen por escritor», «la unica senal que
//     distingue cual invalidador no llego»— y no lo medía nadie. Dos entradas con el mismo
//     origen convierten esa senal en ruido: se sabria que alguien invalido, no CUAL no lo hizo.
//   · **Pertenencia a la cadena.** Al menos un archivo de `invalidaEn` tiene que ser el propio
//     `archivo` del escritor o NOMBRARLO (su servicio, su decorador, su composition root). Sin
//     esto, `invalidaEn` podia apuntar a cualquier sitio del arbol donde por casualidad
//     estuvieran las dos cadenas de texto.
//
// La validacion vive en una funcion PURA (`problemasDe`) para poder ejercerla sobre entradas
// SINTETICAS sin tocar el registro real: asi los casos de discriminacion de abajo demuestran que
// P1 y P3 ya no pasan, sin que nadie tenga que volver a mutar el arbol.

/** Marca de que un archivo ENCOLA el job de invalidacion en vez de llamar al invalidador. */
const ENCOLA_JOB = /\.enqueue\s*\(/;
/** La llamada al unico punto de invalidacion directa (`design.md §5.1`). */
const LLAMA_INVALIDADOR = /invalidarAnaliticaFinanciera\s*\(/;

/** Codigo de un archivo de `invalidaEn`, o `null` si la ruta no existe en disco. */
function codigoDe(rel: string): string | null {
  const abs = path.join(REPO_ROOT, rel);
  return fs.existsSync(abs) ? soloCodigo(fs.readFileSync(abs, "utf8")) : null;
}

/** El nombre del modulo de un escritor: `lib/services/WalletService.ts` -> `WalletService`. */
function nombreDe(archivo: string): string {
  return path.basename(archivo).replace(/\.tsx?$/, "");
}

/**
 * ¿`rel` pertenece a la cadena de `escritor`? Lo es su propio archivo, o cualquiera que lo
 * NOMBRE: su servicio, su decorador o su composition root lo mencionan por fuerza (aunque sea a
 * traves de su interfaz — `ILiquidacionService` contiene `LiquidacionService`).
 */
function esDeLaCadena(rel: string, escritor: EscritorDeLedger): boolean {
  if (rel === escritor.archivo) return true;
  return (codigoDe(rel) ?? "").includes(nombreDe(escritor.archivo));
}

/**
 * TODOS los problemas de una entrada del registro. Devuelve una lista (no lanza) para que el
 * mensaje de fallo los enumere de golpe y para poder ejercerla sobre entradas sinteticas.
 */
function problemasDe(
  escritor: EscritorDeLedger,
  registro: readonly EscritorDeLedger[] = ESCRITORES_DE_LEDGER,
): string[] {
  const p: string[] = [];
  const donde = escritor.archivo;

  if (escritor.invalidadores.length === 0) {
    p.push(
      `${donde}: \`invalidadores\` VACIO. Un escritor de dinero registrado sin invalidador es ` +
        "exactamente el auto-engaño que R18 existe para impedir: el registro seria una promesa.",
    );
  }
  if (escritor.requisitos.length === 0) {
    p.push(
      `${donde}: \`requisitos\` VACIO. No es contabilidad: el chequeo de titulos de R18 ITERA ` +
        "sobre esta lista, asi que dejarla vacia deja R18 sin nada que comprobar.",
    );
  }
  if (escritor.invalidaEn.length === 0) {
    p.push(`${donde}: \`invalidaEn\` VACIO. Nadie puede comprobar donde invalida.`);
  }
  for (const rel of escritor.invalidaEn) {
    if (codigoDe(rel) === null) {
      p.push(`${donde}: \`invalidaEn\` nombra un archivo que NO existe en disco: ${rel}`);
    }
  }

  // B2 (P3) — PERTENENCIA A LA CADENA. Sin esto, `invalidaEn` podia apuntar a cualquier sitio
  // del arbol: copiar la entrada del vecino y cambiarle el `archivo` pasaba en verde, porque las
  // dos cadenas de texto que se buscaban estaban ahi... en el archivo de OTRO escritor.
  if (escritor.invalidaEn.length > 0 && !escritor.invalidaEn.some((rel) => esDeLaCadena(rel, escritor))) {
    p.push(
      `${donde}: ningun archivo de \`invalidaEn\` (${escritor.invalidaEn.join(", ")}) pertenece a ` +
        `la cadena de este escritor. Se espera su propio archivo, o uno que nombre a ` +
        `\`${nombreDe(donde)}\` —su servicio, su decorador o su composition root—. Apuntar al ` +
        "archivo de otro escritor hace que este quede registrado sin invalidar nada suyo.",
    );
  }

  const fuentes = escritor.invalidaEn
    .map((rel) => [rel, codigoDe(rel)] as const)
    .filter((par): par is readonly [string, string] => par[1] !== null);

  for (const inv of escritor.invalidadores) {
    if (inv.clase === "por_su_llamador") {
      // «No invalida por su cuenta» solo vale si quien lo llama SI invalida. Se exige que cada
      // llamador declarado sea a su vez un escritor registrado: si no, la cadena se corta y el
      // dinero de esta pieza se queda sin nadie que lo anuncie.
      if (inv.llamadores.length === 0) {
        p.push(`${donde}: \`por_su_llamador\` sin llamadores. Eso es «no invalida» a secas.`);
      }
      for (const llamador of inv.llamadores) {
        if (codigoDe(llamador) === null) {
          p.push(`${donde}: declara un llamador que no existe en disco: ${llamador}`);
        } else if (!ARCHIVOS_ESCRITORES.includes(llamador)) {
          p.push(
            `${donde}: delega en ${llamador}, que NO esta registrado como escritor. La cadena ` +
              "se corta ahi y su dinero se queda sin invalidador.",
          );
        }
      }
      continue;
    }

    // B2 (P3) — UNICIDAD DEL ORIGEN. R24, con todas las letras: «un origen por escritor», porque
    // es «la unica senal que distingue "la cifra no cambio porque no hubo movimiento" de "la
    // cifra no cambio porque el invalidador de los cierres de bodega no llego"». Dos entradas
    // con el mismo origen convierten esa senal en ruido, y es lo que P3 explotaba.
    const duenosAjenos = registro
      .filter((otro) => otro.archivo !== escritor.archivo)
      .filter((otro) =>
        otro.invalidadores.some((i) => i.clase !== "por_su_llamador" && i.origen === inv.origen),
      )
      .map((otro) => otro.archivo);
    if (duenosAjenos.length > 0) {
      p.push(
        `${donde}: declara el origen "${inv.origen}", que YA pertenece a ${duenosAjenos.join(", ")}. ` +
          "R24 exige un origen por escritor: es la unica senal que dice CUAL invalidador no " +
          "llego. Compartirlo la apaga. Si este escritor es nuevo, dale su propio valor en " +
          "`OrigenInvalidacion` (`lib/interfaces/external/IAnaliticaCache.ts`).",
      );
    }

    const origen = `"${inv.origen}"`;
    const conOrigen = fuentes.filter(([, src]) => src.includes(origen));
    if (conOrigen.length === 0) {
      p.push(
        `${donde}: ningun archivo de \`invalidaEn\` (${escritor.invalidaEn.join(", ")}) contiene ` +
          `el literal de su origen ${origen}. Declarar un origen que nadie emite hace que el ` +
          "registro de R24 no pueda decir CUAL invalidador no llego.",
      );
    }

    if (inv.clase === "directo" || inv.clase === "por_decorador") {
      const conLlamada = fuentes.filter(([, src]) => LLAMA_INVALIDADOR.test(src));
      if (conLlamada.length === 0) {
        p.push(
          `${donde}: declara invalidacion \`${inv.clase}\` pero ninguno de sus archivos llama a ` +
            "`invalidarAnaliticaFinanciera(`. Esto es lo que separa «esta registrado» de " +
            "«invalida de verdad».",
        );
      }
    }

    if (inv.clase === "por_job") {
      const conEncolado = fuentes.filter(([, src]) => ENCOLA_JOB.test(src));
      if (conEncolado.length === 0) {
        p.push(
          `${donde}: declara invalidacion \`por_job\` pero ninguno de sus archivos encola nada. ` +
            "El unico escritor que corre FUERA de un request no puede llamar a `revalidateTag` " +
            "(lanza): si no encola, no invalida nunca.",
        );
      }
      if (fuentes.some(([, src]) => LLAMA_INVALIDADOR.test(src))) {
        p.push(
          `${donde}: un escritor \`por_job\` NO debe llamar a \`invalidarAnaliticaFinanciera\`. ` +
            "Esa funcion no propaga (D4) y aqui el llamador es un job idempotente con backoff, " +
            "donde R11 de la 128 sigue aplicando: una invalidacion fallida DEBE hacerlo fallar.",
        );
      }
    }
  }

  return p;
}

/**
 * Una entrada real, BUSCADA POR SU ARCHIVO y no por su indice. Los casos de discriminacion que
 * parten de una entrada real no pueden depender del orden del array: durante el sondeo P3 —que
 * inserta una entrada al principio— dos de ellos se ponian rojos por el desplazamiento y no por
 * lo que median, y eso convierte el ruido del sondeo en ruido del guardia.
 */
function entradaDe(archivo: string): EscritorDeLedger {
  const e = ESCRITORES_DE_LEDGER.find((x) => x.archivo === archivo);
  if (e === undefined) throw new Error(`el registro no tiene entrada para ${archivo}`);
  return e;
}

describe("R17 · en la cadena de cada escritor esta escrita SU invalidacion y SU origen", () => {
  it.each(ESCRITORES_DE_LEDGER.map((e) => [e.archivo, e] as const))(
    "%s",
    (_archivo, escritor) => {
      expect(problemasDe(escritor).join("\n"), QUE_HACER).toBe("");
    },
  );

  it("DISCRIMINA (P1): registrarse con los campos VACIOS ya no pasa", () => {
    // La entrada EXACTA con la que el reviewer lo rompio en la ronda 1: registrada, con los
    // campos vacios y un test ajeno. Se ejerce sobre la funcion pura para no mutar el registro.
    const promesa: EscritorDeLedger = {
      archivo: "lib/services/__ProbeNovenoEscritorService.ts",
      invalidaEn: [],
      invalidadores: [],
      requisitos: [],
      tests: ["tests/unit/analytics/cache-financiera-escritor-egreso.test.ts"],
      motivo: "registrado para callar al guardia",
    };

    const problemas = problemasDe(promesa);
    expect(problemas.length).toBeGreaterThanOrEqual(3);
    expect(problemas.join("\n")).toMatch(/`invalidadores` VACIO/);
    expect(problemas.join("\n")).toMatch(/`requisitos` VACIO/);
    expect(problemas.join("\n")).toMatch(/`invalidaEn` VACIO/);
  });

  it("DISCRIMINA (P3): COPIAR LA ENTRADA DEL VECINO y cambiarle solo el `archivo` tampoco pasa", () => {
    // El sondeo de la ronda 2, palabra por palabra: un noveno escritor que no invalida en
    // ninguna linea suya, con el `invalidaEn`, el `origen` y el `tests` de OTRO escritor. Con
    // las comprobaciones de la ronda 1 puestas, esto pasaba en VERDE (41/41) — porque las dos
    // cadenas de texto que se buscaban estaban ahi, en el archivo ajeno.
    //
    // Es el sondeo que mas importa de los tres: los otros dos exigen dejar campos vacios o
    // apuntar a un archivo cualquiera; este es lo que uno hace SIN MALA INTENCION al anadir una
    // fila a una tabla —copiar la de al lado— y por eso tenia que doler.
    const copiado: EscritorDeLedger = {
      archivo: "lib/services/__ProbeNovenoEscritorService.ts",
      invalidaEn: ["lib/services/WalletEgresoService.ts", "lib/analytics/invalidacion-financiera.ts"],
      invalidadores: [{ clase: "directo", origen: "ledger_egreso_admin" }],
      requisitos: ["R9"],
      tests: ["tests/unit/analytics/cache-financiera-escritor-egreso.test.ts"],
      motivo: "copiado del vecino",
    };

    const problemas = problemasDe(copiado, [...ESCRITORES_DE_LEDGER, copiado]).join("\n");
    // Las DOS defensas disparan, y cada una por su cuenta bastaria: la unicidad del origen (R24)
    // y la pertenencia a la cadena.
    expect(problemas).toMatch(/YA pertenece a lib\/services\/WalletEgresoService\.ts/);
    expect(problemas).toMatch(/ningun archivo de `invalidaEn` .* pertenece a la cadena/);
  });

  it("DISCRIMINA (P3): dos entradas REALES no pueden compartir origen", () => {
    // La mitad de P3 que vale por si sola, ejercida sobre el registro de verdad: si alguien le
    // pusiera a un escritor el origen de otro, R24 dejaria de poder decir cual no llego.
    const clon: EscritorDeLedger = {
      ...entradaDe("lib/services/WalletService.ts"),
      archivo: "lib/services/OtroServicioQueMueveDinero.ts",
    };
    expect(problemasDe(clon, [...ESCRITORES_DE_LEDGER, clon]).join("\n")).toMatch(
      /declara el origen "ledger_movimiento_manual", que YA pertenece a/,
    );
  });

  it("los OCHO origenes del registro real son distintos entre si (R24)", () => {
    const origenes = ESCRITORES_DE_LEDGER.flatMap((e) =>
      e.invalidadores.flatMap((i) => (i.clase === "por_su_llamador" ? [] : [i.origen])),
    );
    expect(new Set(origenes).size).toBe(origenes.length);
    expect(origenes).toHaveLength(8);
  });

  it("DISCRIMINA: rellenar los campos sin escribir el invalidador tampoco pasa", () => {
    // El segundo intento natural de quien quiere callar al guardia: ya no deja nada vacio, pero
    // apunta a un archivo real que no invalida nada.
    const conRelleno: EscritorDeLedger = {
      archivo: "lib/services/__ProbeNovenoEscritorService.ts",
      invalidaEn: ["lib/services/AnaliticaFinancieraService.ts"], // existe, pero no invalida
      invalidadores: [{ clase: "directo", origen: "ledger_egreso_admin" }],
      requisitos: ["R9"],
      tests: ["tests/unit/analytics/cache-financiera-escritor-egreso.test.ts"],
      motivo: "relleno",
    };

    const problemas = problemasDe(conRelleno).join("\n");
    expect(problemas).toMatch(/ningun archivo de `invalidaEn` .* contiene el literal de su origen/);
    expect(problemas).toMatch(/ninguno de sus archivos llama a/);
  });

  it("DISCRIMINA: un `invalidaEn` que apunta a un archivo inexistente cae", () => {
    const fantasma: EscritorDeLedger = {
      ...entradaDe("lib/services/WalletEgresoService.ts"),
      invalidaEn: ["lib/services/EsteArchivoNoExiste.ts"],
    };
    expect(problemasDe(fantasma).join("\n")).toMatch(/NO existe en disco/);
  });

  it("DISCRIMINA: delegar en un llamador que no esta registrado corta la cadena", () => {
    const huerfano: EscritorDeLedger = {
      archivo: "lib/services/CajaPagoTiendaFeedService.ts",
      invalidaEn: ["lib/services/LiquidacionService.ts"],
      invalidadores: [
        { clase: "por_su_llamador", llamadores: ["lib/services/AnaliticaFinancieraService.ts"] },
      ],
      requisitos: ["R11"],
      tests: ["tests/unit/analytics/cache-financiera-escritor-liquidacion.test.ts"],
      motivo: "delega en alguien que no invalida",
    };
    expect(problemasDe(huerfano).join("\n")).toMatch(/NO esta registrado como escritor/);
  });

  it("y no es verde por vacio: la validacion se ejerce sobre las OCHO entradas reales", () => {
    expect(ESCRITORES_DE_LEDGER).toHaveLength(8);
    // Al menos un escritor de cada clase, para que ninguna rama de `problemasDe` quede muerta.
    const clases = new Set(ESCRITORES_DE_LEDGER.flatMap((e) => e.invalidadores.map((i) => i.clase)));
    expect([...clases].sort()).toEqual(["directo", "por_decorador", "por_job", "por_su_llamador"]);
  });
});

/* -------------------------------------------------------------------------- */
/* M2 — el invalidador `por_decorador` es el mas debil: se ata aqui             */
/* -------------------------------------------------------------------------- */
//
// `por_decorador` depende de que el composition root ENVUELVA. El censo ve que el escritor esta
// registrado; no ve si alguien construyo el servicio en otro sitio sin decorarlo, y ahi la
// invalidacion desapareceria sin que nada fallara. Esto lo cierra: se censa el arbol entero
// buscando `new <Clase>(` y se exige que TODA ocurrencia este envuelta por la factoria del
// decorador. Un composition root nuevo sin envolver pone esto rojo el dia que se escribe.

describe("M2/R11 · todo `new <Servicio>(` de un escritor `por_decorador` esta ENVUELTO", () => {
  const conDecorador = ESCRITORES_DE_LEDGER.filter((e) =>
    e.invalidadores.some((i) => i.clase === "por_decorador"),
  );

  it("hay al menos uno (si no, este bloque seria verde por vacio)", () => {
    expect(conDecorador.length).toBeGreaterThan(0);
  });

  it.each(conDecorador.map((e) => [e.archivo, e] as const))("%s", (_a, escritor) => {
    const clase = path.basename(escritor.archivo, ".ts");

    // La factoria sale del PROPIO archivo del decorador, no de una constante escrita aqui: si
    // se renombra, este guardia sigue midiendo lo correcto en vez de quedarse mirando un nombre
    // que ya no existe.
    const decoradores = escritor.invalidaEn.filter((rel) => rel !== "lib/analytics/invalidacion-financiera.ts");
    const factorias = decoradores.flatMap((rel) => {
      const src = codigoDe(rel) ?? "";
      return [...src.matchAll(/export function (\w+)\s*\(/g)].map((m) => m[1]);
    });
    expect(factorias.length, `${escritor.archivo}: su decorador no exporta ninguna factoria`)
      .toBeGreaterThan(0);

    const construcciones: string[] = [];
    const sinEnvolver: string[] = [];
    for (const rel of TODOS) {
      const src = leer(rel);
      const total = [...src.matchAll(new RegExp(`new\\s+${clase}\\s*\\(`, "g"))].length;
      if (total === 0) continue;
      construcciones.push(rel);
      const envueltas = factorias.reduce(
        (n, f) => n + [...src.matchAll(new RegExp(`${f}\\s*\\(\\s*new\\s+${clase}\\s*\\(`, "g"))].length,
        0,
      );
      if (envueltas < total) sinEnvolver.push(`${rel} (${total - envueltas} sin envolver)`);
    }

    expect(construcciones.length, `nadie construye ${clase}: el censo seria vacuo`).toBeGreaterThan(0);
    expect(
      sinEnvolver,
      `${clase} se construye sin envolver con ${factorias.join("/")}. La invalidacion de ese ` +
        "escritor vive en el DECORADOR: un composition root que no envuelva deja de invalidar y " +
        "NADA falla. Envuelvelo, o mueve la invalidacion dentro del servicio si su feature de " +
        "origen lo permite.",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* M1 — R8: ninguna invalidacion cae DENTRO de una transaccion                  */
/* -------------------------------------------------------------------------- */
//
// R8 tenia test en 1 de los 8 puntos (la liquidacion, con el doble que registra el orden de los
// eventos). Los otros siete lo cumplian por INSPECCION, no por medida, y un escritor futuro que
// invalidara dentro de su `tx` no lo cazaba nadie: los tests de cinco pasos no lo verian, porque
// su doble confirma igual. Esto es el detector que faltaba, y es ESTRUCTURAL: no necesita un
// test por escritor.
//
// Lo que mide: para cada apertura de transaccion (`$transaction(`, `runTransaction(`), se avanza
// balanceando parentesis hasta el final de esa llamada; si dentro de ese tramo aparece un
// `invalidarAnaliticaFinanciera(`, es rojo. No es un parser y no pretende serlo: no hay ningun
// caso en el arbol donde un parentesis viva dentro de un string o de un regex en esas piezas, y
// la contraprueba de abajo mide las dos direcciones.

/** Fin (exclusivo) de la llamada que abre en `desde` (indice del `(`), balanceando parentesis. */
function finDeLlamada(src: string, desde: number): number {
  let nivel = 0;
  for (let i = desde; i < src.length; i += 1) {
    if (src[i] === "(") nivel += 1;
    else if (src[i] === ")") {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  return src.length;
}

/** Tramos `[inicio, fin)` de cada llamada a una transaccion en `src`. */
function tramosDeTransaccion(src: string): [number, number][] {
  const tramos: [number, number][] = [];
  for (const m of src.matchAll(/\$transaction\s*\(|runTransaction\s*\(/g)) {
    const abre = src.indexOf("(", m.index ?? 0);
    if (abre >= 0) tramos.push([abre, finDeLlamada(src, abre)]);
  }
  return tramos;
}

/** Archivos donde una invalidacion cae dentro de una transaccion. */
function invalidacionesDentroDeTx(src: string): number[] {
  const tramos = tramosDeTransaccion(src);
  return [...src.matchAll(/invalidarAnaliticaFinanciera\s*\(/g)]
    .map((m) => m.index ?? -1)
    .filter((i) => i >= 0 && tramos.some(([a, b]) => i > a && i < b));
}

describe("R8 · ninguna invalidacion se escribe DENTRO de una transaccion", () => {
  it("en ningun archivo de `lib/`, `app/` ni `scripts/`", () => {
    const infractores = TODOS.filter((rel) => invalidacionesDentroDeTx(leer(rel)).length > 0);

    expect(
      infractores,
      "invalidar ANTES del commit abre una ventana en la que una lectura concurrente repuebla la " +
        "cache con el estado ANTERIOR, y esa entrada vive el TTL entero (una hora). Nada falla y " +
        "la cifra se congela vieja: es el peor modo de fallo de esta feature, y el unico que " +
        "sobrevive a que todos los demas tests esten verdes. La invalidacion va DESPUES de que la " +
        "transaccion resuelva. Archivos: " + infractores.join(", "),
    ).toEqual([]);
  });

  it("DISCRIMINA: caza la llamada colada dentro de la `tx` y no la de despues", () => {
    const dentro = `
      const r = await this.runTransaction(async (tx) => {
        await this.repo.crearMovimientos(tx, movs);
        await invalidarAnaliticaFinanciera(this.cache, "ledger_liquidacion");
        return { status: "ok" };
      });`;
    const fuera = `
      const r = await this.runTransaction(async (tx) => {
        await this.repo.crearMovimientos(tx, movs);
        return { status: "ok" };
      });
      await invalidarAnaliticaFinanciera(this.cache, "ledger_liquidacion");`;

    expect(invalidacionesDentroDeTx(soloCodigo(dentro))).toHaveLength(1);
    expect(invalidacionesDentroDeTx(soloCodigo(fuera))).toHaveLength(0);
  });

  it("y los siete escritores en request SI llaman al invalidador (si no, seria verde por vacio)", () => {
    // Sin esto, el caso de arriba pasaria igual en un arbol donde nadie invalidara.
    const conLlamada = TODOS.filter((rel) => LLAMA_INVALIDADOR.test(leer(rel)));
    expect(conLlamada.length).toBeGreaterThanOrEqual(7);
  });
});

describe("R18 · cada escritor registrado nombra un test que EXISTE y que lo declara", () => {
  it.each(ESCRITORES_DE_LEDGER.map((e) => [e.archivo, e] as const))(
    "%s",
    (_archivo, escritor) => {
      expect(escritor.tests.length, `${escritor.archivo} no nombra ningun test`).toBeGreaterThan(0);

      const contenidos = escritor.tests.map((rel) => {
        const abs = path.join(REPO_ROOT, rel);
        expect(
          fs.existsSync(abs),
          `${escritor.archivo} apunta a un test que NO existe: ${rel}. Sin R18, R17 se satisface ` +
            "escribiendo una linea en un array: el registro seria una promesa, no una prueba.",
        ).toBe(true);
        return fs.readFileSync(abs, "utf8");
      });

      // Los nombres de los casos (`describe`/`it`) de esos archivos, y solo esos: que el
      // requisito aparezca en un comentario no prueba que se mida.
      const titulos = contenidos
        .flatMap((c) => [...c.matchAll(/(?:describe|it)\(\s*["'`]([^"'`]+)/g)])
        .map((m) => m[1]);

      for (const requisito of escritor.requisitos) {
        expect(
          titulos.some((t) => new RegExp(`\\b${requisito}\\b`).test(t)),
          `${escritor.archivo} declara cubrir ${requisito}, pero ninguno de sus tests ` +
            `(${escritor.tests.join(", ")}) tiene un caso que lo nombre.`,
        ).toBe(true);
      }
    },
  );

  it("el registro cubre los ocho puntos de escritura, incluido el que invalida POR JOB", () => {
    expect(ESCRITORES_DE_LEDGER).toHaveLength(8);
    const porJob = ESCRITORES_DE_LEDGER.filter((e) =>
      e.invalidadores.some((i) => i.clase === "por_job"),
    );
    // El backfill de tesoreria es el unico que escribe FUERA de un request de Next, donde
    // `revalidateTag` lanza: su invalidador es el job de R27 y no una llamada directa.
    expect(porJob.map((e) => e.archivo)).toEqual(["lib/services/CajaBackfillTesoreriaService.ts"]);
  });
});

describe("R19 · el guardia de D2 de la 128 ya no existe, y su sustituto SI", () => {
  const GUARDIA_DE_LA_128 = "tests/unit/analytics/cache-financiera.guardia.test.ts";
  const ESTE_CENSO = "tests/unit/analytics/ledger-escritores.guardia.test.ts";

  it("`cache-financiera.guardia.test.ts` fue retirado: la cache financiera ya existe", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, GUARDIA_DE_LA_128)),
      "el guardia de D2 de la 128 sigue en el arbol A LA VEZ que la cache financiera. Los dos " +
        "no pueden convivir: aquel prohibe exactamente lo que esta feature hace.",
    ).toBe(false);
  });

  it("y este censo SI existe: retirarlo sin sustituto deja el agujero abierto y en silencio", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, ESTE_CENSO))).toBe(true);
  });

  it("la cache financiera esta de verdad cableada (si no, retirar el guardia habria sobrado)", () => {
    const accion = leer("lib/actions/analitica-financiera.ts");
    expect(accion).toMatch(/decorarFinancieraConCache\(/);
  });
});
