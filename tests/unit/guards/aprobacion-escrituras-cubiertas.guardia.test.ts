import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// GUARDIA DE LA FEATURE 239 (T2.6, R33) — TODA ESCRITURA DE LA TRANSACCION DE APROBACION TIENE
// QUE ESTAR NOMBRADA POR ALGUNA ASERCION, Y NINGUNA ASERCION PUEDE EXCLUIR ESCRITURAS POR LA
// FORMA DE SU `where`.
//
// EL INCIDENTE QUE LA MOTIVA (`progress/auditoria_ayuda_tienda.md` §3). El 2026-08-18 se anadio a
// `CierresAdminRepository.resolverCierre` un `updateMany` sobre `orden` que encendia
// `gestion_aprobada` en las devoluciones del cierre: 23 lineas, SIN UN SOLO TEST. Las dos suites
// que SI ejecutaban esa transaccion no lo notaron porque las dos habian aprendido a mirar hacia
// otro lado:
//
//     .filter((c) => c.where.id !== undefined)
//
// Ese filtro excluia escrituras POR LA FORMA DE SU WHERE, y lo unico que excluia era —
// exactamente— la escritura nueva, la unica sin asercion propia. El arbol quedo verde con una
// escritura que gobernaba lo que la tienda ve en `/novedades` y que nadie miraba. Con el reloj
// del SLA anclado en otro sitio, eso costo rechazos cobrados antes de tiempo.
//
// QUE VIGILA ESTA GUARDIA, en dos frentes:
//
//   1. INVENTARIO CERRADO de las escrituras de la rama `aprobado`. Se censa el codigo real y se
//      compara contra una lista declarada, cada entrada con el archivo de test que la nombra. Una
//      escritura nueva sin entrada deja esto ROJO, que es lo que no paso en agosto.
//   2. NINGUNA suite de esa transaccion vuelve a filtrar escrituras por la forma del `where`. El
//      patron se censa por texto sobre los archivos de test implicados.
//
// AUTOCOMPROBACION (obligatoria, `docs/verification.md`): el ultimo bloque demuestra que el
// detector del frente 2 se pone rojo ante el filtro exacto que se retiro en T2.5. Una guardia que
// no se sabe romper no protege nada — este repo ya tuvo un arnes de mutaciones que reporto 9/9
// supervivientes dos veces sin haber ejecutado un test.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const REPO_FILE = path.join(REPO_ROOT, "lib", "repositories", "CierresAdminRepository.ts");
const repoSrc = fs.readFileSync(REPO_FILE, "utf8");

/**
 * Las suites que EJECUTAN la transaccion de aprobacion. Si una suite nueva la ejecuta, entra
 * aqui: es la lista sobre la que se censa el patron prohibido.
 */
const SUITES_DE_LA_TRANSACCION = [
  "tests/unit/repositories/cierres-admin-repository.test.ts",
  "tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts",
  "tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts",
  "tests/unit/repositories/cierres-admin-caja-cod.test.ts",
  "tests/unit/repositories/cierres-admin-indemnizacion.test.ts",
  "tests/integration/db/wallet-idempotencia.test.ts",
  "tests/integration/db/cierre-detail-congelado.test.ts",
] as const;

/**
 * INVENTARIO CERRADO de las escrituras que la rama `aprobado` ejecuta dentro de la `$transaction`,
 * cada una con la suite que la NOMBRA. «Nombrar» = tener al menos una asercion sobre su `where` o
 * su `data`, no simplemente atravesarla.
 */
