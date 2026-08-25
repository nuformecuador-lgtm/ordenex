import { Prisma, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import type { ITarifaVigenteRepository } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import {
  computeTotales,
  derivarIngresoBodega,
  derivarPagos,
} from "@/lib/utils/cierre-totales";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// 💰 Feature 237 (T6.1/T6.2/T6.6, R29/R30/R36) — LA MITAD DEL DINERO: la gestion que registra LA
// TIENDA entra en el cierre DEL MENSAJERO por el MISMO mecanismo que las suyas, y mueve
// EXACTAMENTE el mismo dinero.
//
// Es la tanda que la revision lee primero, asi que se monta sobre el REPOSITORIO REAL con un doble
// de Prisma que guarda filas de verdad (no un mock que devuelve lo que se le pide): el `where` de
// `crearCierre` y el de `findGestionesPendientes` se EVALUAN contra el almacen. Si alguien les
// añadiera un filtro por mensajero distinto, por origen o por actor, estos casos caen.
//
// LO QUE SOSTIENE TODO ESTO ES R3: la gestion de la tienda nace con `mensajero_id` = el mensajero.
// `crearCierre` vincula por `{ mensajeroId, cierreId: null, anuladaAt: null }` y
// `findGestionesPendientes` filtra igual — ninguno de los dos mira quien la registro. Con el id de
// la tienda ahi, la fila no se vincularia NUNCA y desapareceria de los cinco feeds sin que nada
// fallara. Es la mutacion T8.1.

/** Fila de `gestion_orden` del almacen en memoria. Solo lo que estas consultas miran. */
interface FilaGestion {
  id: string;
  ordenId: string;
  mensajeroId: string;
  resultado: "entregada" | "reprogramada" | "rechazada" | "devuelta" | "incidente";
  cierreId: string | null;
  anuladaAt: Date | null;
  pagoMensajero: Prisma.Decimal | null;
  ingresoBodegaRechazo: Prisma.Decimal | null;
  createdAt: Date;
  /** Familia de la fila de historial que la produjo: quien la registro. */
  origen: "gestion" | "gestion_tienda_ayuda";
}

let seq = 0;

function gestion(over: Partial<FilaGestion> = {}): FilaGestion {
  seq += 1;
  return {
    id: `g${seq}`,
    ordenId: `o${seq}`,
    mensajeroId: "mensajero-1",
    resultado: "rechazada",
    cierreId: null,
    anuladaAt: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    createdAt: new Date(2026, 7, 20, 10, seq),
    origen: "gestion",
    ...over,
  };
}

/** La MISMA gestion, pero registrada por la tienda desde la pestaña de ayuda. */
function gestionDeLaTienda(over: Partial<FilaGestion> = {}): FilaGestion {
  return gestion({ ...over, origen: "gestion_tienda_ayuda" });
}

/** Proyeccion que `WITH_DETALLE` espera; los descriptivos son de relleno. */
function proyectar(f: FilaGestion) {
  return {
    id: f.id,
    ordenId: f.ordenId,
    resultado: f.resultado,
    montoRecibido: null,
    metodoPago: null,
    motivo: "motivo",
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: f.pagoMensajero,
    ingresoBodegaRechazo: f.ingresoBodegaRechazo,
    causaIncidente: null,
    pagos: [],
    orden: {
      numGuia: `G-${f.ordenId}`,
      numRemision: null,
      destinatario: "Destinatario",
      direccion: "Direccion",
      producto: "Producto",
      montoCobrar: null,
      cobraComision: true,
      zonaId: "z1",
      tiendaId: "t1",
      tienda: { nombre: "Tienda" },
      zona: { nombre: "Zona", esCentral: true },
      provincia: { nombre: "Provincia" },
      canton: { nombre: "Canton" },
      distrito: { nombre: "Distrito" },
    },
  };
}

/**
 * Doble de Prisma con ALMACEN: `updateMany` muta las filas que casan el `where`, y `findMany` las
 * devuelve. No es un mock que responde lo que se le dice — es donde se comprueba que el `where`
 * hace lo que dice.
 */
function buildStore(filas: FilaGestion[]) {
  const cierres: { id: string; mensajeroId: string }[] = [];
  /** Estatus REAL de cada orden. Sin sembrar, una orden se supone en el estatus de ayuda. */
  const ordenes = new Map<string, string>();
  const detalles: Record<string, unknown>[] = [];

  function casa(f: FilaGestion, where: Record<string, unknown>): boolean {
    if ("mensajeroId" in where && f.mensajeroId !== where.mensajeroId) return false;
    if ("cierreId" in where) {
      const w = where.cierreId;
      if (w === null && f.cierreId !== null) return false;
      if (typeof w === "string" && f.cierreId !== w) return false;
    }
    if ("anuladaAt" in where && where.anuladaAt === null && f.anuladaAt !== null) return false;
    if ("id" in where) {
      const w = where.id as string | { in: string[] };
      if (typeof w === "string" && f.id !== w) return false;
      if (typeof w === "object" && !w.in.includes(f.id)) return false;
    }
    return true;
  }

  const gestionOrden = {
    findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
      filas.filter((f) => casa(f, args.where)).map(proyectar),
    ),
    updateMany: vi.fn(
      async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const f of filas) {
          if (!casa(f, args.where)) continue;
          count += 1;
          if ("cierreId" in args.data) f.cierreId = args.data.cierreId as string;
          if ("pagoMensajero" in args.data) {
            f.pagoMensajero = args.data.pagoMensajero as Prisma.Decimal;
          }
          if ("ingresoBodegaRechazo" in args.data) {
            f.ingresoBodegaRechazo = args.data.ingresoBodegaRechazo as Prisma.Decimal;
          }
        }
        return { count };
      },
    ),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    // El INSERT del camino de la tienda: mete la fila EN EL MISMO almacen que despues lee
    // `crearCierre`. Es lo que hace posible el caso end-to-end.
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const f = gestion({
        id: `g-nueva-${filas.length + 1}`,
        ordenId: args.data.ordenId as string,
        mensajeroId: args.data.mensajeroId as string,
        resultado: args.data.resultado as FilaGestion["resultado"],
        cierreId: (args.data.cierreId as string | undefined) ?? null,
        origen: "gestion_tienda_ayuda",
      });
      filas.push(f);
      return { id: f.id };
    }),
  };

  const prisma = {
    gestionOrden,
    gestionOrdenEvidencia: { createMany: vi.fn(async () => ({ count: 0 })) },
    gestionOrdenPago: { createMany: vi.fn(async () => ({ count: 0 })) },
    usuario: { update: vi.fn() },
    orden: {
      count: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      // ⚠️ FIEL AL MOTOR, no a la guarda. El `where` se aplica sobre el estatus REAL que la orden
      // tiene en el almacen: si el `where` trae `estatusId`, tiene que coincidir; si NO lo trae
      // (mutacion T8.3), Postgres actualizaria igual — y este doble tambien. Un doble que
      // devolviera `count: 0` por la mera ausencia de la guarda daria un rojo FALSO: parecería
      // que el test caza la mutacion cuando lo que caza es su propia suposicion.
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: { estatusId: string } }) => {
        const actual = ordenes.get(args.where.id as string) ?? idEstado("ayuda_tienda");
        if ("estatusId" in args.where && args.where.estatusId !== actual) return { count: 0 };
        ordenes.set(args.where.id as string, args.data.estatusId);
        return { count: 1 };
      }),
    },
    ordenHistorialEstado: {
      findFirst: vi.fn(async () => null),
      createMany: vi.fn(async () => ({ count: 1 })),
      // Feature 237 (D6/R41): la lectura en lote del rotulo. Devuelve las filas de las gestiones
      // que este almacen sabe que registro la tienda, para que el flag no sea siempre `false`.
      findMany: vi.fn(async () =>
        filas
          .filter((f) => f.origen === "gestion_tienda_ayuda")
          .map((f) => ({ gestionOrdenId: f.id })),
      ),
    },
    cierreDia: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(async (args: { data: { mensajeroId: string } }) => {
        const id = `c${cierres.length + 1}`;
        cierres.push({ id, mensajeroId: args.data.mensajeroId });
        return { id };
      }),
    },
    cierreDetail: {
      createMany: vi.fn(async (args: { data: Record<string, unknown>[] }) => {
        detalles.push(...args.data);
        return { count: args.data.length };
      }),
    },
    tarifa: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(prisma)),
  };

  return { prisma, filas, cierres, detalles, ordenes };
}

