import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import { ANCLAJE_DEVOLUCION } from "@/tests/fixtures/anclaje-devolucion";

/**
 * Feature 264 (B8, R5/R22) — LA APROBACION SIGUE MOVIENDO EXACTAMENTE EL MISMO DINERO.
 *
 * POR QUE ESTE ARCHIVO, Y POR QUE NO VALE EL TEST OBVIO.
 *
 * El test obvio seria «con la lista VACIA los totales no cambian». Ese caso es **verde por
 * construccion**: es el estado de hoy, y lo pasaria igual una implementacion que sumara las
 * ordenes sin gestionar a la wallet. `design.md §8.3` lo prohibe explicitamente como cobertura de
 * R22, y con razon.
 *
 * Lo que se hace aqui es el caso EMPAREJADO: el MISMO cierre semilla, aprobado dos veces, una con
 * filas de `cierre_sin_gestion` y otra sin ellas. Los movimientos emitidos a los CINCO feeds
 * tienen que salir iguales **campo a campo**. Si alguien hiciera que un feed leyera esa tabla
 * (mutacion M8 de `tasks.md`), las dos corridas dejarian de coincidir y este archivo se pone rojo.
 *
 * LOS FEEDS SON LOS REALES, no dobles. Es la parte que no se puede negociar: con dobles, mutar
 * `WalletFeedService` no cambiaria nada y el test estaria vigilando su propio doble. Los que SI
 * son dobles son los repositorios que PERSISTEN los movimientos — porque lo que se compara es lo
 * que se les manda, no que lo escriban.
 *
 * El archivo vive en `tests/unit/services/` (donde `tasks.md` lo pide) aunque el sujeto sea
 * `CierresAdminRepository.resolverCierre`: ahi es donde se emite el dinero de una aprobacion, y
 * probarlo un piso mas arriba —con el repositorio doblado— no veria ni un movimiento.
 */

const CIERRE_ID = "c-264";
const MENSAJERO_ID = "m-264";
const TIENDA_ID = "t-264";
const ADMIN_ID = "adm-264";

/** Una fila de `cierre_detail` con tarifa congelada: es de donde sale TODO el dinero del cierre. */
function detalle(ordenId: string) {
  return {
    ordenId,
    tiendaId: TIENDA_ID,
    montoCobrar: new Prisma.Decimal("10000.00"),
    cobraComision: true,
    esCentral: false,
    zonaId: "z-264",
    tarifaId: "ta-264",
    tarifaValorFlete: new Prisma.Decimal("1000.00"),
    tarifaValorFleteGam: new Prisma.Decimal("1500.00"),
    tarifaValorFleteDevuelto: new Prisma.Decimal("400.00"),
    tarifaValorFleteDevueltoGam: new Prisma.Decimal("600.00"),
    tarifaComisionCod: new Prisma.Decimal("5.00"),
    tarifaIvaFlete: new Prisma.Decimal("13.00"),
    tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
  };
}

/** Una fila de `cierre_sin_gestion`: SIN un solo campo de dinero, porque no hay gestion. */
function vinculo(ordenId: string, numGuia: number) {
  return {
    id: `csg-${ordenId}`,
    cierreId: CIERRE_ID,
    ordenId,
    numGuia,
    numRemision: `REM-${ordenId}`,
    destinatario: `Dest ${ordenId}`,
    producto: "Caja",
    tiendaNombre: "Tienda 264",
    zonaNombre: "Zona 264",
    estatusOrigen: { value: "en_reparto" },
    estatusOrigenId: null,
  };
}

const GESTIONES = [
  { ordenId: "o-e1", resultado: "entregada", montoRecibido: new Prisma.Decimal("10000.00") },
  { ordenId: "o-d1", resultado: "devuelta", montoRecibido: null },
  { ordenId: "o-r1", resultado: "rechazada", montoRecibido: null },
];
const DETALLES = GESTIONES.map((g) => detalle(g.ordenId));

/** Las ordenes que el corte barrio y que la aprobacion LIBERA a bodega (feature 109). */
const ORDENES_BARRIDAS = [
  { id: "o-barrida-1", zonaId: "z-264" },
  { id: "o-barrida-2", zonaId: "z-264" },
];

/**
 * El cliente de la transaccion. Contiene ADEMAS `cierreSinGestion` con `findMany` y con las
 * cuatro escrituras posibles: si la aprobacion tocara esa tabla —borrando el vinculo al liberar,
 * por ejemplo— quedaria registrado y el caso de R5 lo caza.
 */
