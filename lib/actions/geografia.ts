"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// Catalogo geografico global (provincia -> canton -> distrito) para la gestion
// de zonas dentro de Tarifas. Solo lectura. Se sirve el arbol completo en una
// sola query para que el cliente lo navegue en un accordion sin round-trips.

export interface DistritoArbolDTO {
  id: string;
  nombre: string;
  /** Zona a la que ya pertenece el distrito (N:M via zona_distrito), o null. */
  zonaId: string | null;
  zonaNombre: string | null;
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
        };
      }),
    })),
  }));

  return { status: "ok", provincias: arbol };
}
