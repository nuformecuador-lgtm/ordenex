import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICobroTiendaService } from "@/lib/interfaces/services/ICobroTiendaService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 → 461 / T B.9 — el BORDE del cobro y de su anulacion, y su COMPOSITION ROOT.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// DOS MITADES, y la segunda es la que este repo tiene medida como modo de fallo real:
//
//  · el BORDE: sin sesion, `unauthenticated` SIN llamar al servicio; una peticion mal formada,
//    `validation_error` SIN llamar al servicio (en la anulacion: motivo vacio o un `monto` colado,
//    R13/R14); y `forbidden`/`ok`/`no_anulable`/`ya_anulado` pasan tal cual desde el DOMINIO.
//
//  · el COMPOSITION ROOT: que alguien PASE de verdad las CINCO dependencias. «2 de 7 notificadores
//    muertos con la suite verde» esta medido en este repo. Aqui se ejercitan las DOS actions REALES,
//    sin `deps.service`, contra un cliente Prisma falso, y se exige que se USEN el repositorio de
//    usuarios, el del ledger, el PUERTO DE CAJA, el de anulaciones y el runner.
//
// REESCRITO por la 461 (HD1/R9): la 381 afirmaba aqui que la caja NO recibia ni una llamada (R24).
// Ahora el espia de `walletMovimiento` tiene que recibir EXACTAMENTE una: el cargo del cobro.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA = "0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55";
const COBRO_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const walletTiendaCreateMany = vi.fn(async () => ({ count: 1 }));
/** Sirve a `obtenerPorIdDeTienda` (where.id + tiendaId) y a `obtenerCobroPorId` (where.id + tipo + categoria). */
const walletTiendaFindFirst = vi.fn(
  async ({ where }: { where: { id: string; tiendaId?: string } }) => ({
    id: where.id,
    tiendaId: where.tiendaId ?? TIENDA,
    tipo: "debito",
    categoria: "cobro_manual",
    monto: new Prisma.Decimal("1500.00"),
    origenTipo: "manual",
    origenId: null,
    descripcion: "Reposicion de etiquetas",
    registradoPor: MAESTRO.usuarioId,
    fechaMovimiento: new Date("2026-09-08T10:00:00.000Z"),
    createdAt: new Date("2026-09-08T10:00:00.000Z"),
    tienda: { nombre: "Tienda Uno", primerApellido: null },
  }),
);
const walletTiendaFindUnique = vi.fn(async () => ({
  monto: new Prisma.Decimal("1500.00"),
  tienda: { nombre: "Tienda Uno", primerApellido: null },
}));
const walletTiendaGroupBy = vi.fn(async () => [
  { tipo: "credito", _sum: { monto: new Prisma.Decimal("500.00") } },
  { tipo: "debito", _sum: { monto: new Prisma.Decimal("1500.00") } },
]);
const historialCreateMany = vi.fn(async () => ({ count: 1 }));
const usuarioFindUnique = vi.fn(async ({ where }: { where: { id: string } }) =>
  where.id === TIENDA
    ? { nombre: "Tienda Uno", primerApellido: null, estado: "activo", rol: { value: "adminTienda" } }
    : { nombre: "Ana", primerApellido: "Torres", estado: "activo", rol: { value: "maestro" } },
);
/** ⚠️ LA CAJA DE ORDENEX. Desde la 461 SI se escribe: el cargo del cobro y el reverso de su anulacion. */
const cajaCreateMany = vi.fn(async () => ({ count: 1 }));
const cajaCreate = vi.fn();
const anulacionCreate = vi.fn(async () => ({ id: "anul-1" }));
const anulacionFindMany = vi.fn(async () => []);
/** `estadoDelCobro`: un cobro con su cargo, ni reclasificado ni anulado. */
const queryRaw = vi.fn(async () => [{ anulado: false, reclasificado: false, tiene_cargo: true }]);

const clienteFalso = {
  walletTiendaMovimiento: {
    createMany: walletTiendaCreateMany,
    findFirst: walletTiendaFindFirst,
    findUnique: walletTiendaFindUnique,
    groupBy: walletTiendaGroupBy,
    findMany: vi.fn(),
    count: vi.fn(),
  },
  walletMovimiento: { createMany: cajaCreateMany, create: cajaCreate },
  cobroTiendaAnulacion: { create: anulacionCreate, findMany: anulacionFindMany },
  historialAccion: { createMany: historialCreateMany },
  usuario: { findUnique: usuarioFindUnique, findMany: vi.fn() },
  tipoIdentificacion: {},
  rol: {},
  $queryRaw: queryRaw,
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(clienteFalso)),
};

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => clienteFalso,
  PRISMA_OMIT: {},
}));

