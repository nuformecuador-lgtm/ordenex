import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getMetrica, listarMetricas } from "@/lib/analytics/metrics";

// Feature 127 / T B.3 — GUARDIA DE CORRESPONDENCIA FUENTE ↔ CONSULTA: R4.
//
// El catalogo de la 135 no describe: MANDA. Cada metrica declara en `fuente.tablas` de donde
// sale su cifra, y ese contrato solo vale algo si la consulta real se le parece. Una metrica
// que declara `wallet_movimiento` y por debajo lee ademas `cierre_dia` no es un detalle de
// implementacion: es que la definicion publicada de esa cifra es falsa, y la 132 la pintara
// junto a otras creyendo que mide lo que dice medir.
//
// El guardia lee los repositorios como TEXTO y extrae las tablas que consultan. Es grosero a
// proposito: los tipos no pueden expresar "este metodo solo puede tocar estas dos tablas".
//
// ⚠ AVISO PARA LA TANDA C — CONTRADICCION ENTRE R4 Y R23, DETECTADA AL ESCRIBIR ESTE GUARDIA.
// `conciliacion_cierres` declara `fuente.tablas = ["cierre_dia", "cierre_bodega"]`, pero R23
// obliga a comparar los snapshots aprobados contra lo que los LEDGERS registraron con
// `origen_tipo = cierre_dia`. Con el catalogo vigente, el repositorio de conciliacion no puede
// cumplir R4 y R23 a la vez. Este guardia NO lleva exencion para ese caso: se pondra rojo el
// dia que se implemente C.4, que es exactamente lo que tiene que pasar. La salida correcta es
// una de estas dos, y ninguna se toma de paso:
//   (a) ampliar `conciliacion_cierres.fuente.tablas` con los tres ledgers — es TOCAR EL
//       CATALOGO de la 135, o sea decision humana fechada, como la de ⟨D8⟩; o
//   (b) acotar R23 a comparar solo contra los cierres, renunciando al cruce con el ledger.
// Aflojar el guardia para que pase es la tercera opcion, y es la unica que esta descartada.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Las cinco tablas del universo, con el nombre que tienen en el cliente de Prisma. */
const MODELO_A_TABLA: Readonly<Record<string, string>> = {
  walletMovimiento: "wallet_movimiento",
  walletTiendaMovimiento: "wallet_tienda_movimiento",
  pagoMensajeroMovimiento: "pago_mensajero_movimiento",
  cierreDia: "cierre_dia",
  cierreBodega: "cierre_bodega",
};

const OPERACIONES =
  "findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy";

/**
 * Que sirve cada metrica: el archivo y, cuando el archivo sirve varias metricas de fuentes
 * DISTINTAS, el metodo concreto.
 *
 * ⚠ CAMBIO DE LA TANDA C, 2026-08-02 (contradiccion C4 de `progress/impl_127_C.md`). La version
 * de la TANDA B mapeaba metrica -> ARCHIVO y comparaba las tablas de todo el archivo contra la
 * declaracion de cada metrica. Eso es correcto mientras las metricas que comparten archivo
 * comparten fuente (el de la caja principal sirve cuatro y todas declaran `wallet_movimiento`),
 * pero es INSATISFACIBLE para `CuentasPorPagarAnaliticaRepository`, que `design.md §3` define
 * como UN repositorio con las dos cuentas por pagar: una declara solo `wallet_tienda_movimiento`
 * y la otra solo `pago_mensajero_movimiento`, asi que cualquier archivo que sirva a las dos
 * infringe a las dos por construccion. El guardia se quedaba sin ninguna implementacion legal.
 *
 * La correccion SUBE la resolucion en vez de bajar la exigencia. Se comprueban DOS cosas:
 *   (a) por METODO — lo que sirve a una metrica cabe en lo que esa metrica declara;
 *   (b) por ARCHIVO — el archivo entero cabe en la UNION de lo que declaran las metricas que
 *       sirve, para que una consulta escondida en un helper de modulo (fuera de todo metodo)
 *       no se escape de (a).
 * Para los archivos de una sola fuente las dos son la comprobacion de antes, palabra por
 * palabra: la mutacion «añadir `cierre_dia` al repositorio de `ingreso_flete`» sigue roja, y la
 * contradiccion R4 ↔ R23 de la conciliacion sigue fijada abajo.
 */
interface Servidor {
  readonly archivo: string;
  /** `undefined` = todo el archivo sirve a esta metrica. */
  readonly metodo?: string;
}

