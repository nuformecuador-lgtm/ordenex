import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import { APLICACION_GESTIONES } from "@/tests/fixtures/anclaje-devolucion";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 42/T9 — idempotencia + no-doble-conteo (R6/R13). Simula el constraint unico
// parcial (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL con una tienda
// en memoria: createMany({ skipDuplicates: true }) NO reinserta pares ya presentes. Con eso
// demostramos que una DOBLE aprobacion del mismo cierre produce UN SOLO set de movimientos y
// que un reintento por par existente es un no-op (sin error, sin segundo movimiento).

// Store en memoria con la semantica del indice unico parcial (solo pares con origen_id).
function makeWalletStore() {
  const rows: Array<CrearMovimientoInput & { id: string }> = [];
  const key = (r: { origenTipo: string; origenId: string | null; categoria: string }) =>
    `${r.origenTipo}|${r.origenId}|${r.categoria}`;
  const seen = new Set<string>();
  let seq = 0;

  const walletMovimiento = {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: CrearMovimientoInput[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of data) {
        // El indice unico parcial solo aplica cuando origen_id IS NOT NULL.
        if (d.origenId !== null) {
          const k = key(d);
          if (seen.has(k)) {
            if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
            throw new Error(`unique violation ${k}`);
          }
          seen.add(k);
        }
        rows.push({ ...d, id: `w${++seq}` });
        count += 1;
      }
      return { count };
    }),
  };
  return { rows, walletMovimiento };
}

// INVERTIDO el 2026-08-19 por la feature 239 (T2.3/T2.5). Hasta aqui este store emulaba el
// `updateMany` POR RELACION que encendia `orden.gestion_aprobada`. Esa escritura SE RETIRO: era
// la mitad implementada del fallo (quitaba la visibilidad sin mover el reloj). La sustituye el
// bloque de ANCLAJE, que es una TRANSICION DE ESTADO de verdad, guardada por el pre-estado.
//
// POR QUE NO ES UN `vi.fn()` QUE DEVUELVE `{count: 0}`, y esto no cambia con la 239: un doble
// mudo tapa el TypeError y deja la escritura sin nadie que la mire — que era exactamente el
// agujero que la escritura vieja tuvo durante toda su vida. Este store honra el `where` como lo
// haria Postgres, asi que la GUARDA por `estatus_id` se comporta como la guarda que dice ser: la
// idempotencia se ve de verdad, no se afirma de palabra.
//
// ⏳ 2026-09-23 (FICHA 454, T1.7): el anclaje se GENERALIZA a la APLICACION de las gestiones de
// calle al aprobar, y escribe con `UPDATE "orden" SET "estatus_id" = $destino WHERE "id" IN (…) AND
// "estatus_id" = $enReparto … RETURNING "id"` (`$queryRaw`). El store emula ESA sentencia honrando
// la guarda, que sigue siendo la idempotencia. Las ordenes de devolucion ya no estan en el
// pre-estado: la gestion nueva las deja `en_reparto` hasta la aprobacion.
function makeOrdenStore() {
  const ordenes = [
    // o1 entrego (gestion LEGADA, ya aplicada al registrarse): la aplicacion no la toca.
    { id: "o1", estatusId: idEstado("entregado"), deletedAt: null as Date | null },
    // o2 es la devolucion de ESTE cierre (gestion g2, modelo nuevo): la que tiene que aplicarse.
    { id: "o2", estatusId: idEstado("en_reparto"), deletedAt: null as Date | null },
    // La testigo: MISMO resultado `devuelta` y MISMO estado, pero su gestion (g3) es de OTRO
    // cierre. Solo el `cierreId` la separa, asi que si la guardia desapareciera del WHERE, esta
    // orden se aplicaria sola — con la aprobacion de un cierre que no es el suyo.
    { id: "o3", estatusId: idEstado("en_reparto"), deletedAt: null as Date | null },
  ];
  /** La sentencia de la aplicacion; cualquier otra (`emitirWebhooksEstado`) recibe `[]`. */
  const $queryRaw = vi.fn(async (...c: unknown[]) => {
    const sql = (c[0] as readonly string[]).join(" ? ");
    if (!sql.includes('UPDATE "orden" SET "estatus_id" =')) return [];
    const destinoId = c[1] as string;
    const ids = (c[2] as { values: string[] }).values;
    const guarda = c[3] as string;
    const movidas: { id: string }[] = [];
    for (const o of ordenes) {
      if (!ids.includes(o.id) || o.estatusId !== guarda || o.deletedAt !== null) continue;
      o.estatusId = destinoId;
      movidas.push({ id: o.id });
    }
    return movidas;
  });
  type WhereOrden = {
    id?: { in?: string[] };
    estatusId?: string;
    deletedAt?: Date | null;
  };
  const orden = {
    updateMany: vi.fn(
      async ({ where, data }: { where: WhereOrden; data: Record<string, unknown> }) => {
        let count = 0;
        for (const o of ordenes) {
          if (where.id?.in !== undefined && !where.id.in.includes(o.id)) continue;
          // LA GUARDA: `estatus_id = <pre-estado>`. Es lo que hace idempotente al bloque sin una
          // sola linea de codigo de idempotencia — una segunda aprobacion no encuentra nada.
          if (where.estatusId !== undefined && o.estatusId !== where.estatusId) continue;
          if (where.deletedAt !== undefined && o.deletedAt !== where.deletedAt) continue;
          Object.assign(o, data);
          count += 1;
        }
        return { count };
      },
    ),
  };
  return { ordenes, orden, $queryRaw };
}

