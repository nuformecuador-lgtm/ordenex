import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { listarSaldosTiendasCompletoAction, listarSaldosTiendasPaginadoAction } from "@/lib/actions/wallet-tienda";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 463 / T4 (R45) — la busqueda por NOMBRE del listado «Saldos de tiendas», en el SERVIDOR.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Tres tiendas con movimientos y un prefijo aleatorio `T` en el nombre, en una transaccion revertida.
// El listado es GLOBAL (todas las tiendas de la base), asi que toda busqueda lleva `T`: el conjunto
// esperado es EXACTO. Se afirma que la busqueda acota la pagina, el total y la descarga, sin acentos
// ni mayusculas, y con `%` como texto.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Medida {
  T: string;
  paginas: Record<string, { nombres: string[]; total: number; page: number }>;
  completo: Record<string, { nombres: string[]; total: number } | string>;
  bordes: Record<string, string>;
}

describeSiHayBase("463/T4 — busqueda del listado de saldos de tiendas (Postgres real, R45)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const T = `t${randomUUID().replace(/-/g, "").slice(0, 7)}`;
        const tiendas = [`${T} Ferretería Ñandú`, `${T} Ferreteria Sol`, `${T} Panaderia`];
        for (const nombre of tiendas) {
          const u = await tx.usuario.create({
            data: {
              nombre,
              email: `t463-${randomUUID().slice(0, 8)}@example.test`,
              telefono: "88880000",
              passwordHash: "no-se-usa",
              cedula: `463-${randomUUID().slice(0, 12)}`,
              tipoIdentificacionId: cat.tipoIdentificacionId,
              rolId: cat.rolId.adminTienda,
              zonaId: null,
              estado: "activo",
              fulfillment: false,
            },
            select: { id: true },
          });
          await tx.walletTiendaMovimiento.create({
            data: {
              tiendaId: u.id,
              tipo: "credito",
              categoria: "cod_recaudado",
              monto: "1000.00",
              origenTipo: "cierre_dia",
              origenId: randomUUID(),
              descripcion: "463",
            },
          });
        }

        const service = new WalletTiendaService(new WalletTiendaMovimientoRepository(s.cliente));
        const maestro = { usuarioId: randomUUID(), rol: "maestro" as const };
        const deps = { getActor: async () => maestro, service };

        const paginas: Medida["paginas"] = {};
        const pagina = async (etiqueta: string, input: Record<string, unknown>) => {
          const r = await listarSaldosTiendasPaginadoAction(input, deps);
          if (r.status !== "ok") throw new Error(`${etiqueta}: ${JSON.stringify(r)}`);
          paginas[etiqueta] = { nombres: r.items.map((i) => i.tiendaNombre), total: r.total, page: r.page };
        };
        await pagina("todas", { busqueda: T, pageSize: 50 });
        await pagina("sinAcentosNiMayusculas", { busqueda: `  ${T.toUpperCase()} FERRETERIA nandu `, pageSize: 50 });
        await pagina("ferreterias", { busqueda: `${T} ferreteria`, pageSize: 50 });
        await pagina("porciento", { busqueda: `${T}%`, pageSize: 50 });
        await pagina("pagina2De1", { busqueda: T, page: 2, pageSize: 1 });

        const completo: Medida["completo"] = {};
        for (const [etiqueta, input] of [
          ["todas", { busqueda: T }],
          ["ferreterias", { busqueda: `${T} ferreteria` }],
        ] as const) {
          const r = await listarSaldosTiendasCompletoAction(input, deps);
          completo[etiqueta] = r.status === "ok" ? { nombres: r.items.map((i) => i.tiendaNombre), total: r.total } : r.status;
        }

        const bordes = {
          paginadoConTiendaId: (await listarSaldosTiendasPaginadoAction({ busqueda: T, tiendaId: randomUUID() }, deps)).status,
          completoConPagina: (await listarSaldosTiendasCompletoAction({ busqueda: T, page: 1 }, deps)).status,
          tiendaPide: (
            await listarSaldosTiendasPaginadoAction({ busqueda: T }, { ...deps, getActor: async () => ({ usuarioId: randomUUID(), rol: "adminTienda" as const }) })
          ).status,
        };
        return { T, paginas, completo, bordes };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R45: la busqueda acota la pagina y el total al conjunto que casa (ordenado por nombre)", () => {
    const { T, paginas } = m();
    expect(paginas.todas).toEqual({
      nombres: [`${T} Ferretería Ñandú`, `${T} Ferreteria Sol`, `${T} Panaderia`].sort((a, b) => a.localeCompare(b)),
      total: 3,
      page: 1,
    });
    expect(paginas.ferreterias.nombres).toHaveLength(2);
    expect(paginas.ferreterias.total).toBe(2);
  });

  it("R45: sin acentos, sin mayusculas y sin espacios de los bordes; `%` es texto", () => {
    const { T, paginas } = m();
    expect(paginas.sinAcentosNiMayusculas).toEqual({ nombres: [`${T} Ferretería Ñandú`], total: 1, page: 1 });
    expect(paginas.porciento).toEqual({ nombres: [], total: 0, page: 1 });
  });

  it("R45: el total es el del conjunto filtrado, no el de la pagina (pagina 2 de 1 fila)", () => {
    expect(m().paginas.pagina2De1.nombres).toHaveLength(1);
    expect(m().paginas.pagina2De1.total).toBe(3);
  });

  it("R45: el termino viaja a la descarga y el archivo trae EXACTAMENTE el conjunto de la tabla", () => {
    const { paginas, completo } = m();
    expect(completo.todas).toEqual({ nombres: paginas.todas.nombres, total: 3 });
    expect(completo.ferreterias).toEqual({ nombres: paginas.ferreterias.nombres, total: 2 });
  });

  it("el alcance sigue cerrado: `tiendaId` o `page` colados ⇒ validation_error; una tienda ⇒ forbidden", () => {
    expect(m().bordes).toEqual({
      paginadoConTiendaId: "validation_error",
      completoConPagina: "validation_error",
      tiendaPide: "forbidden",
    });
  });
});
