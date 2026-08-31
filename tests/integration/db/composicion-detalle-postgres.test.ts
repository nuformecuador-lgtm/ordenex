import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletService } from "@/lib/services/WalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * Ficha 339 — el DETALLE de una fila de la tarjeta de la ganancia, contra **Postgres de
 * verdad**. Cubre **R18, R19, R20, R27, R31 y R33**.
 *
 * ── Por que un doble no sirve para esto (design §9) ──────────────────────────────────────
 *
 * En este repo esta medido CUATRO veces que una mutacion del `WHERE` pasa en verde por delante
 * de un doble: el doble devuelve lo que se le programo, no lo que el motor selecciona. Todo lo
 * que esta ficha promete sobre el ALCANCE de una fila es una propiedad del `WHERE`:
 *
 *  1. el detalle de una fila trae SUS categorias y ninguna mas (`categoria IN (…)`);
 *  2. «Otros» trae el COMPLEMENTO y ya no trae el pago al mensajero — la ficha entera;
 *  3. el `total` sale de un `count` del conjunto, no del largo del `take`;
 *  4. los filtros vigentes (rango de fechas, categoria) recortan de verdad;
 *  5. la Σ de todas las paginas del detalle es, centimo a centimo, el importe de la fila;
 *  6. los dos agregados NO cambiaron de SQL al ganar el repositorio la clave `categorias`.
 *
 * La mutacion exigida por T4.1 —quitar la restriccion de categoria del `WHERE`— se ejecuto y
 * se revirtio; su salida ROJA queda en `progress/impl_339.md`.
 *
 * ── Aislamiento y no-vacuidad ────────────────────────────────────────────────────────────
 *
 * Todo corre dentro de una transaccion que SIEMPRE se revierte: pase, falle o muera el runner,
 * no queda ni una fila de dinero inventada. El conjunto se aisla en una VENTANA DE FECHAS
 * propia y desierta, y cada caso empieza comprobando que esa ventana esta vacia: si la base ya
 * tuviera movimientos ahi, el caso FALLA con su motivo en vez de medir dinero ajeno. **No hay
 * ni un `return` mudo**: un `if (!x) return;` reportaria `passed` sin comprobar una linea.
 *
 * Sin base alcanzable la suite se SALTA (no falla), como el resto de `tests/integration/db`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** El maestro que consulta la caja. No toca ninguna FK: los movimientos van sin registrador. */
const MAESTRO: Actor = { usuarioId: "u-maestro-339", rol: "maestro" };

/**
 * La ventana desierta. Es un mes de 1999 a proposito: la caja de Ordenex nacio en 2026, asi que
 * ningun dato real ni sembrado cae ahi. Todas las consultas de esta suite la llevan puesta.
 */
const DESDE = new Date("1999-11-01T06:00:00.000Z");
const HASTA = new Date("1999-11-30T06:00:00.000Z");
/** Fuera de la ventana, por 15 dias: el movimiento que los filtros tienen que dejar fuera. */
const FUERA_DE_LA_VENTANA = new Date("1999-12-15T06:00:00.000Z");

const FILTROS = { desde: DESDE, hasta: HASTA } as const;

/**
 * El libro sembrado. Los importes son TODOS distintos y ninguno es la suma de otros dos: si el
 * `WHERE` colara una categoria de mas, el fallo la nombra por su importe y no por un total
 * ambiguo. Las fechas tambien son distintas, para que el orden de pagina sea determinista.
 */
const SEMILLA = [
  { categoria: "egreso_pago_mensajero", monto: "1111.11", dia: 2 },
  { categoria: "egreso_pago_mensajero", monto: "2222.22", dia: 3 },
  { categoria: "egreso_ajuste", monto: "333.33", dia: 4 },
  { categoria: "egreso_sueldo", monto: "444.44", dia: 5 },
  { categoria: "egreso_gasto", monto: "55.55", dia: 6 },
  { categoria: "egreso_pago_tienda", monto: "6666.66", dia: 7 }, // de TERCEROS
  { categoria: "ingreso_flete", monto: "7777.77", dia: 8 },
] as const;

function instanteDelDia(dia: number): Date {
  return new Date(`1999-11-${String(dia).padStart(2, "0")}T06:00:00.000Z`);
}