// Las gestiones que ve la transaccion, con la forma REAL de las dos consultas que las leen: el
// feed de dinero (`{ cierreId }`) y el bloque de anclaje (`{ cierreId, resultado, anuladaAt }` y
// despues `{ ordenId: { in }, resultado, anuladaAt }`). El doble honra el `where` en vez de
// devolver siempre la misma lista: si no lo hiciera, la GUARDIA de `cierreId` del anclaje no se
// estaria probando (devolveria las de todos los cierres y el test pasaria igual).
// FICHA 454: `registrada` = la gestion tiene su evento `gestion_registrada` (modelo nuevo). g1 es
// LEGADA; g2 y g3 son devoluciones del modelo nuevo, pendientes hasta que su cierre se apruebe.
const GESTIONES_EN_BASE = [
  { id: "g1", ordenId: "o1", cierreId: "c1", resultado: "entregado", anuladaAt: null as Date | null, registrada: false },
  { id: "g2", ordenId: "o2", cierreId: "c1", resultado: "novedad", anuladaAt: null as Date | null, registrada: true },
  { id: "g3", ordenId: "o3", cierreId: "c2", resultado: "novedad", anuladaAt: null as Date | null, registrada: true },
];

type WhereGestion = {
  id?: { in?: string[] };
  cierreId?: string;
  resultado?: string | { in?: string[] };
  anuladaAt?: Date | null;
  ordenId?: { in?: string[] };
  /** FICHA 454: el filtro de «gestion de calle con evento de registro». */
  eventos?: { some?: { tipo?: string } };
};

/** `resultado` llega escalar desde el anclaje (239) y como `{ in }` desde la confirmacion (238). */
function casaResultado(resultado: string, filtro: WhereGestion["resultado"]): boolean {
  if (filtro === undefined) return true;
  if (typeof filtro === "string") return resultado === filtro;
  return filtro.in === undefined || filtro.in.includes(resultado);
}

/**
 * Store de `gestion_orden` con las filas PROPIAS de cada caso (copia de `GESTIONES_EN_BASE`, no
 * la constante compartida: la 238 ESCRIBE sobre ellas y un caso no puede heredar la marca del
 * anterior).
 *
 * Feature 238 (T3.5): `updateMany` honra el `where` COMPLETO —`id IN`, `cierreId` y el
 * `resultado IN` de los retornables— igual que lo haria Postgres. Un `vi.fn()` mudo devolviendo
 * `{count: n}` dejaria la guarda sin nadie que la mire, que es como el fallo de agosto llego a
 * `dev`.
 */
