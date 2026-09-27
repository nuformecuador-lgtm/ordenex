import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T7 — `marcarConciliado` y `revertirConciliacion`: LA FORMA DE LA ESCRITURA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE MIDE ESTE ARCHIVO Y QUE NO. Aqui se afirma el `WHERE` EXACTO de las dos guardas, el `data`
// que se escribe y los TRES desenlaces. Lo que NO se puede medir con un doble —que la base acepte
// la escritura, que el `CHECK` muerda, que la fila del historial quede— vive en
// `tests/integration/db/marca-conciliacion.int.test.ts`, contra Postgres.
//
// ⚠️ Y HAY UNA TERCERA COSA QUE NO CAZA NI ESTE ARCHIVO NI AQUEL: `appendAccion(this.prisma, …)` en
// vez de `appendAccion(tx, …)`. Con dobles, `this.prisma` y `tx` son el mismo objeto de mentira; en
// integracion, `this.prisma` ES la transaccion del test. Lo unico que lo caza es la guardia
// estatica del censo. Esta escrito aqui para que nadie crea que este archivo lo cubre.
//
// EL DOBLE ES HONESTO EN UN PUNTO CONCRETO: `$transaction` ejecuta el callback con un `tx` cuyo
// `updateMany` devuelve el `count` que el caso decide. Asi, «`count !== 1` -> conflict» se mide de
// verdad y no por lo que el doble tenga ganas de devolver.

/**
 * Las formas de los argumentos que el doble recibe. Se declaran para que `mock.calls[0][0]` tenga
 * tipo: sin esto, TypeScript ve una tupla VACIA y las aserciones de este archivo no compilarian —
 * que es, de paso, la razon por la que compilan de verdad y no por un `any` que las tape.
 */
interface DataMarca {
  estado?: string;
  conciliadoAt?: Date | null;
  conciliadoPor?: string | null;
  montoRecibido?: Prisma.Decimal | null;
  conciliadoNota?: string | null;
  resueltoAt?: Date | null;
  resueltoPor?: string | null;
}

interface ArgsUpdateMany {
  where: Record<string, unknown>;
  data: DataMarca;
}

interface FilaHistorial {
  accion: string;
  entidadTipo: string;
  entidadId: string;
  entidadEtiqueta: string;
  monto: Prisma.Decimal | null;
  actorUsuarioId: string | null;
}

interface OpcionesDoble {
  /** Filas afectadas por el `updateMany` guardado. 1 = la guarda paso. */
  count?: number;
  /** `count` de `cierre_bodega` por id, para distinguir `conflict` de `fuera_de_alcance`. */
  existe?: number;
  /** La fila que se relee (o se preleer, al revertir). */
  fila?: Record<string, unknown> | null;
}

function buildPrisma(opciones: OpcionesDoble = {}) {
  const updateMany = vi.fn(async (_args: ArgsUpdateMany) => ({ count: opciones.count ?? 1 }));
  const findUnique = vi.fn(async () =>
    opciones.fila === undefined
      ? {
          totalGeneral: new Prisma.Decimal("600.00"),
          montoRecibido: new Prisma.Decimal("485.00"),
          solicitadoAt: new Date("2026-09-10T12:00:00.000Z"),
          zona: { nombre: "Cartago" },
        }
      : opciones.fila,
  );
  const count = vi.fn(async () => opciones.existe ?? 1);
  const createMany = vi.fn(async (_args: { data: FilaHistorial[] }) => ({ count: 1 }));
  const usuarioFindUnique = vi.fn(async () => ({
    nombre: "Ana",
    primerApellido: "Solis",
    rol: { value: "maestro" },
  }));

  const tx = {
    cierreBodega: { updateMany, findUnique, count },
    historialAccion: { createMany },
    usuario: { findUnique: usuarioFindUnique },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { prisma, updateMany, findUnique, count, createMany };
}

function repoCon(prisma: unknown) {
  return new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);
}

