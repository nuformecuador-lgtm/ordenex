import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { granularidadDe, trocear, type CuboTemporal } from "@/lib/analytics/cubo-temporal";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "../db/_postgres-real";

// Feature 180 / T2.4 — LA PARTICION POR CUBO, CONTRA POSTGRES DE VERDAD.
//
// POR QUE ESTE ARCHIVO NO ES OPCIONAL. Los tests de `tests/unit/analytics/financiera-*-cubo-repo`
// miden la FORMA de la consulta (texto con `$n`, parametros, formateo de la respuesta) contra un
// fake. Eso caza al que quite la ventana, al que escriba las categorias a mano o al que se trague
// un error — pero NO puede cazar lo unico que decide si la cifra es correcta:
//
//   1. si `width_bucket` existe en el motor de este entorno (exige PostgreSQL >= 14);
//   2. si el CAST de los limites es el correcto. `fecha_movimiento` es `timestamp(3)` SIN zona; el
//      huso de la SESION de este proceso NO es UTC (aqui es `America/Bogota`). Con `::timestamptz`
//      Postgres leeria el texto del parametro en ese huso y correria TODA frontera de dia varias
//      horas — sin lanzar, sin loguear y con cifras que siguen pareciendo razonables;
//   3. si el reparto en cubos casa con la frontera del dia de Costa Rica que `fecha-cr.ts` define.
//
// Un fake que fingiera `width_bucket` seria una segunda implementacion de Postgres escrita a mano,
// cuyo acuerdo con Postgres nadie comprueba: exactamente el error que este archivo existe para no
// cometer.
//
// TODO CORRE DENTRO DE UNA TRANSACCION QUE SIEMPRE SE REVIERTE. Los tres libros son append-only y
// la base de desarrollo es real: un `afterAll` que borrase por un criterio a mano no da garantia si
// el runner se cae a mitad. Ademas, las fechas sembradas son de **2019** —anteriores a la
// existencia de estos libros—, asi que ni el mas improbable resto de datos reales entra en la
// ventana; hay preconditions explicitas que lo comprueban en vez de suponerlo.
//
// Sin `DATABASE_URL` el bloque se SALTA: la suite tiene que seguir siendo verde en una maquina sin
// Postgres levantado (mismo criterio que `tests/integration/db/busqueda-normalizacion-paridad`).

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2019-03-12T15:00:00.000Z");

/** Tres dias de Costa Rica de 2019: `2019-03-09`, `2019-03-10` y `2019-03-11`. */
const RANGO_CORTO = { rango: "personalizado", desde: "2019-03-09", hasta: "2019-03-11" } as const;

/**
 * LOS DOS INSTANTES QUE DECIDEN TODO. `05:59:59.999Z` es el ultimo milisegundo del 9 de marzo en
 * Costa Rica; `06:00:00.000Z` es el primero del 10. Si el cast estuviera mal, o caen en el MISMO
 * cubo o se desplazan seis horas: las dos cosas las ve este archivo y ninguna otra.
 */
const ULTIMO_MS_DEL_9 = new Date("2019-03-10T05:59:59.999Z");
const PRIMER_MS_DEL_10 = new Date("2019-03-10T06:00:00.000Z");

/** Rango largo (166 dias) para forzar granularidad `semana`. El 16/01/2019 fue MIERCOLES. */
const RANGO_LARGO = { rango: "personalizado", desde: "2019-01-16", hasta: "2019-06-30" } as const;
const DENTRO_DEL_PRIMER_CUBO_RECORTADO = new Date("2019-01-18T12:00:00.000Z"); // viernes
const DENTRO_DE_LA_SEMANA_SIGUIENTE = new Date("2019-01-23T12:00:00.000Z"); // miercoles

/** Corte del arrastre: TRES MESES antes del rango corto. */
const HACE_TRES_MESES = new Date("2018-12-09T14:00:00.000Z");
const DENTRO_DEL_RANGO = new Date("2019-03-10T14:00:00.000Z");