function repoDe(tx: Tx): WalletMovimientoRepository {
  return new WalletMovimientoRepository(tx as unknown as PrismaClient);
}

/** Σ de una lista de importes STRING, con `Prisma.Decimal`. En el test, y del lado servidor. */
function sumar(importes: readonly string[]): string {
  return importes.reduce((s, v) => s.add(new Prisma.Decimal(v)), new Prisma.Decimal(0)).toFixed(2);
}

/** Comprueba que la ventana esta desierta. FALLA con su motivo si no lo esta. */
async function exigirVentanaVacia(tx: Tx): Promise<void> {
  const previos = await repoDe(tx).listar({ page: 1, pageSize: 1, ...FILTROS });
  expect(
    previos.total,
    "la ventana de 1999 ya tiene movimientos: este caso dejaria de aislar y estaria midiendo dinero ajeno",
  ).toBe(0);
  const fuera = await repoDe(tx).listar({
    page: 1,
    pageSize: 1,
    desde: FUERA_DE_LA_VENTANA,
    hasta: FUERA_DE_LA_VENTANA,
  });
  expect(fuera.total, "el instante de control fuera de la ventana ya esta ocupado").toBe(0);
}

/** Siembra el libro de la ficha dentro de la ventana. Devuelve el id de cada fila sembrada. */
async function sembrar(tx: Tx): Promise<{ ids: string[]; porCategoria: Map<string, string[]> }> {
  const movimientos: CrearMovimientoInput[] = SEMILLA.map((fila) => ({
    id: randomUUID(),
    tipo: fila.categoria.startsWith("ingreso_") ? ("ingreso" as const) : ("egreso" as const),
    categoria: fila.categoria,
    monto: fila.monto,
    origenTipo: "manual" as const,
    origenId: null,
    // Los pagos a mensajeros llegan SIN descripcion en produccion (lo escribe asi
    // `WalletMensajeroFeedService`): se siembra igual, para que el detalle se mida sobre el
    // dato real y no sobre uno comodo.
    descripcion: fila.categoria === "egreso_pago_mensajero" ? null : `ficha 339 — ${fila.monto}`,
    registradoPor: null,
    fechaMovimiento: instanteDelDia(fila.dia),
  }));

  const insertados = await repoDe(tx).crearMovimientos(tx, movimientos);
  expect(insertados, "la siembra no inserto todas las filas").toBe(SEMILLA.length);

  const porCategoria = new Map<string, string[]>();
  for (const [i, fila] of SEMILLA.entries()) {
    const previos = porCategoria.get(fila.categoria) ?? [];
    porCategoria.set(fila.categoria, [...previos, movimientos[i].id as string]);
  }
  return { ids: movimientos.map((m) => m.id as string), porCategoria };
}

