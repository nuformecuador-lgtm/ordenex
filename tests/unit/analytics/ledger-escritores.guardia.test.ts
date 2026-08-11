import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ARCHIVOS_ESCRITORES,
  ESCRITORES_DE_LEDGER,
  REPOSITORIOS_DE_LEDGER,
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
