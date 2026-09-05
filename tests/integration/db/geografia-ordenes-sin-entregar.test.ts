import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 374 (R60/R61) — **CUANTAS ORDENES SIN ENTREGAR CUELGAN DE UN NODO.** Contra Postgres.
 *
 * PARA QUE SIRVE ESTE NUMERO: retirar un distrito con 40 ordenes en reparto y retirar uno con cero
 * no son el mismo acto, y hoy quien pulsa no puede distinguirlos. La confirmacion lo dice antes de
 * que el maestro confirme.
 *
 * ⚠️ POR QUE CONTRA POSTGRES. Es un `WHERE` entero —la columna del nivel, `deleted_at IS NULL` y
 * `estatus NOT IN (terminales)`—, y en este repo esta medido cuatro veces que una mutacion del
 * `WHERE` pasa en verde con dobles.
 *
 * EL CASO QUE MAS IMPORTA, y no es obvio: `orden.distrito_id` es el UNICO NULLABLE de la terna. Una
 * orden sin distrito CUENTA al desactivar su canton y NO cuenta al desactivar un distrito — que es
 * exactamente lo correcto, y sale gratis por contar por la columna congelada en vez de enumerando
 * descendientes.
 *
 * SIN `DATABASE_URL` se SALTA. CON base pero sin las FK que necesita, REVIENTA CON MENSAJE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f374o${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Un estado VIVO (no terminal) con el que sembrar las ordenes que si cuentan. */
const ESTADO_VIVO = "en_reparto";

interface Sembrado {
  provincia: string;
  canton: string;
  distrito: string;
  /** Otro distrito del MISMO canton, para separar los dos niveles. */
  distritoHermano: string;
}

describeSiHayBase("374/R61 — el conteo de ordenes sin entregar (Postgres real)", () => {
  let prisma: PrismaClient;
  let tiendaId: string;
  let zonaId: string;
  let estatusPorValor: Map<string, string>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const fila = await prisma.orden.findFirst({ select: { tiendaId: true, zonaId: true } });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero `orden` esta vacia: sin una fila de la que tomar `tienda_id` y " +
          "`zona_id` no se puede sembrar el corpus. Este archivo NO debe pasar en verde asi.",
      );
    }
    tiendaId = fila.tiendaId;
    zonaId = fila.zonaId;

    const estatus = await prisma.orderStatus.findMany({ select: { id: true, value: true } });
    estatusPorValor = new Map(estatus.map((e) => [e.value, e.id]));
    for (const valor of [ESTADO_VIVO, ...ESTADOS_TERMINALES]) {
      if (!estatusPorValor.has(valor)) {
        throw new Error(
          `hay DATABASE_URL pero falta el estatus \`${valor}\` en \`order_status\`: sin el no se ` +
            "puede sembrar el caso que decide si cuenta o no.",
        );
      }
    }
  });

  async function conCorpus<T>(
    fn: (ctx: {
      s: Sembrado;
      ordenes: OrdenRepository;
      crearOrden: (opciones: {
        estatus: string;
        distritoId?: string | null;
        borrada?: boolean;
      }) => Promise<string>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const provincia = (
        await tx.provincia.create({ data: { nombre: `Prov cnt ${SUFIJO}` }, select: { id: true } })
      ).id;
      const canton = (
        await tx.canton.create({
          data: { nombre: `Canton cnt ${SUFIJO}`, provinciaId: provincia },
          select: { id: true },
        })
      ).id;
      const distrito = (
        await tx.distrito.create({
          data: { nombre: `Distrito cnt ${SUFIJO}`, cantonId: canton },
          select: { id: true },
        })
      ).id;
      const distritoHermano = (
        await tx.distrito.create({
          data: { nombre: `Distrito hermano ${SUFIJO}`, cantonId: canton },
          select: { id: true },
        })
      ).id;

      let n = 0;
      const crearOrden = async (opciones: {
        estatus: string;
        distritoId?: string | null;
        borrada?: boolean;
      }): Promise<string> => {
        n += 1;
        const fila = await tx.orden.create({
          data: {
            numRemision: `REM-${SUFIJO}-${n}`,
            estatusId: estatusPorValor.get(opciones.estatus) as string,
            destinatario: `Destinatario ${SUFIJO}`,
            telefonoDest: "88881111",
            tiendaId,
            zonaId,
            provinciaId: provincia,
            cantonId: canton,
            distritoId: opciones.distritoId === undefined ? distrito : opciones.distritoId,
            producto: `Producto ${SUFIJO}`,
            ...(opciones.borrada === true ? { deletedAt: new Date() } : {}),
          },
          select: { id: true },
        });
        return fila.id;
      };

      return fn({
        s: { provincia, canton, distrito, distritoHermano },
        ordenes: new OrdenRepository(tx as unknown as PrismaClient),
        crearOrden,
      });
    });
  }

  // ===============================================================================================
  // R61 — que cuenta y que no
  // ===============================================================================================

  describe("374/R61 — «sin entregar» = no borrada Y no terminal", () => {
    it("una orden `en_reparto` CUENTA", async () => {
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(0);
        await crearOrden({ estatus: ESTADO_VIVO });
        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(1);
      });
    });

    it.each([...ESTADOS_TERMINALES])("una orden `%s` NO cuenta", async (terminal) => {
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        await crearOrden({ estatus: terminal });
        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(0);
      });
    });

    it("⭑ una orden BORRADA no cuenta, aunque su estado sea vivo", async () => {
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        await crearOrden({ estatus: ESTADO_VIVO, borrada: true });
        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(0);
      });
    });

    it("las cuatro juntas: solo la viva y no borrada cuenta", async () => {
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        await crearOrden({ estatus: ESTADO_VIVO });
        await crearOrden({ estatus: ESTADO_VIVO, borrada: true });
        for (const terminal of ESTADOS_TERMINALES) await crearOrden({ estatus: terminal });
        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(1);
      });
    });
  });

  // ===============================================================================================
  // El nivel elige la columna CONGELADA de la orden
  // ===============================================================================================

  describe("374/R60 — el nivel elige la columna congelada, no los descendientes", () => {
    it("⭑ una orden SIN `distrito_id` cuenta para su CANTON y no para ningun distrito", async () => {
      // `distrito_id` es el unico nullable de la terna. Contar por la columna del nivel lo resuelve
      // solo; enumerar los distritos descendientes la habria perdido.
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        await crearOrden({ estatus: ESTADO_VIVO, distritoId: null });

        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(0);
        expect(
          await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distritoHermano),
        ).toBe(0);
        expect(await ordenes.contarSinEntregarPorNodoGeografico("canton", s.canton)).toBe(1);
        expect(await ordenes.contarSinEntregarPorNodoGeografico("provincia", s.provincia)).toBe(1);
      });
    });

    it("el canton suma las de sus dos distritos, y cada distrito solo las suyas", async () => {
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        await crearOrden({ estatus: ESTADO_VIVO, distritoId: s.distrito });
        await crearOrden({ estatus: ESTADO_VIVO, distritoId: s.distrito });
        await crearOrden({ estatus: ESTADO_VIVO, distritoId: s.distritoHermano });

        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(2);
        expect(
          await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distritoHermano),
        ).toBe(1);
        expect(await ordenes.contarSinEntregarPorNodoGeografico("canton", s.canton)).toBe(3);
        expect(await ordenes.contarSinEntregarPorNodoGeografico("provincia", s.provincia)).toBe(3);
      });
    });

    it("un nodo INEXISTENTE cuenta cero, no lanza: el numero informa, no condiciona", async () => {
      await conCorpus(async ({ ordenes }) => {
        expect(
          await ordenes.contarSinEntregarPorNodoGeografico(
            "distrito",
            "00000000-0000-0000-0000-000000000000",
          ),
        ).toBe(0);
      });
    });

    it("el estado del nodo NO influye: un distrito RETIRADO sigue contando sus ordenes vivas", async () => {
      // Es lo que la confirmacion necesita: se pregunta ANTES de retirar, y despues sigue siendo
      // cierto. Si el conteo mirase la disponibilidad, diria cero justo cuando mas importa.
      await conCorpus(async ({ s, ordenes, crearOrden }) => {
        await crearOrden({ estatus: ESTADO_VIVO });
        expect(await ordenes.contarSinEntregarPorNodoGeografico("distrito", s.distrito)).toBe(1);
      });
    });
  });
});
