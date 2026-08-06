import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { trocear, type CuboTemporal } from "@/lib/analytics/cubo-temporal";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import {
  fakePrismaDinero,
  fakePrismaQueFalla,
  type ConsultaCrudaFake,
  type FilaLedgerMensajero,
} from "./_fake-prisma-dinero";

// Feature 180 / T2.5 — los DOS metodos nuevos de `CuentasPorPagarAnaliticaRepository`:
// `cuentaPorPagarMensajerosPorCubo` (el MOVIMIENTO de cada cubo) y
// `cuentaPorPagarMensajerosAntesDe` (el SALDO DE ARRASTRE anterior al rango).
//
// La asimetria entre los dos es intencionada y es lo que este archivo protege:
//
//   - `...PorCubo` es un FLUJO acotado a `[rango.desde, rango.hasta)`, particionado por cubo. Se
//     mide por la FORMA DE LA CONSULTA CRUDA emitida (texto con `$n` + parametros), porque un fake
//     no ejecuta `width_bucket` y fingirlo seria una segunda implementacion de Postgres. La
//     semantica la mide la base de verdad en
//     `tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`.
//   - `...AntesDe` es un SALDO con UNA sola cota, `< rango.desde`, y **sin ninguna cota inferior**.
//     Ese metodo si es un `groupBy` normal, asi que se mide contra el libro en memoria del fake:
//     por el VALOR (un devengo de hace tres meses sigue contando) y por la FORMA del `where` (no
//     hay `gte` ni `gt`). Las dos aserciones hacen falta: la del valor sola se podria "arreglar"
//     moviendo el corte a otro sitio, y la de la forma sola pasaria con un libro vacio.
//
// Por que importa tanto: si `...AntesDe` cortara en `hasta` en vez de en `desde`, o si alguien le
// añadiera un `gte`, la serie acumulada arrancaria demasiado abajo. No rompe nada, no lanza y no se
// loguea: da una cifra creible por la que alguien le paga de menos a un mensajero.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-03-12T15:00:00.000Z");

/** TRES dias de Costa Rica: con un solo cubo, el orden de los limites no significaria nada. */
const RANGO_CRUDO = { rango: "personalizado", desde: "2026-03-09", hasta: "2026-03-11" } as const;
const DESDE = new Date("2026-03-09T06:00:00.000Z");
const HASTA = new Date("2026-03-12T06:00:00.000Z");

const HACE_TRES_MESES = new Date("2025-12-09T14:00:00.000Z");
const DENTRO = new Date("2026-03-10T14:00:00.000Z");
/** El instante EXACTO en que arranca el rango: para `...AntesDe` es el primero que queda fuera. */
const JUSTO_EN_DESDE = DESDE;

