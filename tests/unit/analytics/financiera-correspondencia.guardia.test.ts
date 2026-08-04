import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getMetrica, listarMetricas } from "@/lib/analytics/metrics";
import type { TablaDinero } from "@/lib/analytics/types";

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
// ✔ LA CONTRADICCION R4 ↔ R23 (C2) ESTA CERRADA — ⟨D10⟩, humano, 2026-08-02.
// `conciliacion_cierres` declaraba solo `["cierre_dia", "cierre_bodega"]` y R23 obliga a
// comparar los snapshots aprobados contra lo que los LEDGERS registraron con
// `origen_tipo = cierre_dia`: las dos cosas no cabian a la vez. El humano tomo la salida (a) y
// amplio `fuente.tablas` con los tres ledgers (`progress/decision_C2_127.md`). O sea: este
// guardia queda verde POR CONSTRUCCION, no por exencion — no lleva ninguna, y no la lleva a
// proposito. Aflojarlo seguia siendo la unica salida descartada.
// El caso que fijaba la contradiccion sigue abajo, DADO VUELTA: ahora afirma que los tres
// ledgers estan declarados y que quitar uno vuelve a poner rojo al guardia.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Las cinco tablas del universo, con el nombre que tienen en el cliente de Prisma. */
const MODELO_A_TABLA: Readonly<Record<string, string>> = {
  walletMovimiento: "wallet_movimiento",
  walletTiendaMovimiento: "wallet_tienda_movimiento",
  pagoMensajeroMovimiento: "pago_mensajero_movimiento",
  cierreDia: "cierre_dia",
  cierreBodega: "cierre_bodega",
};

/**
 * Las mismas cinco, escritas a mano y tipadas: el universo que este guardia PUEDE ver. El
 * `satisfies` impide ampliarlo con una tabla que no sea de dinero, y el caso del final compara
 * esta lista contra los valores de `MODELO_A_TABLA` para que las dos no se separen en silencio.
 */
const TABLAS_DEL_DINERO = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
] as const satisfies readonly TablaDinero[];

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
  // Feature 173 (P4): las dos cifras de la caja salen del MISMO repositorio y de la MISMA
  // tabla que las cuatro de la 127; lo unico propio de cada una es que categorias declara.
  dinero_en_caja: { archivo: "lib/repositories/IngresosAnaliticaRepository.ts" },
  ganancia_ordenex: { archivo: "lib/repositories/IngresosAnaliticaRepository.ts" },
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

/**
 * Las tablas que el texto consulta y que NO estan en la lista declarada que se le pasa.
 *
 * Se separa de `tablasNoDeclaradas` para poder juzgar el mismo codigo contra un catalogo
 * HIPOTETICO: asi el caso de ⟨D10⟩ puede afirmar "y si al catalogo le quitaran un ledger,
 * esto se pondria rojo" sin mutar el catalogo real de la 135 dentro de un test.
 */
export function tablasFueraDe(declaradas: readonly string[], fuente: string): readonly string[] {
  const permitidas = new Set<string>(declaradas);
  return tablasConsultadas(fuente).filter((t) => !permitidas.has(t));
}

/** Devuelve las tablas que el repositorio consulta y la metrica NO declara. */
export function tablasNoDeclaradas(metricaId: string, fuente: string): readonly string[] {
  const metrica = getMetrica(metricaId);
  if (!metrica) return [`(metrica desconocida: ${metricaId})`];
  return tablasFueraDe(metrica.fuente.tablas, fuente);
}

const ARCHIVOS = [...new Set(Object.values(REPOSITORIO_DE).map((s) => s.archivo))];

