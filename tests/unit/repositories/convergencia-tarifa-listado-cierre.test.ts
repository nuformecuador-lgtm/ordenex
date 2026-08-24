import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

/**
 * FEATURE 274 (T8.4) — TEST DE CONVERGENCIA (R8/R21). El que justifica la feature entera.
 *
 * EL DRIFT QUE VIENE A MATAR, dicho sin rodeos: hasta esta feature el listado de ordenes
 * resolvia la tarifa con `tienda.tarifasTienda { where: { status: "activo" }, take: 1 }` —una
 * regla PROPIA, sin zona y con un `take: 1` que no ordenaba por nada— mientras la liquidacion
 * del cierre de dia usaba otra (`resolveTarifaPorTienda`, con `orderBy createdAt desc`). Con
 * la MISMA base de datos, la pantalla podia MOSTRAR una fila y el cierre FACTURAR otra. No es
 * un riesgo teorico: es el bug por el que existe la 274.
 *
 * QUE AFIRMA ESTE ARCHIVO: para el MISMO conjunto de filas de `tarifas` y la MISMA orden, el
 * camino del LISTADO (`OrdenRepository.list`) y el camino de la LIQUIDACION
 * (`CierreDiaRepository.crearCierre` sobre el resolver REAL) eligen la MISMA fila —se compara
 * el `tarifa_id`, no una descripcion— y el mismo importe de origen.
 *
 * POR QUE NO SE MOCKEA EL RESOLVER: el doble de la suite del cierre devuelve lo que se le
 * pida, asi que un cierre que resolviera con su propia regla seguiria en verde. Aqui los dos
 * caminos corren contra el MISMO doble de `prisma.tarifa.findMany`, que devuelve la tabla
 * entera y NO filtra: si alguno de los dos reintroduce una regla propia (un `status`, un
 * `take: 1`, un desempate por fecha), la fila elegida diverge y este archivo se pone rojo.
 *
 * El doble devuelve la tabla completa a proposito, y eso hace el test MAS exigente que la
 * base real: la seleccion tiene que salir entera de `elegirPorCascada` en memoria, sin
 * apoyarse en que el `WHERE` ya hubiera descartado a las candidatas ajenas.
 */

const TIENDA = "t1";
const ZONA = "z1";

