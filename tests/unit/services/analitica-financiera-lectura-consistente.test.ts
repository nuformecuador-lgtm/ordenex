import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  IDS_FINANCIERAS_SERVIDAS,
  tieneDesglosePorFecha,
} from "@/lib/types/analitica-financiera";
import { armarServicio, consultaDe } from "./_dobles-analitica-financiera";

// Feature 187 (T3.2) — EL SERVICIO COMPONE SUS LECTURAS DENTRO DE UN ALCANCE: R1, R5, R6 y R8.
//
// LO QUE ESTE ARCHIVO NO ES. No es un test de que «se llamo a `enLecturaConsistente`». Eso lo
// cumpliria igual un servicio que abriera el alcance, lo cerrara y consultara al lado, que es
// literalmente el bug que la 187 vino a cerrar. Lo que se afirma aqui es mas fuerte y solo es
// posible porque el doble REGISTRA apertura, cierre y el alcance vigente de cada lectura
// (`_dobles-analitica-financiera.ts`): que las lecturas de una vista cayeron DENTRO, y dentro del
// MISMO alcance.
//
// LO QUE TAMPOCO ES. No dice nada de Postgres, ni de transacciones, ni de niveles de aislamiento:
// eso vive en el repositorio y lo miden `tests/unit/analytics/financiera-lectura-consistente.test.ts`
// y el test de integracion. Aqui la frontera que se prueba es la composicion del servicio.
//
// LOS IDS NO SE ESCRIBEN A MANO. El caso parametrico recorre
// `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` y el de las metricas de fuera sale de su complemento
// sobre `IDS_FINANCIERAS_SERVIDAS`. Es lo unico compatible con el R2 de la 180 y con
// `financiera-desglose-ids.guardia.test.ts`, y ademas es lo que hace que una metrica nueva del
// conjunto entre en este archivo sola, sin que nadie tenga que acordarse.

async function consultar(metricaId: string) {
  const armado = armarServicio();
  const r = await armado.servicio.consultar(consultaDe(metricaId));
  if (r.status !== "ok") throw new Error(`${metricaId} no devolvio ok: ${r.status}`);
  return armado;
}

/* -------------------------------------------------------------------------- */
/* 1. R1 — las lecturas de una vista caen dentro del MISMO alcance             */
/* -------------------------------------------------------------------------- */