// Feature 274: la interfaz quedo en DOS metodos —`resolveTarifa` y `resolveTarifas`— y el
// batch pasa PARES (tienda, zona) con `tx` opcional y segundo. Este camino no mide tarifas:
// el stub resuelve `null` para todo par (gap R23), que es lo que dejaba antes para toda tienda.
const TARIFA_REPO: ITarifaVigenteRepository = {
  resolveTarifa: vi.fn(async () => null),
  resolveTarifas: vi.fn(async (pares: readonly ParTarifa[]) => {
    const m = new Map<string, null>();
    for (const par of pares) m.set(clavePar(par), null);
    return m;
  }),
};

function repoCon(store: ReturnType<typeof buildStore>) {
  return new CierreDiaRepository(store.prisma as unknown as PrismaClient, TARIFA_REPO);
}

/** El repositorio que ESCRIBE la gestion de la tienda, sobre el MISMO almacen. */
function gestionRepoCon(store: ReturnType<typeof buildStore>) {
  const colaFake = {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
  return new GestionOrdenRepository(store.prisma as unknown as PrismaClient, colaFake as never);
}

// La guardia del choke point (140) es de FALLO CERRADO: valida el par
// `ayuda_tienda -> rechazada` contra el mapa REAL de transiciones. Sin catalogo sembrado, el caso
// end-to-end reventaria aqui — que es exactamente lo que se quiere si la arista #66 desapareciera.
beforeEach(async () => {
  await sembrarCatalogoEstados();
});

const TOTALES_CERO = { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" };

function inputCierre(over: Record<string, unknown> = {}) {
  return {
    mensajeroId: "mensajero-1",
    destinoTipo: "bodega_central" as const,
    destinoZonaId: "z1",
    totales: TOTALES_CERO,
    pagoByGestionId: {},
    totalPagoMensajero: "0.00",
    ingresoByGestionId: {},
    totalIngresoBodegaRechazos: "0.00",
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* T6.1 / R29 — la gestion de la tienda CAE en el cierre del mensajero          */
/* -------------------------------------------------------------------------- */

describe("💰 R29 — la gestion de la tienda entra en el cierre del mensajero, por el MISMO mecanismo", () => {
  // ⭑ EL CASO END-TO-END. Los demas casos de este bloque parten de una fila ya sembrada, asi que
  // ejercen el `where` de `crearCierre` pero NO el de quien la escribio. Este arranca en
  // `GestionOrdenRepository.crearGestionDesdeAyuda` —la escritura real de la ficha— y termina en
  // `CierreDiaRepository.crearCierre`, sobre EL MISMO almacen. Es el unico que muere si alguien
  // cambia el `mensajero_id` de la fila por el de la tienda (mutacion T8.1), y por eso existe.
  it("💰 end-to-end: la tienda gestiona -> `crearCierre` la vincula al cierre DEL MENSAJERO", async () => {
    const store = buildStore([]);
    const gestionRepo = gestionRepoCon(store);

    const gestionId = await gestionRepo.crearGestionDesdeAyuda({
      ordenId: "o-e2e",
      estatusAyudaId: idEstado("ayuda_tienda"),
      estatusDestinoId: idEstado("rechazada"),
      mensajeroId: "mensajero-1", // 💰 R3: a quien se ATRIBUYE
      actorUsuarioId: "tienda-1", // R4: quien la REGISTRA
      // Feature 261 (B17): la segunda capa del bloqueo por reserva. Este archivo mide DINERO
      // (que la gestion caiga en el cierre del mensajero), no el predicado del dia: basta con un
      // dia valido para que la orden sembrada, que no tiene reserva, pase la guarda.
      diaEnCurso: new Date("2026-08-21T00:00:00.000Z"),
      gestion: { resultado: "rechazada", motivo: "el cliente no la quiere", evidencias: [] },
    });
    expect(gestionId).not.toBeNull();

    // La fila nace huerfana de cierre (R9) y el mecanismo de siempre se la lleva (R29).
    const creada = store.filas.find((f) => f.id === gestionId);
    expect(creada?.cierreId ?? null).toBeNull();

    const cierreId = await repoCon(store).crearCierre(inputCierre());

    expect(cierreId).not.toBeNull();
    expect(creada?.cierreId).toBe(cierreId);
    // Y con su fila de detalle: sin ella, `WalletFeedService` abortaria la aprobacion.
    expect(store.detalles.map((d) => d.ordenId)).toEqual(["o-e2e"]);
  });

  // 💰 R24/R25 — LA CARRERA, ejercida contra el estatus REAL de la orden, no contra un contador
  // amañado. Es el caso que muere si alguien le quita `estatusId` al `where` del `updateMany`
  // (mutacion T8.3): sin esa condicion, la tienda resolveria una orden que el mensajero ya
  // recupero —o que el corte de la noche ya se llevo— y le cobraria un rechazo por ella.
  it("💰 end-to-end: si la orden YA salio de ayuda, no se crea gestion ni se mueve nada (R24/R25)", async () => {
    const store = buildStore([]);
    // El mensajero gano la carrera: pulso «Recuperar» y la orden volvio a `en_reparto`.
    store.ordenes.set("o-carrera", idEstado("en_reparto"));

    const gestionId = await gestionRepoCon(store).crearGestionDesdeAyuda({
      ordenId: "o-carrera",
      estatusAyudaId: idEstado("ayuda_tienda"),
      estatusDestinoId: idEstado("rechazada"),
      mensajeroId: "mensajero-1",
      actorUsuarioId: "tienda-1",
      diaEnCurso: new Date("2026-08-21T00:00:00.000Z"), // feature 261 (B17)
      gestion: { resultado: "rechazada", motivo: "el cliente no la quiere", evidencias: [] },
    });

    expect(gestionId).toBeNull();
    // Ni una fila de gestion...
    expect(store.filas).toHaveLength(0);
    // ...ni un movimiento de estado: la orden se queda donde el mensajero la dejo.
    expect(store.ordenes.get("o-carrera")).toBe(idEstado("en_reparto"));
  });

  it("`crearCierre` la vincula: el `where` no mira quien la registro, solo a quien se atribuye", async () => {
    const deLaTienda = gestionDeLaTienda({ id: "g-tienda", ordenId: "o-tienda" });
    const store = buildStore([deLaTienda]);

    const cierreId = await repoCon(store).crearCierre(inputCierre());

    expect(cierreId).not.toBeNull();
    // ESTA es la afirmacion de la ficha: la fila que registro la tienda tiene `cierre_id` del
    // cierre del mensajero. Nadie escribio un camino propio para ella.
    expect(deLaTienda.cierreId).toBe(cierreId);
  });

  it("💰 R41: aparece en `findGestionesPendientes` Y ROTULADA como hecha por la tienda", async () => {
    // Las dos mitades de D6 en un solo caso, y emparejadas: la orden desaparece del portal del
    // mensajero, pero la fila de su cierre del dia SI la lleva — y dice quien la hizo. Sin el
    // rotulo, el mensajero firma un cierre con una gestion que no hizo y una evidencia que no
    // subio, y no puede explicarla si le preguntan.
    const deLaTienda = gestionDeLaTienda({ id: "g-tienda", ordenId: "o-tienda" });
    const propia = gestion({ id: "g-propia", ordenId: "o-propia" });
    const store = buildStore([deLaTienda, propia]);

    const pendientes = await repoCon(store).findGestionesPendientes("mensajero-1");

    expect(pendientes.map((g) => [g.gestionId, g.desdeAyudaTienda])).toEqual([
      ["g-tienda", true],
      ["g-propia", false],
    ]);
  });

  it("y tiene su fila de `cierre_detail` — sin ella, la APROBACION abortaria", async () => {
    // `WalletFeedService` aborta si una gestion del cierre no tiene detalle. Que el snapshot se
    // construya leyendo `where: { cierreId }` DENTRO de la tx es lo que garantiza que una gestion
    // creada por la tienda entre la lectura del servicio y la transaccion tenga su fila igual.
    const deLaTienda = gestionDeLaTienda({ id: "g-tienda", ordenId: "o-tienda" });
    const store = buildStore([deLaTienda]);

    await repoCon(store).crearCierre(inputCierre());

    expect(store.detalles).toHaveLength(1);
    expect(store.detalles[0]).toMatchObject({ ordenId: "o-tienda" });
  });

  it("una gestion del mensajero y otra de la tienda entran en el MISMO cierre, sin distincion", async () => {
    const propia = gestion({ id: "g-propia", ordenId: "o-propia" });
    const deLaTienda = gestionDeLaTienda({ id: "g-tienda", ordenId: "o-tienda" });
    const store = buildStore([propia, deLaTienda]);

    const cierreId = await repoCon(store).crearCierre(inputCierre());

    expect(propia.cierreId).toBe(cierreId);
    expect(deLaTienda.cierreId).toBe(cierreId);
    expect(store.detalles).toHaveLength(2);
  });

  it("💰 la de OTRO mensajero NO entra: el unico filtro es a quien se atribuye", async () => {
    // El contraste que hace que los casos de arriba digan algo. Si el `where` no filtrara por
    // mensajero, esta gestion tambien caeria en el cierre y se le pagaria al mensajero equivocado.
    const ajena = gestionDeLaTienda({ id: "g-ajena", mensajeroId: "mensajero-2" });
    const propia = gestion({ id: "g-propia" });
    const store = buildStore([propia, ajena]);

    const cierreId = await repoCon(store).crearCierre(inputCierre());

    expect(propia.cierreId).toBe(cierreId);
    expect(ajena.cierreId).toBeNull();
  });

  it("R39: una gestion de la tienda ANULADA no se vincula a ningun cierre", async () => {
    const anulada = gestionDeLaTienda({ id: "g-anulada", anuladaAt: new Date(2026, 7, 20) });
    const propia = gestion({ id: "g-propia" });
    const store = buildStore([propia, anulada]);

    await repoCon(store).crearCierre(inputCierre());

    expect(anulada.cierreId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* T6.3 / R31 + R32 — LA INVARIANTE: el cierre en curso y el SIGUIENTE          */
/* -------------------------------------------------------------------------- */

describe("💰 R31/R32 (D1) — la gestion posterior cae en el SIGUIENTE cierre, y en UNO SOLO", () => {
  it("R31/R32: un cierre ya creado NO la contiene, y sus totales NO cambian", async () => {
    // El escenario de D1, ejercido y no supuesto: el mensajero ya tiene un cierre creado (con su
    // snapshot congelado) y DESPUES la tienda resuelve una orden desde ayuda.
    const yaCerrada = gestion({ id: "g-ya", ordenId: "o-ya" });
    const store = buildStore([yaCerrada]);
    const repo = repoCon(store);

    const primerCierre = await repo.crearCierre(inputCierre());
    const detallesTrasPrimero = store.detalles.length;

    // ...y ahora la tienda gestiona. La gestion nace con `cierre_id = NULL`.
    const posterior = gestionDeLaTienda({ id: "g-posterior", ordenId: "o-posterior" });
    store.filas.push(posterior);

    // (a) el cierre en curso NO la contiene
    expect(posterior.cierreId).toBeNull();
    expect(posterior.cierreId).not.toBe(primerCierre);
    // (b) R31: sus totales y su detalle NO se tocan — el snapshot ya se congelo sin ella
    expect(store.detalles).toHaveLength(detallesTrasPrimero);
    expect(store.detalles.map((d) => d.ordenId)).toEqual(["o-ya"]);

    // (c) y el SIGUIENTE cierre SI la contiene
    const segundoCierre = await repo.crearCierre(inputCierre());
    expect(posterior.cierreId).toBe(segundoCierre);
    expect(segundoCierre).not.toBe(primerCierre);
  });

  it("R32: a UNO SOLO — el segundo cierre no vuelve a llevarse la que ya estaba en el primero", async () => {
    // «Nunca a ninguno, nunca a dos». La guarda `cierreId: null` del `updateMany` es lo que lo
    // impide: una gestion ya vinculada deja de casar el `where`.
    const yaCerrada = gestion({ id: "g-ya", ordenId: "o-ya" });
    const store = buildStore([yaCerrada]);
    const repo = repoCon(store);

    const primerCierre = await repo.crearCierre(inputCierre());
    const posterior = gestionDeLaTienda({ id: "g-posterior", ordenId: "o-posterior" });
    store.filas.push(posterior);
    const segundoCierre = await repo.crearCierre(inputCierre());

    expect(yaCerrada.cierreId).toBe(primerCierre); // sigue en el suyo
    expect(posterior.cierreId).toBe(segundoCierre); // y la nueva en el siguiente
  });
});

/* -------------------------------------------------------------------------- */
/* T6.2 / R30 — el dinero es EL MISMO, venga de quien venga                     */
/* -------------------------------------------------------------------------- */

describe("💰 R30 — los movimientos son IDENTICOS venga la gestion del mensajero o de la tienda", () => {
  // Las tres funciones que deciden el dinero del cierre son PURAS y reciben la fila de dominio:
  // `derivarPagos` (lo que se le paga al mensajero), `derivarIngresoBodega` (el `cobroRechazado`,
  // que es ingreso de BODEGA en el cierre del mensajero, y NO un debito a la tienda) y
  // `computeTotales` (la caja del dia). NINGUNA recibe el origen ni el actor — no tienen por donde
  // enterarse—, y eso es exactamente lo que R30 afirma. Se prueba comparando salidas, no leyendo el
  // codigo.
  //
  // Los importes se comparan como STRING: nunca `number` ni `parseFloat` sobre un monto.
  const TARIFA = { cobroEntregado: "1500.00", cobroRechazado: "1000.00" };

  /** Fila de dominio minima con lo que el dinero mira. */
  function fila(
    gestionId: string,
    resultado: CierreGestionPendienteRow["resultado"],
  ): CierreGestionPendienteRow {
    return {
      gestionId,
      ordenId: `o-${gestionId}`,
      numGuia: 1,
      numRemision: "R-1",
      destinatario: "D",
      direccion: "Dir",
      zonaNombre: "Z",
      provinciaNombre: "P",
      cantonNombre: "C",
      distritoNombre: null,
      producto: "Prod",
      tiendaNombre: "T",
      resultado,
      montoRecibido: null,
      metodoPago: null,
      pagos: [],
      motivo: "m",
      fechaReprogramacion: null,
      evidenciaStoragePath: null,
      pagoMensajero: null,
      ingresoBodegaRechazo: null,
      esRechazoSla: false,
      desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
      causaIncidente: null,
      indemnizacion: null,
    };
  }

  it.each(["rechazada", "reprogramada"] as const)(
    "`%s`: mismo pago, mismo ingreso y mismos totales para las dos procedencias",
    (resultado) => {
      const delMensajero = [fila("g-mensajero", resultado)];
      const deLaTienda = [fila("g-tienda", resultado)];

      const pagoM = derivarPagos(delMensajero, TARIFA);
      const pagoT = derivarPagos(deLaTienda, TARIFA);
      const ingM = derivarIngresoBodega(delMensajero, TARIFA);
      const ingT = derivarIngresoBodega(deLaTienda, TARIFA);

      expect(pagoT.total).toBe(pagoM.total);
      expect(ingT.total).toBe(ingM.total);
      expect(computeTotales(deLaTienda)).toEqual(computeTotales(delMensajero));
    },
  );

  it("💰 `rechazada` de la tienda dispara el `cobroRechazado` DE LA TARIFA, exactamente igual", () => {
    // El importe es DINERO REAL, pero NO es un debito a la tienda: los hasta ₡1.000 del
    // `cobroRechazado` (medido en produccion el 2026-08-20) son INGRESO DE BODEGA y caen en el
    // cierre DEL MENSAJERO —por eso la funcion que este caso ejerce se llama `derivarIngresoBodega`
    // y por eso en la billetera de la tienda no hay apunte por ese concepto—. A la tienda un rechazo
    // SI le cuesta, pero por otra via y otra tarifa: el flete de devolucion mas IVA 13 %. La tarifa
    // se resuelve por zona + vehiculo DEL MENSAJERO, coherente con «cuenta como del mensajero», y
    // el resultado es el mismo string.
    const deLaTienda = [fila("g-tienda", "rechazada")];
    const { ingresoByGestionId, total } = derivarIngresoBodega(deLaTienda, TARIFA);
    expect(ingresoByGestionId["g-tienda"]).toBe("1000.00");
    expect(total).toBe("1000.00");
    // Y no se le paga nada al mensajero por un rechazo: solo `entregada` paga.
    expect(derivarPagos(deLaTienda, TARIFA).total).toBe("0.00");
  });

  it("`reprogramada` de la tienda es money-neutral: 0.00 en pago y 0.00 en ingreso", () => {
    const deLaTienda = [fila("g-tienda", "reprogramada")];
    expect(derivarPagos(deLaTienda, TARIFA)).toEqual({
      pagoByGestionId: { "g-tienda": "0.00" },
      total: "0.00",
    });
    expect(derivarIngresoBodega(deLaTienda, TARIFA)).toEqual({
      ingresoByGestionId: { "g-tienda": "0.00" },
      total: "0.00",
    });
    // Y no aporta a los totales de caja: `computeTotales` solo suma lo entregado.
    expect(computeTotales(deLaTienda)).toMatchObject({ general: "0.00" });
  });

  it("los importes viajan como STRING de escala 2 — ni un `number` en el camino", () => {
    const { total } = derivarIngresoBodega([fila("g-tienda", "rechazada")], TARIFA);
    expect(typeof total).toBe("string");
    expect(total).toMatch(/^\d+\.\d{2}$/);
  });

  // ⭑ EL CASO QUE ATA EL DINERO A LA FILA REAL. Los de arriba comparan salidas de funciones PURAS,
  // que nunca ven el `mensajero_id` — por eso sobreviven a cualquier mutacion de la escritura, y
  // por eso solos no bastan. Este arranca en `crearGestionDesdeAyuda` y termina con el SNAPSHOT del
  // ingreso escrito en la fila por `crearCierre`: si la gestion no se vincula (mutacion T8.1), no
  // hay snapshot que escribir y el `cobroRechazado` de la tienda se pierde en silencio.
  it("💰 end-to-end: el `cobroRechazado` se congela EN LA FILA que registro la tienda", async () => {
    const store = buildStore([]);

    const gestionId = await gestionRepoCon(store).crearGestionDesdeAyuda({
      ordenId: "o-dinero",
      estatusAyudaId: idEstado("ayuda_tienda"),
      estatusDestinoId: idEstado("rechazada"),
      mensajeroId: "mensajero-1",
      actorUsuarioId: "tienda-1",
      diaEnCurso: new Date("2026-08-21T00:00:00.000Z"), // feature 261 (B17)
      gestion: { resultado: "rechazada", motivo: "el cliente no la quiere", evidencias: [] },
    });
    expect(gestionId).not.toBeNull();

    // El servicio del cierre deriva el ingreso con la MISMA funcion pura de siempre y se lo pasa a
    // `crearCierre` como snapshot por gestion. Aqui se hace ese paso explicito.
    const cierreId = await repoCon(store).crearCierre(
      inputCierre({
        ingresoByGestionId: { [gestionId as string]: "1000.00" },
        totalIngresoBodegaRechazos: "1000.00",
      }),
    );
    expect(cierreId).not.toBeNull();

    const creada = store.filas.find((f) => f.id === gestionId);
    // Money-safe: se compara como STRING de escala 2, nunca como `number`.
    expect(creada?.ingresoBodegaRechazo?.toFixed(2)).toBe("1000.00");
  });
});

/* -------------------------------------------------------------------------- */
/* T6.6 / R36 — los KPI del mensajero no se mueven                              */
/* -------------------------------------------------------------------------- */

describe("R36 — el «Total a cobrar del dia» del mensajero no cambia: la orden cambia de SUMANDO", () => {
  it("los dos sumandos son DISJUNTOS por construccion, y `ayuda_tienda` esta en el excluido", async () => {
    // El total tiene dos partes: `porCobrar` (lo que lleva en la mano: `porGestionar ∪ conAyuda`) y
    // `sumMontoCobrarGestionadas` (lo ya gestionado hoy). Al gestionar la tienda, la orden SALE del
    // primero (deja `ayuda_tienda`) y ENTRA en el segundo (tiene gestion vigente del dia con su
    // `mensajero_id`). El total no se mueve porque la orden solo cambia de sumando.
    //
    // La disjuncion vive en el `where` de `gestionadasDelDiaWhere`, que EXCLUYE los estatus «en
    // mano». Se lee del fuente porque es donde vive: un test de servicio con dobles no ve ese SQL.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fuente = fs.readFileSync(
      path.join(process.cwd(), "lib", "repositories", "GestionOrdenRepository.ts"),
      "utf8",
    );
    const bloque = fuente.match(
      /const ESTADOS_EN_MANO_DEL_MENSAJERO = \[([^\]]*)\]/,
    );
    expect(bloque).not.toBeNull();
    const lista = (bloque as RegExpMatchArray)[1];
    // Los DOS estatus en los que el paquete sigue con el mensajero. Si `ayuda_tienda` saliera de
    // aqui, una orden en ayuda contaria en los DOS sumandos y su COD se sumaria dos veces.
    expect(lista).toContain("ESTADO_EN_REPARTO");
    expect(lista).toContain('"ayuda_tienda"');
    // Y el `where` de lo gestionado los excluye (`notIn`), que es lo que los hace disjuntos.
    expect(fuente).toMatch(
      /estatus: \{ value: \{ notIn: ESTADOS_EN_MANO_DEL_MENSAJERO \} \}/,
    );
  });
});