function gestionOrdenFake(extras: readonly (typeof GESTIONES_EN_BASE)[number][] = []) {
  const filas = [...GESTIONES_EN_BASE, ...extras].map((g) => ({
    ...g,
    confirmadaFisicaAt: null as Date | null,
  }));
  const delegate = {
    findMany: vi.fn(async ({ where }: { where: WhereGestion }) =>
      filas
        .filter(
          (g) =>
            (where.cierreId === undefined || g.cierreId === where.cierreId) &&
            casaResultado(g.resultado, where.resultado) &&
            (where.anuladaAt === undefined || g.anuladaAt === where.anuladaAt) &&
            (where.ordenId?.in === undefined || where.ordenId.in.includes(g.ordenId)) &&
            (where.eventos?.some?.tipo !== "gestion_registrada" || g.registrada),
        )
        .map((g) => ({
          ...g,
          mensajeroId: "m1",
          motivo: null,
          eventos: g.registrada
            ? [{ id: `ev-${g.id}`, familiaAplicacion: "gestion", actorUsuarioId: "m1" }]
            : [],
        })),
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: WhereGestion; data: Record<string, unknown> }) => {
        let count = 0;
        for (const g of filas) {
          if (where.id?.in !== undefined && !where.id.in.includes(g.id)) continue;
          if (where.cierreId !== undefined && g.cierreId !== where.cierreId) continue;
          if (!casaResultado(g.resultado, where.resultado)) continue;
          Object.assign(g, data);
          count += 1;
        }
        return { count };
      },
    ),
  };
  return { delegate, filas };
}

/**
 * Store de `cierre_dia` que HONRA la guarda `estado IN ESTADOS_RESOLUBLES`.
 *
 * Feature 238 (T3.5, R22): es lo que hace visible la idempotencia REAL de la marca. El bloque de
 * confirmacion no tiene —ni necesita— codigo de idempotencia: vive dentro del
 * `res.count === 1 && aprobado`, y ese `res` sale de este `updateMany`. Con un doble que devuelva
 * siempre `{count: 1}` la segunda aprobacion volveria a entrar y la propiedad no se estaria
 * midiendo.
 */
function cierreDiaFake(estadoInicial = "solicitado") {
  const cierre = { estado: estadoInicial };
  return {
    cierre,
    delegate: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { estado?: { in?: string[] } };
          data: { estado?: string };
        }) => {
          if (where.estado?.in !== undefined && !where.estado.in.includes(cierre.estado)) {
            return { count: 0 };
          }
          if (data.estado !== undefined) cierre.estado = data.estado;
          return { count: 1 };
        },
      ),
      count: vi.fn().mockResolvedValue(1), // existe en alcance -> `conflict`, no `fuera_de_alcance`
      // FICHA 362: la resolucion lee ademas el total y el mensajero para congelar la fila.
      findUnique: vi.fn().mockResolvedValue({
        mensajeroId: "m1",
        totalGeneral: new Prisma.Decimal("0.00"),
        solicitadoAt: new Date("2026-09-02T12:00:00Z"),
        mensajero: { nombre: "Mensa", primerApellido: "Uno" },
      }),
    },
  };
}

const TARIFA = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

// Feature 69: la misma tarifa, ya CONGELADA en la fila de `cierre_detail`.
const TARIFA_CONGELADA = {
  tarifaId: "ta1",
  tarifaValorFlete: new Prisma.Decimal(TARIFA.valorFlete),
  tarifaValorFleteGam: new Prisma.Decimal(TARIFA.valorFleteGam),
  tarifaValorFleteDevuelto: new Prisma.Decimal(TARIFA.valorFleteDevuelto),
  tarifaValorFleteDevueltoGam: new Prisma.Decimal(TARIFA.valorFleteDevueltoGam),
  tarifaComisionCod: new Prisma.Decimal(TARIFA.comisionCod),
  tarifaIvaFlete: new Prisma.Decimal(TARIFA.ivaFlete),
  tarifaIvaComisionCod: new Prisma.Decimal(TARIFA.ivaComisionCod),
};