const { registrarCobroTiendaAction, anularCobroTiendaAction } = await import("@/lib/actions/wallet-tienda");

/** Ficha 461 (R66): la clave que el dialogo genera al abrirse; sin ella el borde responde validation_error. */
const CLAVE_461 = "6b1f0d2e-7c3a-4d5b-9e8f-0a1b2c3d4e5f";

function peticion(over: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE_461,
    tiendaId: TIENDA,
    monto: "1500.00",
    descripcion: "Reposicion de etiquetas",
    ...over,
  };
}

function servicioDoble(resultado: unknown) {
  const registrarCobro = vi.fn().mockResolvedValue(resultado);
  const anular = vi.fn().mockResolvedValue(resultado);
  return { service: { registrarCobro, anular } as unknown as ICobroTiendaService, registrarCobro, anular };
}

type Datos = { data: Record<string, unknown>[]; skipDuplicates?: boolean };
const primerArg = (fn: { mock: { calls: unknown[][] } }, n = 0) => fn.mock.calls[n][0] as Datos;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REGISTRAR — el borde (sin cambios de forma respecto de la 381)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("461/B.9 — registrar: el borde (sesion y forma)", () => {
  it("R8: sin sesion responde `unauthenticated` y NO llama al servicio", async () => {
    const { service, registrarCobro } = servicioDoble({ status: "ok" });
    const r = await registrarCobroTiendaAction(peticion(), { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("R6: una peticion mal formada muere en el borde, con sus campos", async () => {
    const { service, registrarCobro } = servicioDoble({ status: "ok" });
    const r = await registrarCobroTiendaAction(
      { tiendaId: "no-es-uuid", monto: "0", descripcion: "  " },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(["claveIdempotencia", "descripcion", "monto", "tiendaId"]) // 461/R66: la clave tambien es obligatoria;
    expect(r.fieldErrors.descripcion).toContain("La descripcion es obligatoria.");
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("R53: el payload del cobro sigue siendo tienda, monto, descripcion y fecha; una clave colada lo tumba", async () => {
    const { service, registrarCobro } = servicioDoble({ status: "ok" });
    const r = await registrarCobroTiendaAction(peticion({ categoria: "ingreso_cobro_tienda" }), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("`forbidden` del dominio viaja tal cual (R8)", async () => {
    const { service } = servicioDoble({ status: "forbidden" });
    const r = await registrarCobroTiendaAction(peticion(), {
      service,
      getActor: async () => ({ usuarioId: "u-t", rol: "adminTienda" }),
    });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("`ok` viaja con el cobro y el saldo, y el schema entrega el input ya limpio", async () => {
    const OK = {
      status: "ok",
      cobro: { id: "c1", tiendaId: TIENDA, monto: "1500.00" },
      saldo: { creditos: "0.00", debitos: "1500.00", saldo: "-1500.00", signo: "negativo" },
    };
    const { service, registrarCobro } = servicioDoble(OK);
    const r = await registrarCobroTiendaAction(peticion({ descripcion: "  Cintas  " }), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r).toEqual(OK);
    expect(registrarCobro).toHaveBeenCalledWith({ claveIdempotencia: CLAVE_461, tiendaId: TIENDA, monto: "1500.00", descripcion: "Cintas" }, MAESTRO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REGISTRAR — el composition root PASA las cinco dependencias
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("461/B.9 (R1/R9) — el composition root de registrar PASA las dependencias, no solo las importa", () => {
  it("la accion REAL, sin `deps.service`, escribe el debito, el rastro y EL CARGO EN LA CAJA, y devuelve el saldo", async () => {
    const r = await registrarCobroTiendaAction(peticion(), { getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // 1) EL REPOSITORIO DE USUARIOS llego: sin el, la validacion de la tienda habria lanzado.
    expect(usuarioFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TIENDA } }));
    // 2) EL RUNNER DE TRANSACCIONES llego.
    expect(clienteFalso.$transaction).toHaveBeenCalledTimes(1);
    // 3) EL REPOSITORIO DEL LEDGER llego, y escribio LA fila del debito, con el instante del servicio.
    expect(walletTiendaCreateMany).toHaveBeenCalledTimes(1);
    const debito = primerArg(walletTiendaCreateMany);
    expect(debito.data).toHaveLength(1);
    expect(debito.data[0]).toMatchObject({
      tiendaId: TIENDA,
      tipo: "debito",
      categoria: "cobro_manual",
      origenTipo: "manual",
      origenId: null,
      registradoPor: MAESTRO.usuarioId,
    });
    expect((debito.data[0].monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    expect(debito.data[0].fechaMovimiento).toBeInstanceOf(Date);
    // 4) EL RASTRO, en la misma transaccion.
    expect(historialCreateMany).toHaveBeenCalledTimes(1);
    const fila = primerArg(historialCreateMany).data[0];
    expect(fila.accion).toBe("cobro_tienda_registrado");
    expect(fila.entidadTipo).toBe("wallet_tienda_movimiento");
    expect(fila.entidadId).toBe(debito.data[0].id);
    expect(fila.entidadEtiqueta).toBe("Tienda Uno");
    // 5) ⭑ EL PUERTO DE CAJA llego (HD1/R9): UNA fila `ingreso/ingreso_cobro_tienda`, origen
    //    `cobro_tienda` → id del debito, mismo monto, MISMO instante, descrita con la tienda.
    expect(cajaCreateMany).toHaveBeenCalledTimes(1);
    const cargo = primerArg(cajaCreateMany);
    expect(cargo.data).toHaveLength(1);
    expect(cargo.data[0]).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_cobro_tienda",
      origenTipo: "cobro_tienda",
      origenId: debito.data[0].id,
      registradoPor: MAESTRO.usuarioId,
      descripcion: "Tienda Uno · Reposicion de etiquetas",
    });
    expect((cargo.data[0].monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    expect((cargo.data[0].fechaMovimiento as Date).getTime()).toBe((debito.data[0].fechaMovimiento as Date).getTime());
    expect(cargo.skipDuplicates).toBe(true); // R2: idempotente por el indice unico parcial
    expect(cajaCreate).not.toHaveBeenCalled();
    // 6) El saldo derivado del ledger, con su signo. 500 − 1500 = −1000.
    expect(r.saldo.saldo).toBe("-1000.00");
    expect(r.saldo.signo).toBe("negativo");
  });

  it("la tienda inexistente se rechaza por el camino REAL, sin escribir en NINGUN libro", async () => {
    usuarioFindUnique.mockResolvedValueOnce(null as never);
    const r = await registrarCobroTiendaAction(peticion(), { getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "validation_error", fieldErrors: { tiendaId: ["La tienda no existe"] } });
    expect(walletTiendaCreateMany).not.toHaveBeenCalled();
    expect(historialCreateMany).not.toHaveBeenCalled();
    expect(cajaCreateMany).not.toHaveBeenCalled();
    expect(clienteFalso.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ANULAR — el borde (R13/R14/R18)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("461/B.9 — anular: el borde (sesion y forma)", () => {
  const CUERPO = { cobroId: COBRO_ID, motivo: "Se cobro dos veces" };

  it("R18: sin sesion responde `unauthenticated` y NO llama al servicio", async () => {
    const { service, anular } = servicioDoble({ status: "ok" });
    expect(await anularCobroTiendaAction(CUERPO, { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
    expect(anular).not.toHaveBeenCalled();
  });

  it("R14: un motivo vacio muere en el borde, sin llamar al servicio", async () => {
    const { service, anular } = servicioDoble({ status: "ok" });
    const r = await anularCobroTiendaAction({ cobroId: COBRO_ID, motivo: "   " }, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(r.fieldErrors.motivo).toContain("El motivo de la anulacion es obligatorio.");
    expect(anular).not.toHaveBeenCalled();
  });

  it("⭑ R13: un `monto` colado en la peticion la tumba entera (`.strict()`), sin llamar al servicio", async () => {
    const { service, anular } = servicioDoble({ status: "ok" });
    const r = await anularCobroTiendaAction({ ...CUERPO, monto: "1.00" }, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("validation_error");
    expect(anular).not.toHaveBeenCalled();
  });

  it("la sesion se resuelve ANTES que el schema: sin sesion y con basura, `unauthenticated`", async () => {
    const { service } = servicioDoble({ status: "ok" });
    expect(await anularCobroTiendaAction("basura", { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
  });

  it.each([
    [{ status: "forbidden" }],
    [{ status: "no_encontrado" }],
    [{ status: "ya_anulado" }],
    [{ status: "no_anulable", motivo: "reclasificado" }],
    [{ status: "no_anulable", motivo: "sin_linea_de_caja" }],
    [{ status: "ok", saldo: { creditos: "1.00", debitos: "0.00", saldo: "1.00", signo: "positivo" } }],
  ])("el resultado del dominio %j viaja tal cual, con el input ya limpio", async (resultado) => {
    const { service, anular } = servicioDoble(resultado);
    const r = await anularCobroTiendaAction({ cobroId: COBRO_ID, motivo: "  Duplicado  " }, { service, getActor: async () => MAESTRO });
    expect(r).toEqual(resultado);
    expect(anular).toHaveBeenCalledWith({ cobroId: COBRO_ID, motivo: "Duplicado" }, MAESTRO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ANULAR — el composition root
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("461/B.9 (R10/R9) — el composition root de anular PASA las dependencias", () => {
  it("la accion REAL escribe la constancia, su rastro, el credito a la tienda y EL REVERSO EN LA CAJA", async () => {
    const r = await anularCobroTiendaAction({ cobroId: COBRO_ID, motivo: "Se cobro dos veces" }, { getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // El cobro se leyo por su id Y por su tipo/categoria (R16), y su estado en UNA consulta.
    expect(walletTiendaFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COBRO_ID, tipo: "debito", categoria: "cobro_manual" } }),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // La constancia, con el motivo y quien.
    expect(anulacionCreate).toHaveBeenCalledWith({
      data: { cobroId: COBRO_ID, motivo: "Se cobro dos veces", anuladoPor: MAESTRO.usuarioId },
    });
    // Su rastro: `cobro_tienda_anulado`, con el importe y la tienda, sin el motivo.
    expect(historialCreateMany).toHaveBeenCalledTimes(1);
    const fila = primerArg(historialCreateMany).data[0];
    expect(fila.accion).toBe("cobro_tienda_anulado");
    expect(fila.entidadTipo).toBe("wallet_tienda_movimiento");
    expect(fila.entidadId).toBe(COBRO_ID);
    expect(fila.entidadEtiqueta).toBe("Tienda Uno");
    expect((fila.monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    expect(JSON.stringify(fila)).not.toContain("Se cobro dos veces");
    // El credito a la tienda por el monto DEL COBRO (R13).
    const credito = primerArg(walletTiendaCreateMany);
    expect(credito.data[0]).toMatchObject({
      tiendaId: TIENDA,
      tipo: "credito",
      categoria: "cobro_tienda_anulado",
      origenTipo: "cobro_tienda",
      origenId: COBRO_ID,
      descripcion: "Anulación · Reposicion de etiquetas",
    });
    expect((credito.data[0].monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    // ⭑ El REVERSO en la caja, mismo monto, mismo instante que el credito.
    expect(cajaCreateMany).toHaveBeenCalledTimes(1);
    const reverso = primerArg(cajaCreateMany);
    expect(reverso.data[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_reverso_cobro_tienda",
      origenTipo: "cobro_tienda",
      origenId: COBRO_ID,
      descripcion: "Anulación · Tienda Uno · Reposicion de etiquetas",
    });
    expect((reverso.data[0].monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    expect((reverso.data[0].fechaMovimiento as Date).getTime()).toBe((credito.data[0].fechaMovimiento as Date).getTime());
    // Todo dentro de UNA transaccion.
    expect(clienteFalso.$transaction).toHaveBeenCalledTimes(1);
    // 500 − 1500 = −1000 (el doble del saldo es fijo; lo que importa es que se leyo despues).
    expect(r.saldo.saldo).toBe("-1000.00");
  });

  it("un cobro reclasificado por el camino REAL responde `no_anulable` sin abrir la transaccion", async () => {
    queryRaw.mockResolvedValueOnce([{ anulado: false, reclasificado: true, tiene_cargo: false }] as never);
    const r = await anularCobroTiendaAction({ cobroId: COBRO_ID, motivo: "x" }, { getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "no_anulable", motivo: "reclasificado" });
    expect(clienteFalso.$transaction).not.toHaveBeenCalled();
    expect(anulacionCreate).not.toHaveBeenCalled();
    expect(cajaCreateMany).not.toHaveBeenCalled();
  });

  it("un id que no es un cobro, por el camino REAL, responde `no_encontrado` sin leer su estado", async () => {
    walletTiendaFindFirst.mockResolvedValueOnce(null as never);
    const r = await anularCobroTiendaAction({ cobroId: COBRO_ID, motivo: "x" }, { getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "no_encontrado" });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(clienteFalso.$transaction).not.toHaveBeenCalled();
  });
});
