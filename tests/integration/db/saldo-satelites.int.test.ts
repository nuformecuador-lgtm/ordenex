import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { SaldosSatelitesRepository } from "@/lib/repositories/SaldosSatelitesRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T9 (R17/R18/R19/R20/R21/R22) — EL SALDO SIN CONCILIAR, CONTRA POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST CON DOBLES. Lo que se mide vive ENTERO en un `WHERE`
// y en dos `groupBy`: `estado <> 'rechazado'` para el dinero, y `conciliado_at IS NULL` para la
// cola. Un doble de Prisma devuelve lo que el test le diga y no ve el SQL — medido cuatro veces en
// este repo: una mutacion del `WHERE` pasa los tests de servicio en verde.
//
// LAS CUATRO POBLACIONES, que son los cuatro casos que la formula tiene que cubrir sin un `if`:
//   1. SIN MARCAR                -> aporta su efectivo INTEGRO;
//   2. MARCADA COMPLETA          -> aporta 0;
//   3. MARCADA POR MENOS (R18)   -> aporta LA DIFERENCIA. Es el caso de los ₡485.000 de ₡500.000,
//      y es el que desaparece si alguien «optimiza» la consulta del dinero filtrando por
//      `conciliado_at IS NULL`;
//   4. RECHAZADA                 -> NO aporta nada (queda fuera del conjunto).
//
// ⚠️ Y EL SALDO MIDE **EFECTIVO**, NO `total_general`. Decision del humano sobre Q2 (2026-09-16),
// medida contra produccion: de ₡4.196.897 consolidados, ₡1.105.790 (26,3 %) son SINPE, que llega
// directo a una cuenta y NO VIAJA EN EL BULTO. Con `total_general`, la pantalla ensenaria ₡1,1 M de
// deuda fantasma. Este archivo siembra a proposito consolidaciones con SINPE distinto de cero, de
// forma que cambiar `totalEfectivo` por `totalGeneral` en el repositorio PONGA ESTO ROJO.
//
// ⚠️ NADA DE `if (!fks) return;`: siembra sus propias filas y falla ruidosamente si no puede.
//
// AISLAMIENTO: transaccion SIEMPRE revertida + sufijo propio en los nombres de zona. Sin base
// alcanzable se SALTA, y en ese caso el verde de esta task NO cuenta.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `431-sal-${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------------------------
// R19/R20 — money-safe, barrido ESTATICO con su contraprueba.
// ---------------------------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_REPO = "lib/repositories/SaldosSatelitesRepository.ts";

/** Las formas de perder un centimo convirtiendo el importe. `toFixed` sobre un `Decimal` NO lo es. */
const CONVERSIONES = [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/] as const;