function consultaDe(metricaId = "cuenta_por_pagar_mensajero"): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(RANGO_CRUDO, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/** Los cubos SALEN DE `trocear` (R22): ni uno se escribe a mano aqui. */
function cubosDe(consulta: ConsultaAnalitica): readonly CuboTemporal[] {
  return trocear(consulta.rango);
}

/* -------------------------------------------------------------------------- */
/* El libro del arrastre                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Cada fila esta por un motivo, y tres estan para NO entrar en el arrastre. Sin ellas, este archivo
 * pasaria por conjunto vacio: hay un caso al final que lo comprueba.
 */
const LEDGER: readonly FilaLedgerMensajero[] = [
  // ANTES del rango: es lo que se le sigue debiendo. Tiene que ENTRAR.
  { mensajeroId: "m-1", categoria: "pago_devengado", tipo: "devengo", monto: "5000.00", fechaMovimiento: HACE_TRES_MESES },
  { mensajeroId: "m-2", categoria: "pago_efectivo", tipo: "pago", monto: "1500.00", fechaMovimiento: HACE_TRES_MESES },
  // El instante EXACTO de `rango.desde`: el corte es ESTRICTO, asi que queda FUERA.
  { mensajeroId: "m-1", categoria: "pago_devengado", tipo: "devengo", monto: "111.00", fechaMovimiento: JUSTO_EN_DESDE },
  // DENTRO del rango: es flujo del periodo, no arrastre. FUERA.
  { mensajeroId: "m-2", categoria: "pago_devengado", tipo: "devengo", monto: "1200.00", fechaMovimiento: DENTRO },
  { mensajeroId: "m-1", categoria: "pago_efectivo", tipo: "pago", monto: "800.00", fechaMovimiento: DENTRO },
  // DESPUES del rango: fuera por los dos lados.
  { mensajeroId: "m-2", categoria: "pago_devengado", tipo: "devengo", monto: "999.00", fechaMovimiento: HASTA },
];

type FilaCruda = Record<string, unknown>;

const RESPUESTA_POR_CUBO: readonly FilaCruda[] = [
  { indiceCubo: 0, tipo: "devengo", suma: new Prisma.Decimal("1200") },
  { indiceCubo: 0, tipo: "pago", suma: new Prisma.Decimal("800.5") },
  { indiceCubo: 2, tipo: "devengo", suma: new Prisma.Decimal("42.25") },
];

function repositorio(
  ledgerMensajero: readonly FilaLedgerMensajero[] = LEDGER,
  respuestaCruda: readonly FilaCruda[] = RESPUESTA_POR_CUBO,
) {
  const fake = fakePrismaDinero({ ledgerMensajero, respuestaCruda: () => respuestaCruda });
  return { repo: new CuentasPorPagarAnaliticaRepository(fake.cliente), fake };
}

function sqlEmitido(fake: ReturnType<typeof repositorio>["fake"], i = 0): ConsultaCrudaFake {
  const llamada = fake.llamadas[i];
  expect(llamada.operacion, "el repositorio no emitio ningun $queryRaw").toBe("queryRaw");
  return { texto: llamada.args.texto as string, valores: llamada.args.valores as unknown[] };
}

function whereDe(fake: ReturnType<typeof repositorio>["fake"], i = 0): Record<string, unknown> {
  return fake.llamadas[i].args.where as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* EL SALDO DE ARRASTRE — la cota que no esta                                  */
/* -------------------------------------------------------------------------- */

describe("el saldo de arrastre mira TODO el libro anterior al rango, sin cota inferior", () => {
  it("un devengo de hace tres meses sigue contando hoy", async () => {
    const { repo } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosAntesDe(consultaDe());

    // 5000 de devengo y 1500 de pago, los dos de hace tres meses, y NADA mas.
    expect(filas).toEqual([
      { tipo: "devengo", suma: "5000.00" },
      { tipo: "pago", suma: "1500.00" },
    ]);
  });

  it("y NO incluye el movimiento que ocurre dentro del rango: eso es flujo, no arrastre", async () => {
    const { repo } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosAntesDe(consultaDe());

    // Si el corte se moviera de `desde` a `hasta`, el devengo seria 5000 + 111 + 1200 = 6311 y el
    // pago 1500 + 800 = 2300. La serie acumulada arrancaria por encima de su valor real.
    expect(filas.find((f) => f.tipo === "devengo")?.suma).not.toBe("6311.00");
    expect(filas.find((f) => f.tipo === "pago")?.suma).not.toBe("2300.00");
    expect(LEDGER.some((f) => f.fechaMovimiento.getTime() === DENTRO.getTime())).toBe(true);
  });

  it("su UNICA cota es `< rango.desde`: el `where` no tiene ni `gte` ni `gt` ni nada mas", async () => {
    // Esta es la asercion que muere si alguien le añade una cota inferior. Se escribe como
    // igualdad de claves y no como `not.toHaveProperty`, porque una igualdad tambien caza la cota
    // que nadie ha imaginado todavia (`gte`, `gt`, `in`, `equals`...).
    const consulta = consultaDe();
    const { repo, fake } = repositorio();
    await repo.cuentaPorPagarMensajerosAntesDe(consulta);

    const fecha = whereDe(fake).fechaMovimiento as Record<string, unknown>;
    expect(Object.keys(fecha)).toEqual(["lt"]);
    expect(fecha.lt).toEqual(consulta.rango.desde);
    expect(fecha).not.toHaveProperty("gte");
    expect(fecha).not.toHaveProperty("gt");
    // Y el `where` entero no tiene nada mas: ni categoria, ni mensajero, ni un segundo campo.
    expect(Object.keys(whereDe(fake))).toEqual(["fechaMovimiento"]);
  });

  it("el corte es `rango.desde`, NO `rango.hasta`: es la hermana del saldo al corte, no ella misma", async () => {
    const consulta = consultaDe();
    const { repo, fake } = repositorio();
    await repo.cuentaPorPagarMensajerosAntesDe(consulta);
    await repo.cuentaPorPagarMensajerosAlCorte(consulta);

    const antes = (whereDe(fake, 0).fechaMovimiento as Record<string, unknown>).lt;
    const alCorte = (whereDe(fake, 1).fechaMovimiento as Record<string, unknown>).lt;
    expect(antes).toEqual(DESDE);
    expect(alCorte).toEqual(HASTA);
    // Los dos cortes son DISTINTOS. Si alguien igualara uno al otro, este caso lo dice; los dos
    // metodos existen precisamente porque cortan en sitios diferentes.
    expect(antes).not.toEqual(alCorte);
  });

  it("el corte es estricto: el movimiento del instante exacto de `desde` queda FUERA", async () => {
    const { repo } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosAntesDe(consultaDe());

    // Con `lte` en vez de `lt`, el devengo seria 5111.00. El de las 00:00 CR del primer dia del
    // rango es del rango, no del arrastre.
    expect(filas.find((f) => f.tipo === "devengo")?.suma).toBe("5000.00");
    expect(LEDGER.some((f) => f.fechaMovimiento.getTime() === DESDE.getTime())).toBe(true);
  });

  it("no lleva mensajeroId ni en la firma, ni en el groupBy, ni en la respuesta (R24)", async () => {
    const { repo, fake } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosAntesDe(consultaDe());

    expect(fake.llamadas[0].args.by).toEqual(["tipo"]);
    for (const fila of filas) expect(Object.keys(fila).sort()).toEqual(["suma", "tipo"]);
    expect(JSON.stringify(filas)).not.toContain("m-1");
    expect(JSON.stringify(filas)).not.toContain("m-2");
    expect(CuentasPorPagarAnaliticaRepository.prototype.cuentaPorPagarMensajerosAntesDe).toHaveLength(1);
  });

  it("pide orden explicito por tipo y dos ejecuciones dan lo mismo (R26)", async () => {
    const consulta = consultaDe();
    const { repo, fake } = repositorio();
    const a = await repo.cuentaPorPagarMensajerosAntesDe(consulta);
    const b = await repo.cuentaPorPagarMensajerosAntesDe(consulta);

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ tipo: "asc" }]);
  });

  it("el importe es cadena de escala 2 y no pasa por `number` (R16)", async () => {
    // `SUM(monto)` es `numeric` sin limite de precision (la cota `Decimal(12,2)` es de la columna,
    // no del agregado): un libro append-only de años llega aqui. Por `number` sale ...99.98, un
    // centimo menos, sin error y sin log.
    const gordo = "99999999999999.99";
    const { repo } = repositorio([
      { mensajeroId: "m-1", categoria: "pago_devengado", tipo: "devengo", monto: gordo, fechaMovimiento: HACE_TRES_MESES },
    ]);
    const filas = await repo.cuentaPorPagarMensajerosAntesDe(consultaDe());

    expect(filas).toEqual([{ tipo: "devengo", suma: gordo }]);
    expect(typeof filas[0].suma).toBe("string");
    expect(filas[0].suma).not.toBe(Number(gordo).toFixed(2));
    expect(Number(gordo).toFixed(2)).toBe("99999999999999.98"); // la mentira, dicha aparte
  });

  it("un fallo de la base sube TAL CUAL (R25)", async () => {
    const caida = new Error("could not connect to server: Connection refused");
    const repo = new CuentasPorPagarAnaliticaRepository(fakePrismaQueFalla(caida));
    // `toBe`, no `toThrow`: la identidad del objeto. Un `catch (e) { throw new Error(...) }`
    // pasaria un `toThrow` y perderia el codigo de Postgres por el camino.
    await expect(repo.cuentaPorPagarMensajerosAntesDe(consultaDe())).rejects.toBe(caida);
  });
});

