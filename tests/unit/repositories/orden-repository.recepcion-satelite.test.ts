import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 33 — repo de la bodega satelite. Prisma se mockea con dobles simples
// (patron orden-repository.guia.test.ts): sin DB real, se verifica la forma de la
// query (where/select) y el mapeo de filas.
// Feature 49/#6: recibirEnSatelite envuelve el updateMany guardado en `$transaction`
// (pre-lectura del origen + append en la misma tx). El fake `$transaction` pasa el
// propio prisma como `tx`.
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    orden: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    usuario: {
      findUnique: vi.fn(),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

// Feature 49/#6: contexto de historial (actor = el adminSatelite que recibe por QR).
const HIST_RECEPCION = { actorUsuarioId: "adminsat-1", origenTipo: "recepcion_satelite" } as const;

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("OrdenRepository.findUsuarioZonaId (R4/R5)", () => {
  it("R4: devuelve la zona del adminSatelite (select zonaId por usuarioId)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ zonaId: "z-limon" });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioZonaId("u1")).toBe("z-limon");
    const arg = prisma.usuario.findUnique.mock.calls[0][0];
    expect(arg).toEqual({ where: { id: "u1" }, select: { zonaId: true } });
  });

  it("R5: null si el usuario no tiene zona (zonaId NULL)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ zonaId: null });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioZonaId("u1")).toBeNull();
  });

  it("R5: null si el usuario no resuelve", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue(null);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findUsuarioZonaId("nope")).toBeNull();
  });
});