const REPOSITORIO_DE: Readonly<Record<string, Servidor>> = {
  ingreso_flete: { archivo: "lib/repositories/IngresosAnaliticaRepository.ts" },
  ingreso_comision_cod: { archivo: "lib/repositories/IngresosAnaliticaRepository.ts" },
  ingreso_iva: { archivo: "lib/repositories/IngresosAnaliticaRepository.ts" },
  egresos: { archivo: "lib/repositories/IngresosAnaliticaRepository.ts" },
  cod_recaudado: { archivo: "lib/repositories/RecaudoAnaliticaRepository.ts" },
  cuenta_por_pagar_tienda: {
    archivo: "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
    metodo: "saldoPorTiendaAlCorte",
  },
  cuenta_por_pagar_mensajero: {
    archivo: "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
    metodo: "cuentaPorPagarMensajerosAlCorte",
  },
  conciliacion_cierres: { archivo: "lib/repositories/ConciliacionCierresAnaliticaRepository.ts" },
};

/**
 * El cuerpo de un metodo `async`, desde su firma hasta el siguiente metodo `async` de la clase
 * (o el fin del archivo). Grosero a proposito, como el resto del guardia: basta para atribuir
 * una consulta a la metrica que la pidio, y lo que se le escape lo caza la comprobacion (b).
 * Si el metodo no aparece, devuelve `null` y el caso correspondiente falla en vez de callarse.
 */