const ESCRITURAS_DE_LA_APROBACION = [
  {
    escritura: "tx.cierreDia.updateMany",
    que: "la transicion del propio cierre, guardada por estado resoluble + alcance",
    cubiertaPor: "tests/unit/repositories/cierres-admin-repository.test.ts",
  },
  {
    escritura: "tx.gestionOrden.updateMany",
    que: "feature 158: el monto de indemnizacion, guardado por (cierreId, resultado)",
    cubiertaPor: "tests/unit/repositories/cierres-admin-indemnizacion.test.ts",
  },
  {
    escritura: "tx.orden.updateMany",
    que:
      "TRES bloques comparten esta escritura: liberacion de `sin_gestionar` (109), devolucion " +
      "de `rechazada` (139) y ANCLAJE de la devolucion (239). Los tres rutean por ids y van " +
      "guardados por su estado de origen.",
    cubiertaPor: "tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts",
  },
  {
    escritura: "appendCambioEstado",
    que: "el historial de las tres transiciones de arriba, por el punto unico de escritura",
    cubiertaPor: "tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts",
  },
] as const;

/**
 * Escrituras del MISMO ARCHIVO que NO son de la transaccion de aprobacion, cada una con la suite
 * que la nombra. El censo del frente 1 es por archivo —no sabe distinguir una transaccion de
 * otra—, asi que sin esta lista una escritura ajena a la aprobacion solo tendria dos salidas:
 * declararse como «de la aprobacion», que seria falso, o quedarse el arbol rojo.
 *
 * La EXIGENCIA es la misma y por eso van declaradas y no exentas: cada entrada nombra la suite
 * que asierta sobre su `where` o su `data`. Lo que esta lista concede es el rotulo, no la
 * cobertura; el fallo de agosto de 2026 fue una escritura que NADIE miraba, y eso lo sigue
 * cerrando este archivo para todo lo que se escriba aqui dentro.
 */
const ESCRITURAS_FUERA_DE_LA_APROBACION = [
  {
    escritura: "tx.gestionOrdenPago.deleteMany",
    que:
      "correccion del desglose de pago (2026-08-19): borra las lineas VIGENTES de la gestion " +
      "antes de reinsertarlas. Transaccion propia (`actualizarPagosGestion`), disparada desde " +
      "el detalle de un cierre ABIERTO, no desde la resolucion.",
    cubiertaPor: "tests/unit/repositories/cierres-admin-corregir-pagos-where.test.ts",
  },
  {
    escritura: "tx.gestionOrdenPago.createMany",
    que: "correccion del desglose de pago: las lineas NUEVAS, que sustituyen enteras a las anteriores",
    cubiertaPor: "tests/unit/repositories/cierres-admin-corregir-pagos-where.test.ts",
  },
] as const;

/** Escrituras de la transaccion que salen por un REPOSITORIO inyectado, no por `tx.` directo. */
const ESCRITURAS_POR_REPO_INYECTADO = [
  {
    escritura: "this.walletMovimientoRepo.crearMovimientos",
    cubiertaPor: "tests/integration/db/wallet-idempotencia.test.ts",
  },
  {
    escritura: "this.walletTiendaMovimientoRepo.crearMovimientos",
    cubiertaPor: "tests/unit/repositories/cierres-admin-repository.test.ts",
  },
  {
    escritura: "this.pagoMensajeroMovimientoRepo.crearMovimientos",
    cubiertaPor: "tests/unit/repositories/cierres-admin-repository.test.ts",
  },
] as const;

