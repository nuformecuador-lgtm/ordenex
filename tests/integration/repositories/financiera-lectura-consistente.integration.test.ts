import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { prepararConsultaAnalitica, type ConsultaAnalitica } from "@/lib/analytics/consulta";
import { trocear, type CuboTemporal } from "@/lib/analytics/cubo-temporal";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "../db/_postgres-real";

// Feature 187 / T6.1 y T6.2 — LA MITAD QUE SOLO POSTGRES PUEDE DEMOSTRAR.
//
// Los tests unitarios de `tests/unit/analytics/financiera-lectura-consistente.test.ts` miden la
// FORMA: que el repositorio pide `$transaction` con `isolationLevel: "RepeatableRead"`, que todas
// las consultas del alcance salen por el cliente transaccional y que dentro solo hay lecturas. Eso
// caza a quien quite la opcion o se salte el alcance — pero NO puede demostrar las dos cosas que
// deciden si la feature sirve para algo:
//
//   I1. que esa opcion de Prisma ATERRICE de verdad en la sesion de Postgres. Este repo no tenia
//       hasta hoy ni un `isolationLevel` explicito en produccion (`design.md` §3.2), asi que el
//       hecho de que el nivel llegue no es folklore heredado: se mide.
//   I2. que el snapshot SOSTENGA la invariante de la 180 (R12: Σ filas == total) con una escritura
//       AJENA Y CONFIRMADA en medio. Es el unico test que falsa R4.
//
// POR QUE ESTE ARCHIVO SI ESCRIBE, cuando `financiera-cubo-temporal.integration.test.ts` no.
// `enTransaccionRevertida` (`tests/integration/db/_postgres-real.ts`) NO SIRVE AQUI, y no es un
// descuido: su transaccion nunca commitea, y una escritura sin confirmar es justamente la que el
// lector NO deberia ver ni con snapshot ni sin el. Falsar R4 exige una escritura CONFIRMADA por
// otra conexion mientras el lector tiene el suyo abierto. Autorizado por el humano el 2026-08-08
// (Q1 de `requirements.md` §7, opcion (a)) con estas condiciones, que este archivo cumple:
//
//   - fechas de **2019**, anteriores a la existencia de los tres libros de dinero;
//   - ids uuid CONOCIDOS y fijos, escritos aqui;
//   - precondicion de ventana vacia ANTES de sembrar: si hubiera dinero real ahi, el test para con
//     un mensaje claro en vez de mezclarse con el;
//   - borrado por id en un `finally`, pase lo que pase.
//
// Riesgo residual, declarado y aceptado: si el runner muere entre el INSERT y el `finally`, quedan
// dos o tres filas de 2019 en la base de DESARROLLO. Son localizables por sus ids, que estan
// escritos abajo.
//
// Sin `DATABASE_URL` el bloque se SALTA, no falla (mismo criterio que el resto de
// `tests/integration/`): la suite tiene que seguir verde en una maquina sin Postgres.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2019-03-12T15:00:00.000Z");
const RANGO = { rango: "personalizado", desde: "2019-03-09", hasta: "2019-03-11" } as const;

/** Dentro de la ventana, en el dia 10 de Costa Rica. */
const DENTRO_DEL_RANGO = new Date("2019-03-10T14:00:00.000Z");

/**
 * Ids FIJOS, no generados: si el runner muere a mitad, estas tres filas se borran a mano con un
 * `DELETE ... WHERE id IN (...)`. Un uuid aleatorio dejaria basura anonima en un libro append-only.
 */
const ID_PREEXISTENTE = "f187aaaa-0000-4000-8000-000000000001";
const ID_ESCRITURA_CON_ALCANCE = "f187aaaa-0000-4000-8000-000000000002";
const ID_ESCRITURA_SIN_ALCANCE = "f187aaaa-0000-4000-8000-000000000003";
const TODOS_LOS_IDS = [ID_PREEXISTENTE, ID_ESCRITURA_CON_ALCANCE, ID_ESCRITURA_SIN_ALCANCE];

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type ClienteDeIngresos = ConstructorParameters<typeof IngresosAnaliticaRepository>[0];

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ ...RANGO }, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/** Los cubos SALEN de `trocear`: ni una frontera se escribe a mano aqui. */
function cubosDe(consulta: ConsultaAnalitica): readonly CuboTemporal[] {
  return trocear(consulta.rango);
}