/** Fila de `tarifas` con TODAS las columnas que proyectan los dos caminos. */
function filaTarifa(over: {
  id: string;
  tiendaId: string | null;
  zonaId: string | null;
  valorFlete: string;
  createdAt?: Date;
}) {
  return {
    id: over.id,
    tiendaId: over.tiendaId,
    zonaId: over.zonaId,
    valorFlete: new Prisma.Decimal(over.valorFlete),
    valorFleteGam: new Prisma.Decimal("800.00"),
    valorFleteDevuelto: new Prisma.Decimal("500.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("400.00"),
    fulfillment: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("5.00"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
    tarifaEspecial: null,
    isDefault: false,
    createdAt: over.createdAt ?? new Date("2026-01-01"),
    updatedAt: over.createdAt ?? new Date("2026-01-01"),
  };
}

type FilaTarifa = ReturnType<typeof filaTarifa>;

// --------------------------------------------------------------------------------------
// Camino 1 — EL LISTADO
// --------------------------------------------------------------------------------------

function ordenListRow() {
  return {
    id: "ord-1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: idEstado("en_bodega_central"),
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: TIENDA,
    zonaId: ZONA,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: new Prisma.Decimal("1.500"),
    notas: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    mensajeroAsignadoId: null,
    prioridad: false,
    estatus: { id: idEstado("en_bodega_central"), value: "en_bodega_central" },
    tienda: { id: TIENDA, nombre: "Tienda X", email: "t@x.co", telefono: "0990000001" },
    // NO-central a proposito: la formula lee `valorFlete`, no `valorFleteGam`, y asi el
    // importe visible depende de la fila elegida y no de la columna elegida.
    zona: { id: ZONA, nombre: "Limón", esCentral: false },
    provincia: { id: "p1", nombre: "Limón" },
    canton: { id: "c1", nombre: "Central" },
    distrito: null,
    mensajeroAsignado: null,
    gestiones: [],
    // Feature 204: el listado deriva "Flete + IVA" con el monto de la orden.
    montoCobrar: new Prisma.Decimal("25000.00"),
    cobraComision: true,
  };
}

interface ResueltoListado {
  tarifaId: string | null;
  valorFlete: number | null;
  fleteConIva: string | undefined;
  where: unknown;
}

async function resolverPorListado(filas: readonly FilaTarifa[]): Promise<ResueltoListado> {
  const tarifaFindMany = vi.fn(async () => [...filas]);
  const prisma = {
    orden: {
      findMany: vi.fn(async () => [ordenListRow()]),
      count: vi.fn(async () => 1),
    },
    tarifa: { findMany: tarifaFindMany },
  };

  const res = await new OrdenRepository(prisma as unknown as PrismaClient).list({
    where: {},
    sortBy: "created_at",
    sortDir: "desc",
    skip: 0,
    take: 50,
  });

  const tarifa = res.items[0].relaciones?.tienda?.tarifa ?? null;
  return {
    tarifaId: tarifa?.id ?? null,
    valorFlete: tarifa?.valorFlete ?? null,
    fleteConIva: res.items[0].fleteConIva,
    where: (tarifaFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
  };
}

// --------------------------------------------------------------------------------------
// Camino 2 — LA LIQUIDACION DEL CIERRE DE DIA
// --------------------------------------------------------------------------------------

/** Gestion vinculada tal como la lee `SNAPSHOT_SELECT` dentro de la tx de `crearCierre`. */
function snapshotRow() {
  return {
    ordenId: "ord-1",
    orden: {
      montoCobrar: new Prisma.Decimal("25000.00"),
      cobraComision: true,
      zonaId: ZONA,
      tiendaId: TIENDA,
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      zona: { nombre: "Limón", esCentral: false },
      tienda: { nombre: "Tienda X" },
      provincia: { nombre: "Limón" },
      canton: { nombre: "Central" },
      distrito: null,
    },
  };
}

const INPUT_CIERRE = {
  mensajeroId: "m1",
  destinoTipo: "bodega_satelite" as const,
  destinoZonaId: ZONA,
  totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
  pagoByGestionId: { g1: "0.00" },
  totalPagoMensajero: "0.00",
  ingresoByGestionId: { g1: "0.00" },
  totalIngresoBodegaRechazos: "0.00",
};

interface ResueltoCierre {
  cierreId: string | null;
  tarifaId: string | null;
  valorFleteCongelado: string | null;
  where: unknown;
}

async function resolverPorCierre(filas: readonly FilaTarifa[]): Promise<ResueltoCierre> {
  const tarifaFindMany = vi.fn(async () => [...filas]);
  // El cliente de la TX: es el que el resolver recibe como segundo argumento (R8 de la 69: la
  // tarifa se congela con lo que la tx ve, no con lo que veia el cliente de fuera).
  const tx = {
    cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
    gestionOrden: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [snapshotRow()]),
    },
    cierreDetail: { createMany: vi.fn(async () => ({ count: 1 })) },
    tarifa: { findMany: tarifaFindMany },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    tarifa: {
      findMany: vi.fn(async () => {
        throw new Error("el cierre resolvio la tarifa FUERA de su transaccion");
      }),
    },
  };

  const repo = new CierreDiaRepository(
    prisma as unknown as PrismaClient,
    // RESOLVER REAL, no un doble: es la mitad del invariante. Se construye sobre el `prisma`
    // que estalla, para que la unica via viable sea el `tx`.
    new TarifaVigenteRepository(prisma as unknown as PrismaClient),
  );

  const cierreId = await repo.crearCierre(INPUT_CIERRE);
  const data = (
    tx.cierreDetail.createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[] }]
  )[0].data;
  const congelado = data[0].tarifaValorFlete as Prisma.Decimal | null;

  return {
    cierreId,
    tarifaId: (data[0].tarifaId as string | null) ?? null,
    valorFleteCongelado: congelado === null ? null : congelado.toFixed(2),
    where: (tarifaFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
  };
}

// --------------------------------------------------------------------------------------

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

/**
 * Los escenarios. El primero es EL caso historico de divergencia y por eso va primero y con
 * nombre propio; los demas barren los tres niveles de la cascada y el hueco.
 */
