import { describe, it, expect, vi } from "vitest";

import { consultarFinanzasDiario } from "@/lib/actions/finanzas-diario";
import { FinanzasDiarioRepository } from "@/lib/repositories/FinanzasDiarioRepository";
import { FinanzasDiarioService } from "@/lib/services/FinanzasDiarioService";
import { derivarFinanzasDiarias } from "@/lib/utils/finanzas-diarias";
import type { AgregadoDiarioCajaRow } from "@/lib/interfaces/repositories/IFinanzasDiarioRepository";

const AHORA = new Date("2026-08-17T12:00:00.000Z");

/** Atajo para escribir filas del agregado sin repetir la forma. */
function fila(
  fecha: string,
  categoria: string,
  tipo: "ingreso" | "egreso",
  total: string,
): AgregadoDiarioCajaRow {
  return { fecha, categoria, tipo, total } as AgregadoDiarioCajaRow;
}

describe("La derivación del dinero por día", () => {
  // `ingresos`/`egresos` son TODO lo que entró y salió (contra-entrega incluido) y `ganancia`
  // solo el dinero PROPIO. Es la partición de la feature 173, y por eso las tres no cuadran
  // entre sí: es la diferencia entre «lo que pasó por la caja» y «lo que ganó Ordenex».
  it("separa el dinero propio del de terceros, como el resumen del wallet", () => {
    const dias = derivarFinanzasDiarias([
      fila("2026-08-15", "ingreso_flete", "ingreso", "100.00"),
      fila("2026-08-15", "ingreso_cod_recaudado", "ingreso", "900.00"), // de terceros
      fila("2026-08-15", "egreso_gasto", "egreso", "40.00"),
      fila("2026-08-15", "egreso_pago_tienda", "egreso", "500.00"), // de terceros
    ]);

    expect(dias).toEqual([
      {
        fecha: "2026-08-15",
        // Ficha 459 (R13, reescrito): solo el EFECTIVO; el flete (100) es un cargo a la tienda.
        ingresos: "900.00",
        egresos: "540.00",
        ganancia: "60.00", // 100 propios − 40 propios: el COD y el pago a tienda no entran
        pagoMensajeros: "0.00",
        // El pago a tienda SÍ sale desglosado aunque no toque la ganancia: es dinero de
        // terceros saliendo de la caja, así que suma a `egresos` y no a `ganancia`.
        pagoTiendas: "500.00",
      },
    ]);
  });

  // Ficha 457 (R19/R39, design §10): el pago de una tienda a Ordenex es EFECTIVO de terceros: cuenta
  // en los `ingresos` de su dia y su anulacion en los `egresos` del dia en que se anula; la ganancia
  // del dia no se mueve con ninguno de los dos (los fletes que la tienda debia ya se contaron al
  // aprobar el cierre). El cobro que la dejo en contra es un CARGO: sube la ganancia y no los ingresos.
  it("el pago de una tienda a Ordenex entra en los ingresos del dia y su anulacion en los egresos; la ganancia no cambia", () => {
    const dias = derivarFinanzasDiarias([
      fila("2026-09-20", "ingreso_cobro_tienda", "ingreso", "10000.00"), // cargo: no es efectivo
      fila("2026-09-20", "ingreso_abono_tienda", "ingreso", "4000.00"), // efectivo de terceros
      fila("2026-09-21", "egreso_reverso_abono_tienda", "egreso", "4000.00"), // efectivo de terceros
    ]);
    expect(dias).toEqual([
      { fecha: "2026-09-20", ingresos: "4000.00", egresos: "0.00", ganancia: "10000.00", pagoMensajeros: "0.00", pagoTiendas: "0.00" },
      { fecha: "2026-09-21", ingresos: "0.00", egresos: "4000.00", ganancia: "0.00", pagoMensajeros: "0.00", pagoTiendas: "0.00" },
    ]);
  });

  // El pago a mensajeros se pidió aparte, pero YA está dentro de los egresos y del lado
  // negativo de la ganancia. Sumarlo al total lo contaría dos veces.
  it("el pago a mensajeros sale aparte y además cuenta dentro de los egresos", () => {
    const [dia] = derivarFinanzasDiarias([
      fila("2026-08-16", "egreso_pago_mensajero", "egreso", "250.00"),
      fila("2026-08-16", "egreso_gasto", "egreso", "50.00"),
    ]);

    expect(dia).toMatchObject({
      egresos: "300.00",
      pagoMensajeros: "250.00",
      ganancia: "-300.00",
    });
  });

  // Espejo exacto del caso de mensajeros: se pidió aparte, pero YA está dentro de los egresos.
  // Sumarlo al total lo contaría dos veces.
  it("el pago a tiendas sale aparte y además cuenta dentro de los egresos", () => {
    const [dia] = derivarFinanzasDiarias([
      fila("2026-08-16", "egreso_pago_tienda", "egreso", "700.00"),
      fila("2026-08-16", "egreso_gasto", "egreso", "50.00"),
    ]);

    expect(dia).toMatchObject({
      egresos: "750.00",
      pagoTiendas: "700.00",
      // El pago a tienda es dinero de TERCEROS: no resta de la ganancia. Sólo el gasto propio.
      ganancia: "-50.00",
    });
  });

  // Los dos pagos conviven sin mezclarse: cada categoría a su cubeta.
  it("los dos pagos se acumulan por separado", () => {
    const [dia] = derivarFinanzasDiarias([
      fila("2026-08-16", "egreso_pago_tienda", "egreso", "700.00"),
      fila("2026-08-16", "egreso_pago_mensajero", "egreso", "250.00"),
    ]);

    expect(dia).toMatchObject({ pagoTiendas: "700.00", pagoMensajeros: "250.00" });
  });

  // ⚠ NO SE NETEA CON EL REVERSO, y es una decisión escrita: esta cifra responde «cuánto salió
  // hacia tiendas ese día». La anulación es un hecho de otro día y ya se refleja en `ingresos`.
  // Netear dejaría días en negativo, que en una barra apilada no se puede dibujar.
  it("un reverso de pago a tienda NO resta del pago a tiendas", () => {
    const [dia] = derivarFinanzasDiarias([
      fila("2026-08-16", "egreso_pago_tienda", "egreso", "700.00"),
      fila("2026-08-16", "ingreso_reverso_pago_tienda", "ingreso", "700.00"),
    ]);

    expect(dia).toMatchObject({ pagoTiendas: "700.00" });
    // Pero el reverso SÍ entra donde tiene que entrar: en lo que entró a la caja.
    expect(dia?.ingresos).toBe("700.00");
  });

  it("un día sin pagos a tiendas dice cero, no omite la cifra", () => {
    const [dia] = derivarFinanzasDiarias([fila("2026-08-16", "ingreso_flete", "ingreso", "1.00")]);

    expect(dia?.pagoTiendas).toBe("0.00");
  });

  it("la ganancia puede ser negativa y se dice con su signo", () => {
    const [dia] = derivarFinanzasDiarias([fila("2026-08-16", "egreso_sueldo", "egreso", "10.50")]);

    expect(dia?.ganancia).toBe("-10.50");
  });

  // Money-safe: con `number`, sumar cien veces 0.10 no da 10.00.
  it("459/R13: un dia solo con cargos a la tienda no tiene ingresos de efectivo, pero SI ganancia", () => {
    const [dia] = derivarFinanzasDiarias([
      fila("2026-08-18", "ingreso_flete", "ingreso", "2500.00"),
      fila("2026-08-18", "ingreso_iva_flete", "ingreso", "325.00"),
    ]);
    expect(dia).toEqual({
      fecha: "2026-08-18",
      ingresos: "0.00",
      egresos: "0.00",
      ganancia: "2825.00",
      pagoMensajeros: "0.00",
      pagoTiendas: "0.00",
    });
  });

  it("⭑ 461/R30: el cobro de Ordenex a una tienda y su reverso NO son efectivo del dia, pero SI cuentan en la ganancia", () => {
    // Un cobro de 2 500,50 el dia 18 y su anulacion el 19: ni «ingresos» ni «egresos» se mueven
    // (no entro ni salio dinero: se tomo del saldo de la tienda y se le devolvio), y la ganancia
    // sube y baja exactamente en el monto.
    const dias = derivarFinanzasDiarias([
      fila("2026-09-18", "ingreso_cobro_tienda", "ingreso", "2500.50"),
      fila("2026-09-18", "ingreso_ajuste", "ingreso", "100.00"),
      fila("2026-09-19", "egreso_reverso_cobro_tienda", "egreso", "2500.50"),
      fila("2026-09-19", "egreso_gasto_variable", "egreso", "40.00"),
    ]);
    expect(dias).toEqual([
      {
        fecha: "2026-09-18",
        ingresos: "100.00", // solo el ajuste, que es efectivo
        egresos: "0.00",
        ganancia: "2600.50", // 2 500,50 del cobro + 100,00 del ajuste
        pagoMensajeros: "0.00",
        pagoTiendas: "0.00",
      },
      {
        fecha: "2026-09-19",
        ingresos: "0.00",
        egresos: "40.00", // solo el gasto, que es efectivo; el reverso del cobro no sale de la caja
        ganancia: "-2540.50", // −2 500,50 del reverso − 40,00 del gasto
        pagoMensajeros: "0.00",
        pagoTiendas: "0.00",
      },
    ]);
  });

  it("suma con decimales exactos", () => {
    const filas = Array.from({ length: 100 }, () =>
      // Ficha 459: con un ingreso EFECTIVO (el flete ya no suma a los ingresos del dia).
      fila("2026-08-16", "ingreso_ajuste", "ingreso", "0.10"),
    );

    expect(derivarFinanzasDiarias(filas)[0]?.ingresos).toBe("10.00");
  });

  it("agrupa por día y sale en orden cronológico ascendente", () => {
    const dias = derivarFinanzasDiarias([
      fila("2026-08-17", "ingreso_flete", "ingreso", "1.00"),
      fila("2026-08-15", "ingreso_flete", "ingreso", "2.00"),
      fila("2026-08-16", "ingreso_flete", "ingreso", "3.00"),
    ]);

    expect(dias.map((d) => d.fecha)).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
  });

  // Los días sin movimiento no producen filas y aquí no se inventan: rellenarlos exige conocer
  // la ventana, que es de quien la pidió (el DTO la lleva para eso).
  it("no inventa días vacíos", () => {
    expect(derivarFinanzasDiarias([])).toEqual([]);
  });
});