function consultaDe(
  metricaId: string,
  crudo: Record<string, unknown> = { ...RANGO_CORTO },
): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(crudo, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/** Los cubos SALEN de `trocear`: ni una frontera se escribe a mano en este archivo (R11). */
function cubosDe(consulta: ConsultaAnalitica): readonly CuboTemporal[] {
  return trocear(consulta.rango);
}

/** El cliente de la transaccion, con la superficie minima que los repositorios piden. */
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("la particion por cubo temporal, contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /* ------------------------------------------------------------------------ */
  /* 0. El motor tiene lo que la consulta usa                                  */
  /* ------------------------------------------------------------------------ */

  it("el motor es PostgreSQL >= 14 y `width_bucket(anyelement, anyarray)` resuelve de verdad", async () => {
    // Se COMPRUEBA, no se supone: si esta variante no existiera, el design §5.1 obliga a la
    // alternativa `CASE` generada desde el mismo array de limites, y a dejarlo escrito.
    const [{ mayor }] = await prisma.$queryRaw<
      readonly { mayor: number }[]
    >`SELECT (current_setting('server_version_num')::int / 10000) AS mayor`;
    expect(mayor).toBeGreaterThanOrEqual(14);

    const [{ bucket }] = await prisma.$queryRaw<readonly { bucket: number }[]>`
      SELECT width_bucket(
        '2019-03-10T06:00:00.000Z'::timestamp,
        ARRAY['2019-03-09T06:00:00.000Z'::timestamp, '2019-03-10T06:00:00.000Z'::timestamp]
      ) AS bucket`;
    expect(bucket).toBe(2); // 1-based: el segundo limite. El repositorio le resta 1.
  });

  it("el huso de la SESION no es UTC, que es lo que hace peligroso a `::timestamptz`", async () => {
    // Este caso no prueba el repositorio: prueba que el ENTORNO tiene el riesgo que el cast evita.
    // Si algun dia la sesion pasara a ser UTC, el caso de la frontera dejaria de discriminar entre
    // `::timestamp` y `::timestamptz` y habria que decirlo en vez de creerse el verde.
    const [{ tz }] = await prisma.$queryRaw<
      readonly { tz: string }[]
    >`SELECT current_setting('TimeZone') AS tz`;
    expect(tz).not.toBe("UTC");
  });

  /* ------------------------------------------------------------------------ */
  /* 1. R11 — la frontera del dia de Costa Rica                                */
  /* ------------------------------------------------------------------------ */

  it("R11 · dos movimientos separados por UN milisegundo sobre las 06:00Z caen en cubos DISTINTOS", async () => {
    const consulta = consultaDe("ingreso_flete");
    const cubos = cubosDe(consulta);

    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx, consulta);
      await sembrarCaja(tx, [
        { fechaMovimiento: ULTIMO_MS_DEL_9, monto: "11.00" },
        { fechaMovimiento: PRIMER_MS_DEL_10, monto: "22.00" },
      ]);
      return new IngresosAnaliticaRepository(tx).sumarPorCuboYCategoria(consulta, cubos);
    });

    // El troceo dice que hay tres cubos y que el segundo es el dia 10 de Costa Rica.
    expect(cubos.map((c) => c.clave)).toEqual(["2019-03-09", "2019-03-10", "2019-03-11"]);

    // Y la BASE los reparte igual: 11.00 en el cubo del dia 9, 22.00 en el del dia 10.
    // Con el cast equivocado esto sale de una de dos formas, y las dos mueren aqui:
    //   - los dos en el mismo cubo (la frontera se movio fuera del hueco de 1 ms);
    //   - los dos desplazados seis horas (el 22.00 caeria en el cubo del dia 9).
    expect(filas).toEqual([
      { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "11.00" },
      { indiceCubo: 1, categoria: "ingreso_flete", tipo: "ingreso", suma: "22.00" },
    ]);
    expect(filas[0].indiceCubo).not.toBe(filas[1].indiceCubo);
    expect(cubos[filas[1].indiceCubo].clave).toBe("2019-03-10");
  });

  it("R11 · la misma frontera, en el otro libro: `cuentaPorPagarMensajerosPorCubo`", async () => {
    // Los dos repositorios emiten el MISMO cast y por eso los dos tienen su caso. Arreglar uno y
    // olvidar el otro correria la frontera solo en la mitad de las metricas, que es el fallo mas
    // dificil de ver: la mitad de las tarjetas del tablero cuadraria.
    const consulta = consultaDe("cuenta_por_pagar_mensajero");
    const cubos = cubosDe(consulta);

    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      const mensajeroId = await unUsuarioCualquiera(tx);
      await exigirLibroDeMensajerosVacio(tx, consulta);
      await sembrarMensajeros(tx, mensajeroId, [
        { fechaMovimiento: ULTIMO_MS_DEL_9, monto: "11.00" },
        { fechaMovimiento: PRIMER_MS_DEL_10, monto: "22.00" },
      ]);
      return new CuentasPorPagarAnaliticaRepository(tx).cuentaPorPagarMensajerosPorCubo(
        consulta,
        cubos,
      );
    });

    expect(filas).toEqual([
      { indiceCubo: 0, tipo: "devengo", suma: "11.00" },
      { indiceCubo: 1, tipo: "devengo", suma: "22.00" },
    ]);
    expect(cubos[filas[1].indiceCubo].clave).toBe("2019-03-10");
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Un cubo sin movimiento NO aparece                                      */
  /* ------------------------------------------------------------------------ */

  it("un cubo sin movimiento NO vuelve de la base: el relleno denso es del servicio", async () => {
    // La tanda del servicio trabaja CONTRA esto: si la base rellenara los huecos, el servicio no
    // sabria distinguir "cero movimiento" de "sin dato" y el R9 (repetir el saldo anterior en las
    // metricas acumuladas) no tendria donde apoyarse. Queda comprobado aqui, no supuesto.
    const consulta = consultaDe("ingreso_flete");
    const cubos = cubosDe(consulta);

    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx, consulta);
      await sembrarCaja(tx, [{ fechaMovimiento: PRIMER_MS_DEL_10, monto: "33.00" }]);
      return new IngresosAnaliticaRepository(tx).sumarPorCuboYCategoria(consulta, cubos);
    });

    expect(cubos).toHaveLength(3);
    expect(filas).toHaveLength(1);
    expect(filas.map((f) => f.indiceCubo)).toEqual([1]);
    // Los cubos 0 y 2 existen en el troceo y NO tienen fila. No hay ceros de relleno.
    expect(filas.map((f) => f.indiceCubo)).not.toContain(0);
    expect(filas.map((f) => f.indiceCubo)).not.toContain(2);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. R14 — el saldo de arrastre                                             */
  /* ------------------------------------------------------------------------ */

  it("R14 · el arrastre incluye lo devengado TRES MESES antes y excluye lo de dentro del rango", async () => {
    const consulta = consultaDe("cuenta_por_pagar_mensajero");

    const { antes, dentro } = await enTransaccionRevertida(prisma, async (tx) => {
      const mensajeroId = await unUsuarioCualquiera(tx);
      await exigirLibroDeMensajerosVacio(tx, consulta);
      await sembrarMensajeros(tx, mensajeroId, [
        { fechaMovimiento: HACE_TRES_MESES, monto: "5000.00" },
        { fechaMovimiento: DENTRO_DEL_RANGO, monto: "1200.00" },
      ]);
      const repo = new CuentasPorPagarAnaliticaRepository(tx);
      return {
        antes: await repo.cuentaPorPagarMensajerosAntesDe(consulta),
        dentro: await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubosDe(consulta)),
      };
    });

    // El devengo de diciembre SIGUE debiendose en marzo: sin el, la serie acumulada arrancaria en
    // cero y toda la linea quedaria por debajo de su valor real.
    expect(antes).toEqual([{ tipo: "devengo", suma: "5000.00" }]);
    // Y el de dentro del rango NO esta en el arrastre: con `lt: hasta` en vez de `lt: desde`
    // saldrian 6200.00, que es una cifra plausible por la que alguien paga de menos.
    expect(antes[0].suma).not.toBe("6200.00");
    // Ese movimiento existe de verdad —el caso no pasa por libro vacio—: esta en el flujo.
    expect(dentro).toEqual([{ indiceCubo: 1, tipo: "devengo", suma: "1200.00" }]);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Granularidad `semana`                                                  */
  /* ------------------------------------------------------------------------ */

  it("con granularidad `semana`, el primer cubo recortado y la semana siguiente son los indices 0 y 1", async () => {
    const consulta = consultaDe("ingreso_flete", { ...RANGO_LARGO });
    const cubos = cubosDe(consulta);

    // El rango arranca un MIERCOLES: el primer cubo empieza ese dia (no el lunes anterior, que
    // afirmaria contener dinero de dias que el rango excluye) y se corta en el lunes siguiente.
    expect(granularidadDe(consulta.rango)).toBe("semana");
    expect(cubos[0].clave).toBe("2019-01-16");
    expect(cubos[1].clave).toBe("2019-01-21"); // lunes
    expect(cubos[0].hasta).toEqual(cubos[1].desde);

    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx, consulta);
      await sembrarCaja(tx, [
        { fechaMovimiento: DENTRO_DEL_PRIMER_CUBO_RECORTADO, monto: "70.00" },
        { fechaMovimiento: DENTRO_DE_LA_SEMANA_SIGUIENTE, monto: "80.00" },
      ]);
      return new IngresosAnaliticaRepository(tx).sumarPorCuboYCategoria(consulta, cubos);
    });

    expect(filas).toEqual([
      { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "70.00" },
      { indiceCubo: 1, categoria: "ingreso_flete", tipo: "ingreso", suma: "80.00" },
    ]);
    // Y el numero de cubos respeta el techo de puntos por serie, que es para lo que existe la
    // granularidad semanal.
    expect(cubos.length).toBeLessThanOrEqual(62);
  });
});

