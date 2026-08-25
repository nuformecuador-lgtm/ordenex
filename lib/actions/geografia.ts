"use server";

import { z } from "zod";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// Catalogo geografico global (provincia -> canton -> distrito) para la gestion
// de zonas dentro de Tarifas. Se sirve el arbol completo en una sola query para
// que el cliente lo navegue en un accordion sin round-trips. La unica escritura
// es la marca `distrito.zona_especial` (al final del archivo); el catalogo en si
// es de solo lectura.

export interface DistritoArbolDTO {
  id: string;
  nombre: string;
  /** Zona a la que ya pertenece el distrito (N:M via zona_distrito), o null. */
  zonaId: string | null;
  zonaNombre: string | null;
  /**
   * Marca de zona especial. La columna es `BOOLEAN NULL` (null = nadie lo
   * decidio todavia), pero hacia la UI se normaliza a dos valores con la unica
   * lectura correcta: `zona_especial IS TRUE`. La marca es del DISTRITO, no de
   * la zona: si el distrito pertenece a varias zonas, la ven todas.
   */
  zonaEspecial: boolean;
}

export interface CantonArbolDTO {
  id: string;
  nombre: string;
  distritos: DistritoArbolDTO[];
}

export interface ProvinciaArbolDTO {
  id: string;
  nombre: string;
  cantones: CantonArbolDTO[];
}

export type ArbolGeograficoResult =
  | { status: "ok"; provincias: ProvinciaArbolDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

/**
 * Devuelve el arbol geografico completo ordenado alfabeticamente en cada nivel.
 * Autoriza solo al rol `maestro` (misma puerta que /configuracion). El distrito
 * expone su zona actual (primera relacion en zona_distrito) para que la UI marque
 * los ya asignados.
 */
export async function listarArbolGeografico(): Promise<ArbolGeograficoResult> {
  const actor = await resolveActorFromSession();
  if (!actor) return { status: "unauthenticated" };
  if (actor.rol !== "maestro") return { status: "forbidden" };

  const prisma = getPrismaClient();
  const provincias = await prisma.provincia.findMany({
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      cantones: {
        orderBy: { nombre: "asc" },
        select: {
          id: true,
          nombre: true,
          distritos: {
            orderBy: { nombre: "asc" },
            select: {
              id: true,
              nombre: true,
              zonaEspecial: true,
              zonas: {
                take: 1,
                select: { zona: { select: { id: true, nombre: true } } },
              },
            },
          },
        },
      },
    },
  });

  const arbol: ProvinciaArbolDTO[] = provincias.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    cantones: p.cantones.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      distritos: c.distritos.map((d) => {
        const zona = d.zonas[0]?.zona ?? null;
        return {
          id: d.id,
          nombre: d.nombre,
          zonaId: zona?.id ?? null,
          zonaNombre: zona?.nombre ?? null,
          // `=== true` y no `!!`: con `null` los dos dan false, pero esto deja
          // dicho que la columna es tri-valuada y que null NO es "no especial".
          zonaEspecial: d.zonaEspecial === true,
        };
      }),
    })),
  }));

  return { status: "ok", provincias: arbol };
}

// ── Marca de zona especial ─────────────────────────────────────────────────

const distritosEspecialesSchema = z.object({
  /** Distritos que pasan a `zona_especial = true`. */
  marcar: z.array(z.string().min(1)).default([]),
  /** Distritos que pasan a `zona_especial = false`. */
  desmarcar: z.array(z.string().min(1)).default([]),
});

export type ActualizarDistritosEspecialesResult =
  | { status: "ok"; actualizados: number }
  | { status: "validation_error" }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

/**
 * Escribe la marca `distrito.zona_especial` de un lote de distritos. Recibe el
 * DELTA (lo que cambio en el formulario), no el estado completo: asi dos zonas
 * abiertas a la vez no se pisan la marca de los distritos que ninguna toco.
 *
 * La marca es del distrito, de modo que al guardarla queda visible desde
 * CUALQUIER zona que lo contenga; el llamador refresca el arbol para verlo.
 * Misma puerta que el resto de /configuracion: solo `maestro`.
 */
export async function actualizarDistritosEspeciales(
  input: unknown,
): Promise<ActualizarDistritosEspecialesResult> {
  const actor = await resolveActorFromSession();
  if (!actor) return { status: "unauthenticated" };
  if (actor.rol !== "maestro") return { status: "forbidden" };

  const parsed = distritosEspecialesSchema.safeParse(input);
  if (!parsed.success) return { status: "validation_error" };

  const { marcar, desmarcar } = parsed.data;
  // Un id en las dos listas seria una orden contradictoria: se rechaza en vez
  // de dejar que gane la ultima escritura.
  const enAmbas = marcar.filter((id) => desmarcar.includes(id));
  if (enAmbas.length > 0) return { status: "validation_error" };
  if (marcar.length === 0 && desmarcar.length === 0) {
    return { status: "ok", actualizados: 0 };
  }

  const prisma = getPrismaClient();
  // Una sola transaccion: o quedan las dos mitades del cambio, o ninguna.
  const [on, off] = await prisma.$transaction([
    prisma.distrito.updateMany({
      where: { id: { in: marcar } },
      data: { zonaEspecial: true },
    }),
    prisma.distrito.updateMany({
      where: { id: { in: desmarcar } },
      data: { zonaEspecial: false },
    }),
  ]);

  return { status: "ok", actualizados: on.count + off.count };
}
