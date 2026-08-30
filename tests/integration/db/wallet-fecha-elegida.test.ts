import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { FinanzasDiarioRepository } from "@/lib/repositories/FinanzasDiarioRepository";
import { WalletService } from "@/lib/services/WalletService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { AgregadoDiarioCajaRow } from "@/lib/interfaces/repositories/IFinanzasDiarioRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * Ficha 334 — la fecha elegida, contra **Postgres de verdad**.
 *
 * ── Por que un doble no sirve para esto ──────────────────────────────────────────────────
 *
 * Los cuatro hechos que esta ficha promete no viven en el codigo del servicio, viven en la
 * BASE, y en este repo esta medido cuatro veces que una mutacion del `WHERE` pasa en verde por
 * delante de un doble:
 *
 *  1. **`created_at` sigue siendo el instante en que se creo la fila** (R24). Lo pone el
 *     `DEFAULT CURRENT_TIMESTAMP` de la columna, no el codigo: solo el motor puede decir que
 *     quedo distinto de la fecha elegida.
 *  2. **El rollup diario cuenta el movimiento en el dia ELEGIDO** (R25). La frontera del dia es
 *     `(fecha_movimiento − 6h)::date` dentro de un `$queryRaw`; ningun doble la evalua.
 *  3. **El filtro `desde` lo incluye** (R27). Es una comparacion de `timestamp` en el `WHERE`.
 *  4. **Tres filas EMPATADAS paginan sin repetir ni perder** (R26). El orden indefinido de un
 *     `ORDER BY` de una sola columna es una propiedad del planificador, no del cliente.
 *
 * ── Aislamiento y no-vacuidad ────────────────────────────────────────────────────────────
 *
 * Todo corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si
 * el runner muere, no queda ni una fila de dinero inventada. Y **no hay ni un `return` mudo**:
 * cuando falta un dato previo (un usuario que pueda ser el actor, o el rango vacio del caso del
 * empate), el test FALLA con su motivo — un `if (!x) return;` reportaria `passed` sin haber
 * comprobado una sola linea, que es un modo de fallo que este repo ya sufrio.
 *
 * Sin base alcanzable, la suite entera se SALTA (no falla): la suite tiene que seguir siendo
 * verde en una maquina sin Postgres levantado.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** Un monto reconocible, para que un delta accidental no pueda confundirse con el medido. */
const MONTO_DEL_GASTO = "1234.56";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * El actor que registra. Tiene que ser un usuario REAL: `wallet_movimiento.registrado_por` es
 * una FK, y con un id inventado el INSERT lo rechaza el motor.
 */
async function actorDeLaBase(tx: Tx): Promise<Actor> {
  const usuario = await tx.usuario.findFirst({ select: { id: true } });
  if (usuario === null) {
    throw new Error(
      "la base de desarrollo no tiene ningun usuario y `registrado_por` es una FK: " +
        "sembrá al menos uno antes de correr esta suite (no se salta a proposito)",
    );
  }
  return { usuarioId: usuario.id, rol: "maestro" };
}

function repoDe(tx: Tx): WalletMovimientoRepository {
  return new WalletMovimientoRepository(tx as unknown as PrismaClient);
}

/** SUM del dia `fecha` para `categoria` en el agregado del rollup, como STRING escala 2. */
function totalDelDia(
  filas: readonly AgregadoDiarioCajaRow[],
  fecha: string,
  categoria: string,
): string {
  return filas
    .filter((f) => f.fecha === fecha && f.categoria === categoria)
    .reduce((acc, f) => acc.add(new Prisma.Decimal(f.total)), new Prisma.Decimal(0))
    .toFixed(2);
}