describe("OrdenRepository.findRecepcionSateliteByZona (R6/R8/R9)", () => {
  function ordenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "o1",
      numGuia: 10,
      numRemision: "R-1",
      destinatario: "Ana",
      telefonoDest: "099",
      direccion: "calle 1",
      producto: "caja",
      montoCobrar: new Prisma.Decimal(25),
      prioridad: false, // feature 101/R9: escalar de la fila que toRecepcionSateliteRow propaga
      estatus: { value: "en_ruta_bodega_satelite" },
      tienda: { nombre: "Tienda X" },
      zona: { nombre: "Limon" },
      provincia: { nombre: "Prov" },
      canton: { nombre: "Canton" },
      distrito: { nombre: "Distrito" },
      ...overrides,
    };
  }

  it("R6/R8: filtra zona + estatus IN + no borradas; mapea nombres y Decimal->number", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      ordenRow({ prioridad: true }),
      ordenRow({ id: "o2", estatus: { value: "en_bodega_satelite" }, distrito: null, montoCobrar: null }),
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findRecepcionSateliteByZona("z-limon", [
      "en_ruta_bodega_satelite",
      "en_bodega_satelite",
    ]);

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      zonaId: "z-limon",
      deletedAt: null, // R6: excluye borradas
      estatus: { value: { in: ["en_ruta_bodega_satelite", "en_bodega_satelite"] } },
    });
    // Feature 101/R7: sort prioridad-first en la QUERY (no en memoria), desempate por recencia.
    expect(arg.orderBy).toEqual([{ prioridad: "desc" }, { createdAt: "desc" }]);
    // Feature 101/R9: el `select` pide `prioridad` explicitamente (es un select acotado).
    expect(arg.select.prioridad).toBe(true);
    // R9: y toRecepcionSateliteRow lo propaga a la fila (aqui la o1 es prioritaria).
    expect(rows[0]).toEqual({
      id: "o1",
      numGuia: 10,
      numRemision: "R-1",
      estatusValue: "en_ruta_bodega_satelite",
      destinatario: "Ana",
      telefonoDest: "099",
      direccion: "calle 1",
      producto: "caja",
      montoCobrar: 25,
      tiendaNombre: "Tienda X",
      zonaNombre: "Limon",
      provinciaNombre: "Prov",
      cantonNombre: "Canton",
      distritoNombre: "Distrito",
      prioridad: true, // feature 101/R9
      // Feature 262/B8 (R16): el dia de reparto por orden, ya serializado a `YYYY-MM-DD`. Aqui la
      // fila sembrada no lo trae, asi que `toFechaISO` devuelve `null`.
      //
      // ⚠️ SE AÑADE AL LITERAL, NO SE RELAJA EL `toEqual`. Este literal ES el contrato de
      // `RecepcionSateliteRow`: cambiarlo por `objectContaining` o por su propia fuente lo dejaria
      // siempre verde y dejaria de avisar el dia que el repositorio se olvide de un campo.
      fechaRepartoISO: null,
    });
    // R9: estatusValue distingue "Recibidas"; distrito/monto nullable resueltos; prioridad default.
    expect(rows[1].estatusValue).toBe("en_bodega_satelite");
    expect(rows[1].distritoNombre).toBeNull();
    expect(rows[1].montoCobrar).toBeNull();
    expect(rows[1].prioridad).toBe(false);
  });

  it("devuelve vacio sin consultar cuando estatusValues esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findRecepcionSateliteByZona("z-limon", [])).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.recibirEnSatelite (R11/R18 · feature 49/#6)", () => {
  it("R11/R18: UPDATE guardado por id+zona+deletedAt+origen; true si afecto 1 fila", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("en_ruta_bodega_satelite") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const ok = await repo.recibirEnSatelite("o1", "z-limon", idEstado("en_bodega_satelite"), HIST_RECEPCION);

    expect(ok).toBe(true);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    // Guardia por estado de origen + zona + no borrada en la propia escritura.
    expect(arg.where).toEqual({
      id: "o1",
      zonaId: "z-limon",
      deletedAt: null,
      estatus: { value: "en_ruta_bodega_satelite" },
    });
    // R11: solo fija estatusId; NO toca mensajeroAsignadoId ni numGuia.
    expect(arg.data).toEqual({ estatusId: idEstado("en_bodega_satelite") });
    expect(arg.data).not.toHaveProperty("mensajeroAsignadoId");
    expect(arg.data).not.toHaveProperty("numGuia");
  });

  // Feature 49/#6 (R14/R7): al recibir, 1 historial (origen en_reparto -> en_bodega_satelite).
  it("R14: recepcion deja 1 historial con origen pre-leido y tipo recepcion_satelite", async () => {
    const prisma = buildPrisma();
    prisma.orden.findFirst.mockResolvedValue({ estatusId: idEstado("en_ruta_bodega_satelite") });
    prisma.orden.updateMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.recibirEnSatelite("o1", "z-limon", idEstado("en_bodega_satelite"), HIST_RECEPCION);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_ruta_bodega_satelite"),
        estatusDestinoId: idEstado("en_bodega_satelite"),
        actorUsuarioId: "adminsat-1",
        origenTipo: "recepcion_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R18/R8: false si el UPDATE no afecto filas (race); NO deja rastro", async () => {
    const prisma = buildPrisma();
    // Perdio la carrera: la pre-lectura ya no encuentra la orden en el origen (o cambio).
    prisma.orden.findFirst.mockResolvedValue(null);
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.recibirEnSatelite("o1", "z-limon", idEstado("en_bodega_satelite"), HIST_RECEPCION)).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

// --- Feature 278 (T3B.6, R40): aqui vivian `buildPrismaRaw` y
// `describe("OrdenRepository.recibirLoteEnSatelite (feature 63)")` ---
//
// El metodo de escritura EN LOTE se retiro del repositorio y de `IOrdenRepository`. Destino de
// sus CUATRO casos (detalle en `progress/impl_278.md`): los cuatro MUEREN con el codigo, porque
// afirmaban un SQL que ya no existe (`UPDATE ... RETURNING "id"` guardado por origen+zona) y una
// cota de lista vacia que ya no tiene lista. Lo que sostiene el QR es su HERMANO singular,
// `recibirEnSatelite`, cuyo `describe` de ARRIBA queda intacto y conserva los tres casos que
// importan: el `where` completo (id + zona + deletedAt + estado de origen), el append de UN
// historial con el origen pre-leido, y el `false` sin rastro cuando la carrera se pierde.
// Probar el WHERE donde vive: esa es la razon por la que ese bloque no se toca (R38).
