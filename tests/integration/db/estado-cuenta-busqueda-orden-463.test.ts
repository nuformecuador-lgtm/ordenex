import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { verEstadoCuentaAction, verEstadoCuentaCompletoAction, verMiEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO, TipoDeCuenta } from "@/lib/types/estado-cuenta";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459 } from "./_fixtures/caja-459";
import { T4, lineaDe, montarEstadoCuenta, sembrarEscenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 463 / T3 — el BUSCADOR y el ORDEN del libro de los ESTADOS DE CUENTA, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Escenario: el de la 458 (`_fixtures/wallet-458.ts`): la tienda C (7 filas, con empates de instante
// controlados), el mensajero M (6 filas, idem) y la bodega Z (3 filas armadas desde `cierre_bodega`).
// Todas las lecturas van por las ACTIONS (el borde real: el esquema pone el orden por defecto).
//
// Lo que se afirma:
//   · R37 — el saldo corrido de cada fila es el MISMO en «Mas recientes» y en «Mas antiguas» (la
//     lectura `desc` es la `asc` dada la vuelta, linea a linea con su corrido), en los tres tipos;
//   · R36 — paginas de 2 (con tres filas EMPATADAS en la bodega, sembradas aqui) recorridas en los dos sentidos = la lectura entera, sin repetir ni omitir;
//   · R34/R47 — sin orden en la entrada, el libro llega en «Mas recientes»;
//   · R26 — en la oficina el termino casa con la descripcion y con quien registro;
//   · R27 — en `/mi-wallet` buscar el nombre de quien registro da lo mismo que un texto ausente;
//   · R28 — `%` y `_` son texto (sin escapar, «%%%» y «___» devolverian el libro entero);
//   · R11 — las tarjetas del periodo NO cambian con termino, chip u orden;
//   · R44 — la descarga con termino y orden respeta el tope como hoy (tope bajado a 3 para medirlo).
//
// El ORACULO del termino no es el SQL que se prueba: se filtra la lectura ENTERA (sin termino) en
// TypeScript por la descripcion y el nombre de quien registro que la propia pantalla recibe.

const tope = vi.hoisted(() => ({ valor: 0 }));
vi.mock("@/lib/config/descarga", async (original) => {
  const real = await original<typeof import("@/lib/config/descarga")>();
  tope.valor = real.descargaConfig.MAX_FILAS;
  return {
    ...real,
    descargaConfig: new Proxy(real.descargaConfig, {
      get: (objetivo, prop, receptor) => (prop === "MAX_FILAS" ? tope.valor : Reflect.get(objetivo, prop, receptor)),
    }),
  };
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Cuenta = { tipo: TipoDeCuenta; id: string };
type Tarjetas = Pick<EstadoCuentaDTO, "saldoInicial" | "abonos" | "cargos" | "saldoFinal" | "saldoActual">;

/** Una fila en una linea: su dinero (fecha|cargo|abono|corrido|chip) + lo buscable. */
const lineaCompleta = (f: FilaEstadoCuentaDTO) => `${lineaDe(f)}|${f.descripcion ?? ""}|${f.registro.nombre ?? ""}`;
const tarjetas = (e: EstadoCuentaDTO): Tarjetas => ({
  saldoInicial: e.saldoInicial,
  abonos: e.abonos,
  cargos: e.cargos,
  saldoFinal: e.saldoFinal,
  saldoActual: e.saldoActual,
});

interface PorCuenta {
  asc: string[];
  desc: string[];
  sinOrden: string[];
  paginasAsc: string[];
  paginasDesc: string[];
  total: number;
}

interface Medida {
  maestroNombre: string;
  cuentas: Record<"tienda" | "mensajero" | "bodega", PorCuenta>;
  /** Lectura entera de la oficina (asc), para el oraculo del termino. */
  enteras: Record<"tienda" | "bodega", FilaEstadoCuentaDTO[]>;
  busquedas: Record<string, { lineas: string[]; total: number }>;
  tarjetas: Record<string, Tarjetas>;
  completo: Record<string, unknown>;
  bordes: Record<string, string>;
}

describeSiHayBase("463/T3 — buscador y orden de los estados de cuenta (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const esc = await sembrarEscenario458(tx, cat);
        // 463 — EMPATES en la bodega, que el escenario de la 458 no tiene: dos consolidaciones
        // solicitadas en el MISMO instante (T4+1h) y una de ellas recibida en ese mismo instante. Las
        // tres filas comparten `fecha`: solo `orden` (declarado antes que recibido) y el id las ordenan.
        const t5 = new Date(T4.getTime() + 3_600_000);
        for (const recibida of [true, false]) {
          await tx.cierreBodega.create({
            data: {
              zonaId: esc.zonaZ,
              solicitadoPor: esc.maestro.usuarioId,
              estado: recibida ? "aprobado" : "solicitado",
              totalEfectivo: "700.00",
              totalGeneral: "700.00",
              solicitadoAt: t5,
              ...(recibida
                ? { resueltoPor: esc.maestro.usuarioId, resueltoAt: t5, conciliadoAt: t5, conciliadoPor: esc.maestro.usuarioId, montoRecibido: "650.00" }
                : {}),
            },
          });
        }
        const ec = montarEstadoCuenta(s);
        const tiendaActor: Actor = { usuarioId: esc.tiendaC, rol: "adminTienda" };
        const oficina = async (input: Record<string, unknown>): Promise<EstadoCuentaDTO> => {
          const r = await verEstadoCuentaAction({ pageSize: 50, ...input }, { getActor: async () => esc.maestro, service: ec });
          if (r.status !== "ok") throw new Error(`oficina ${JSON.stringify(input)}: ${JSON.stringify(r)}`);
          return r.estado;
        };
        const deLaTienda = async (input: Record<string, unknown>): Promise<EstadoCuentaDTO> => {
          const r = await verMiEstadoCuentaAction({ pageSize: 50, ...input }, { getActor: async () => tiendaActor, service: ec });
          if (r.status !== "ok") throw new Error(`mi-wallet ${JSON.stringify(input)}: ${JSON.stringify(r)}`);
          return r.estado;
        };

        const cuentas: Record<"tienda" | "mensajero" | "bodega", Cuenta> = {
          tienda: { tipo: "tienda", id: esc.tiendaC },
          mensajero: { tipo: "mensajero", id: esc.mensajeroM },
          bodega: { tipo: "bodega", id: esc.zonaZ },
        };

        async function medirCuenta(cuenta: Cuenta): Promise<PorCuenta> {
          const asc = await oficina({ cuenta, sortDir: "asc" });
          const desc = await oficina({ cuenta, sortDir: "desc" });
          const sinOrden = await oficina({ cuenta });
          const recorrer = async (sortDir: "asc" | "desc") => {
            const lineas: string[] = [];
            for (let page = 1; page <= 10; page += 1) {
              const p = await oficina({ cuenta, sortDir, page, pageSize: 2 });
              if (p.filas.length === 0) break;
              lineas.push(...p.filas.map(lineaCompleta));
            }
            return lineas;
          };
          return {
            asc: asc.filas.map(lineaCompleta),
            desc: desc.filas.map(lineaCompleta),
            sinOrden: sinOrden.filas.map(lineaCompleta),
            paginasAsc: await recorrer("asc"),
            paginasDesc: await recorrer("desc"),
            total: asc.total,
          };
        }

        const enteraTienda = await oficina({ cuenta: cuentas.tienda, sortDir: "asc" });
        const enteraBodega = await oficina({ cuenta: cuentas.bodega, sortDir: "asc" });

        // En SERIE: cada lectura abre su transaccion REPEATABLE READ sobre la misma conexion del test.
        const busquedas: Record<string, { lineas: string[]; total: number }> = {};
        const buscar = async (etiqueta: string, leer: () => Promise<EstadoCuentaDTO>) => {
          const e = await leer();
          busquedas[etiqueta] = { lineas: e.filas.map(lineaCompleta), total: e.total };
        };
        await buscar("tiendaDescripcion", () => oficina({ cuenta: cuentas.tienda, sortDir: "asc", q: "COBRO_manual" }));
        await buscar("tiendaRegistrador", () => oficina({ cuenta: cuentas.tienda, sortDir: "asc", q: esc.maestroNombre }));
        await buscar("bodegaRegistrador", () => oficina({ cuenta: cuentas.bodega, sortDir: "asc", q: esc.maestroNombre }));
        await buscar("mensajeroDescripcion", () => oficina({ cuenta: cuentas.mensajero, sortDir: "asc", q: "liquidacion" }));
        await buscar("tiendaPorciento", () => oficina({ cuenta: cuentas.tienda, sortDir: "asc", q: "%%%" }));
        await buscar("tiendaGuionBajo", () => oficina({ cuenta: cuentas.tienda, sortDir: "asc", q: "___" }));
        await buscar("miWalletRegistrador", () => deLaTienda({ sortDir: "asc", q: esc.maestroNombre }));
        await buscar("miWalletAusente", () => deLaTienda({ sortDir: "asc", q: "zzz-no-existe-463" }));
        await buscar("miWalletDescripcion", () => deLaTienda({ sortDir: "asc", q: "cobro_manual" }));
        await buscar("miWalletDescripcionDesc", () => deLaTienda({ sortDir: "desc", q: "458" }));
        await buscar("miWalletDescripcionAsc", () => deLaTienda({ sortDir: "asc", q: "458" }));

        // R11 — las tarjetas con el periodo fijo, cambiando SOLO lo de la zona del libro.
        const periodo = { desde: "2026-09-11", hasta: "2026-09-15" };
        const tarjetasDe = async (input: Record<string, unknown>) => tarjetas(await oficina({ cuenta: cuentas.tienda, ...periodo, ...input }));
        const tarjetasMedidas = {
          base: await tarjetasDe({}),
          conTermino: await tarjetasDe({ q: "cobro_manual" }),
          conTerminoAusente: await tarjetasDe({ q: "zzz-no-existe-463" }),
          conChip: await tarjetasDe({ chip: "pagos" }),
          asc: await tarjetasDe({ sortDir: "asc" }),
          desc: await tarjetasDe({ sortDir: "desc" }),
          todoJunto: await tarjetasDe({ q: "458", chip: "cierres", sortDir: "asc" }),
          mensajeroBase: tarjetas(await oficina({ cuenta: cuentas.mensajero, ...periodo })),
          mensajeroConTodo: tarjetas(await oficina({ cuenta: cuentas.mensajero, ...periodo, q: "liquidacion", sortDir: "asc" })),
        };

        // R44 / R43 — la descarga con termino y orden, con el tope bajado a 3 SOLO para estas lecturas.
        const topeReal = tope.valor;
        tope.valor = 3;
        const completo = (input: Record<string, unknown>) =>
          verEstadoCuentaCompletoAction(input, { getActor: async () => esc.maestro, service: ec });
        const completoMedido = {
          porEncima: await completo({ cuenta: cuentas.tienda, q: "458", sortDir: "desc" }),
          porDebajoAsc: await completo({ cuenta: cuentas.mensajero, q: "liquidacion", sortDir: "asc" }),
          porDebajoDesc: await completo({ cuenta: cuentas.mensajero, q: "liquidacion", sortDir: "desc" }),
        };
        tope.valor = topeReal;

        const estado = async (input: Record<string, unknown>) =>
          (await verEstadoCuentaAction(input, { getActor: async () => esc.maestro, service: ec })).status;
        const bordes = {
          direccionInvalida: await estado({ cuenta: cuentas.tienda, sortDir: "arriba" }),
          campoInvalido: await estado({ cuenta: cuentas.tienda, sortBy: "monto" }),
          terminoCorto: await estado({ cuenta: cuentas.tienda, q: "ab" }),
          miWalletDireccionInvalida: (
            await verMiEstadoCuentaAction({ sortDir: "x" }, { getActor: async () => tiendaActor, service: ec })
          ).status,
          completoCampoInvalido: (await completo({ cuenta: cuentas.tienda, sortBy: "importe" })).status,
        };

        return {
          maestroNombre: esc.maestroNombre,
          cuentas: {
            tienda: await medirCuenta(cuentas.tienda),
            mensajero: await medirCuenta(cuentas.mensajero),
            bodega: await medirCuenta(cuentas.bodega),
          },
          enteras: { tienda: enteraTienda.filas, bodega: enteraBodega.filas },
          busquedas,
          tarjetas: tarjetasMedidas,
          completo: completoMedido,
          bordes,
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("no-vacuidad: las tres cuentas tienen filas (tienda 7, mensajero 6, bodega 3 + 3 empatadas)", () => {
    const c = m().cuentas;
    expect([c.tienda.total, c.mensajero.total, c.bodega.total]).toEqual([7, 6, 6]);
    expect(c.tienda.asc).toHaveLength(7);
  });

  it("R37: el saldo corrido de cada fila es el MISMO en los dos sentidos (desc = asc al reves, linea a linea)", () => {
    for (const cuenta of Object.values(m().cuentas)) {
      expect(cuenta.desc).toEqual([...cuenta.asc].reverse());
    }
    // El orden cronologico es el de la 458: el ultimo corrido de la tienda es su saldo (6 200 − 3 000 + 3 000 …).
    const tienda = m().cuentas.tienda;
    expect(tienda.desc[0]).toBe(tienda.asc[tienda.asc.length - 1]);
  });

  it("R36: paginas de 2 recorridas en los dos sentidos = la lectura entera, sin repetir ni omitir", () => {
    for (const cuenta of Object.values(m().cuentas)) {
      expect(cuenta.paginasAsc).toEqual(cuenta.asc);
      expect(cuenta.paginasDesc).toEqual(cuenta.desc);
      expect(new Set(cuenta.paginasAsc).size).toBe(cuenta.total);
    }
  });

  it("R34/R47: sin orden en la entrada, el libro llega en «Mas recientes»", () => {
    for (const cuenta of Object.values(m().cuentas)) expect(cuenta.sinOrden).toEqual(cuenta.desc);
  });

  it("R24/R26: en la oficina el termino casa con la descripcion (sin distinguir mayusculas) y con quien registro", () => {
    const { busquedas: b, enteras, maestroNombre } = m();
    const esperadaDescripcion = enteras.tienda
      .filter((f) => (f.descripcion ?? "").toLowerCase().includes("cobro_manual"))
      .map(lineaCompleta);
    expect(esperadaDescripcion).toHaveLength(1);
    expect(b.tiendaDescripcion.lineas).toEqual(esperadaDescripcion);

    const registradoPorMaestro = (filas: FilaEstadoCuentaDTO[]) =>
      filas.filter((f) => f.registro.nombre === maestroNombre).map(lineaCompleta);
    expect(registradoPorMaestro(enteras.tienda).length).toBeGreaterThan(0);
    expect(b.tiendaRegistrador.lineas).toEqual(registradoPorMaestro(enteras.tienda));
    // La bodega no tiene descripcion: solo encuentra por quien registro (el «Recibido» del escenario y
    // las tres filas empatadas que solicito/recibio el maestro).
    expect(registradoPorMaestro(enteras.bodega)).toHaveLength(4);
    expect(b.bodegaRegistrador.lineas).toEqual(registradoPorMaestro(enteras.bodega));
    expect(b.mensajeroDescripcion.total).toBe(2); // m3 y m6, «458 liquidacion»
  });

  it("R27: en /mi-wallet buscar el nombre de quien registro da lo mismo que un texto ausente (y la descripcion si busca)", () => {
    const b = m().busquedas;
    expect(b.miWalletRegistrador).toEqual(b.miWalletAusente);
    expect(b.miWalletAusente).toEqual({ lineas: [], total: 0 });
    // Control: la misma busqueda en la oficina SI encuentra filas, y en /mi-wallet la descripcion si busca.
    expect(b.tiendaRegistrador.total).toBeGreaterThan(0);
    expect(b.miWalletDescripcion.total).toBe(1);
    expect(b.miWalletDescripcionDesc.lineas).toEqual([...b.miWalletDescripcionAsc.lineas].reverse());
    expect(b.miWalletDescripcionAsc.total).toBeGreaterThan(1);
  });

  it("R28: `%` y `_` son texto (sin escapar devolverian el libro entero)", () => {
    expect(m().busquedas.tiendaPorciento).toEqual({ lineas: [], total: 0 });
    expect(m().busquedas.tiendaGuionBajo).toEqual({ lineas: [], total: 0 });
  });

  it("R11: las tarjetas del periodo no cambian con termino, chip u orden (tienda y mensajero)", () => {
    const t = m().tarjetas;
    expect(t.base.abonos !== "0.00" || t.base.cargos !== "0.00").toBe(true); // el periodo tiene movimientos
    for (const k of ["conTermino", "conTerminoAusente", "conChip", "asc", "desc", "todoJunto"]) expect(t[k]).toEqual(t.base);
    expect(t.mensajeroConTodo).toEqual(t.mensajeroBase);
  });

  it("R43/R44: la descarga con termino y orden respeta el tope como hoy; por debajo, el conjunto en el orden pedido", () => {
    const c = m().completo as Record<string, { status: string; total?: number; limite?: number; estado?: EstadoCuentaDTO }>;
    expect(c.porEncima).toEqual({ status: "limite_excedido", total: expect.any(Number), limite: 3 });
    expect(c.porEncima.total).toBeGreaterThan(3);
    expect(c.porDebajoAsc.status).toBe("ok");
    expect(c.porDebajoDesc.status).toBe("ok");
    const asc = c.porDebajoAsc.estado!.filas.map(lineaCompleta);
    expect(asc).toHaveLength(2);
    expect(c.porDebajoDesc.estado!.filas.map(lineaCompleta)).toEqual([...asc].reverse());
  });

  it("R40/R24: direccion o campo de orden no admitidos, o termino corto ⇒ validation_error", () => {
    expect(m().bordes).toEqual({
      direccionInvalida: "validation_error",
      campoInvalido: "validation_error",
      terminoCorto: "validation_error",
      miWalletDireccionInvalida: "validation_error",
      completoCampoInvalido: "validation_error",
    });
  });
});