describe("R4 · lo que cada repositorio consulta cabe en lo que su metrica declara", () => {
  it("el mapa cubre las diez financieras, ni una de mas ni una de menos", () => {
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
      // Los cuatro repositorios ya existen; el caso «los CUATRO repositorios existen» de abajo
      // lo afirma, para que este `continue` no pueda dejar el bucle mudo sin que nadie lo vea.
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

  it("los CUATRO repositorios existen: el bucle de arriba no se salta ninguno", () => {
    const existentes = ARCHIVOS.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
    // Con C.4 escrito ya no hay ausencias legitimas: el ancla sube de ">= 3" a "los cuatro".
    // Si alguien borrara un repositorio, el `continue` del caso (a) lo dejaria pasar en
    // silencio; esta linea es la que lo impide.
    expect([...existentes].sort()).toEqual([...ARCHIVOS].sort());
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

  // ⟨D10⟩ — ESTE CASO ESTA DADO VUELTA, NO BORRADO (2026-08-02).
  //
  // La version de la TANDA B afirmaba lo contrario: «el ledger que R23 quiere cruzar NO cabe
  // hoy en lo que `conciliacion_cierres` declara». Eso era verdad y fijaba la contradiccion C2
  // en un test para que no se descubriera por sorpresa. Con ⟨D10⟩ ya no lo es: el humano amplio
  // el catalogo. Borrar el caso dejaria el hueco sin vigilancia —nadie notaria que los tres
  // ledgers se caen del catalogo—, asi que pasa a afirmar la otra mitad: que estan declarados,
  // y que si a la declaracion le faltara UNO, el guardia se pondria rojo.
  it("los tres ledgers que R23 cruza SI estan declarados por conciliacion_cierres (⟨D10⟩)", () => {
    const conciliacion = `
      export class ConciliacionCierresAnaliticaRepository {
        async a() { return this.prisma.cierreDia.groupBy({ by: ["estado"] }); }
        async b() { return this.prisma.cierreBodega.groupBy({ by: ["estado"] }); }
        async c() { return this.prisma.walletMovimiento.groupBy({ by: ["origenId"] }); }
        async d() { return this.prisma.walletTiendaMovimiento.groupBy({ by: ["origenId"] }); }
        async e() { return this.prisma.pagoMensajeroMovimiento.groupBy({ by: ["origenId"] }); }
      }
    `;

    // (1) El catalogo declara EXACTAMENTE las cinco. Escrito a mano y no derivado del propio
    //     catalogo: si alguien le quita un ledger, esta linea es la que grita.
    expect([...(getMetrica("conciliacion_cierres")?.fuente.tablas ?? [])].sort()).toEqual([
      "cierre_bodega",
      "cierre_dia",
      "pago_mensajero_movimiento",
      "wallet_movimiento",
      "wallet_tienda_movimiento",
    ]);

    // (2) Y por eso el repositorio que cruza los cinco ya no infringe R4.
    expect(tablasNoDeclaradas("conciliacion_cierres", conciliacion)).toEqual([]);

    // (3) Quitarle UNO a la declaracion vuelve a poner rojo al guardia: la correspondencia
    //     sigue siendo una exigencia, no una amnistia para esta metrica.
    const sinLaCaja = ["cierre_dia", "cierre_bodega", "wallet_tienda_movimiento", "pago_mensajero_movimiento"];
    expect(tablasFueraDe(sinLaCaja, conciliacion)).toEqual(["wallet_movimiento"]);
  });

  // ⚠ TITULO CORREGIDO (menor 2 del review, 2026-08-02). Se llamaba «una tabla que
  // conciliacion_cierres NO declara la caza igual» y el fixture no ejercitaba ninguna tabla FUERA
  // del universo: prometia una vigilancia que este guardia no puede dar. Ahora el fixture SI baja
  // a `orden` y a `gestion_orden`, y el caso dice las dos verdades —lo que este guardia caza y lo
  // que delega— en vez de insinuar que caza las dos.
  it("dentro de su universo muerde; fuera de el no puede, y por eso `orden` la caza financiera-fuente", () => {
    const conElIntruso = `
      export class ConciliacionCierresAnaliticaRepository {
        async a() { return this.prisma.cierreDia.groupBy({ by: ["estado"] }); }
        async b() { return this.prisma.walletMovimiento.groupBy({ by: ["origenId"] }); }
        async c() { return this.prisma.orden.aggregate({ _sum: { montoCobrar: true } }); }
        async d() { return this.prisma.$queryRaw\`SELECT SUM(monto) FROM gestion_orden\`; }
      }
    `;

    // (1) Lo que este guardia SI hace: correspondencia DENTRO del universo. Contra la declaracion
    //     real de ⟨D10⟩ el fixture esta limpio, y contra una que no incluyera la caja, en
    //     infraccion. Esa es la mordida, y sigue viva.
    expect(tablasNoDeclaradas("conciliacion_cierres", conElIntruso)).toEqual([]);
    expect(tablasFueraDe(["cierre_dia"], conElIntruso)).toEqual(["wallet_movimiento"]);

    // (2) Lo que este guardia NO puede hacer, dicho en una asercion y no en un comentario: su
    //     universo es `MODELO_A_TABLA`, las cinco `TablaDinero`, asi que `orden` y `gestion_orden`
    //     le son INVISIBLES por construccion —no aparecen ni con la declaracion mas estrecha—.
    //     Si alguien ampliara este universo, esta linea obliga a decirlo aqui.
    expect(Object.values(MODELO_A_TABLA).sort()).toEqual([...TABLAS_DEL_DINERO].sort());
    expect(tablasConsultadas(conElIntruso)).toEqual(["cierre_dia", "wallet_movimiento"]);
    expect(tablasFueraDe([], conElIntruso)).not.toContain("orden");

    // (3) Y quien SI las caza existe y sigue nombrandolas: el guardia de fuente (R1/R2/R3/R33).
    //     Se comprueba por texto y no importandolo, porque importar otro archivo de test
    //     arrastraria su suite entera dentro de esta.
    const fuente = fs.readFileSync(
      path.join(__dirname, "financiera-fuente.guardia.test.ts"),
      "utf8",
    );
    expect(fuente).toContain("export function fuenteProhibida");
    expect(fuente).toContain("FIXTURE_INFRACTOR_ORDEN");
    expect(fuente).toContain("gestion_orden");
  });
});