export function cuerpoDeMetodo(fuente: string, metodo: string): string | null {
  const inicio = fuente.search(new RegExp(`\\basync\\s+${metodo}\\s*\\(`));
  if (inicio < 0) return null;
  const resto = fuente.slice(inicio + metodo.length);
  const siguiente = resto.search(/\basync\s+\w+\s*\(/);
  return siguiente < 0 ? resto : resto.slice(0, siguiente);
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Las tablas del universo que el texto consulta de verdad (no las que menciona en prosa). */
export function tablasConsultadas(fuente: string): readonly string[] {
  const codigo = soloCodigo(fuente);
  const encontradas = Object.entries(MODELO_A_TABLA)
    .filter(([modelo]) => new RegExp(`\\.\\s*${modelo}\\s*\\.\\s*(${OPERACIONES})`).test(codigo))
    .map(([, tabla]) => tabla);
  return [...new Set(encontradas)].sort();
}

/** Devuelve las tablas que el repositorio consulta y la metrica NO declara. */
export function tablasNoDeclaradas(metricaId: string, fuente: string): readonly string[] {
  const metrica = getMetrica(metricaId);
  if (!metrica) return [`(metrica desconocida: ${metricaId})`];
  const declaradas = new Set<string>(metrica.fuente.tablas);
  return tablasConsultadas(fuente).filter((t) => !declaradas.has(t));
}

const ARCHIVOS = [...new Set(Object.values(REPOSITORIO_DE).map((s) => s.archivo))];

describe("R4 · lo que cada repositorio consulta cabe en lo que su metrica declara", () => {
  it("el mapa cubre las ocho financieras, ni una de mas ni una de menos", () => {
    const delCatalogo = listarMetricas({ dominio: "financiera" }).map((m) => m.id).sort();
    expect(Object.keys(REPOSITORIO_DE).sort()).toEqual(delCatalogo);
  });

  it("los cuatro repositorios del mapa son los que design.md §3 declara", () => {
    expect([...ARCHIVOS].sort()).toEqual([
      "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
      "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
      "lib/repositories/IngresosAnaliticaRepository.ts",
      "lib/repositories/RecaudoAnaliticaRepository.ts",
    ]);
  });

  it("(a) ninguna metrica consulta una tabla que no declaro", () => {
    const infracciones: string[] = [];
    for (const [metricaId, servidor] of Object.entries(REPOSITORIO_DE)) {
      const abs = path.join(REPO_ROOT, servidor.archivo);
      // Los repositorios que la TANDA C aun no escribio (C.4) no existen. El caso de abajo
      // comprueba que este bucle no se queda mudo para siempre, y los fixtures comprueban que
      // el detector discrimina hoy mismo.
      if (!fs.existsSync(abs)) continue;
      const archivo = fs.readFileSync(abs, "utf8");
      const trozo = servidor.metodo === undefined ? archivo : cuerpoDeMetodo(archivo, servidor.metodo);
      if (trozo === null) {
        infracciones.push(`${metricaId}: ${servidor.archivo} no tiene el metodo ${servidor.metodo}`);
        continue;
      }
      const sobrantes = tablasNoDeclaradas(metricaId, trozo);
      if (sobrantes.length > 0) {
        infracciones.push(
          `${metricaId} (${servidor.archivo}${servidor.metodo ? `#${servidor.metodo}` : ""}) consulta ${sobrantes.join(", ")} sin declararlo`,
        );
      }
    }
    expect(infracciones).toEqual([]);
  });

  it("(b) ningun archivo consulta una tabla que NINGUNA de sus metricas declara", () => {
    const infracciones: string[] = [];
    for (const archivo of ARCHIVOS) {
      const abs = path.join(REPO_ROOT, archivo);
      if (!fs.existsSync(abs)) continue;
      const declaradas = new Set<string>(
        Object.entries(REPOSITORIO_DE)
          .filter(([, s]) => s.archivo === archivo)
          .flatMap(([metricaId]) => [...(getMetrica(metricaId)?.fuente.tablas ?? [])]),
      );
      const sobrantes = tablasConsultadas(fs.readFileSync(abs, "utf8")).filter(
        (t) => !declaradas.has(t),
      );
      if (sobrantes.length > 0) {
        infracciones.push(`${archivo} consulta ${sobrantes.join(", ")}, que nadie declara ahi`);
      }
    }
    expect(infracciones).toEqual([]);
  });

  it("declara cuantos repositorios existen ya, para que el silencio de arriba sea visible", () => {
    const existentes = ARCHIVOS.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
    // No es un `expect` de valor fijo: es un ancla. Tres de los cuatro estan escritos (C.1-C.3);
    // el cuarto (C.4) espera a que se resuelva la contradiccion R4 ↔ R23.
    expect(existentes.length).toBeGreaterThanOrEqual(3);
    expect(existentes.length).toBeLessThanOrEqual(4);
  });

  it("y el troceado por metodo mira metodos de verdad: los dos de las cuentas por pagar existen", () => {
    const rel = "lib/repositories/CuentasPorPagarAnaliticaRepository.ts";
    const archivo = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const tienda = cuerpoDeMetodo(archivo, "saldoPorTiendaAlCorte");
    const mensajero = cuerpoDeMetodo(archivo, "cuentaPorPagarMensajerosAlCorte");

    expect(tienda).not.toBeNull();
    expect(mensajero).not.toBeNull();
    // Cada trozo consulta SU tabla y solo la suya: si los dos metodos se fundieran, o si uno
    // leyera el libro del otro, estas dos lineas se ponen rojas.
    expect(tablasConsultadas(tienda ?? "")).toEqual(["wallet_tienda_movimiento"]);
    expect(tablasConsultadas(mensajero ?? "")).toEqual(["pago_mensajero_movimiento"]);
    expect(cuerpoDeMetodo(archivo, "metodoQueNoExiste")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Autocomprobacion: el detector discrimina HOY, sin esperar a la tanda C      */
/* -------------------------------------------------------------------------- */

const REPO_INGRESOS_LEGITIMO = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class IngresosAnaliticaRepository {
  async sumarPorCategoria(consulta: ConsultaAnalitica) {
    return this.prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where: { categoria: { in: consulta.metrica.definicion.categorias } },
      _sum: { monto: true },
    });
  }
}
`;

describe("R4 · autocomprobacion del detector con fixtures", () => {
  it("el repositorio de ingresos legitimo solo consulta la caja principal", () => {
    expect(tablasConsultadas(REPO_INGRESOS_LEGITIMO)).toEqual(["wallet_movimiento"]);
    expect(tablasNoDeclaradas("ingreso_flete", REPO_INGRESOS_LEGITIMO)).toEqual([]);
  });

  it("añadirle cierre_dia lo pone en infraccion, porque ingreso_flete no lo declara", () => {
    const mutado = REPO_INGRESOS_LEGITIMO.replace(
      "return this.prisma.walletMovimiento",
      "await this.prisma.cierreDia.aggregate({ _sum: { totalGeneral: true } });\n    return this.prisma.walletMovimiento",
    );
    expect(tablasConsultadas(mutado)).toEqual(["cierre_dia", "wallet_movimiento"]);
    expect(tablasNoDeclaradas("ingreso_flete", mutado)).toEqual(["cierre_dia"]);
  });

  it("cod_recaudado SI puede tocar las dos tablas que declara", () => {
    const recaudo = `
      export class RecaudoAnaliticaRepository {
        async a() { return this.prisma.cierreDia.aggregate({ _sum: { totalEfectivo: true } }); }
        async b() { return this.prisma.walletTiendaMovimiento.groupBy({ by: ["tiendaId"] }); }
      }
    `;
    expect(tablasNoDeclaradas("cod_recaudado", recaudo)).toEqual([]);
  });

  it("una mencion en prosa no cuenta como consulta", () => {
    const conProsa = `// Ojo: aqui NO se hace this.prisma.cierreDia.aggregate(...)\n${REPO_INGRESOS_LEGITIMO}`;
    expect(tablasConsultadas(conProsa)).toEqual(["wallet_movimiento"]);
  });

  it("el ledger que R23 quiere cruzar NO cabe hoy en lo que conciliacion_cierres declara", () => {
    // Este caso FIJA la contradiccion del encabezado en un test, para que no se descubra por
    // sorpresa en la tanda C ni se resuelva aflojando el guardia sin que nadie se entere.
    const conciliacion = `
      export class ConciliacionCierresAnaliticaRepository {
        async a() { return this.prisma.cierreDia.groupBy({ by: ["estado"] }); }
        async b() { return this.prisma.cierreBodega.groupBy({ by: ["estado"] }); }
        async c() { return this.prisma.walletMovimiento.groupBy({ by: ["origenId"] }); }
      }
    `;
    expect(tablasNoDeclaradas("conciliacion_cierres", conciliacion)).toEqual(["wallet_movimiento"]);
  });
});