// Prisma doble: gestiones del cierre + su detalle CONGELADO + la tienda de wallet +
// $transaction (tx === prisma). Feature 69: el feed deriva del snapshot, asi que el doble
// aporta `cierreDetail`; los importes (y por tanto los 6 conceptos) no cambian.
function buildPrisma(
  store: ReturnType<typeof makeWalletStore>,
  ordenStore: ReturnType<typeof makeOrdenStore> = makeOrdenStore(),
  // Feature 238 (T3.5): los dos stores que la idempotencia de la marca necesita ver de verdad.
  gestionStore: ReturnType<typeof gestionOrdenFake> = gestionOrdenFake(),
  cierreStore: ReturnType<typeof cierreDiaFake> | null = null,
) {
  const detalle = [
    { ordenId: "o1", tiendaId: "t1", montoCobrar: new Prisma.Decimal("10000.00"), cobraComision: true, esCentral: false, ...TARIFA_CONGELADA },
    { ordenId: "o2", tiendaId: "t1", montoCobrar: null, cobraComision: true, esCentral: false, ...TARIFA_CONGELADA },
    // FICHA 301 (2026-08-28): `o4` es el RECHAZO, y existe porque la `devuelta` (o2) dejo de
    // facturar. Sin el, el caso R6 pasaria de deduplicar 6 conceptos a deduplicar 4 y los dos
    // de devolucion —que son dinero— saldrian del test. La fila solo la usa la gestion extra
    // que ese caso inyecta; los demas casos no tienen ninguna gestion que la mire.
    { ordenId: "o4", tiendaId: "t1", montoCobrar: null, cobraComision: true, esCentral: false, ...TARIFA_CONGELADA },
  ];
  const prisma = {
    cierreDia: cierreStore
      ? cierreStore.delegate
      : {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          count: vi.fn().mockResolvedValue(1),
          // FICHA 362: la resolucion lee el total y el mensajero para congelar la fila del registro.
          findUnique: vi.fn().mockResolvedValue({
            totalGeneral: new Prisma.Decimal("0.00"),
            solicitadoAt: new Date("2026-09-02T12:00:00Z"),
            mensajero: { nombre: "Mensa", primerApellido: "Uno" },
          }),
        },
    gestionOrden: gestionStore.delegate,
    cierreDetail: { findMany: vi.fn().mockResolvedValue(detalle) },
    walletMovimiento: store.walletMovimiento,
    orden: ordenStore.orden,
    $queryRaw: ordenStore.$queryRaw, // ficha 454: la sentencia de la aplicacion
    // Feature 239 (T2.2): el anclaje registra la transicion por el choke point. El doble tiene
    // que existir o la tx muere; lo que escribe se afirma en el caso de abajo.
    ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 0 })) },
    // FICHA 362: el registro de la decision (`cierre_dia_aprobado` / `cierre_dia_rechazado`) va
    // en la MISMA tx. El doble tiene que responder o la transaccion muere.
    historialAccion: { createMany: vi.fn(async () => ({ count: 1 })) },
    usuario: {
      findUnique: vi.fn(async () => ({
        nombre: "Admin",
        primerApellido: "Uno",
        rol: { value: "admin" },
      })),
    },
  };
  return {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
}

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/**
 * El repositorio bajo prueba con los dobles de las features vecinas. Extraido (era el cuerpo del
 * caso R6) para que el caso del ANCLAJE de mas abajo monte EXACTAMENTE la misma
 * transaccion: si cada uno armara la suya, podrian dejar de medir el mismo camino sin que nada
 * lo delate.
 */
function makeRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new CierresAdminRepository(
      prisma as unknown as PrismaClient,
      new WalletMovimientoRepository(prisma as unknown as PrismaClient),
      new WalletFeedService(),
      // Feature 43: dobles no-op del ledger por tienda (este test cubre SOLO la idempotencia
      // de la caja principal 42; el ledger por tienda tiene su propio test de idempotencia).
      { crearMovimientos: vi.fn().mockResolvedValue(0), listarPorTienda: vi.fn(), agregarSaldoPorTienda: vi.fn(), listarSaldosTodasTiendas: vi.fn(), listarSaldosTiendasPaginado: vi.fn(), agregarDesglosePorTienda: vi.fn(), listarCierresDeTienda: vi.fn(async () => []), obtenerPorIdDeTienda: vi.fn(async () => null), registrarCobroEnHistorial: vi.fn(async () => undefined), obtenerCobroPorId: vi.fn(async () => null), nombreDeTienda: vi.fn(async () => ""), obtenerCobroPorClave: vi.fn(async () => null) /* ficha 461; no ejercitados aqui */ },
      { construirMovimientosPorTienda: vi.fn().mockResolvedValue([]) },
      // Feature 44: dobles no-op del libro del pago por mensajero (feed devuelve libro/egreso
      // vacios; el pago por mensajero tiene su propio test de idempotencia).
      { crearMovimientos: vi.fn().mockResolvedValue(0), listarPorMensajero: vi.fn(), agregarCuentaPorPagar: vi.fn(), listarCuentasPorPagarTodos: vi.fn(), listarCuentasPorPagarPaginado: vi.fn(), listarCuentasPorPagarCompleto: vi.fn(), obtenerNombreMensajero: vi.fn(), sumarPremiosVivosPorCierre: vi.fn(async () => ({})), listarPremiosPorDias: vi.fn(async () => []) },
      { construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }) },
      // Feature 158/T1.14: doble del feed del egreso de indemnizacion. Este caso cubre la
      // idempotencia de los conceptos de INGRESO; la del egreso de indemnizacion tiene su
      // propio caso mas abajo, con el feed REAL.
      { construirEgresoIndemnizacion: vi.fn(async () => []) },
  );
}

// Feature 140/239: la guardia del choke point es de FALLO CERRADO. El anclaje registra el par
// `devolucion_por_confirmar -> devuelta`, asi que la tx necesita un catalogo REAL con esos dos
// values o la aprobacion entera revierte (que es el comportamiento correcto, pero no lo que este
// archivo mide).
beforeEach(async () => {
  await sembrarCatalogoEstados();
});