/* -------------------------------------------------------------------------- */
/* Utilidades de siembra                                                       */
/* -------------------------------------------------------------------------- */

/**
 * PRECONDICION, no adorno: si la ventana ya tuviera dinero real, las igualdades exactas de arriba
 * fallarian por un motivo que no es el que se esta midiendo. Las fechas son de 2019 —anteriores a
 * los tres libros—, asi que esto tiene que ser 0; si algun dia no lo fuera, el test lo dice con un
 * mensaje claro en vez de convertirse en un rojo misterioso.
 */
async function exigirVentanaVacia(tx: Tx, consulta: ConsultaAnalitica): Promise<void> {
  const cuantos = await tx.walletMovimiento.count({
    where: { fechaMovimiento: { gte: consulta.rango.desde, lt: consulta.rango.hasta } },
  });
  expect(cuantos, "la ventana de 2019 ya tenia movimientos de caja: el fixture no es aislado").toBe(
    0,
  );
}

/** Igual que la anterior, para el libro de mensajeros: TODO lo anterior a `rango.hasta`. */
async function exigirLibroDeMensajerosVacio(tx: Tx, consulta: ConsultaAnalitica): Promise<void> {
  const cuantos = await tx.pagoMensajeroMovimiento.count({
    where: { fechaMovimiento: { lt: consulta.rango.hasta } },
  });
  expect(
    cuantos,
    "el libro de mensajeros ya tenia movimientos anteriores a 2019-03-12: el fixture no es aislado",
  ).toBe(0);
}