function buildTx(sinGestion: ReturnType<typeof vinculo>[]) {
  const tx = {
    cierreDia: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({
        mensajeroId: MENSAJERO_ID,
        totalPagoMensajero: new Prisma.Decimal("1500.00"),
        totalEfectivo: new Prisma.Decimal("10000.00"),
      })),
    },
    gestionOrden: {
      findMany: vi.fn(async () => GESTIONES),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    cierreDetail: { findMany: vi.fn(async () => DETALLES) },
    cierreSinGestion: {
      findMany: vi.fn(async () => sinGestion),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => null),
      update: vi.fn(async () => null),
    },
    walletTiendaMovimiento: { findMany: vi.fn(async () => []) },
    orden: {
      findMany: vi.fn(async () => ORDENES_BARRIDAS),
      updateMany: vi.fn(
        async (args: { where: { id: { in: string[] } }; data: unknown }) => ({
          count: args.where.id.in.length,
        }),
      ),
    },
    ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 0 })) },
  };
  return tx;
}

/** Dobles de los repositorios que PERSISTEN. Capturan lo que cada feed emitio. */
function buildCaptores() {
  const caja: unknown[][] = [];
  const tienda: unknown[][] = [];
  const mensajero: unknown[][] = [];
  const walletMovimientoRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: unknown[]) => {
      caja.push(movs);
      return movs.length;
    }),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  } as unknown as IWalletMovimientoRepository;
  const walletTiendaMovimientoRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: unknown[]) => {
      tienda.push(movs);
      return movs.length;
    }),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;
  const pagoMensajeroMovimientoRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: unknown[]) => {
      mensajero.push(movs);
      return movs.length;
    }),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
  } as unknown as IPagoMensajeroMovimientoRepository;
  return {
    caja,
    tienda,
    mensajero,
    walletMovimientoRepo,
    walletTiendaMovimientoRepo,
    pagoMensajeroMovimientoRepo,
  };
}

/** Aprueba el cierre semilla con los feeds REALES y devuelve todo lo emitido. */
async function aprobarCon(sinGestion: ReturnType<typeof vinculo>[]) {
  const tx = buildTx(sinGestion);
  const captores = buildCaptores();
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const repo = new CierresAdminRepository(
    prisma as unknown as PrismaClient,
    captores.walletMovimientoRepo,
    new WalletFeedService(),
    captores.walletTiendaMovimientoRepo,
    new WalletTiendaFeedService(),
    captores.pagoMensajeroMovimientoRepo,
    new WalletMensajeroFeedService(),
    new WalletIndemnizacionFeedService(),
  );
  // La CajaCod la instancia el propio repositorio (no se inyecta), asi que ya es la real.
  void CajaCodFeedService;

  const resultado = await repo.resolverCierre({
    cierreId: CIERRE_ID,
    alcance: { destinoTipo: "bodega_central", destinoZonaId: null },
    nuevoEstado: "aprobado",
    resueltoPor: ADMIN_ID,
    motivoRechazo: null,
    // Feature 109: la config de liberacion de las ordenes `sin_gestionar` del mensajero.
    liberacionSinGestionar: {
      sinGestionarEstatusId: idEstado("sin_gestionar"),
      enBodegaEstatusId: idEstado("en_bodega_central"),
      enBodegaSateliteEstatusId: idEstado("en_bodega_satelite"),
      centralZonaId: "z-264",
    },
    confirmacionFisica: [],
    // Feature 239: obligatorio en la rama `aprobado`. Esta suite no mide el anclaje —el bloque
    // corre en no-op con el corpus de aqui—, pero el tipo lo exige a proposito: un olvido de
    // cableado rompe el typecheck en vez de congelar devoluciones en produccion.
    anclajeDevolucion: ANCLAJE_DEVOLUCION,
  });

  return { resultado, tx, ...captores };
}

beforeEach(async () => {
  // El choke point del historial es de fallo CERRADO: sin catalogo real no valida la transicion.
  await sembrarCatalogoEstados();
});