describe("431/T7 — CierresBodegaAdminRepository.marcarConciliado", () => {
  it("⭑ R11: la guarda del `WHERE` son LOS DOS predicados, no uno", async () => {
    // `estado: 'solicitado'` Y `conciliadoAt: null`. El estado es lo que las pantallas leen;
    // `conciliado_at` es EL predicado de la marca. Con uno solo, una fila incoherente —que el
    // `CHECK` impide, pero el `WHERE` no deberia necesitar— se dejaria marcar dos veces.
    const { prisma, updateMany } = buildPrisma();
    await repoCon(prisma).marcarConciliado({
      id: "cb1",
      montoRecibido: "485.00",
      nota: null,
      actorUsuarioId: "u-maestro",
    });

    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: "cb1",
      estado: "solicitado",
      conciliadoAt: null,
    });
  });

  it("⭑ R8/R9: escribe los cuatro datos, el estado y el ESPEJO, con el monto como Decimal", async () => {
    const { prisma, updateMany } = buildPrisma();
    await repoCon(prisma).marcarConciliado({
      id: "cb1",
      montoRecibido: "485.00",
      nota: "faltaron 15",
      actorUsuarioId: "u-maestro",
    });

    const data = updateMany.mock.calls[0][0].data;
    expect(data.estado).toBe("aprobado"); // D2: se LEE «Recibido»
    expect(data.conciliadoPor).toBe("u-maestro");
    expect(data.conciliadoNota).toBe("faltaron 15");
    // Money-safe: el importe entra como STRING y se convierte AQUI, en el borde de la escritura.
    expect(data.montoRecibido).toBeInstanceOf(Prisma.Decimal);
    expect(data.montoRecibido?.toFixed(2)).toBe("485.00");
    // El espejo, sin el cual los cierres de bodega desaparecen de la analitica financiera.
    expect(data.resueltoPor).toBe("u-maestro");
    expect(data.resueltoAt).toBeInstanceOf(Date);
    // Y el MISMO instante en las dos marcas de tiempo: son el mismo acto.
    expect(data.resueltoAt?.getTime()).toBe(data.conciliadoAt?.getTime());
  });

  it("⭑ R13: registra `cierre_bodega_conciliado` con el monto RECIBIDO y sin la nota", async () => {
    const { prisma, createMany } = buildPrisma();
    await repoCon(prisma).marcarConciliado({
      id: "cb1",
      montoRecibido: "485.00",
      nota: "una nota que NO viaja",
      actorUsuarioId: "u-maestro",
    });

    const fila = createMany.mock.calls[0][0].data[0];
    expect(fila.accion).toBe("cierre_bodega_conciliado");
    expect(fila.entidadTipo).toBe("cierre_bodega");
    expect(fila.entidadId).toBe("cb1");
    // El monto RECIBIDO (485), NO el consolidado (600): es lo que la persona afirma haber contado.
    expect(fila.monto?.toFixed(2)).toBe("485.00");
    expect(fila.entidadEtiqueta).toContain("Cartago");
    // R5 de la 362: el texto libre no entra en el historial.
    expect(JSON.stringify(fila)).not.toContain("una nota que NO viaja");
  });

  it("R11: `count !== 1` con la fila existente -> `conflict`, y NO registra nada", async () => {
    const { prisma, createMany } = buildPrisma({ count: 0, existe: 1 });
    const r = await repoCon(prisma).marcarConciliado({
      id: "cb1",
      montoRecibido: "1.00",
      nota: null,
      actorUsuarioId: "u-maestro",
    });

    expect(r).toBe("conflict");
    // Una accion que no ocurrio no deja rastro de que ocurrio.
    expect(createMany).not.toHaveBeenCalled();
  });

  it("`count !== 1` y la fila NO existe -> `fuera_de_alcance`", async () => {
    const { prisma } = buildPrisma({ count: 0, existe: 0 });
    const r = await repoCon(prisma).marcarConciliado({
      id: "no-existe",
      montoRecibido: "1.00",
      nota: null,
      actorUsuarioId: "u-maestro",
    });

    expect(r).toBe("fuera_de_alcance");
  });
});

describe("431/T7 — CierresBodegaAdminRepository.revertirConciliacion", () => {
  it("⭑ R12: la guarda del `WHERE` exige que de verdad estuviera marcada", async () => {
    const { prisma, updateMany } = buildPrisma();
    await repoCon(prisma).revertirConciliacion({ id: "cb1", actorUsuarioId: "u-maestro" });

    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: "cb1",
      estado: "aprobado",
      conciliadoAt: { not: null },
    });
  });

  it("⭑ R12: pone a NULL las cuatro columnas de la marca Y las dos del espejo", async () => {
    const { prisma, updateMany } = buildPrisma();
    await repoCon(prisma).revertirConciliacion({ id: "cb1", actorUsuarioId: "u-maestro" });

    expect(updateMany.mock.calls[0][0].data).toEqual({
      estado: "solicitado", // se LEE «Pendiente de conciliar»
      conciliadoAt: null,
      conciliadoPor: null,
      montoRecibido: null,
      conciliadoNota: null,
      resueltoAt: null,
      resueltoPor: null,
    });
  });

  it("⭑ R13: el monto de la fila del historial es EL QUE SE BORRA, leido ANTES del update", async () => {
    // Es el unico sitio donde sobrevive: tras el `updateMany`, `monto_recibido` es NULL. Si la
    // lectura se hiciera despues, este monto seria `null` y el rastro diria «alguien deshizo algo».
    const { prisma, createMany, findUnique, updateMany } = buildPrisma();
    await repoCon(prisma).revertirConciliacion({ id: "cb1", actorUsuarioId: "u-maestro" });

    const fila = createMany.mock.calls[0][0].data[0];
    expect(fila.accion).toBe("cierre_bodega_conciliacion_revertida");
    expect(fila.monto?.toFixed(2)).toBe("485.00");
    // Y el ORDEN importa: la lectura va ANTES del `updateMany`.
    expect(findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0],
    );
  });

  it("revertir algo que no estaba marcado -> `conflict`, sin registrar", async () => {
    const { prisma, createMany } = buildPrisma({ count: 0, existe: 1 });
    const r = await repoCon(prisma).revertirConciliacion({
      id: "cb1",
      actorUsuarioId: "u-maestro",
    });

    expect(r).toBe("conflict");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("revertir algo que no existe -> `fuera_de_alcance`", async () => {
    const { prisma } = buildPrisma({ count: 0, existe: 0 });
    const r = await repoCon(prisma).revertirConciliacion({
      id: "no-existe",
      actorUsuarioId: "u-maestro",
    });

    expect(r).toBe("fuera_de_alcance");
  });

  it("⭑ R14: ninguno de los dos metodos toca un libro de dinero", async () => {
    // El doble NO tiene `walletMovimiento`, `walletTiendaMovimiento` ni `pagoMensajeroMovimiento`:
    // si alguno de los dos metodos intentara escribir en ellos, el caso revienta con
    // «cannot read properties of undefined». Es un control estructural, no una promesa.
    const { prisma } = buildPrisma();
    await expect(
      repoCon(prisma).marcarConciliado({
        id: "cb1",
        montoRecibido: "1.00",
        nota: null,
        actorUsuarioId: "u-maestro",
      }),
    ).resolves.toBe("updated");
    await expect(
      repoCon(prisma).revertirConciliacion({ id: "cb1", actorUsuarioId: "u-maestro" }),
    ).resolves.toBe("updated");
  });
});