describe("El servicio: la ventana la pone el reloj", () => {
  function servicio(now: Date) {
    const repo = { sumarPorDia: vi.fn().mockResolvedValue([]) };
    return { repo, service: new FinanzasDiarioService(repo, { now: () => now }) };
  }

  // Últimos 30 días CR resueltos por `resolverRango`, no por aritmética propia: es el mismo
  // módulo que decide «hoy» para el resto de la analítica.
  it("pide los últimos 30 días de Costa Rica", async () => {
    const { repo, service } = servicio(AHORA);

    const dto = await service.consultar();

    expect(dto.hasta).toBe("2026-08-17");
    expect(dto.desde).toBe("2026-07-19"); // 30 días contando hoy
    const [desde, hasta] = repo.sumarPorDia.mock.calls[0] ?? [];
    expect(desde).toEqual(new Date("2026-07-19T06:00:00.000Z"));
    expect(hasta).toEqual(new Date("2026-08-18T06:00:00.000Z")); // semiabierta
  });

  it("`lastSync` sale del reloj inyectado", async () => {
    const { service } = servicio(AHORA);

    expect((await service.consultar()).lastSync).toBe("2026-08-17T12:00:00.000Z");
  });
});

describe("La consulta que se ejecuta", () => {
  /** Doble del cliente Prisma: captura el SQL y devuelve filas fijas. */
  function prismaFalso(filas: unknown[]) {
    const capturado = { sql: "" };
    const prisma = {
      $queryRaw: (plantilla: TemplateStringsArray, ...valores: { sql?: string }[]) => {
        capturado.sql = [...plantilla].map((t, i) => t + (valores[i]?.sql ?? "")).join("");
        return Promise.resolve(filas);
      },
    };
    return { prisma, capturado };
  }

  // ⚠ NI UNA ZONA HORARIA EN EL SQL: sería una segunda definición del día operativo fuera del
  // alcance de `fecha-cr.ts` — el off-by-one de seis horas del que avisa `ranges.ts`.
  it("agrupa por día CR sin nombrar ninguna zona horaria", async () => {
    const { prisma, capturado } = prismaFalso([]);

    await new FinanzasDiarioRepository(prisma as never).sumarPorDia(
      new Date("2026-07-19T06:00:00.000Z"),
      new Date("2026-08-18T06:00:00.000Z"),
    );

    expect(capturado.sql).not.toMatch(/AT TIME ZONE/i);
    expect(capturado.sql).not.toMatch(/America|Costa_Rica/i);
    expect(capturado.sql).not.toMatch(/interval\s+'6 hours'/i);
    expect(capturado.sql).toContain("interval '1 second'");
    expect(capturado.sql).toContain("::date");
    expect(capturado.sql).toContain("GROUP BY 1, 2, 3");
  });

  // `::timestamp` y NO `::timestamptz`: `fecha_movimiento` guarda el reloj de pared UTC, y
  // `timestamptz` lo leería en el huso de la sesión de Node y desplazaría toda frontera.
  it("compara la ventana como `timestamp`, no como `timestamptz`", async () => {
    const { prisma, capturado } = prismaFalso([]);

    await new FinanzasDiarioRepository(prisma as never).sumarPorDia(new Date(), new Date());

    expect(capturado.sql).toContain("::timestamp");
    expect(capturado.sql).not.toContain("::timestamptz");
  });

  it("el importe vuelve como STRING de escala 2, nunca como número", async () => {
    const { prisma } = prismaFalso([
      { fecha: "2026-08-15", categoria: "ingreso_flete", tipo: "ingreso", total: "12.5" },
    ]);

    const filas = await new FinanzasDiarioRepository(prisma as never).sumarPorDia(
      new Date(),
      new Date(),
    );

    expect(filas[0]?.total).toBe("12.50");
    expect(typeof filas[0]?.total).toBe("string");
  });
});

describe("El borde", () => {
  const DATOS = { porDia: [], desde: "2026-07-19", hasta: "2026-08-17", lastSync: "x" };

  function deps(actor: unknown) {
    const service = { consultar: vi.fn(async () => DATOS) };
    return { deps: { service, getActor: async () => actor as never }, service };
  }

  it("el camino feliz devuelve la serie", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarFinanzasDiario(d as never)).toEqual({ status: "ok", datos: DATOS });
  });

  // El gate es `esAccesoTotal`: la caja central es UNA, y quien no es maestro o admin no ve
  // parte de ella — no ve nada. Y no se toca la base para decírselo.
  it.each(["adminTienda", "adminSatelite", "mensajero"])(
    "`%s` es forbidden y no llega al servicio",
    async (rol) => {
      const { deps: d, service } = deps({ usuarioId: "u1", rol });

      expect(await consultarFinanzasDiario(d as never)).toEqual({ status: "forbidden" });
      expect(service.consultar).not.toHaveBeenCalled();
    },
  );

  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d, service } = deps(null);

    expect(await consultarFinanzasDiario(d as never)).toEqual({ status: "unauthenticated" });
    expect(service.consultar).not.toHaveBeenCalled();
  });
});
