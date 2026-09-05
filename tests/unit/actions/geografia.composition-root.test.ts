import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IVehiculoService";

// FICHA 374 / D3 — EL COMPOSITION ROOT, EJERCITADO DE VERDAD.
//
// ⚠️ QUE FALLO CONCRETO CIERRA ESTE ARCHIVO. `GeografiaService` recibe DOS repositorios: el del
// catalogo y el de ORDENES, este ultimo solo para el conteo de la confirmacion (R60). El unico
// sitio del sistema que se los pasa es el `buildGeografiaService()` de la Server Action. Un
// `buildGeografiaService()` que se quedara con un solo argumento COMPILA IGUAL en cuanto alguien
// marque el parametro como opcional, pasa todos los tests de servicio —que inyectan sus propios
// dobles— y revienta EN PRODUCCION, en la primera confirmacion de desactivar. Este repo ya midio
// esa familia: «2 de 7 notificadores muertos con la suite verde». Comprobar que el modulo IMPORTA
// el repositorio NO BASTA: hay que comprobar que alguien lo PASA.
//
// COMO SE COMPRUEBA. Se mockea `getPrismaClient` con un cliente falso que responde `orden.count`,
// se llama a la accion REAL sin `deps.geografiaService` —de modo que se construye por el root de
// verdad— y se exige el numero. Si el repositorio de ordenes llegara `undefined`, esta llamada
// lanzaria en vez de devolver el conteo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const ordenCount = vi.fn(async (_args: { where: Record<string, unknown> }) => 7);
const provinciaFindMany = vi.fn(async () => [
  { id: "p1", nombre: "Puntarenas", activo: true, cantones: [] },
]);

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => ({
    orden: { count: ordenCount },
    provincia: { findMany: provinciaFindMany },
    canton: {},
    distrito: {},
  }),
  PRISMA_OMIT: {},
}));

const { contarOrdenesSinEntregarDeNodo, listarArbolGeografico } = await import(
  "@/lib/actions/geografia"
);

describe("374/D3 — el composition root PASA el repositorio de ordenes, no solo lo importa", () => {
  it("la accion real, sin `deps.geografiaService`, devuelve el conteo", async () => {
    const r = await contarOrdenesSinEntregarDeNodo(
      { nivel: "distrito", id: "d-1" },
      { getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "ok", ordenes: 7 });
    // Anti-vacuidad: el repositorio de ordenes se USO de verdad. Sin esto, un `0` devuelto por un
    // camino que nunca consulta pasaria por bueno.
    expect(ordenCount).toHaveBeenCalledTimes(1);
  });

  it("el conteo llega al `where` por la columna CONGELADA del nivel, y con el criterio de vivas", async () => {
    ordenCount.mockClear();
    await contarOrdenesSinEntregarDeNodo(
      { nivel: "canton", id: "c-1" },
      { getActor: async () => MAESTRO },
    );
    const arg = ordenCount.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cantonId: "c-1", deletedAt: null });
    expect(arg.where.provinciaId).toBeUndefined();
    expect(arg.where.distritoId).toBeUndefined();
  });

  it("el mismo root sirve la lectura del arbol: `listarArbolGeografico` sin deps funciona", async () => {
    // La otra mitad del cableado: el PRIMER argumento del constructor tambien tiene que llegar.
    const r = await listarArbolGeografico({ getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    expect(provinciaFindMany).toHaveBeenCalled();
  });
});