const ESCENARIOS: {
  nombre: string;
  filas: FilaTarifa[];
  esperado: string | null;
  flete: string | null;
}[] = [
  {
    nombre:
      "EL CASO DEL DRIFT — una tarifa de la tienda MAS RECIENTE frente a la de la zona: gana la de la zona",
    filas: [
      // Nivel 1 del par (t1, z1), la vieja.
      filaTarifa({
        id: "ta-z1",
        tiendaId: TIENDA,
        zonaId: ZONA,
        valorFlete: "1000.00",
        createdAt: new Date("2026-07-01"),
      }),
      // Nivel 2 (tienda entera, sin zona) y MAS NUEVA. Con el `orderBy createdAt desc` de
      // `dev` esta le ganaba a la de arriba en la liquidacion; con el `take: 1` del listado,
      // la fila mostrada dependia del orden que devolviera la base. Ahora pierde por NIVEL.
      filaTarifa({
        id: "ta-generica",
        tiendaId: TIENDA,
        zonaId: null,
        valorFlete: "9999.00",
        createdAt: new Date("2026-08-01"),
      }),
    ],
    esperado: "ta-z1",
    flete: "1000.00",
  },
  {
    nombre: "nivel 2 — la tienda no tiene fila para esta zona, cobra su tarifa generica",
    filas: [
      filaTarifa({ id: "ta-generica", tiendaId: TIENDA, zonaId: null, valorFlete: "700.00" }),
      // De OTRA zona de la misma tienda: no aplica a este par por ningun nivel.
      filaTarifa({ id: "ta-z9", tiendaId: TIENDA, zonaId: "z9", valorFlete: "5.00" }),
    ],
    esperado: "ta-generica",
    flete: "700.00",
  },
  {
    nombre: "nivel 3 — la tienda no tiene ninguna fila propia, cobra la tarifa de la zona",
    filas: [
      filaTarifa({ id: "ta-zona", tiendaId: null, zonaId: ZONA, valorFlete: "300.00" }),
      filaTarifa({ id: "ta-otra-tienda", tiendaId: "t9", zonaId: ZONA, valorFlete: "1.00" }),
    ],
    esperado: "ta-zona",
    flete: "300.00",
  },
  {
    nombre: "sin fila en ningun nivel — los DOS caminos coinciden en que no hay tarifa",
    filas: [
      filaTarifa({ id: "ta-otra-tienda", tiendaId: "t9", zonaId: ZONA, valorFlete: "1.00" }),
      filaTarifa({ id: "ta-z9", tiendaId: TIENDA, zonaId: "z9", valorFlete: "5.00" }),
    ],
    esperado: null,
    flete: null,
  },
];

describe("274/T8.4 — el listado y la liquidacion resuelven la MISMA fila (R8/R21)", () => {
  for (const caso of ESCENARIOS) {
    it(`${caso.nombre}`, async () => {
      const listado = await resolverPorListado(caso.filas);
      const cierre = await resolverPorCierre(caso.filas);

      // LA AFIRMACION: el mismo `tarifa_id` por los dos caminos, sobre las mismas filas.
      expect(listado.tarifaId, "listado").toBe(caso.esperado);
      expect(cierre.tarifaId, "cierre").toBe(caso.esperado);
      expect(listado.tarifaId).toBe(cierre.tarifaId);

      // Y el mismo importe de ORIGEN: no basta con coincidir en el id si uno de los dos
      // leyera otra columna. El listado devuelve `valorFlete` como number; el cierre congela
      // la MISMA columna como Decimal.
      if (caso.flete === null) {
        expect(listado.valorFlete).toBeNull();
        expect(cierre.valorFleteCongelado).toBeNull();
        // R20/R39: el hueco no rompe la pantalla ni el cierre (la asimetria vive en T8.5).
        expect(listado.fleteConIva).toBe("0.00");
        expect(cierre.cierreId).toBe("c1");
      } else {
        expect(listado.valorFlete?.toFixed(2)).toBe(caso.flete);
        expect(cierre.valorFleteCongelado).toBe(caso.flete);
      }
    });
  }

  it("los dos caminos consultan `tarifas` con el MISMO `where`: es la misma REGLA, no dos", async () => {
    const filas = ESCENARIOS[0].filas;
    const listado = await resolverPorListado(filas);
    const cierre = await resolverPorCierre(filas);

    // Si alguno reintrodujera una condicion propia (`status`, `deletedAt`, `isDefault`, un
    // `take`), los dos `where` dejarian de ser iguales aqui antes incluso de que divergiera
    // la fila elegida.
    expect(listado.where).toEqual(cierre.where);
    expect(listado.where).toEqual({
      OR: [
        { tiendaId: { in: [TIENDA] }, zonaId: { in: [ZONA] } },
        { tiendaId: { in: [TIENDA] }, zonaId: null },
        { tiendaId: null, zonaId: { in: [ZONA] } },
      ],
    });
  });

  it("autocomprobacion: el montaje DISTINGUE filas — con otra tabla, la fila elegida cambia", async () => {
    // Sin esto, un montaje que siempre devolviera `null` por los dos caminos daria verde en
    // los cuatro escenarios y no probaria nada.
    const a = await resolverPorListado(ESCENARIOS[0].filas);
    const b = await resolverPorListado(ESCENARIOS[1].filas);
    expect(a.tarifaId).not.toBe(b.tarifaId);
    const c = await resolverPorCierre(ESCENARIOS[0].filas);
    const d = await resolverPorCierre(ESCENARIOS[1].filas);
    expect(c.tarifaId).not.toBe(d.tarifaId);
  });
});