describe("wallet idempotencia (R6/R13)", () => {
  it("R6: doble aprobacion del mismo cierre -> UN SOLO set de movimientos (skipDuplicates)", async () => {
    const store = makeWalletStore();
    // FICHA 301: hasta el 2026-08-28 los dos conceptos de devolucion los ponia la `devuelta`
    // (g2) del cierre. Ya no los pone, asi que el cierre trae ademas un RECHAZO —el resultado
    // que si los factura— para que este caso siga deduplicando los SEIS conceptos y no cuatro.
    const gestiones = gestionOrdenFake([
      { id: "g4", ordenId: "o4", cierreId: "c1", resultado: "devolucion_a_origen_por_rechazo", anuladaAt: null, registrada: false },
    ]);
    const prisma = buildPrisma(store, makeOrdenStore(), gestiones);
    const repo = makeRepo(prisma);

    const aprobar = () =>
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE,
        nuevoEstado: "aprobado",
      aplicacionGestiones: APLICACION_GESTIONES, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
        resueltoPor: "adm",
        motivoRechazo: null,
      });

    await aprobar();
    const trasPrimera = store.rows.length;
    await aprobar(); // segunda aprobacion: el constraint deduplica todos los pares.

    // El set de movimientos es EXACTAMENTE el mismo (no se duplico ningun concepto).
    expect(store.rows.length).toBe(trasPrimera);
    // Cada par (cierre_dia, c1, categoria) aparece una sola vez.
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(claves.length);
    // El cierre entregada + devuelta + rechazada produce: flete, iva_flete, comision,
    // iva_comision, flete_devolucion, iva_flete_devolucion (6 conceptos, ninguno duplicado).
    // Ficha 301: los dos ultimos los pone la RECHAZADA; la devuelta no aporta ninguno.
    expect(store.rows.length).toBe(6);
    expect([...new Set(store.rows.map((r) => r.categoria))].sort()).toEqual(
      [
        "ingreso_comision_cod",
        "ingreso_flete",
        "ingreso_flete_devolucion",
        "ingreso_iva_comision_cod",
        "ingreso_iva_flete",
        "ingreso_iva_flete_devolucion",
      ].sort(),
    );
  });

  // INVERTIDO el 2026-08-19 (feature 239, T2.3/T2.5). Este caso nacio el 2026-08-18 para mirar
  // «la escritura que nadie miraba»: el `updateMany` que encendia `orden.gestion_aprobada`. Esa
  // escritura ya no existe — era la mitad implementada del fallo—; la sustituye el ANCLAJE, que
  // mueve la orden del pre-estado a `devuelta` dentro de la MISMA transaccion que los cinco
  // feeds de dinero.
  //
  // El caso se conserva EN ESTE ARCHIVO y con el mismo enunciado (R6: doble aprobacion, un solo
  // efecto) porque mide lo mismo que medía: la unica escritura de la tx que NO esta protegida
  // por el indice unico de la wallet ni por `skipDuplicates`, sino por ser idempotente por
  // construccion. Lo que cambia es de que escritura hablamos.
  // ⏳ 2026-09-23 (FICHA 454, T1.7): el ANCLAJE de la 239 se generaliza a la APLICACION de las
  // gestiones al aprobar. El enunciado se conserva —R6: doble aprobacion, un solo efecto— porque
  // mide la unica escritura de la tx que no protege el indice de la wallet sino su GUARDA de
  // estado. Cambia la forma: la orden va de `en_reparto` a `devuelta` (no del pre-estado) y la
  // escritura es el `UPDATE … RETURNING` crudo, no un `updateMany`.
  it("R6/454-R7/R12: aprobar APLICA solo la devolucion de ESTE cierre, y re-aprobar no cambia nada", async () => {
    const store = makeWalletStore();
    const ordenStore = makeOrdenStore();
    const prisma = buildPrisma(store, ordenStore);
    const repo = makeRepo(prisma);

    const aprobar = () =>
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE,
        nuevoEstado: "aprobado",
        aplicacionGestiones: APLICACION_GESTIONES, // ficha 454/T1.7: obligatorio al aprobar
        confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
        resueltoPor: "adm",
        motivoRechazo: null,
      });

    await aprobar();

    const estado = () => Object.fromEntries(ordenStore.ordenes.map((o) => [o.id, o.estatusId]));
    // o2 es la unica `devuelta` de c1: pasa de `en_reparto` a `devuelta` (visible para la tienda
    // y con el reloj corriendo desde la gestion, R47). o1 entrego (legada). o3 se devolvio en
    // OTRO cierre y sigue `en_reparto` con su gestion pendiente: mientras ese cierre no se
    // apruebe, ni se ve ni corre su plazo —y por tanto NO se le puede cobrar el rechazo.
    expect(estado()).toEqual({
      o1: idEstado("entregado"),
      o2: APLICACION_GESTIONES.destinoPorResultado.novedad,
      o3: idEstado("en_reparto"),
    });

    // La sentencia tal cual sale del repositorio: ids derivados de ESTE cierre y GUARDA por
    // `en_reparto`. Y el `SET` lleva SOLO `estatus_id`: money-neutral (R10 de la 239).
    const updates = (ordenStore.$queryRaw.mock.calls as unknown[][]).filter((c) =>
      (c[0] as readonly string[]).join(" ? ").includes('UPDATE "orden" SET "estatus_id" ='),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe(APLICACION_GESTIONES.destinoPorResultado.novedad);
    expect((updates[0][2] as { values: string[] }).values).toEqual(["o2"]);
    expect(updates[0][3]).toBe(APLICACION_GESTIONES.enRepartoId);
    const sql = (updates[0][0] as readonly string[]).join(" ? ").replace(/\s+/g, " ");
    expect(sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE")).trim()).toBe('SET "estatus_id" = ?');
    // Y el `updateMany` de `orden` NO participa en la aplicacion.
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();

    const historialTrasLaPrimera = prisma.ordenHistorialEstado.createMany.mock.calls.length;
    expect(historialTrasLaPrimera).toBe(1); // R8: la transicion deja su fila

    await aprobar(); // segunda aprobacion del MISMO cierre
    // R12: la guarda por `en_reparto` no encuentra nada -> ni cambio de estado ni segunda fila de
    // historial. La idempotencia no la da un `if`, la da el WHERE.
    expect(estado()).toEqual({
      o1: idEstado("entregado"),
      o2: APLICACION_GESTIONES.destinoPorResultado.novedad,
      o3: idEstado("en_reparto"),
    });
    const updatesTrasLaSegunda = (ordenStore.$queryRaw.mock.calls as unknown[][]).filter((c) =>
      (c[0] as readonly string[]).join(" ? ").includes('UPDATE "orden" SET "estatus_id" ='),
    );
    expect(updatesTrasLaSegunda).toHaveLength(2); // se INTENTA
    expect(prisma.ordenHistorialEstado.createMany.mock.calls.length).toBe(historialTrasLaPrimera); // y no escribe
  });

  // ------------------------------------------------------------------------------------------
  // Feature 238 (T3.5, R22) — LA IDEMPOTENCIA DE LA MARCA, DONDE DE VERDAD SE VE.
  //
  // Este caso vive AQUI y no en `cierres-admin-caja-cod.test.ts`, y no es una preferencia: aquel
  // doble devuelve vacio para el bloque de ordenes y PASA DE LARGO por esta zona. El store de
  // este archivo honra el `where` como lo haria Postgres, asi que la guarda se comporta como la
  // guarda que dice ser. No re-descubrir esto: ya costo una escritura sin asercion durante toda
  // su vida.
  it("238/R22: re-aprobar da `conflict`, no ejecuta el bloque y deja UNA sola marca", async () => {
    const store = makeWalletStore();
    const gestionStore = gestionOrdenFake();
    const cierreStore = cierreDiaFake(); // arranca `solicitado`
    const prisma = buildPrisma(store, makeOrdenStore(), gestionStore, cierreStore);
    const repo = makeRepo(prisma);

    const aprobar = () =>
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE,
        nuevoEstado: "aprobado",
        aplicacionGestiones: APLICACION_GESTIONES,
        resueltoPor: "adm",
        motivoRechazo: null,
        // `g2` es la unica gestion de `c1` cuyo paquete vuelve: es lo que bodega escaneo.
        confirmacionFisica: [{ gestionId: "g2" }],
      });

    const primera = await aprobar();
    expect(primera).toBe("updated");

    const marca = gestionStore.filas.find((g) => g.id === "g2")?.confirmadaFisicaAt;
    expect(marca).toBeInstanceOf(Date);
    // Y SOLO `g2`: `g1` entrego (no vuelve) y `g3` es de OTRO cierre.
    expect(gestionStore.filas.filter((g) => g.confirmadaFisicaAt !== null).map((g) => g.id)).toEqual(
      ["g2"],
    );
    const escriturasTrasLaPrimera = gestionStore.delegate.updateMany.mock.calls.length;
    expect(escriturasTrasLaPrimera).toBe(1);

    // SEGUNDA aprobacion del MISMO cierre. El cierre ya esta `aprobado`, asi que la guarda
    // `estado IN ["solicitado"]` no casa, `res.count = 0` y la rama entera —marca incluida— no
    // se ejecuta. La idempotencia no la da un `if`: la da esa guarda.
    const segunda = await aprobar();

    expect(segunda).toBe("conflict");
    expect(gestionStore.delegate.updateMany.mock.calls.length).toBe(escriturasTrasLaPrimera);
    // UNA sola marca, y con el instante de la PRIMERA: el reintento no la reescribe.
    expect(gestionStore.filas.find((g) => g.id === "g2")?.confirmadaFisicaAt).toBe(marca);
    expect(gestionStore.filas.filter((g) => g.confirmadaFisicaAt !== null)).toHaveLength(1);
  });

  it("R13: reintento por par existente = no-op (sin error propagado, sin segundo movimiento)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
    const mov: CrearMovimientoInput = {
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto: "1000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
    };

    const n1 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [mov]);
    // Reintento del MISMO par: no lanza, no inserta.
    const n2 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [mov]);

    expect(n1).toBe(1);
    expect(n2).toBe(0); // no-op
    expect(store.rows.length).toBe(1);
  });

  // Feature 158 — EXTENSION A LOS DOS ORIGENES (design §12.5, R29/R53/R56/R64). Hasta el PR 1
  // este archivo solo conocia el egreso del cierre. El camino del ADMIN anade un segundo emisor
  // con `origen_tipo = orden_incidente`, y lo que hay que fijar es doble: que cada uno es
  // idempotente POR SU CUENTA y que los dos COEXISTEN sin que el indice unico parcial se trague
  // uno (mismo `categoria`, distinto `origen_tipo`/`origen_id`).
  it("158/R53: el egreso del INCIDENTE del admin es idempotente por (orden_incidente, id)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({
      walletMovimiento: store.walletMovimiento,
    } as unknown as PrismaClient);
    const egreso: CrearMovimientoInput = {
      tipo: "egreso",
      categoria: "egreso_indemnizacion",
      monto: "2500.00",
      origenTipo: "orden_incidente",
      origenId: "inc-1",
    };

    const n1 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [
      egreso,
    ]);
    // Reintentar la aprobacion del MISMO incidente: no lanza, no inserta (R53).
    const n2 = await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [
      egreso,
    ]);

    expect(n1).toBe(1);
    expect(n2).toBe(0);
    expect(store.rows).toHaveLength(1);
    // El reintento NO altera el ya emitido. (El repo convierte STRING -> Decimal al escribir,
    // asi que la fila guardada trae un Decimal: se compara con escala 2 explicita.)
    expect(new Prisma.Decimal(store.rows[0].monto).toFixed(2)).toBe("2500.00");
  });

  it("158/R29/R64: los DOS egresos de indemnizacion coexisten (ninguno absorbe al otro)", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({
      walletMovimiento: store.walletMovimiento,
    } as unknown as PrismaClient);
    const tx = { walletMovimiento: store.walletMovimiento } as never;

    // Camino del MENSAJERO (agregado por cierre) y camino del ADMIN (por incidente).
    await repo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: "1000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
      },
    ]);
    await repo.crearMovimientos(tx, [
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: "2500.00",
        origenTipo: "orden_incidente",
        origenId: "inc-1",
      },
    ]);

    // DOS filas: misma categoria, origenes distintos -> claves distintas del indice parcial.
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((r) => r.origenTipo).sort()).toEqual(["cierre_dia", "orden_incidente"]);
    const claves = store.rows.map((r) => `${r.origenTipo}|${r.origenId}|${r.categoria}`);
    expect(new Set(claves).size).toBe(2);
    // Y cada uno conserva SU monto: ninguno reemplaza, absorbe ni anula al otro (R64).
    expect(store.rows.map((r) => new Prisma.Decimal(r.monto).toFixed(2)).sort()).toEqual([
      "1000.00",
      "2500.00",
    ]);
  });

  it("158/R56: dos incidentes de admin DISTINTOS no se deduplican entre si", async () => {
    // El grano del camino del admin es el incidente, no la orden: dos incidentes (de ordenes
    // distintas, o el mismo caso re-reportado tras un rechazo) son movimientos distintos. Lo que
    // impide pagar DOS VECES la misma orden no es este indice, es el indice unico parcial de
    // `orden_incidente` (a lo sumo uno vivo) + que un `rechazado` nunca persistio monto.
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({
      walletMovimiento: store.walletMovimiento,
    } as unknown as PrismaClient);
    const tx = { walletMovimiento: store.walletMovimiento } as never;
    const egreso = (origenId: string, monto: string): CrearMovimientoInput => ({
      tipo: "egreso",
      categoria: "egreso_indemnizacion",
      monto,
      origenTipo: "orden_incidente",
      origenId,
    });

    await repo.crearMovimientos(tx, [egreso("inc-1", "10.00")]);
    await repo.crearMovimientos(tx, [egreso("inc-2", "20.00")]);

    expect(store.rows).toHaveLength(2);
  });

  it("manuales (origen_id NULL) NO se deduplican: cada ajuste es una fila nueva", async () => {
    const store = makeWalletStore();
    const repo = new WalletMovimientoRepository({ walletMovimiento: store.walletMovimiento } as unknown as PrismaClient);
    const manual: CrearMovimientoInput = {
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "50.00",
      origenTipo: "manual",
      origenId: null,
      descripcion: "ajuste",
      registradoPor: "u-maestro",
    };
    await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [manual]);
    await repo.crearMovimientos({ walletMovimiento: store.walletMovimiento } as never, [manual]);
    // Dos ajustes iguales -> DOS filas (fuera del indice unico parcial).
    expect(store.rows.length).toBe(2);
  });
});
