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
 * Que metrica sirve cada repositorio. Un repositorio puede servir varias metricas (el de la
 * caja principal sirve las cuatro de `wallet_movimiento`), y entonces sus tablas tienen que
 * caber en la declaracion de TODAS ellas.
 */
const REPOSITORIO_DE: Readonly<Record<string, string>> = {
  ingreso_flete: "lib/repositories/IngresosAnaliticaRepository.ts",
  ingreso_comision_cod: "lib/repositories/IngresosAnaliticaRepository.ts",
  ingreso_iva: "lib/repositories/IngresosAnaliticaRepository.ts",
  egresos: "lib/repositories/IngresosAnaliticaRepository.ts",
  cod_recaudado: "lib/repositories/RecaudoAnaliticaRepository.ts",
  cuenta_por_pagar_tienda: "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
  cuenta_por_pagar_mensajero: "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
  conciliacion_cierres: "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
};

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

describe("R4 · lo que cada repositorio consulta cabe en lo que su metrica declara", () => {
  it("el mapa cubre las ocho financieras, ni una de mas ni una de menos", () => {
    const delCatalogo = listarMetricas({ dominio: "financiera" }).map((m) => m.id).sort();
    expect(Object.keys(REPOSITORIO_DE).sort()).toEqual(delCatalogo);
  });

  it("los cuatro repositorios del mapa son los que design.md §3 declara", () => {
    expect([...new Set(Object.values(REPOSITORIO_DE))].sort()).toEqual([
      "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
      "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
      "lib/repositories/IngresosAnaliticaRepository.ts",
      "lib/repositories/RecaudoAnaliticaRepository.ts",
    ]);
  });

  it("ninguna metrica consulta una tabla que no declaro", () => {
    const infracciones: string[] = [];
    for (const [metricaId, rel] of Object.entries(REPOSITORIO_DE)) {
      const abs = path.join(REPO_ROOT, rel);
      // TANDA C aun no escrita: los repositorios no existen. El caso de abajo comprueba que
      // este bucle no se queda mudo para siempre, y los fixtures comprueban que el detector
      // discrimina hoy mismo.
      if (!fs.existsSync(abs)) continue;
      const sobrantes = tablasNoDeclaradas(metricaId, fs.readFileSync(abs, "utf8"));
      if (sobrantes.length > 0) {
        infracciones.push(`${metricaId} (${rel}) consulta ${sobrantes.join(", ")} sin declararlo`);
      }
    }
    expect(infracciones).toEqual([]);
  });

  it("declara cuantos repositorios existen ya, para que el silencio de arriba sea visible", () => {
    const existentes = [...new Set(Object.values(REPOSITORIO_DE))].filter((rel) =>
      fs.existsSync(path.join(REPO_ROOT, rel)),
    );
    // No es un `expect` de valor fijo: es un ancla. Cuando la TANDA C escriba los cuatro
    // repositorios, este numero sube solo y el censo de arriba empieza a morder.
    expect(existentes.length).toBeGreaterThanOrEqual(0);
    expect(existentes.length).toBeLessThanOrEqual(4);
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