/** Todas las llamadas de escritura sobre el `tx` que aparecen en el archivo del repositorio. */
function censarEscriturasTx(src: string): string[] {
  const re = /\btx\.([A-Za-z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
  return [...new Set([...src.matchAll(re)].map((m) => `tx.${m[1]}.${m[2]}`))].sort();
}

describe("239/R33 — el inventario de escrituras de la aprobacion esta CERRADO", () => {
  it("el censo del codigo no encuentra ninguna escritura sobre `tx` fuera del inventario", () => {
    const censadas = censarEscriturasTx(repoSrc);
    // AUTOCOMPROBACION del censo: si el regex dejara de encontrar nada, este test pasaria en
    // verde sin haber mirado el codigo. Se exige que encuentre las que sabemos que hay.
    expect(censadas.length).toBeGreaterThanOrEqual(3);

    const declaradas = new Set<string>(
      [...ESCRITURAS_DE_LA_APROBACION, ...ESCRITURAS_FUERA_DE_LA_APROBACION].map(
        (e) => e.escritura,
      ),
    );
    const noDeclaradas = censadas.filter((e) => !declaradas.has(e));
    expect(
      noDeclaradas,
      "escritura sobre `tx` sin entrada en ESCRITURAS_DE_LA_APROBACION ni en " +
        "ESCRITURAS_FUERA_DE_LA_APROBACION: declarala con la suite que la nombra, o el fallo " +
        "de agosto de 2026 se repite",
    ).toEqual([]);
  });

  it("cada escritura declarada apunta a un archivo de test que EXISTE", () => {
    for (const e of [
      ...ESCRITURAS_DE_LA_APROBACION,
      ...ESCRITURAS_FUERA_DE_LA_APROBACION,
      ...ESCRITURAS_POR_REPO_INYECTADO,
    ]) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, e.cubiertaPor)),
        `${e.escritura} cita ${e.cubiertaPor}, que no existe`,
      ).toBe(true);
    }
  });

  it("las escrituras por repositorio inyectado siguen invocandose en la transaccion", () => {
    for (const e of ESCRITURAS_POR_REPO_INYECTADO) {
      expect(repoSrc, `${e.escritura} ya no aparece en el repositorio`).toContain(e.escritura);
    }
  });

  it("la escritura de `gestion_aprobada` ya no existe (feature 239/T2.3)", () => {
    // Era la escritura sin asercion. Su sustituta es el anclaje, que si la tiene. El censo se
    // hace sobre el archivo del repositorio, no sobre el arbol entero: el censo del arbol es
    // otra guardia (T3.2), de otra tanda.
    expect(repoSrc).not.toContain("gestionAprobada");
  });
});

// ---------------------------------------------------------------------------------------------
// Frente 2: ninguna suite vuelve a excluir escrituras por la FORMA de su `where`.
// ---------------------------------------------------------------------------------------------

/**
 * Detecta el patron que causo el agujero: filtrar LAS LLAMADAS ESPIADAS (`mock.calls`) por la
 * PRESENCIA o AUSENCIA de una clave del `where`, en vez de por lo que la escritura significa.
 *
 * Las TRES condiciones tienen que darse en la MISMA cadena, y las tres importan:
 *   - `mock.calls` — se esta mirando lo que el codigo LLAMO (no filtrando datos de un fake);
 *   - `.filter(`   — se estan DESCARTANDO llamadas;
 *   - `where.<x>` comparado con `undefined` — el criterio del descarte es la FORMA del where.
 *
 * Sin la primera condicion el detector ladraria ante los dobles de Prisma, que legitimamente
 * escriben `where.cierreId === undefined || ...` para emular la semantica de un WHERE parcial.
 * Esos no descartan aserciones: emulan la base. La diferencia entre las dos cosas es justo lo que
 * esta guardia tiene que saber distinguir, y por eso la autocomprobacion de abajo prueba las dos.
 */
export function filtraPorFormaDelWhere(fuente: string): boolean {
  const VENTANA = 400; // una cadena `mock.calls.map(...).filter(...)` cabe de sobra
  const criterio = /\bwhere\.[A-Za-z_$][\w$]*\s*[!=]==\s*undefined/;
  for (const m of fuente.matchAll(/mock\.calls/g)) {
    const desde = m.index ?? 0;
    const cola = fuente.slice(desde, desde + VENTANA);
    const filtro = cola.indexOf(".filter(");
    if (filtro === -1) continue;
    if (criterio.test(cola.slice(filtro))) return true;
  }
  return false;
}