/** Un usuario cualquiera, solo para satisfacer la FK de `pago_mensajero_movimiento`. */
async function unUsuarioCualquiera(tx: Tx): Promise<string> {
  const usuario = await tx.usuario.findFirst({ select: { id: true } });
  if (usuario === null) throw new Error("no hay ningun usuario en la base: la FK no se puede cumplir");
  return usuario.id;
}

/**
 * Filas COHERENTES con el CHECK `wallet_movimiento_tipo_categoria_check` de la 173:
 * `ingreso_flete` es de tipo `ingreso`. Una fila cruzada la base la rechaza con 23514 — que es
 * justo por lo que el design §7 avisa de no copiar los dobles viejos de la 127.
 */
async function sembrarCaja(
  tx: Tx,
  movimientos: readonly { fechaMovimiento: Date; monto: string }[],
): Promise<void> {
  await tx.walletMovimiento.createMany({
    data: movimientos.map((m) => ({
      tipo: "ingreso" as const,
      categoria: "ingreso_flete" as const,
      monto: m.monto,
      origenTipo: "manual" as const,
      origenId: null,
      descripcion: "feature 180 / T2.4 — siembra de test (transaccion revertida)",
      fechaMovimiento: m.fechaMovimiento,
    })),
  });
}

/** Idem para el libro de mensajeros: `pago_devengado` es de tipo `devengo` (CHECK de la 44). */
async function sembrarMensajeros(
  tx: Tx,
  mensajeroId: string,
  movimientos: readonly { fechaMovimiento: Date; monto: string }[],
): Promise<void> {
  await tx.pagoMensajeroMovimiento.createMany({
    data: movimientos.map((m) => ({
      mensajeroId,
      tipo: "devengo" as const,
      categoria: "pago_devengado" as const,
      monto: m.monto,
      origenTipo: "manual" as const,
      origenId: null,
      descripcion: "feature 180 / T2.4 — siembra de test (transaccion revertida)",
      fechaMovimiento: m.fechaMovimiento,
    })),
  });
}
