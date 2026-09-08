import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICobroTiendaService } from "@/lib/interfaces/services/ICobroTiendaService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 / T F.1 + F.2 — el BORDE del cobro y su COMPOSITION ROOT.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// DOS MITADES, y la segunda es la que este repo tiene medida como modo de fallo real:
//
//  · F.1 — lo que decide el borde: sin sesion, `unauthenticated` SIN llamar al servicio (R13); una
//    peticion mal formada, `validation_error` SIN llamar al servicio (R14/R15/R16); y `forbidden`
//    y `ok` pasan tal cual desde el DOMINIO.
//
//  · F.2 — que alguien PASE de verdad las tres dependencias. «2 de 7 notificadores muertos con la
//    suite verde» esta medido en este repo: comprobar que el modulo IMPORTA el repositorio NO
//    BASTA. Aqui se ejercita la accion REAL, sin `deps.service`, contra un cliente Prisma falso, y
//    se exige que las tres partes se USEN: el repositorio de usuarios (validacion de la tienda), el
//    del ledger (asiento + relectura + saldo) y el runner de transacciones.
//
// ⚠️ Y LA CUARTA DEPENDENCIA QUE **NO** DEBE EXISTIR: el mismo cliente falso lleva un espia de
// `walletMovimiento` —la caja de Ordenex— que tiene que quedarse en CERO (R24/D1).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA = "0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55";

const walletTiendaCreateMany = vi.fn(async () => ({ count: 1 }));
const walletTiendaFindFirst = vi.fn(
  async ({ where }: { where: { id: string; tiendaId: string } }) => ({
    id: where.id,
    tiendaId: where.tiendaId,
    tipo: "debito",
    categoria: "cobro_manual",
    monto: new Prisma.Decimal("1500.00"),
    origenTipo: "manual",
    origenId: null,
    descripcion: "Reposicion de etiquetas",
    registradoPor: MAESTRO.usuarioId,
    fechaMovimiento: new Date("2026-09-08T10:00:00.000Z"),
    createdAt: new Date("2026-09-08T10:00:00.000Z"),
  }),
);
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
/** ⚠️ LA CAJA DE ORDENEX. Vive aqui para poder afirmar que NADIE la llama (R24). */
const cajaCreateMany = vi.fn();
const cajaCreate = vi.fn();

const clienteFalso = {
  walletTiendaMovimiento: {
    createMany: walletTiendaCreateMany,
    findFirst: walletTiendaFindFirst,
    groupBy: walletTiendaGroupBy,
    findMany: vi.fn(),
    count: vi.fn(),
  },
  walletMovimiento: { createMany: cajaCreateMany, create: cajaCreate },
  historialAccion: { createMany: historialCreateMany },
  usuario: { findUnique: usuarioFindUnique, findMany: vi.fn() },
  tipoIdentificacion: {},
  rol: {},
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(clienteFalso)),
};

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => clienteFalso,
  PRISMA_OMIT: {},
}));

const { registrarCobroTiendaAction } = await import("@/lib/actions/wallet-tienda");

function peticion(over: Record<string, unknown> = {}) {
  return { tiendaId: TIENDA, monto: "1500.00", descripcion: "Reposicion de etiquetas", ...over };
}