/* -------------------------------------------------------------------------- */
/* EL MOVIMIENTO POR CUBO — la forma de la consulta cruda                      */
/* -------------------------------------------------------------------------- */

describe("el movimiento por cubo lee la ventana del rango y reparte por los cubos recibidos", () => {
  it("filtra por `>= desde` y `< hasta`, con los dos instantes como parametros", async () => {
    const consulta = consultaDe();
    const { repo, fake } = repositorio();
    await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubosDe(consulta));

    const { texto, valores } = sqlEmitido(fake);
    expect(texto).toMatch(/fecha_movimiento\s*>=\s*\$\d+::timestamp/);
    expect(texto).toMatch(/fecha_movimiento\s*<\s+\$\d+::timestamp/);
    expect(texto).not.toMatch(/fecha_movimiento\s*<=/);
    expect(valores).toContainEqual(consulta.rango.desde);
    expect(valores).toContainEqual(consulta.rango.hasta);
    // A DIFERENCIA del arrastre, este SI tiene cota inferior: es un flujo, no un saldo.
    expect(consulta.rango.desde).toEqual(DESDE);
  });

  it("los limites de particion son los `desde` de cada cubo, en orden", async () => {
    const consulta = consultaDe();
    const cubos = cubosDe(consulta);
    const { repo, fake } = repositorio();
    await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubos);

    const { texto, valores } = sqlEmitido(fake);
    expect(cubos).toHaveLength(3);
    expect(valores.slice(0, cubos.length)).toEqual(cubos.map((c) => c.desde));
    expect(texto).toMatch(/width_bucket\(fecha_movimiento,\s*ARRAY\[(\$\d+::timestamp,?)+\]\)/);
    expect(texto).toMatch(/\)\s*-\s*1\s+AS\s+"indiceCubo"/);
  });

  it("el cast es `::timestamp`, nunca `::timestamptz`, y no hay ni una zona horaria en el SQL", async () => {
    // Es el MISMO cast que emite `IngresosAnaliticaRepository`, y esta escrito en los dos archivos
    // a proposito: arreglar uno y olvidar el otro correria la frontera de dia solo en la mitad de
    // las metricas. Con `::timestamptz` Postgres leeria el texto en el huso de la SESION.
    const consulta = consultaDe();
    const { repo, fake } = repositorio();
    await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubosDe(consulta));

    const { texto } = sqlEmitido(fake);
    expect(texto).toContain("::timestamp");
    expect(texto).not.toContain("::timestamptz");
    expect(texto).not.toMatch(/AT TIME ZONE|Costa_Rica|date_trunc|interval/i);
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("nombra `pago_mensajero_movimiento` y ninguna otra tabla (R23), y ninguna persona (R24)", async () => {
    const consulta = consultaDe();
    const { repo, fake } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubosDe(consulta));

    const { texto } = sqlEmitido(fake);
    expect(texto).toMatch(/FROM\s+pago_mensajero_movimiento\b/);
    expect([...texto.matchAll(/\b(FROM|JOIN)\b/gi)]).toHaveLength(1);
    for (const prohibida of ["analytics_daily", "orden", "usuario", "zona", "wallet_"]) {
      expect(texto, `el SQL nombra ${prohibida}`).not.toContain(prohibida);
    }
    // `mensajero_id` existe en esa tabla y NO se selecciona ni se agrupa por el: la proteccion es
    // que el id no exista en la respuesta, no seudonimizarlo.
    expect(texto).not.toContain("mensajero_id");
    for (const fila of filas) expect(Object.keys(fila).sort()).toEqual(["indiceCubo", "suma", "tipo"]);
  });

  it("su firma son DOS parametros: la consulta entera y los cubos (R22)", () => {
    expect(CuentasPorPagarAnaliticaRepository.prototype.cuentaPorPagarMensajerosPorCubo).toHaveLength(2);
  });

  it("`cubos` no es un canal para colar otra ventana: el WHERE lo sigue mandando `consulta.rango`", async () => {
    const consulta = consultaDe();
    const unSoloCubo = [cubosDe(consulta)[1]];
    const { repo, fake } = repositorio();
    await repo.cuentaPorPagarMensajerosPorCubo(consulta, unSoloCubo);

    const { valores } = sqlEmitido(fake);
    expect(valores[0]).toEqual(unSoloCubo[0].desde);
    expect(valores).toContainEqual(consulta.rango.desde);
    expect(valores).toContainEqual(consulta.rango.hasta);
  });

  it("pide `ORDER BY` explicito y dos ejecuciones dan exactamente lo mismo (R26)", async () => {
    const consulta = consultaDe();
    const cubos = cubosDe(consulta);
    const { repo, fake } = repositorio();

    const a = await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubos);
    const b = await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubos);

    expect(sqlEmitido(fake).texto).toMatch(/ORDER BY 1,\s*2/);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    expect(sqlEmitido(fake, 0)).toEqual(sqlEmitido(fake, 1));
    expect(a.map((f) => f.indiceCubo)).toEqual([0, 0, 2]);
  });

  it("el importe es cadena de escala 2 (R16)", async () => {
    const consulta = consultaDe();
    const { repo } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosPorCubo(consulta, cubosDe(consulta));

    expect(filas.map((f) => f.suma)).toEqual(["1200.00", "800.50", "42.25"]);
    for (const fila of filas) {
      expect(typeof fila.suma).toBe("string");
      expect(fila.suma).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("con `cubos: []` devuelve [] y NO llega a consultar la base", async () => {
    const consulta = consultaDe();
    const { repo, fake } = repositorio();

    expect(await repo.cuentaPorPagarMensajerosPorCubo(consulta, [])).toEqual([]);
    expect(fake.llamadas).toHaveLength(0);
    // Y `trocear` nunca produce esa lista para un rango valido: el caso es artificial a proposito.
    expect(cubosDe(consulta)).not.toHaveLength(0);
  });

  it("un fallo de la base sube TAL CUAL (R25)", async () => {
    const caida = new Error("could not connect to server: Connection refused");
    const consulta = consultaDe();
    const repo = new CuentasPorPagarAnaliticaRepository(fakePrismaQueFalla(caida));

    await expect(repo.cuentaPorPagarMensajerosPorCubo(consulta, cubosDe(consulta))).rejects.toBe(
      caida,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Ni un caso pasa por conjunto vacio                                          */
/* -------------------------------------------------------------------------- */

describe("los casos de arriba no pasan por conjunto vacio", () => {
  it("el libro tiene movimientos anteriores, en el corte exacto, dentro y despues del rango", () => {
    expect(LEDGER.some((f) => f.fechaMovimiento < DESDE)).toBe(true);
    expect(LEDGER.some((f) => f.fechaMovimiento.getTime() === DESDE.getTime())).toBe(true);
    expect(LEDGER.some((f) => f.fechaMovimiento > DESDE && f.fechaMovimiento < HASTA)).toBe(true);
    expect(LEDGER.some((f) => f.fechaMovimiento.getTime() === HASTA.getTime())).toBe(true);
    expect(LEDGER.length).toBeGreaterThanOrEqual(6);
  });

  it("y las filas del fixture son coherentes con el CHECK `categoria <-> tipo` del libro", () => {
    // El design §7 avisa de dobles viejos con filas cruzadas que la base RECHAZA. Las de aqui no
    // lo estan: `pago_devengado` es siempre `devengo` y `pago_efectivo` es siempre `pago`.
    for (const fila of LEDGER) {
      const esperado = fila.categoria.startsWith("pago_devengado") ? "devengo" : "pago";
      expect(fila.tipo, `${fila.categoria} con tipo ${fila.tipo}`).toBe(esperado);
    }
  });
});