describe("431/R20 — el saldo no pasa por coma flotante (barrido estatico)", () => {
  const FUENTE = quitarComentarios(readFileSync(path.join(RAIZ, RUTA_REPO), "utf8"));

  it("anti-vacuidad: el fuente se leyo y es el que se cree", () => {
    expect(FUENTE.length).toBeGreaterThan(500);
    expect(FUENTE).toContain("Prisma.Decimal");
    expect(FUENTE).toContain("toFixed(2)");
  });

  it("CONTRAPRUEBA: el detector caza la conversion si se le da un cuerpo mutado", () => {
    const mutado = "{ return Number(efectivo).toFixed(2); }";
    expect(CONVERSIONES.some((re) => re.test(mutado))).toBe(true);
  });

  it("⭑ el repositorio real no convierte ningun importe a numero", () => {
    const infractoras = CONVERSIONES.filter((re) => re.test(FUENTE));
    expect(
      infractoras.map(String),
      "un importe del saldo pasa por coma flotante. `Prisma.Decimal` -> `toFixed(2)` y nada mas.",
    ).toEqual([]);
  });

  it("⭑ R19: el saldo NO se guarda — no hay columna ni escritura en este repositorio", () => {
    // El saldo se DERIVA en cada lectura. Este repositorio es de solo lectura por contrato, y esto
    // lo ancla: si alguien le añadiera una escritura «para cachear el saldo», se pone rojo.
    expect(FUENTE).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres: las cuatro poblaciones.
// ---------------------------------------------------------------------------------------------

describeSiHayBase("431/T9 — el saldo sin conciliar, con filas reales", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sembrarZona(tx: TxDeTest, marca: string): Promise<string> {
    const fila = await tx.zona.create({
      data: {
        nombre: `Zona ${SUFIJO}-${marca}`,
        sinpeNumero: "80000000",
        sinpeNombre: "Titular de Prueba",
        cobroVehiculo: false,
        esCentral: false,
      },
      select: { id: true },
    });
    return fila.id;
  }

  async function algunUsuarioId(tx: TxDeTest): Promise<string> {
    const fila = await tx.usuario.findFirst({ select: { id: true } });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `usuario` esta vacia: sin FK no se puede sembrar un " +
          "cierre_bodega. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    return fila.id;
  }

  interface Semilla {
    efectivo: string;
    simpe: string;
    estado?: "solicitado" | "aprobado" | "rechazado";
    /** `null` = sin marcar. Con valor, se escribe la marca COMPLETA (el CHECK lo exige). */
    recibido?: string | null;
    diasAtras?: number;
  }

  async function sembrarConsolidacion(
    tx: TxDeTest,
    zonaId: string,
    usuarioId: string,
    s: Semilla,
  ): Promise<string> {
    const estado = s.estado ?? "solicitado";
    const marcada = s.recibido != null;
    const solicitadoAt = new Date(Date.now() - (s.diasAtras ?? 0) * 86_400_000);
    const fila = await tx.cierreBodega.create({
      data: {
        zonaId,
        solicitadoPor: usuarioId,
        estado,
        solicitadoAt,
        totalEfectivo: new Prisma.Decimal(s.efectivo),
        totalSimpe: new Prisma.Decimal(s.simpe),
        totalGeneral: new Prisma.Decimal(s.efectivo).plus(new Prisma.Decimal(s.simpe)),
        ...(marcada
          ? {
              conciliadoAt: new Date(),
              conciliadoPor: usuarioId,
              montoRecibido: new Prisma.Decimal(s.recibido as string),
              resueltoAt: new Date(),
              resueltoPor: usuarioId,
            }
          : {}),
      },
      select: { id: true },
    });
    return fila.id;
  }

  it("⭑ R17/R18: las CUATRO poblaciones en una sola bodega, y el saldo las cuadra", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "cuatro");

      // 1. sin marcar          -> aporta 1000.00 (su efectivo integro)
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "1000.00",
        simpe: "400.00",
        diasAtras: 5,
      });
      // 2. marcada COMPLETA    -> aporta 0.00
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "800.00",
        simpe: "200.00",
        estado: "aprobado",
        recibido: "800.00",
      });
      // 3. marcada POR MENOS   -> aporta 15.00 (R18: 500 declarados, 485 recibidos)
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "500.00",
        simpe: "100.00",
        estado: "aprobado",
        recibido: "485.00",
      });
      // 4. RECHAZADA           -> NO aporta (fuera del conjunto)
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "9999.00",
        simpe: "0.00",
        estado: "rechazado",
      });

      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      const todos = await repo.findSaldosCompleto();
      return todos.find((s) => s.zonaId === zonaId) ?? null;
    });

    // Control positivo: la bodega sembrada esta en el resultado. Sin esto, «undefined» pasaria
    // cualquier aserción que no lo mire.
    expect(r, "la bodega sembrada no aparece en el listado de saldos").not.toBeNull();

    // ⭑ EL NUMERO. 1000 + 0 + 15 = 1015.00. Si la formula usara `total_general`, seria
    // 1400 + 200 + 115 = 1715.00; si excluyera lo ya conciliado, seria 1000.00; y si no filtrara
    // las rechazadas, seria 11014.00. Los tres errores dan numeros DISTINTOS de este.
    expect(r!.saldoSinConciliar).toBe("1015.00");

    // El contexto que viaja al lado, para que la resta sea auditable desde la pantalla.
    expect(r!.totalEfectivo).toBe("2300.00"); // 1000 + 800 + 500 (la rechazada, fuera)
    expect(r!.totalConsolidado).toBe("3000.00"); // + 400 + 200 + 100 de SINPE
    expect(r!.totalRecibido).toBe("1285.00"); // 800 + 485

    // R21: solo la SIN MARCAR sigue en la cola, y lleva 5 dias.
    expect(r!.consolidacionesSinConciliar).toBe(1);
    expect(r!.diasDeLaMasAntigua).toBe(5);
    expect(r!.fechaDeLaMasAntigua).not.toBeNull();
  });

  it("⭑ R17/Q2: el SINPE NO cuenta — dos bodegas con el mismo general y distinto efectivo", async () => {
    // El caso que hace visible la decision del humano sobre Q2. Las dos bodegas consolidaron
    // ₡1.000 y ninguna esta conciliada; la unica diferencia es COMO se recaudo. La que lo recaudo
    // todo en SINPE no debe NADA: ese dinero ya esta en una cuenta.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zEfectivo = await sembrarZona(tx, "todo-efectivo");
      const zSinpe = await sembrarZona(tx, "todo-sinpe");

      await sembrarConsolidacion(tx, zEfectivo, usuarioId, {
        efectivo: "1000.00",
        simpe: "0.00",
      });
      await sembrarConsolidacion(tx, zSinpe, usuarioId, { efectivo: "0.00", simpe: "1000.00" });

      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      const todos = await repo.findSaldosCompleto();
      return {
        efectivo: todos.find((s) => s.zonaId === zEfectivo),
        sinpe: todos.find((s) => s.zonaId === zSinpe),
      };
    });

    expect(r.efectivo, "falta la bodega de efectivo").toBeDefined();
    expect(r.sinpe, "falta la bodega de SINPE").toBeDefined();
    // Mismo consolidado…
    expect(r.efectivo!.totalConsolidado).toBe("1000.00");
    expect(r.sinpe!.totalConsolidado).toBe("1000.00");
    // …y saldos OPUESTOS. Con `total_general` los dos serian "1000.00" y este caso moriria.
    expect(r.efectivo!.saldoSinConciliar).toBe("1000.00");
    expect(r.sinpe!.saldoSinConciliar).toBe("0.00");
  });

  it("R18: recibido de MAS -> el saldo queda NEGATIVO y no se recorta a cero", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "de-mas");
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "100.00",
        simpe: "0.00",
        estado: "aprobado",
        recibido: "150.00",
      });
      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      const todos = await repo.findSaldosCompleto();
      return todos.find((s) => s.zonaId === zonaId) ?? null;
    });

    expect(r).not.toBeNull();
    expect(r!.saldoSinConciliar).toBe("-50.00");
  });

  it("una bodega SIN consolidaciones vale 0.00 y `null` de antiguedad, no un hueco", async () => {
    // El cero tiene que ser un importe decible: `null` obligaria a la pantalla a interpretarlo. Y
    // `diasDeLaMasAntigua` SI es `null`, porque «no hay cola» no es lo mismo que «la mas vieja es
    // de hoy».
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaId = await sembrarZona(tx, "vacia");
      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      const todos = await repo.findSaldosCompleto();
      return todos.find((s) => s.zonaId === zonaId) ?? null;
    });

    expect(r).not.toBeNull();
    expect(r!.saldoSinConciliar).toBe("0.00");
    expect(r!.totalRecibido).toBe("0.00");
    expect(r!.consolidacionesSinConciliar).toBe(0);
    expect(r!.diasDeLaMasAntigua).toBeNull();
    expect(r!.fechaDeLaMasAntigua).toBeNull();
  });

  it("⭑ R21: la antiguedad es la de la MAS VIEJA SIN CONCILIAR, no la de la mas vieja", async () => {
    // Trampa real: la consolidacion mas antigua de la bodega puede estar YA conciliada. Si la
    // consulta de la cola no filtrara `conciliado_at IS NULL`, el numero diria 30 dias de una deuda
    // que no existe.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "antiguedad");
      // la MAS vieja, pero ya conciliada: NO cuenta
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "100.00",
        simpe: "0.00",
        estado: "aprobado",
        recibido: "100.00",
        diasAtras: 30,
      });
      // la mas vieja SIN conciliar
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "50.00",
        simpe: "0.00",
        diasAtras: 7,
      });
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "25.00",
        simpe: "0.00",
        diasAtras: 1,
      });
      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      const todos = await repo.findSaldosCompleto();
      return todos.find((s) => s.zonaId === zonaId) ?? null;
    });

    expect(r).not.toBeNull();
    expect(r!.consolidacionesSinConciliar).toBe(2);
    expect(r!.diasDeLaMasAntigua).toBe(7); // 7, NO 30
  });

  it("⭑ R22/R24: el desglose compone el total y deriva `faltaPorRecibir` en el SERVIDOR", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "desglose");
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "500.00",
        simpe: "123.45",
        estado: "aprobado",
        recibido: "485.00",
      });
      await sembrarConsolidacion(tx, zonaId, usuarioId, { efectivo: "200.00", simpe: "0.00" });
      // Una rechazada, que NO debe salir en el desglose (D2: el estado se retira de la pantalla).
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "9999.00",
        simpe: "0.00",
        estado: "rechazado",
      });

      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      return repo.findConsolidacionesCompleto(zonaId);
    });

    expect(r).toHaveLength(2); // la rechazada, fuera
    const conciliada = r.find((c) => c.conciliado);
    const pendiente = r.find((c) => !c.conciliado);

    expect(conciliada, "falta la consolidacion conciliada").toBeDefined();
    expect(conciliada!.totales).toEqual({
      efectivo: "500.00",
      simpe: "123.45",
      transferencia: "0.00",
      general: "623.45",
    });
    expect(conciliada!.montoRecibido).toBe("485.00");
    // ⭑ SOBRE EL EFECTIVO: 500 − 485 = 15. Con `general` serian 138.45 y la suma de esta columna
    // dejaria de cuadrar con el saldo de la bodega.
    expect(conciliada!.faltaPorRecibir).toBe("15.00");

    expect(pendiente, "falta la consolidacion pendiente").toBeDefined();
    expect(pendiente!.montoRecibido).toBeNull(); // `null`, no "0.00"
    expect(pendiente!.faltaPorRecibir).toBe("200.00");

    // ⭑ LA IDENTIDAD QUE CIERRA EL CIRCULO: la suma de la columna de detalle ES el saldo de la
    // bodega. Si las dos escalas usaran formulas distintas, esto se pone rojo.
    const suma = r
      .reduce((acc, c) => acc.plus(new Prisma.Decimal(c.faltaPorRecibir)), new Prisma.Decimal(0))
      .toFixed(2);
    expect(suma).toBe("215.00");
  });

  it("R24: `soloSinConciliar` recorta a la cola, y sin el vienen las dos poblaciones", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "recorte");
      await sembrarConsolidacion(tx, zonaId, usuarioId, {
        efectivo: "10.00",
        simpe: "0.00",
        estado: "aprobado",
        recibido: "10.00",
      });
      await sembrarConsolidacion(tx, zonaId, usuarioId, { efectivo: "20.00", simpe: "0.00" });
      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      return {
        todas: await repo.findConsolidacionesCompleto(zonaId),
        soloCola: await repo.findConsolidacionesCompleto(zonaId, true),
      };
    });

    expect(r.todas).toHaveLength(2);
    expect(r.soloCola).toHaveLength(1);
    expect(r.soloCola[0].conciliado).toBe(false);
  });

  it("la pagina es un segmento del conjunto: mismo criterio y mismo orden", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "pagina");
      for (const dias of [1, 2, 3, 4, 5]) {
        await sembrarConsolidacion(tx, zonaId, usuarioId, {
          efectivo: "10.00",
          simpe: "0.00",
          diasAtras: dias,
        });
      }
      const repo = new SaldosSatelitesRepository(tx as unknown as PrismaClient);
      const completo = await repo.findConsolidacionesCompleto(zonaId);
      const pagina = await repo.findConsolidacionesPaginado(zonaId, { skip: 2, take: 2 });
      return { completo, pagina };
    });

    expect(r.completo).toHaveLength(5);
    expect(r.pagina.total).toBe(5); // el total del CONJUNTO, no de la pagina
    expect(r.pagina.items.map((c) => c.cierreBodegaId)).toEqual(
      r.completo.slice(2, 4).map((c) => c.cierreBodegaId),
    );
  });
});