describe("239/R33 — ninguna asercion excluye escrituras por la forma de su `where`", () => {
  it("las suites de la transaccion de aprobacion estan limpias del patron", () => {
    const sucias: string[] = [];
    for (const rel of SUITES_DE_LA_TRANSACCION) {
      const file = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(file), `${rel} no existe: actualiza la lista de suites`).toBe(true);
      // SIN COMENTARIOS (quitador unico del repo, feature 209): estos archivos NOMBRAN a
      // proposito el filtro que se retiro, para dejar dicho por que se retiro. Censar la prosa
      // como si fuera codigo obligaria a borrar la explicacion para pasar la guardia.
      const fuente = quitarComentarios(fs.readFileSync(file, "utf8"));
      if (filtraPorFormaDelWhere(fuente)) sucias.push(rel);
    }
    expect(
      sucias,
      "estas suites vuelven a filtrar escrituras por la forma de su `where`. Ese filtro es lo " +
        "que dejo la escritura de `gestion_aprobada` sin asercion durante toda su vida.",
    ).toEqual([]);
  });

  // AUTOCOMPROBACION — la guardia se pone ROJA ante el filtro EXACTO que T2.5 retiro. Sin esto,
  // un regex mal escrito daria verde para siempre y esta guardia seria decorativa.
  it("AUTOCOMPROBACION: el detector reconoce el filtro real que se retiro en T2.5", () => {
    // Las dos formas literales que vivian en el arbol el 2026-08-18.
    const comoEnLaSuiteDeLaDevolucion = `
      return prisma.orden.updateMany.mock.calls
        .map((c) => c[0] as UpdateManyArgs)
        .filter((c) => c.where.id !== undefined);
    `;
    const comoEnLaSuiteDeLaLiberacion = `
      const calls = prisma.orden.updateMany.mock.calls
        .map((c) => c[0])
        .filter((c: { where: { id?: unknown } }) => c.where.id !== undefined);
    `;
    expect(filtraPorFormaDelWhere(comoEnLaSuiteDeLaDevolucion)).toBe(true);
    expect(filtraPorFormaDelWhere(comoEnLaSuiteDeLaLiberacion)).toBe(true);
    // Y sigue rojo tras pasar por el quitador, que es como lo ve el caso de arriba.
    expect(filtraPorFormaDelWhere(quitarComentarios(comoEnLaSuiteDeLaDevolucion))).toBe(true);

    // Pero NO ante la MENCION del filtro en un comentario: nombrar lo que se retiro es lo que
    // deja el motivo escrito junto al codigo, y no puede costar la guardia.
    const soloMencionado = `
      // 2026-08-19: se retira el .filter((c) => c.where.id !== undefined) de esta cadena.
      const calls = prisma.orden.updateMany.mock.calls.map((c) => c[0]);
    `;
    expect(filtraPorFormaDelWhere(quitarComentarios(soloMencionado))).toBe(false);

    // Y NO ladra ante un filtro legitimo: elegir la escritura por lo que ESCRIBE es correcto.
    const legitimo = `const central = calls.filter((c) => c.data.estatusId === idEstado("x"));`;
    expect(filtraPorFormaDelWhere(legitimo)).toBe(false);
    const sinFiltro = `const calls = prisma.orden.updateMany.mock.calls.map((c) => c[0]);`;
    expect(filtraPorFormaDelWhere(sinFiltro)).toBe(false);
    // Ni ante un DOBLE de Prisma que emula un WHERE parcial: eso no descarta ninguna asercion,
    // es la base fingiendo ser la base. Es el falso positivo que hundio la primera version de
    // este detector, y por eso se queda escrito aqui.
    const dobleDePrisma = `
      findMany: vi.fn(async ({ where }) =>
        gestiones.filter(
          (g) =>
            (where.cierreId === undefined || g.cierreId === where.cierreId) &&
            (where.resultado === undefined || g.resultado === where.resultado),
        ),
      ),`;
    expect(filtraPorFormaDelWhere(dobleDePrisma)).toBe(false);
  });
});