describeSiHayBase("ficha 334 — la fecha elegida contra Postgres (R22/R24/R25/R26/R27)", () => {
  let prisma: PrismaClient;

  /** El dia CALENDARIO de Costa Rica de hoy y el de ayer, con el reloj real de la corrida. */
  const hoyCR = fechaCalendarioCR();
  const ayerCR = fechaCalendarioCR(new Date(Date.now() - UN_DIA_MS));

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R22/R24: un gasto fechado AYER se guarda a las 06:00Z de ayer, y `created_at` es el presente", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const actor = await actorDeLaBase(tx);
      const svc = new WalletEgresoService(repoDe(tx), tx as unknown as PrismaClient);

      const r = await svc.registrarEgreso(
        {
          tipoEgreso: "gasto_variable",
          monto: MONTO_DEL_GASTO,
          descripcion: "ficha 334 — gasto de ayer",
          fecha: ayerCR,
        },
        actor,
      );

      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("esperado ok");

      // R28 contra la base: el servicio devuelve la fila que ACABA de crear, y existe.
      const fila = await tx.walletMovimiento.findUnique({ where: { id: r.movimiento.id } });
      expect(fila, "el id que devolvio el servicio no existe en la tabla").not.toBeNull();
      if (fila === null) throw new Error("fila inexistente");

      // R22: el instante en que ese dia EMPIEZA en Costa Rica. `00:00Z` metería el gasto en el
      // dia anterior del rollup — por eso el literal es `06:00Z` y esta escrito entero.
      expect(fila.fechaMovimiento.toISOString()).toBe(`${ayerCR}T06:00:00.000Z`);

      // R24: `created_at` NO es la fecha elegida; lo pone la base y cae ahora mismo.
      expect(fila.createdAt.toISOString()).not.toBe(fila.fechaMovimiento.toISOString());
      expect(fila.createdAt.getTime()).toBeGreaterThan(fila.fechaMovimiento.getTime());
      expect(Math.abs(fila.createdAt.getTime() - Date.now())).toBeLessThan(10 * 60 * 1000);

      // Money-safe: el monto vuelve como STRING escala 2 y vale lo que se mando.
      expect(r.movimiento.monto).toBe(MONTO_DEL_GASTO);
      expect(fila.monto.toFixed(2)).toBe(MONTO_DEL_GASTO);
    });
  });

  it("R25: el rollup DIARIO lo cuenta en el dia de AYER y no en el de hoy", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const actor = await actorDeLaBase(tx);
      const diario = new FinanzasDiarioRepository(tx as unknown as PrismaClient);
      const desde = inicioDelDiaCREnUtc(ayerCR);
      const hasta = inicioDelDiaSiguienteCREnUtc(hoyCR); // ventana semiabierta [ayer, mañana)

      // Se mide el DELTA y no el total: la base de desarrollo puede traer filas propias en esa
      // ventana, y un total absoluto seria una asercion sobre datos ajenos.
      const antes = await diario.sumarPorDia(desde, hasta);

      const r = await new WalletEgresoService(
        repoDe(tx),
        tx as unknown as PrismaClient,
      ).registrarEgreso(
        {
          tipoEgreso: "gasto_variable",
          monto: MONTO_DEL_GASTO,
          descripcion: "ficha 334 — rollup",
          fecha: ayerCR,
        },
        actor,
      );
      expect(r.status).toBe("ok");

      const despues = await diario.sumarPorDia(desde, hasta);
      const delta = (fecha: string) =>
        new Prisma.Decimal(totalDelDia(despues, fecha, "egreso_gasto_variable"))
          .minus(totalDelDia(antes, fecha, "egreso_gasto_variable"))
          .toFixed(2);

      // El dia elegido gana EXACTAMENTE el monto…
      expect(delta(ayerCR)).toBe(MONTO_DEL_GASTO);
      // …y el dia de hoy no se entera. Las dos aserciones juntas son lo que se rompe si la
      // traduccion de la fecha se neutraliza: la fila caeria en hoy y los dos deltas se
      // cambiarian de sitio.
      expect(delta(hoyCR)).toBe("0.00");
    });
  });

  it("R27: el filtro `desde` = ayer devuelve el movimiento fechado ese dia", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const actor = await actorDeLaBase(tx);
      const repo = repoDe(tx);

      const r = await new WalletEgresoService(
        repo,
        tx as unknown as PrismaClient,
      ).registrarEgreso(
        {
          tipoEgreso: "gasto_variable",
          monto: MONTO_DEL_GASTO,
          descripcion: "ficha 334 — filtro desde",
          fecha: ayerCR,
        },
        actor,
      );
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("esperado ok");

      // `new Date("YYYY-MM-DD")` es EXACTAMENTE lo que produce el `z.coerce.date()` del borde
      // a partir del `<input type="date">`: medianoche UTC del dia elegido.
      const page = await repo.listar({
        page: 1,
        pageSize: 100,
        categoria: "egreso_gasto_variable",
        desde: new Date(ayerCR),
      });

      // Si el conjunto desbordara la pagina, la asercion de abajo dejaria de significar nada:
      // se falla con su motivo en vez de pasar por casualidad.
      expect(page.total, "el filtro devuelve mas de una pagina; el caso ya no aisla").toBeLessThanOrEqual(100);
      expect(page.movimientos.map((m) => m.id)).toContain(r.movimiento.id);
    });
  });

  it("R26: tres movimientos EMPATADOS en la misma fecha paginan sin repetir ni perder filas", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const actor = await actorDeLaBase(tx);
      const repo = repoDe(tx);
      const svc = new WalletService(repo, tx as unknown as PrismaClient);

      // El rango se cierra sobre UN SOLO instante (`gte` y `lte` iguales): son exactamente las
      // filas que comparten `fecha_movimiento`, que es donde vive el empate.
      const instante = new Date(`${ayerCR}T06:00:00.000Z`);
      const filtro = {
        categoria: "egreso_ajuste" as const,
        desde: instante,
        hasta: instante,
      };

      const previo = await repo.listar({ ...filtro, page: 1, pageSize: 10 });
      expect(
        previo.total,
        "la base ya tiene ajustes en ese instante exacto; el caso dejaria de aislar",
      ).toBe(0);

      const ids: string[] = [];
      for (const monto of ["11.00", "22.00", "33.00"]) {
        const r = await svc.registrarMovimientoManual(
          {
            tipo: "egreso",
            categoria: "egreso_ajuste",
            monto,
            descripcion: `ficha 334 — empate ${monto}`,
            fecha: ayerCR,
          },
          actor,
        );
        expect(r.status).toBe("ok");
        if (r.status !== "ok") throw new Error("esperado ok");
        ids.push(r.movimiento.id);
      }

      const p1 = await repo.listar({ ...filtro, page: 1, pageSize: 2 });
      const p2 = await repo.listar({ ...filtro, page: 2, pageSize: 2 });

      expect(p1.total).toBe(3);
      expect(p1.movimientos).toHaveLength(2);
      expect(p2.movimientos).toHaveLength(1);

      // CONTROL DE NO-VACUIDAD: las tres filas comparten el MISMO instante. Sin esto, el caso
      // podria estar midiendo tres fechas distintas, donde paginar nunca fallaria.
      const instantes = new Set(
        [...p1.movimientos, ...p2.movimientos].map((m) => m.fechaMovimiento),
      );
      expect(instantes).toEqual(new Set([`${ayerCR}T06:00:00.000Z`]));

      // Y lo que la ficha promete: las dos paginas juntas son las TRES filas, sin repetidas.
      const vistos = [...p1.movimientos, ...p2.movimientos].map((m) => m.id);
      expect(vistos).toHaveLength(3);
      expect(new Set(vistos).size).toBe(3);
      expect(new Set(vistos)).toEqual(new Set(ids));
    });
  });
});
