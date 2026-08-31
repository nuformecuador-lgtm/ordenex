import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 335 (A12) — EL ALCANCE POR TIENDA DE `listarCierresDeTienda`, CONTRA POSTGRES DE VERDAD.
 *
 * POR QUE AQUI Y NO EN EL TEST DE SERVICIO. Lo que se afirma es de la forma «el WHERE excluye»:
 * que el libro de la tienda A no puede ofrecer un cierre que solo movio dinero de la tienda B, y
 * que el conteo de una opcion es el de ESA tienda en ESE cierre y no el del cierre entero. Un
 * doble en memoria no puede demostrar ninguna de las dos: en este repo esta medido CUATRO veces
 * que una mutacion del `WHERE` sobrevive en verde por arriba. Contraprueba hecha a mano y
 * anotada en `progress/impl_335.md`: quitando `tiendaId` del `where` del repositorio, los dos
 * casos de abajo se ponen ROJOS.
 *
 * SIN BASE ALCANZABLE SE SALTA (`describe.skip`) Y SE VE EN LA SALIDA. Prohibido el
 * `if (!x) return;` dentro del caso, que reporta `passed` sin haber comprobado nada — este repo
 * ya se comio ese verde.
 *
 * TODO SE SIEMBRA (las dos tiendas y los tres cierres) dentro de una transaccion que SIEMPRE se
 * revierte: si el test pasa, si falla o si el proceso muere a mitad, no queda ni una fila. Del
 * catalogo se reusa solo lo que las FK exigen (`tipo_identificacion`, `rol`).
 *
 * Money-safe: los montos se escriben como `Prisma.Decimal` desde STRING y NUNCA se leen: esta
 * lectura no devuelve importes (R9).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("335/A12 — los cierres del libro de UNA tienda, contra Postgres", () => {
  let prisma: PrismaClient;
  let catalogo: { tipoIdentificacionId: string; rolId: string };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const u = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (u === null) {
      // Con base pero sin catalogo se falla RUIDOSAMENTE: un skip aqui escondería que la
      // evidencia de R2 y R6 no se ejecuto.
      throw new Error(
        "hay DATABASE_URL pero no hay ningun usuario: falta el catalogo (rol / tipo de " +
          "identificacion) que las FK de `usuario` exigen. Corre `pnpm run db:seed`.",
      );
    }
    catalogo = u;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

  /**
   * DOS tiendas y TRES cierres CRUZADOS:
   *
   *   - `compartido`: movio dinero de las dos tiendas — 3 filas de A y 1 de B. Es el que hace
   *     que R6 signifique algo: el conteo del cierre ENTERO (4) no es el de A (3).
   *   - `soloA`: 2 filas, todas de A.
   *   - `soloB`: 1 fila, de B. Es el que la lista de A NO puede contener (R2).
   *
   * Ademas, un ajuste `manual` de A con `origen_id` NULL, que no es ningun cierre y no puede
   * aparecer como opcion.
   */
  async function sembrar(tx: Tx) {
    await serializarEscriturasReales(tx);
    const sufijo = randomUUID();

    const crearTienda = async (etiqueta: string) =>
      (
        await tx.usuario.create({
          data: {
            nombre: `335-${etiqueta}`,
            email: `335-${etiqueta}-${sufijo}@example.test`,
            telefono: "88880000",
            passwordHash: "x",
            cedula: `335-${etiqueta}-${sufijo}`,
            tipoIdentificacionId: catalogo.tipoIdentificacionId,
            rolId: catalogo.rolId,
          },
          select: { id: true },
        })
      ).id;

    const tiendaA = await crearTienda("tienda-a");
    const tiendaB = await crearTienda("tienda-b");

    const cierreCompartido = randomUUID();
    const cierreSoloA = randomUUID();
    const cierreSoloB = randomUUID();

    const mov = (
      tiendaId: string,
      origenId: string | null,
      categoria: "cod_recaudado" | "flete" | "iva_flete" | "ajuste_credito",
      fecha: string,
    ) => ({
      tiendaId,
      tipo: categoria === "cod_recaudado" || categoria === "ajuste_credito" ? "credito" as const : "debito" as const,
      categoria,
      monto: new Prisma.Decimal("1000.00"),
      origenTipo: origenId === null ? ("manual" as const) : ("cierre_dia" as const),
      origenId,
      fechaMovimiento: new Date(fecha),
    });

    await tx.walletTiendaMovimiento.createMany({
      data: [
        // El cierre compartido: TRES filas de A, UNA de B.
        mov(tiendaA, cierreCompartido, "cod_recaudado", "2026-07-12T10:00:00.000Z"),
        mov(tiendaA, cierreCompartido, "flete", "2026-07-12T10:00:00.000Z"),
        mov(tiendaA, cierreCompartido, "iva_flete", "2026-07-12T14:30:00.000Z"), // el mas reciente de A
        mov(tiendaB, cierreCompartido, "cod_recaudado", "2026-07-12T23:00:00.000Z"), // mas nuevo, pero de B
        // Un cierre que solo toco a A.
        mov(tiendaA, cierreSoloA, "cod_recaudado", "2026-07-05T09:00:00.000Z"),
        mov(tiendaA, cierreSoloA, "flete", "2026-07-05T09:00:00.000Z"),
        // Un cierre que solo toco a B: es el que la lista de A no puede ofrecer.
        mov(tiendaB, cierreSoloB, "cod_recaudado", "2026-07-20T09:00:00.000Z"),
        // Un ajuste manual de A, sin origen: no es un cierre.
        mov(tiendaA, null, "ajuste_credito", "2026-07-25T09:00:00.000Z"),
      ],
    });

    return { tiendaA, tiendaB, cierreCompartido, cierreSoloA, cierreSoloB };
  }

  it("control de no-vacuidad: la tienda A tiene al menos un cierre en su lista", async () => {
    // Sin este caso, los dos de abajo podrian estar pasando sobre una lista VACIA —que no
    // contiene el cierre de B ni ningun otro— y no dirian nada.
    const { filas, sembrado } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const repo = new WalletTiendaMovimientoRepository(tx as unknown as PrismaClient);
      return { filas: await repo.listarCierresDeTienda(sembrado.tiendaA, 200), sembrado };
    });

    expect(filas.length).toBeGreaterThan(0);
    expect(filas.map((f) => f.cierreId).sort()).toEqual(
      [sembrado.cierreCompartido, sembrado.cierreSoloA].sort(),
    );
    // R7 con datos reales: el mas reciente primero. Para A, el compartido (14:30 del 12) va
    // antes que `soloA` (09:00 del 5).
    expect(filas[0].cierreId).toBe(sembrado.cierreCompartido);
    // Y el ajuste `manual` (origen NULL) no produjo ninguna opcion.
    expect(filas).toHaveLength(2);
  });

  it("R2: la lista de la tienda A NO contiene el cierre que solo movió dinero de la tienda B", async () => {
    const { deA, deB, sembrado } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const repo = new WalletTiendaMovimientoRepository(tx as unknown as PrismaClient);
      return {
        deA: await repo.listarCierresDeTienda(sembrado.tiendaA, 200),
        deB: await repo.listarCierresDeTienda(sembrado.tiendaB, 200),
        sembrado,
      };
    });

    const idsA = deA.map((f) => f.cierreId);
    const idsB = deB.map((f) => f.cierreId);

    expect(idsA).not.toContain(sembrado.cierreSoloB);
    // La contracara, que es la que impide que el `not.toContain` sea verde por vacuidad: el
    // cierre de B SI existe y SI aparece en la lista de B.
    expect(idsB).toContain(sembrado.cierreSoloB);
    expect(idsB).not.toContain(sembrado.cierreSoloA);
    // Y el compartido esta en las dos: cada tienda lo ve por SUS propios movimientos.
    expect(idsA).toContain(sembrado.cierreCompartido);
    expect(idsB).toContain(sembrado.cierreCompartido);
  });

  it("R6: el conteo de movimientos es el de ESA tienda en ESE cierre, no el del cierre entero", async () => {
    const { deA, deB, sembrado } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const repo = new WalletTiendaMovimientoRepository(tx as unknown as PrismaClient);
      return {
        deA: await repo.listarCierresDeTienda(sembrado.tiendaA, 200),
        deB: await repo.listarCierresDeTienda(sembrado.tiendaB, 200),
        sembrado,
      };
    });

    const compartidoDeA = deA.find((f) => f.cierreId === sembrado.cierreCompartido);
    const compartidoDeB = deB.find((f) => f.cierreId === sembrado.cierreCompartido);
    if (!compartidoDeA || !compartidoDeB) throw new Error("el cierre compartido falta en una de las dos listas");

    // El cierre compartido tiene CUATRO filas en total. Cada tienda ve las SUYAS.
    expect(compartidoDeA.movimientos).toBe(3);
    expect(compartidoDeB.movimientos).toBe(1);
    expect(compartidoDeA.movimientos + compartidoDeB.movimientos).toBe(4);

    // Y la fecha rotula el ultimo movimiento DE ESA TIENDA, no el del cierre: el de B (23:00)
    // es posterior al ultimo de A (14:30) y no puede aparecer en la opcion de A.
    expect(compartidoDeA.ultimaFecha).toBe("2026-07-12T14:30:00.000Z");
    expect(compartidoDeB.ultimaFecha).toBe("2026-07-12T23:00:00.000Z");
  });

  it("R9: ninguna fila devuelta trae un importe, con dinero REAL en la tabla", async () => {
    const filas = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const repo = new WalletTiendaMovimientoRepository(tx as unknown as PrismaClient);
      return repo.listarCierresDeTienda(sembrado.tiendaA, 200);
    });

    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      expect(Object.keys(f).sort()).toEqual(["cierreId", "movimientos", "ultimaFecha"]);
      // Ni un `Decimal` colado: lo unico numerico es el CARDINAL del conteo.
      expect(f.movimientos).toBeTypeOf("number");
      expect(Number.isInteger(f.movimientos)).toBe(true);
    }
  });
});