describe("264/B8 — aprobar un cierre CON ordenes sin gestionar mueve el mismo dinero (R22)", () => {
  it("R22: los movimientos de los CINCO feeds son iguales campo a campo, con y sin la lista", async () => {
    // ⭑ EL CASO EMPAREJADO. `conLista` tiene TRES filas de `cierre_sin_gestion`; `sinLista`,
    // ninguna. Todo lo demas es identico. Si un feed leyera esa tabla, las dos corridas
    // divergirian aqui.
    const conLista = await aprobarCon([vinculo("o-b1", 11), vinculo("o-b2", 12), vinculo("o-b3", 13)]);
    const sinLista = await aprobarCon([]);

    expect(conLista.resultado).toBe(sinLista.resultado);
    // Caja principal (ingresos de Ordenex + egreso del pago al mensajero + ingreso COD).
    expect(conLista.caja).toEqual(sinLista.caja);
    // Ledger por tienda (credito COD + debitos por concepto).
    expect(conLista.tienda).toEqual(sinLista.tienda);
    // Libro del pago por mensajero (devengo + pago).
    expect(conLista.mensajero).toEqual(sinLista.mensajero);

    // Contrapunto OBLIGATORIO: si las tres listas estuvieran vacias, las tres igualdades de
    // arriba pasarian sin comprobar nada. El cierre semilla SI mueve dinero.
    expect(conLista.caja.flat().length).toBeGreaterThan(0);
    expect(conLista.tienda.flat().length).toBeGreaterThan(0);
    expect(conLista.mensajero.flat().length).toBeGreaterThan(0);
  });

  it("R22: los importes de la caja son los del cierre semilla, no unos derivados de la lista", async () => {
    // Los literales cierran la puerta que la igualdad de arriba deja abierta: si alguien hiciera
    // que las DOS corridas leyeran la tabla, seguirian siendo iguales entre si. Estos numeros
    // salen SOLO de `cierre_detail` (una entregada, una devuelta y una rechazada de 10 000.00
    // con la tarifa congelada del fixture) y no cambian porque haya tres ordenes barridas.
    const { caja } = await aprobarCon([vinculo("o-b1", 11), vinculo("o-b2", 12)]);
    const porCategoria = Object.fromEntries(
      caja.flat().map((m) => [(m as { categoria: string }).categoria, (m as { monto: string }).monto]),
    );

    expect(porCategoria.ingreso_flete).toBe("1000.00");
    expect(porCategoria.ingreso_iva_flete).toBe("130.00");
    expect(porCategoria.ingreso_comision_cod).toBe("500.00");
    expect(porCategoria.ingreso_iva_comision_cod).toBe("65.00");
    expect(porCategoria.ingreso_flete_devolucion).toBe("800.00");
    expect(porCategoria.ingreso_iva_flete_devolucion).toBe("104.00");
  });

  it("R22: ninguna orden barrida aparece como origen de un movimiento de dinero", async () => {
    const ordenesBarridas = ["o-b1", "o-b2", "o-b3"];
    const { caja, tienda, mensajero } = await aprobarCon(
      ordenesBarridas.map((o, i) => vinculo(o, 20 + i)),
    );

    const todo = JSON.stringify([...caja.flat(), ...tienda.flat(), ...mensajero.flat()]);
    for (const o of ordenesBarridas) {
      expect(todo).not.toContain(o);
    }
  });

  it("R5: la aprobacion NO borra ni reescribe el vinculo — la fila sobrevive al cierre", async () => {
    const { tx } = await aprobarCon([vinculo("o-b1", 11)]);

    // La liberacion (feature 109) le cambia el estatus a la ORDEN y le quita el mensajero; el
    // VINCULO no se toca. Es justo lo que hace que un cierre aprobado siga sabiendo que barrio:
    // antes de esta feature, ese momento era el que borraba el unico rastro que habia.
    expect(tx.cierreSinGestion.deleteMany).not.toHaveBeenCalled();
    expect(tx.cierreSinGestion.delete).not.toHaveBeenCalled();
    expect(tx.cierreSinGestion.updateMany).not.toHaveBeenCalled();
    expect(tx.cierreSinGestion.update).not.toHaveBeenCalled();
    expect(tx.cierreSinGestion.createMany).not.toHaveBeenCalled();
  });

  it("R22/109: la liberacion de las `sin_gestionar` sigue siendo la de siempre", async () => {
    const { tx } = await aprobarCon([vinculo("o-b1", 11)]);

    // Se localiza por su GUARDA, no por su posicion: la rama `aprobado` tiene mas de un
    // `updateMany` sobre `orden` y un indice fijo se rompe en cuanto se añade otro bloque.
    const upd = tx.orden.updateMany.mock.calls
      .map(([a]) => a as { where: { estatusId?: string; id: { in: string[] } }; data: unknown })
      .find((a) => a.where.estatusId === idEstado("sin_gestionar"));
    expect(upd, "la liberacion de las `sin_gestionar` no ocurrio").toBeDefined();
    // Guardada por el estatus de origen, y money-neutral: SOLO toca columnas de `orden`.
    expect(upd?.where).toEqual({
      id: { in: ["o-barrida-1", "o-barrida-2"] },
      estatusId: idEstado("sin_gestionar"),
      deletedAt: null,
    });
    expect(upd?.data).toEqual({
      estatusId: idEstado("en_bodega_central"),
      mensajeroAsignadoId: null,
      asignadoAt: null,
      fechaReparto: null,
      prioridad: true,
    });
  });
});