describeSiHayBase("ficha 339 — el detalle de una fila contra Postgres (R18/R19/R20/R27/R31/R33)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R18/R33: el detalle de «Pagos a mensajeros» trae SOLO su categoria", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx);
      const { porCategoria } = await sembrar(tx);
      const svc = new WalletService(repoDe(tx), tx as unknown as PrismaClient);

      const r = await svc.listarMovimientosDeFila(
        { fila: "egreso_pago_mensajero", page: 1, pageSize: 10, ...FILTROS },
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);

      // Los DOS pagos y nada mas. La comparacion es por conjunto de ids, no por conteo: un
      // conteo igual con filas distintas pasaria.
      expect(new Set(r.data.movimientos.map((m) => m.id))).toEqual(
        new Set(porCategoria.get("egreso_pago_mensajero")),
      );
      expect(r.data.total).toBe(2);
      expect(new Set(r.data.movimientos.map((m) => m.categoria))).toEqual(
        new Set(["egreso_pago_mensajero"]),
      );

      // Y los importes intrusos, uno a uno: quitar la restriccion de categoria del `WHERE`
      // mete estos tres y el caso cae nombrandolos.
      const montos = r.data.movimientos.map((m) => m.monto);
      expect(montos.sort()).toEqual(["1111.11", "2222.22"]);
      for (const intruso of ["333.33", "444.44", "55.55", "6666.66", "7777.77"]) {
        expect(montos, `el detalle se colo el importe ${intruso}`).not.toContain(intruso);
      }
    });
  });

  it("R18: «Otros» trae el COMPLEMENTO — y ya NO trae el pago al mensajero", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx);
      const { porCategoria } = await sembrar(tx);
      const svc = new WalletService(repoDe(tx), tx as unknown as PrismaClient);

      const r = await svc.listarMovimientosDeFila(
        { fila: "otros_egresos", page: 1, pageSize: 10, ...FILTROS },
        MAESTRO,
      );
      if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);

      // El cubo se queda con `egreso_gasto` y con nada mas: es la ficha, medida contra el motor.
      expect(r.data.movimientos.map((m) => m.id)).toEqual(porCategoria.get("egreso_gasto"));
      expect(r.data.movimientos.map((m) => m.monto)).toEqual(["55.55"]);
      expect(r.data.total).toBe(1);
      const categorias = r.data.movimientos.map((m) => m.categoria);
      expect(categorias).not.toContain("egreso_pago_mensajero");
      expect(categorias).not.toContain("egreso_ajuste");
      // Ni el dinero de TERCEROS: el pago a la tienda nunca entro en la ganancia.
      expect(categorias).not.toContain("egreso_pago_tienda");

      // Y el ajuste, que salio del cubo, se encuentra por SU fila y con su importe (R2/R3).
      const ajustes = await svc.listarMovimientosDeFila(
        { fila: "egreso_ajuste", page: 1, pageSize: 10, ...FILTROS },
        MAESTRO,
      );
      if (ajustes.status !== "ok") throw new Error("esperado ok");
      expect(ajustes.data.movimientos.map((m) => m.monto)).toEqual(["333.33"]);
    });
  });

  it("R27/R31: el detalle devuelve UNA pagina y el `total` es el del CONJUNTO", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx);
      const repo = repoDe(tx);
      const svc = new WalletService(repo, tx as unknown as PrismaClient);

      // `pageSize + 3` movimientos de UNA categoria, con importes distintos.
      const pageSize = 2;
      const cuantos = pageSize + 3;
      const movimientos: CrearMovimientoInput[] = Array.from({ length: cuantos }, (_, i) => ({
        id: randomUUID(),
        tipo: "egreso" as const,
        categoria: "egreso_pago_mensajero" as const,
        monto: `${(i + 1) * 100}.0${i}`,
        origenTipo: "manual" as const,
        origenId: null,
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: instanteDelDia(10 + i),
      }));
      expect(await repo.crearMovimientos(tx, movimientos)).toBe(cuantos);

      const paginas = [];
      for (const page of [1, 2, 3]) {
        const r = await svc.listarMovimientosDeFila(
          { fila: "egreso_pago_mensajero", page, pageSize, ...FILTROS },
          MAESTRO,
        );
        if (r.status !== "ok") throw new Error("esperado ok");
        paginas.push(r.data);
      }

      // El `total` es 5 en las TRES paginas: lo cuenta la base, no el largo de la pagina. Un
      // `total = movimientos.length` daria 2, 2 y 1, y este caso cae con los tres numeros.
      expect(paginas.map((p) => p.total)).toEqual([cuantos, cuantos, cuantos]);
      expect(paginas.map((p) => p.movimientos.length)).toEqual([2, 2, 1]);
      expect(paginas[0].total).not.toBe(paginas[0].movimientos.length);

      // Y las tres paginas juntas son el conjunto ENTERO, sin repetir ni perder una fila (el
      // orden es TOTAL: fecha, `created_at`, `id`).
      const vistos = paginas.flatMap((p) => p.movimientos.map((m) => m.id));
      expect(vistos).toHaveLength(cuantos);
      expect(new Set(vistos).size).toBe(cuantos);
      expect(new Set(vistos)).toEqual(new Set(movimientos.map((m) => m.id)));
    });
  });

  it("R20: los filtros vigentes de la wallet recortan el detalle", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx);
      const repo = repoDe(tx);
      const svc = new WalletService(repo, tx as unknown as PrismaClient);
      const { porCategoria } = await sembrar(tx);

      // Un pago a mensajero FUERA de la ventana: mismo concepto, otro periodo.
      const idFuera = randomUUID();
      expect(
        await repo.crearMovimientos(tx, [
          {
            id: idFuera,
            tipo: "egreso",
            categoria: "egreso_pago_mensajero",
            monto: "8888.88",
            origenTipo: "manual",
            origenId: null,
            descripcion: null,
            registradoPor: null,
            fechaMovimiento: FUERA_DE_LA_VENTANA,
          },
        ]),
      ).toBe(1);

      // (a) el rango de fechas lo deja fuera…
      const enLaVentana = await svc.listarMovimientosDeFila(
        { fila: "egreso_pago_mensajero", page: 1, pageSize: 10, ...FILTROS },
        MAESTRO,
      );
      if (enLaVentana.status !== "ok") throw new Error("esperado ok");
      expect(enLaVentana.data.movimientos.map((m) => m.id)).not.toContain(idFuera);
      expect(enLaVentana.data.total).toBe(2);
      expect(enLaVentana.data.movimientos.map((m) => m.monto)).not.toContain("8888.88");

      // …y sin el filtro de fecha, el mismo movimiento SI esta (control de no-vacuidad: el
      // `not.toContain` de arriba no pasa porque la fila no exista).
      const sinRango = await svc.listarMovimientosDeFila(
        {
          fila: "egreso_pago_mensajero",
          page: 1,
          pageSize: 10,
          desde: DESDE,
          hasta: FUERA_DE_LA_VENTANA,
        },
        MAESTRO,
      );
      if (sinRango.status !== "ok") throw new Error("esperado ok");
      expect(sinRango.data.movimientos.map((m) => m.id)).toContain(idFuera);
      expect(sinRango.data.total).toBe(3);

      // (b) con el filtro de CATEGORIA puesto a otra cosa, el detalle de la fila sale VACIO —
      //     y el recorte lo hace el motor, no un `if`: el conjunto de la fila y el filtro del
      //     usuario conviven en el `WHERE` y su interseccion es vacia.
      const contradictorio = await svc.listarMovimientosDeFila(
        {
          fila: "egreso_pago_mensajero",
          page: 1,
          pageSize: 10,
          categoria: "egreso_sueldo",
          ...FILTROS,
        },
        MAESTRO,
      );
      if (contradictorio.status !== "ok") throw new Error("esperado ok");
      expect(contradictorio.data.movimientos).toEqual([]);
      expect(contradictorio.data.total).toBe(0);

      // (c) y con el filtro puesto a SU propia categoria, el detalle vuelve entero.
      const coincidente = await svc.listarMovimientosDeFila(
        {
          fila: "egreso_pago_mensajero",
          page: 1,
          pageSize: 10,
          categoria: "egreso_pago_mensajero",
          ...FILTROS,
        },
        MAESTRO,
      );
      if (coincidente.status !== "ok") throw new Error("esperado ok");
      expect(new Set(coincidente.data.movimientos.map((m) => m.id))).toEqual(
        new Set(porCategoria.get("egreso_pago_mensajero")),
      );
    });
  });

  it("R19: la Σ de TODAS las paginas del detalle es el importe de la fila, centimo a centimo", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx);
      await sembrar(tx);
      const svc = new WalletService(repoDe(tx), tx as unknown as PrismaClient);

      // El importe de la fila sale del MISMO camino que la tarjeta: una lectura agregada, con
      // los MISMOS filtros. La suma del detalle se hace aqui, con `Prisma.Decimal`: ni la app
      // ni el navegador suman nada.
      const resumen = await svc.verResumenCaja({ page: 1, pageSize: 20, ...FILTROS }, MAESTRO);
      if (resumen.status !== "ok") throw new Error("esperado ok");

      const filas = [
        { fila: "egreso_pago_mensajero" as const, importe: resumen.composicion.egresos.egreso_pago_mensajero },
        { fila: "egreso_ajuste" as const, importe: resumen.composicion.egresos.egreso_ajuste },
        { fila: "otros_egresos" as const, importe: resumen.composicion.otrosEgresos },
      ];

      for (const { fila, importe } of filas) {
        // Paginas de UNA fila: se recorre el conjunto entero a proposito, para que la Σ no
        // pueda cuadrar por caber toda en la primera pagina.
        const montos: string[] = [];
        let page = 1;
        let total = -1;
        do {
          const r = await svc.listarMovimientosDeFila(
            { fila, page, pageSize: 1, ...FILTROS },
            MAESTRO,
          );
          if (r.status !== "ok") throw new Error("esperado ok");
          total = r.data.total;
          montos.push(...r.data.movimientos.map((m) => m.monto));
          page += 1;
        } while (montos.length < total && page <= total + 1);

        expect(montos.length, `${fila}: no se recorrio el conjunto entero`).toBe(total);
        expect(sumar(montos), `${fila}: la suma del detalle no es el importe de la fila`).toBe(
          importe,
        );
        // No-vacuidad: la fila TIENE dinero y TIENE movimientos. Un `0.00 === 0.00` sobre un
        // conjunto vacio pasaria sin probar nada.
        expect(total, `${fila} no trajo movimientos`).toBeGreaterThan(0);
        expect(new Prisma.Decimal(importe).gt(0), `${fila} vale 0.00`).toBe(true);
      }

      // Y la identidad de la columna entera (R11): las filas con nombre + el sueldo (que sirve
      // `DesgloseEgresosDTO`) + «otros» = `egresosPropios`. El pago a la TIENDA queda fuera.
      const desglose = await repoDe(tx).agregarPorCategoria(FILTROS);
      const columna = sumar([
        desglose.gastoFijo,
        desglose.gastoVariable,
        desglose.sueldo,
        desglose.indemnizacion,
        resumen.composicion.egresos.egreso_pago_mensajero,
        resumen.composicion.egresos.egreso_ajuste,
        resumen.composicion.otrosEgresos,
      ]);
      expect(columna).toBe(resumen.composicion.totalEgresos);
      expect(resumen.composicion.totalEgresos).toBe(resumen.resumen.egresosPropios);
      // R12/R14 contra la base: el total de egresos propios es el de siempre — 1111,11 +
      // 2222,22 + 333,33 + 444,44 + 55,55 — y el pago a la tienda (6 666,66) no esta dentro.
      expect(resumen.resumen.egresosPropios).toBe("4166.65");
      expect(resumen.resumen.salidas).toBe("10833.31"); // + el pago a la tienda
    });
  });

  it("los DOS agregados no cambiaron de SQL al ganar el repositorio la clave `categorias`", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await exigirVentanaVacia(tx);
      await sembrar(tx);
      const repo = repoDe(tx);

      // Con la clave AUSENTE y con la clave presente en `undefined`: el `where` tiene que ser
      // el mismo, y por tanto el resultado tambien. Es lo que garantiza que la ficha no movio
      // ni una cifra de la caja ni del desglose de egresos.
      const porCategoriaYTipo = await repo.agregarPorCategoriaYTipo(FILTROS);
      const porCategoriaYTipoExplicito = await repo.agregarPorCategoriaYTipo({
        ...FILTROS,
        categorias: undefined,
      });
      expect(porCategoriaYTipoExplicito).toEqual(porCategoriaYTipo);

      const porCategoria = await repo.agregarPorCategoria(FILTROS);
      const porCategoriaExplicito = await repo.agregarPorCategoria({
        ...FILTROS,
        categorias: undefined,
      });
      expect(porCategoriaExplicito).toEqual(porCategoria);

      // No-vacuidad: los agregados VEN las siete filas sembradas, cada una con su importe.
      expect(new Set(porCategoriaYTipo.map((f) => f.categoria))).toEqual(
        new Set(SEMILLA.map((f) => f.categoria)),
      );
      expect(porCategoria.sueldo).toBe("444.44");
      expect(sumar(porCategoriaYTipo.map((f) => f.total))).toBe(sumar(SEMILLA.map((f) => f.monto)));

      // Y la contraprueba de que la clave nueva NO es decorativa: cuando SI viaja, acota.
      const acotado = await repo.agregarPorCategoriaYTipo({
        ...FILTROS,
        categorias: ["egreso_gasto"],
      });
      expect(acotado.map((f) => [f.categoria, f.total])).toEqual([["egreso_gasto", "55.55"]]);
    });
  });
});
