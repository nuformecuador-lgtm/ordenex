import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { IEstadoCuentaRepository } from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { RechazoTiendaCobroAnulacionRepository } from "@/lib/repositories/RechazoTiendaCobroAnulacionRepository";
import { EstadoCuentaService } from "@/lib/services/EstadoCuentaService";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { acreditar459, conCandado459, limpiar459, sembrarPersonas459, type Personas459 } from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B — revision M2: el estado de cuenta lee la pagina, los totales y el periodo en UNA
// transaccion REPEATABLE READ. Contra Postgres, con filas COMMITEADAS y dos conexiones reales.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El experimento: la tienda tiene 1 000,00 a favor. Se lee su estado de cuenta y, EN MEDIO de la
// lectura —justo despues de leer el saldo actual y antes de leer el periodo—, otra conexion
// COMMITEA lo que la aprobacion de un cierre escribe en el libro de la tienda (credito
// `cod_recaudado` 500,00 y debito `flete` 50,00, origen `cierre_dia`). Sin la lectura consistente,
// el periodo ve esas dos filas y el saldo actual no: R22 no cuadra y `leer` LANZA (error de servidor
// en la pantalla). Con ella, la lectura entera es la foto de antes (1 000,00) y cuadra; la
// siguiente lectura ya ve el cierre (1 450,00).
//
// MUTACION (bitacora): `enLecturaConsistente` que llama `fn(this)` sin abrir transaccion → este test
// cae en rojo por el `throw` de R22.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("458-B/M2 — un cierre aprobado en medio de la lectura del estado de cuenta no la rompe (Postgres real)", () => {
  let prisma: PrismaClient;
  /** OTRO cliente (otro pool): el del test tiene `max: 2` y los ocupan el candado y la lectura. */
  let escritor: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    escritor = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await escritor?.$disconnect();
  });

  /** Lo que la aprobacion de un cierre deja en el libro de la tienda, commiteado por OTRA conexion. */
  async function aprobarCierreEnMedio(p: Personas459): Promise<void> {
    const cierreId = randomUUID();
    await escritor.walletTiendaMovimiento.createMany({
      data: [
        {
          tiendaId: p.tiendaId,
          tipo: "credito",
          categoria: "cod_recaudado",
          monto: new Prisma.Decimal("500.00"),
          origenTipo: "cierre_dia",
          origenId: cierreId,
          descripcion: null,
        },
        {
          tiendaId: p.tiendaId,
          tipo: "debito",
          categoria: "flete",
          monto: new Prisma.Decimal("50.00"),
          origenTipo: "cierre_dia",
          origenId: cierreId,
          descripcion: null,
        },
      ],
    });
  }

  /**
   * El repositorio REAL, con un espia que dispara la escritura concurrente justo despues de leer el
   * saldo actual (la llamada a `totalesDeTienda` sin `antesDe`). El espia envuelve tambien al
   * repositorio ligado a la transaccion, que es el que el servicio usa.
   */
  function repoConCierreEnMedio(p: Personas459, disparos: { n: number }): IEstadoCuentaRepository {
    const real = new EstadoCuentaRepository(prisma);
    const espiar = (r: IEstadoCuentaRepository): IEstadoCuentaRepository =>
      new Proxy(r, {
        get(objetivo, prop, receptor) {
          if (prop === "totalesDeTienda") {
            return async (tiendaId: string, antesDe?: Date) => {
              const salida = await objetivo.totalesDeTienda(tiendaId, antesDe);
              if (antesDe === undefined && disparos.n === 0) {
                disparos.n += 1;
                await aprobarCierreEnMedio(p);
              }
              return salida;
            };
          }
          if (prop === "enLecturaConsistente") {
            return <T,>(fn: (repo: IEstadoCuentaRepository) => Promise<T>) =>
              objetivo.enLecturaConsistente((ligado) => fn(espiar(ligado)));
          }
          const valor = Reflect.get(objetivo, prop, receptor) as unknown;
          return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
        },
      });
    return espiar(real);
  }

  it("la lectura responde ok con la foto de ANTES (1 000,00), cuadra, y la siguiente ya ve el cierre (1 450,00)", async () => {
    await conCandado459(prisma, async () => {
      let p: Personas459 | null = null;
      try {
        p = await sembrarPersonas459(prisma);
        await acreditar459(prisma, p.tiendaId, "1000.00");
        const disparos = { n: 0 };
        const servicio = new EstadoCuentaService(
          repoConCierreEnMedio(p, disparos),
          new RechazoTiendaCobroAnulacionRepository(prisma),
        );
        const input = { cuenta: { tipo: "tienda" as const, id: p.tiendaId }, page: 1, pageSize: 20 };

        const r = await servicio.leer(input, p.maestro);
        // No-vacuidad: la escritura concurrente se hizo DE VERDAD, en medio de la lectura.
        expect(disparos.n).toBe(1);
        expect(await prisma.walletTiendaMovimiento.count({ where: { tiendaId: p.tiendaId } })).toBe(3);
        if (r.status !== "ok") throw new Error(`se esperaba ok y llego ${JSON.stringify(r)}`);
        expect(r.estado.saldoActual).toBe("1000.00");
        expect(r.estado.saldoFinal).toBe("1000.00");
        expect(r.estado.total).toBe(1);

        const despues = await servicio.leer(input, p.maestro);
        if (despues.status !== "ok") throw new Error(`se esperaba ok y llego ${JSON.stringify(despues)}`);
        expect(despues.estado.saldoActual).toBe("1450.00");
        expect(despues.estado.saldoFinal).toBe("1450.00");
        expect(despues.estado.total).toBe(3);
      } finally {
        await limpiar459(prisma, p);
      }
    });
  }, 120_000);
});
