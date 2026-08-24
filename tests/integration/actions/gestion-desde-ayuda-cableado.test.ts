import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";

/**
 * FEATURE 276 (T5, caso 3) — EL COMPOSITION ROOT **PASA** LA DEPENDENCIA DEL TOPE.
 *
 * ⚠️ POR QUE ESTE ARCHIVO EXISTE, y por que NO vale un `expect(fuente).toContain("historial")`.
 * En este repo ya pasó: dos notificadores quedaron MUERTOS con la suite entera en verde porque el
 * composition root los IMPORTABA y no los INYECTABA, y su default era un no-op. Aqui el default no
 * existe —`historial` es obligatoria en `GestionDesdeAyudaDeps`, asi que olvidarla rompe el
 * typecheck—, pero eso solo protege de la AUSENCIA del campo, no de que alguien lo cablee con un
 * doble vacio o con otro servicio. Lo que se comprueba aqui es lo unico que importa: se EJECUTA la
 * Server Action SIN inyectar servicio, y se mira QUE objeto construyo `buildService()`.
 *
 * Se mockea la clase del servicio para poder capturar sus `deps` en el constructor, y el cliente de
 * Prisma para no abrir ninguna conexion: lo que se mide es el CABLEADO, no la base.
 */

const depsCapturadas: Record<string, unknown>[] = [];

vi.mock("@/lib/db/prisma-client", () => ({
  // Los repositorios solo lo guardan en su constructor; ninguno consulta al construirse.
  getPrismaClient: () => ({}) as never,
  PRISMA_OMIT: { orden: { busquedaTexto: true } },
}));

vi.mock("@/lib/services/GestionDesdeAyudaService", async (importOriginal) => {
  const real = await importOriginal<
    typeof import("@/lib/services/GestionDesdeAyudaService")
  >();
  return {
    ...real,
    GestionDesdeAyudaService: class {
      constructor(deps: Record<string, unknown>) {
        depsCapturadas.push(deps);
      }
      async gestionar() {
        return { status: "ok" as const, ordenId: "o1", resultado: "rechazada" as const };
      }
    },
  };
});

const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };

function formData(): FormData {
  const fd = new FormData();
  fd.set("ordenId", "22222222-2222-4222-8222-222222222222");
  fd.set("resultado", "rechazada");
  fd.set("motivo", "el cliente no la quiere");
  fd.append("evidencia", new File([new Uint8Array([1])], "f0.jpg", { type: "image/jpeg" }));
  return fd;
}

describe("276/T5 · el composition root de `gestionarDesdeAyuda` cablea el tope", () => {
  it("ejecutada SIN inyectar servicio, el objeto construido trae `historial` cableado", async () => {
    const { gestionarDesdeAyuda } = await import("@/lib/actions/gestion-desde-ayuda");

    // SIN `deps.service`: la action tiene que pasar por `buildService()`.
    const r = await gestionarDesdeAyuda(formData(), { getActor: async () => TIENDA });

    expect(r.status).toBe("ok");
    expect(depsCapturadas).toHaveLength(1);
    const deps = depsCapturadas[0];

    // 1. El campo existe y no es `undefined` (un cableado olvidado con la dep marcada opcional
    //    habria llegado aqui como `undefined` sin romper nada).
    expect(deps.historial).toBeDefined();
    // 2. Es EL servicio de historial real, no un objeto cualquiera con un metodo. Eso es lo que
    //    garantiza que el numero que decide la puerta sea el MISMO criterio unico de la 215 que
    //    ven el panel del mensajero, el cron de SLA y el drawer.
    expect(deps.historial).toBeInstanceOf(OrdenHistorialService);
    // 3. Y expone el metodo que la puerta llama. Si alguien cableara un `Pick` recortado, o un
    //    doble de conveniencia, esto lo delata.
    expect(typeof (deps.historial as OrdenHistorialService).contarIntentos).toBe("function");

    // Los otros cuatro cables siguen ahi: este caso no puede quedarse verde porque el servicio se
    // construya "a medias".
    for (const clave of ["notaRepo", "ordenRepo", "gestionRepo", "storage"]) {
      expect(deps[clave], `falta el cable \`${clave}\``).toBeDefined();
    }
  });
});