/** Σ de importes como decimal, nunca como `number`: es dinero. */
function sumar(filas: readonly { readonly suma: string }[]): string {
  return filas
    .reduce((acc, f) => acc.add(new Prisma.Decimal(f.suma)), new Prisma.Decimal(0))
    .toFixed(2);
}

describeSiHayBase("la lectura consistente de la analitica financiera, contra Postgres", () => {
  let prisma: PrismaClient;
  /** SEGUNDA conexion: la que confirma escrituras mientras la primera tiene el snapshot abierto. */
  let escritor: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    escritor = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.walletMovimiento.deleteMany({ where: { id: { in: TODOS_LOS_IDS } } });
    await Promise.all([prisma.$disconnect(), escritor.$disconnect()]);
  });

  /* ------------------------------------------------------------------------ */
  /* I1 — el nivel de aislamiento aterriza de verdad (R2)                       */
  /* ------------------------------------------------------------------------ */

  it("I1 · dentro del alcance la sesion dice `repeatable read`, y fuera dice otra cosa", async () => {
    const consulta = consultaDe("ingreso_flete");

    // El contra-caso va PRIMERO y es la mitad que hace significativo al caso: si la sesion ya
    // estuviera en `repeatable read` por configuracion del servidor, el caso de abajo pasaria sin
    // que el repositorio hiciera nada. Postgres por defecto es `read committed`.
    const [{ nivel: fuera }] = await prisma.$queryRaw<
      readonly { nivel: string }[]
    >`SELECT current_setting('transaction_isolation') AS nivel`;
    expect(fuera).not.toBe("repeatable read");

    const { cliente, txDeLaLectura } = clienteQueCapturaLaTransaccion(prisma);

    const nivelDentro = await new IngresosAnaliticaRepository(cliente).enLecturaConsistente(
      async (r) => {
        // Una lectura de verdad del repositorio, para que el alcance no este vacio.
        await r.sumarPorCategoria(consulta);
        const [{ nivel }] = await txDeLaLectura().$queryRaw<
          readonly { nivel: string }[]
        >`SELECT current_setting('transaction_isolation') AS nivel`;
        return nivel;
      },
    );

    expect(nivelDentro).toBe("repeatable read");
  });

  /* ------------------------------------------------------------------------ */
  /* I2 — la invariante bajo escritura confirmada (R4)                          */
  /* ------------------------------------------------------------------------ */

  it("I2 · con una escritura confirmada entre las dos lecturas, Σ filas sigue igual al total", async () => {
    const consulta = consultaDe("ingreso_flete");
    const cubos = cubosDe(consulta);

    try {
      await exigirVentanaVacia(prisma, consulta);
      // Dinero preexistente y confirmado: sin el, el caso compararia 0 contra 0 y pasaria aunque
      // el alcance no existiera.
      await sembrar(escritor, ID_PREEXISTENTE, "30.00");

      const [total, porCubo] = await new IngresosAnaliticaRepository(prisma).enLecturaConsistente(
        async (r) => {
          const t = await r.sumarPorCategoria(consulta);
          // AQUI, con el snapshot ya fijado por la sentencia de arriba, otra conexion CONFIRMA
          // dinero nuevo dentro de la misma ventana.
          await sembrar(escritor, ID_ESCRITURA_CON_ALCANCE, "33.00");
          const c = await r.sumarPorCuboYCategoria(consulta, cubos);
          return [t, c] as const;
        },
      );

      // Ninguna de las dos lecturas ve los 33.00: las dos miran la misma foto.
      expect(sumar(total)).toBe("30.00");
      expect(sumar(porCubo)).toBe("30.00");
      expect(sumar(porCubo)).toBe(sumar(total));
    } finally {
      await limpiar(prisma);
    }
  });

  it("I2b · contra-caso — SIN alcance, las mismas dos lecturas discrepan", async () => {
    const consulta = consultaDe("ingreso_flete");
    const cubos = cubosDe(consulta);
    const repo = new IngresosAnaliticaRepository(prisma);

    try {
      await exigirVentanaVacia(prisma, consulta);
      await sembrar(escritor, ID_PREEXISTENTE, "30.00");

      // Exactamente la misma secuencia de antes, sin el alcance. Esta es la mitad que demuestra
      // que el caso de arriba muerde: si esto tambien cuadrara, la feature no estaria arreglando
      // nada y el verde de I2 seria una casualidad del entorno.
      const total = await repo.sumarPorCategoria(consulta);
      await sembrar(escritor, ID_ESCRITURA_SIN_ALCANCE, "33.00");
      const porCubo = await repo.sumarPorCuboYCategoria(consulta, cubos);

      expect(sumar(total)).toBe("30.00");
      expect(sumar(porCubo)).toBe("63.00");
      expect(sumar(porCubo)).not.toBe(sumar(total));
    } finally {
      await limpiar(prisma);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Un cliente que delega en el real pero se queda con el `tx` que Prisma entrega.
 *
 * Hace falta para I1 y no es una trampa: `enLecturaConsistente` entrega a `fn` un
 * `IIngresosAnaliticaRepository` —vocabulario de dominio, sin `$queryRaw`, que es justo lo que R6
 * exige—, asi que preguntarle a la sesion por su nivel de aislamiento no se puede hacer por esa
 * puerta. Lo que se mide sigue siendo lo del repositorio: la transaccion la abre EL, con SUS
 * opciones; aqui solo se sostiene el asa para poder preguntar dentro.
 */
function clienteQueCapturaLaTransaccion(prisma: PrismaClient): {
  cliente: ClienteDeIngresos;
  txDeLaLectura: () => Tx;
} {
  let capturado: Tx | null = null;
  const cliente = {
    walletMovimiento: prisma.walletMovimiento,
    $queryRaw: prisma.$queryRaw.bind(prisma),
    $transaction: (fn: (tx: Tx) => Promise<unknown>, opciones?: unknown) =>
      (
        prisma.$transaction as unknown as (
          f: (tx: Tx) => Promise<unknown>,
          o?: unknown,
        ) => Promise<unknown>
      )(async (tx) => {
        capturado = tx;
        return fn(tx);
      }, opciones),
  } as unknown as ClienteDeIngresos;

  return {
    cliente,
    txDeLaLectura: () => {
      if (capturado === null) throw new Error("la transaccion no se llego a abrir");
      return capturado;
    },
  };
}

/**
 * PRECONDICION, no adorno: las igualdades exactas de arriba se miden en cifras concretas
 * (`30.00`, `63.00`). Si la ventana de 2019 ya tuviera dinero, fallarian por un motivo que no es
 * el que se esta midiendo, y el rojo seria un misterio en vez de un mensaje.
 */
async function exigirVentanaVacia(
  prisma: PrismaClient,
  consulta: ConsultaAnalitica,
): Promise<void> {
  const cuantos = await prisma.walletMovimiento.count({
    where: { fechaMovimiento: { gte: consulta.rango.desde, lt: consulta.rango.hasta } },
  });
  expect(
    cuantos,
    "la ventana de 2019 ya tenia movimientos de caja: el fixture no es aislado y NO se siembra encima",
  ).toBe(0);
}

/**
 * Siembra CONFIRMADA (fuera de cualquier transaccion del test), que es lo que la hace util: una
 * escritura sin commit no la veria ningun lector, con snapshot o sin el.
 *
 * Fila coherente con el CHECK `wallet_movimiento_tipo_categoria_check` de la 173: `ingreso_flete`
 * es de tipo `ingreso`.
 */
async function sembrar(escritor: PrismaClient, id: string, monto: string): Promise<void> {
  await escritor.walletMovimiento.create({
    data: {
      id,
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto,
      origenTipo: "manual",
      origenId: null,
      descripcion: "feature 187 / T6.2 — siembra de test, borrada en el finally",
      fechaMovimiento: DENTRO_DEL_RANGO,
    },
  });
}

/** Borrado por id, nunca por criterio: lo que este test crea es exactamente lo que borra. */
async function limpiar(prisma: PrismaClient): Promise<void> {
  await prisma.walletMovimiento.deleteMany({ where: { id: { in: TODOS_LOS_IDS } } });
}