describe("R1 · las lecturas que componen una vista comparten un unico alcance", () => {
  it("las DOS lecturas de la caja ocurren dentro del MISMO alcance abierto", async () => {
    const { alcances } = await consultar("ingreso_flete");

    expect(alcances.aperturas()).toBe(1);
    expect(alcances.lecturas().map((l) => l.nombre)).toEqual([
      "sumarPorCategoria",
      "sumarPorCuboYCategoria",
    ]);
    // Ni una lectura fuera (`null`), y las dos con el mismo id de alcance.
    expect(alcances.alcancesDeLasLecturas()).toEqual([0, 0]);
  });

  it("la de mensajeros mete sus TRES lecturas en uno solo, no en tres", async () => {
    const { alcances } = await consultar("cuenta_por_pagar_mensajero");

    expect(alcances.aperturas()).toBe(1);
    expect(alcances.lecturas().map((l) => l.nombre)).toEqual([
      "cuentaPorPagarMensajerosAlCorte",
      "cuentaPorPagarMensajerosAntesDe",
      "cuentaPorPagarMensajerosPorCubo",
    ]);
    expect(alcances.alcancesDeLasLecturas()).toEqual([0, 0, 0]);
  });

  it("y el alcance se CIERRA: no queda abierto despues de servir la vista", async () => {
    // Un alcance que no se cierra es una conexion del pool retenida por cada consulta del
    // tablero. El registro lo ve porque apunta cierres, no solo aperturas.
    const { alcances } = await consultar("egresos");
    expect(alcances.eventos.filter((e) => e.tipo === "cierra")).toHaveLength(1);
    expect(alcances.eventos[alcances.eventos.length - 1].tipo).toBe("cierra");
  });

  it("LAS SIETE del conjunto con desglose abren UN alcance y no leen nada fuera de el", async () => {
    for (const metricaId of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const { alcances } = await consultar(metricaId);

      expect(alcances.aperturas(), metricaId).toBe(1);
      expect(alcances.lecturas().length, metricaId).toBeGreaterThan(1);
      // Todas dentro, y todas dentro del mismo. `null` seria una lectura al lado del alcance.
      expect(new Set(alcances.alcancesDeLasLecturas()), metricaId).toEqual(new Set([0]));
    }
  });

  it("el caso parametrico no pasa por vacio: el conjunto tiene las siete", () => {
    // Si `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` se vaciara, el bucle de arriba quedaria verde
    // sin comprobar nada. La longitud se ancla igual que en `financiera-desglose-ids.guardia`.
    expect(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA).toHaveLength(7);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. R5 — el numero de lecturas NO baja: siguen siendo dos caminos (o tres)   */
/* -------------------------------------------------------------------------- */

describe("R5 · el total sigue saliendo de su propia consulta", () => {
  it("la caja hace DOS lecturas, ni una menos: el total no se deriva de las filas", async () => {
    const { consultasHechas, ingresos } = await consultar("ingreso_flete");

    expect(consultasHechas()).toBe(2);
    expect(ingresos.sumarPorCategoria).toHaveBeenCalledTimes(1);
    expect(ingresos.sumarPorCuboYCategoria).toHaveBeenCalledTimes(1);
  });

  it("la cuenta de mensajeros hace TRES lecturas y no dos", async () => {
    // El corte, el arrastre y el movimiento por cubo. Si alguien fundiera el total con la serie,
    // esta cifra bajaria a dos y la invariante R13 de la 180 pasaria a ser una tautologia.
    const { consultasHechas, cuentasPorPagar } = await consultar("cuenta_por_pagar_mensajero");

    expect(consultasHechas()).toBe(3);
    expect(cuentasPorPagar.cuentaPorPagarMensajerosAlCorte).toHaveBeenCalledTimes(1);
    expect(cuentasPorPagar.cuentaPorPagarMensajerosAntesDe).toHaveBeenCalledTimes(1);
    expect(cuentasPorPagar.cuentaPorPagarMensajerosPorCubo).toHaveBeenCalledTimes(1);
  });

  it("abrir un alcance NO cuenta como consulta: `consultasHechas()` mide lo mismo que antes", async () => {
    // Es la razon por la que las suites de la 180 y la 127 pasan sin editar ni una asercion
    // (T5.1). Si `enLecturaConsistente` entrara en el censo de espias, `consultasHechas() === 2`
    // valdria 3 y esta feature habria roto su propia promesa.
    const { consultasHechas, alcances } = await consultar("dinero_en_caja");
    expect(alcances.aperturas()).toBe(1);
    expect(consultasHechas()).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R8 — las tres de fuera no abren ningun alcance                           */
/* -------------------------------------------------------------------------- */

/** El complemento del conjunto, derivado y no escrito: `cod_recaudado` y las otras dos. */
const SIN_DESGLOSE_POR_FECHA = IDS_FINANCIERAS_SERVIDAS.filter((id) => !tieneDesglosePorFecha(id));

describe("R8 · las metricas de fuera del conjunto no abren ninguna lectura consistente", () => {
  it("son exactamente tres, y son las que el alcance de la 187 deja fuera", () => {
    expect(SIN_DESGLOSE_POR_FECHA).toHaveLength(3);
  });

  it("ninguna de las tres abre un alcance, y todas leen fuera de cualquiera", async () => {
    for (const metricaId of SIN_DESGLOSE_POR_FECHA) {
      const { alcances } = await consultar(metricaId);

      expect(alcances.aperturas(), metricaId).toBe(0);
      expect(alcances.lecturas().length, metricaId).toBeGreaterThan(0);
      // `null` aqui es lo CORRECTO: R8 pide que su comportamiento sea identico al de antes.
      expect(new Set(alcances.alcancesDeLasLecturas()), metricaId).toEqual(new Set([null]));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R6 — el servicio no habla Prisma                                         */
/* -------------------------------------------------------------------------- */

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SERVICIO = "lib/services/AnaliticaFinancieraService.ts";

/**
 * La prosa SI puede nombrar la transaccion —el comentario de `deCaja` explica que desde la 187 las
 * dos consultas van bajo un mismo snapshot, y censar eso convertiria la explicacion en una
 * infraccion—, asi que el censo mira solo el codigo.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Los identificadores de Prisma que el servicio no puede escribir (R6). `prisma.` va en
 * minuscula a proposito: `Prisma.Decimal` es legitimo y necesario —el servicio SUMA en decimal—,
 * lo prohibido es tener un cliente.
 */
const HUELLAS_DE_PRISMA: readonly RegExp[] = [
  /\$transaction/,
  /isolationLevel/,
  /RepeatableRead/,
  /\bprisma\./,
  /\$queryRaw/,
];

export function hablaPrisma(nombre: string, fuente: string): string[] {
  const codigo = soloCodigo(fuente);
  return HUELLAS_DE_PRISMA.filter((h) => h.test(codigo)).map(
    (h) => `${nombre}: menciona ${h.source}, que es vocabulario de ORM y no de dominio (R6)`,
  );
}

describe("R6 · el servicio no conoce la transaccion ni el nivel de aislamiento", () => {
  it("el censo lee el servicio de verdad, y el servicio si usa el alcance", () => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, SERVICIO), "utf8");
    expect(fuente.length).toBeGreaterThan(500);
    // Sin esto, «no menciona `$transaction`» seria verdad tambien en un servicio que no hubiera
    // adoptado la lectura consistente. Que la use es la otra mitad del requisito.
    expect(fuente).toContain("enLecturaConsistente");
  });

  it("no menciona $transaction, isolationLevel, RepeatableRead ni un cliente prisma", () => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, SERVICIO), "utf8");
    expect(hablaPrisma(SERVICIO, fuente)).toEqual([]);
  });

  it("CONTRA-CASO · el censo caza el servicio que abriera la transaccion por su cuenta", () => {
    const legitimo = `
      const [filas, porCubo] = await this.ingresos.enLecturaConsistente(async (r) => [
        await r.sumarPorCategoria(consulta),
        await r.sumarPorCuboYCategoria(consulta, cubos),
      ] as const);
      const total = new Prisma.Decimal(0);
    `;
    expect(hablaPrisma("legitimo.ts", legitimo)).toEqual([]);

    const infractor = `
      const [filas, porCubo] = await this.prisma.$transaction(
        async (tx) => [await tx.walletMovimiento.groupBy({}), []],
        { isolationLevel: "RepeatableRead" },
      );
    `;
    expect(hablaPrisma("infractor.ts", infractor).length).toBeGreaterThanOrEqual(4);
  });

  it("y no marca la PROSA que explica por que el servicio no abre nada", () => {
    const conProsa = `
      // Desde la 187 esto va bajo un mismo snapshot; el $transaction con
      // isolationLevel: "RepeatableRead" vive en el repositorio, no aqui.
      const x = await this.ingresos.enLecturaConsistente(async (r) => r.sumarPorCategoria(c));
    `;
    expect(hablaPrisma("prosa.ts", conProsa)).toEqual([]);
  });
});