function servicioDoble(resultado: unknown) {
  const registrarCobro = vi.fn().mockResolvedValue(resultado);
  return {
    service: { registrarCobro } as unknown as ICobroTiendaService,
    registrarCobro,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("381/F.1 — el borde: sesion y forma", () => {
  it("R13: sin sesion responde `unauthenticated` y NO llama al servicio", async () => {
    const { service, registrarCobro } = servicioDoble({ status: "ok" });
    const r = await registrarCobroTiendaAction(peticion(), {
      service,
      getActor: async () => null,
    });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("R14/R15/R16: una peticion mal formada muere en el borde, con sus campos", async () => {
    const { service, registrarCobro } = servicioDoble({ status: "ok" });
    const r = await registrarCobroTiendaAction(
      { tiendaId: "no-es-uuid", monto: "0", descripcion: "  " },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    // Los tres campos, cada uno con su motivo. El ZodError se traduce a `fieldErrors`.
    expect(Object.keys(r.fieldErrors).sort()).toEqual(["descripcion", "monto", "tiendaId"]);
    expect(r.fieldErrors.descripcion).toContain("La descripcion es obligatoria.");
    // Y ni una llamada al dominio: la barrera es PARSEAR.
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it("la sesion se resuelve ANTES que el schema: sin sesion y con basura, `unauthenticated`", async () => {
    // El orden importa: si validara primero, una peticion anonima con basura revelaria que campos
    // existen antes de comprobar quien pregunta.
    const { service } = servicioDoble({ status: "ok" });
    const r = await registrarCobroTiendaAction("basura", { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("`forbidden` del dominio viaja tal cual (R12)", async () => {
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
    const r = await registrarCobroTiendaAction(
      peticion({ descripcion: "  Cintas  " }),
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual(OK);
    // El servicio recibe lo PARSEADO (descripcion recortada) y el actor de la sesion.
    expect(registrarCobro).toHaveBeenCalledWith(
      { tiendaId: TIENDA, monto: "1500.00", descripcion: "Cintas" },
      MAESTRO,
    );
  });
});

describe("381/F.2 — el composition root PASA las tres dependencias, no solo las importa", () => {
  it("la accion REAL, sin `deps.service`, escribe el asiento, el rastro y devuelve el saldo", async () => {
    const r = await registrarCobroTiendaAction(peticion(), { getActor: async () => MAESTRO });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // 1) EL REPOSITORIO DE USUARIOS llego: sin el, la validacion de la tienda habria lanzado.
    expect(usuarioFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TIENDA } }),
    );
    // 2) EL RUNNER DE TRANSACCIONES llego: si fuera `undefined`, esto seria un TypeError.
    expect(clienteFalso.$transaction).toHaveBeenCalledTimes(1);
    // 3) EL REPOSITORIO DEL LEDGER llego, y escribio LA fila del cobro.
    expect(walletTiendaCreateMany).toHaveBeenCalledTimes(1);
    const datos = (walletTiendaCreateMany.mock.calls as unknown as unknown[][])[0][0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(datos.data).toHaveLength(1);
    expect(datos.data[0]).toMatchObject({
      tiendaId: TIENDA,
      tipo: "debito",
      categoria: "cobro_manual",
      origenTipo: "manual",
      origenId: null,
      registradoPor: MAESTRO.usuarioId,
    });
    expect((datos.data[0].monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    // 4) Y el RASTRO, en la misma transaccion.
    expect(historialCreateMany).toHaveBeenCalledTimes(1);
    const fila = ((historialCreateMany.mock.calls as unknown as unknown[][])[0][0] as {
      data: Record<string, unknown>[];
    }).data[0];
    expect(fila.accion).toBe("cobro_tienda_registrado");
    expect(fila.entidadTipo).toBe("wallet_tienda_movimiento");
    expect(fila.entidadId).toBe(datos.data[0].id);
    expect(fila.entidadEtiqueta).toBe("Tienda Uno");
    expect((fila.monto as Prisma.Decimal).toFixed(2)).toBe("1500.00");
    // 5) El saldo derivado del ledger, con su signo. 500 − 1500 = −1000.
    expect(r.saldo.saldo).toBe("-1000.00");
    expect(r.saldo.signo).toBe("negativo");
  });

  it("⚠️ y NO construye ningun escritor de la caja de Ordenex (R24)", async () => {
    await registrarCobroTiendaAction(peticion(), { getActor: async () => MAESTRO });
    // Los dos espias estan vivos y en cero: el cobro no genera ni un movimiento de caja.
    expect(cajaCreateMany).not.toHaveBeenCalled();
    expect(cajaCreate).not.toHaveBeenCalled();
  });

  it("la tienda inexistente se rechaza por el camino REAL, sin escribir nada", async () => {
    usuarioFindUnique.mockResolvedValueOnce(null as never);
    const r = await registrarCobroTiendaAction(peticion(), { getActor: async () => MAESTRO });
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { tiendaId: ["La tienda no existe"] },
    });
    expect(walletTiendaCreateMany).not.toHaveBeenCalled();
    expect(historialCreateMany).not.toHaveBeenCalled();
    expect(clienteFalso.$transaction).not.toHaveBeenCalled();
  });
});
