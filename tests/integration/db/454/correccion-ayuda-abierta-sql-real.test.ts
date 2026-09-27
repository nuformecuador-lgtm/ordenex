import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { rolAdmiteCorreccion } from "@/lib/types/correccion-datos-cliente";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (R64, fase 2) — LA TIENDA SIGUE PUDIENDO CORREGIR LOS DATOS DEL CLIENTE EN LA AYUDA.
 *
 * P2 de la 312 (2026-08-28) abrio la correccion del `adminTienda` a los DOS grupos de `/novedades`,
 * expresada como «el estado pertenece a un grupo» (`grupoDeEstatus`). Con la 454 la ayuda deja de
 * ser el estado `ayuda_tienda`: la orden con ayuda abierta esta `en_reparto`, y el estado ya no la
 * distingue. Sin este arreglo la tienda PERDIA la correccion en la pestaña de ayuda (R64: ningun rol
 * gana ni pierde acceso), en silencio: el test unitario del servicio seguia verde porque su doble
 * todavia decia `ayuda_tienda`.
 *
 * Aqui se mide contra Postgres real y la derivacion real (`ayuda-abierta.ts`), por el repositorio
 * real (`findParaCorreccion`):
 *   C1 ayuda abierta                 -> `ayudaAbierta: true`  -> la tienda corrige
 *   C2 en reparto sin ayuda          -> `ayudaAbierta: false` -> la tienda NO corrige (como hoy)
 *   C3 ayuda recuperada («Recuperar») -> `ayudaAbierta: false` -> la tienda NO corrige
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/R64 — la correccion del adminTienda sobre una ayuda abierta (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const c1 = await e.sembrarOrden({ estatus: "en_reparto" });
      const c2 = await e.sembrarOrden({ estatus: "en_reparto" });
      const c3 = await e.sembrarOrden({ estatus: "en_reparto" });
      const pedidas = [
        (await e.pedirAyuda(c1.ordenId)).status,
        (await e.pedirAyuda(c3.ordenId)).status,
      ];
      const recuperada = (await e.recuperar(c3.ordenId)).status;

      const leer = async (ordenId: string) => {
        const fila = await e.s.ordenRepo.findParaCorreccion(ordenId);
        if (fila === null) throw new Error(`precondicion: ${ordenId} no se leyo`);
        return {
          estatus: fila.estatusValue,
          ayudaAbierta: fila.ayudaAbierta,
          tienda: rolAdmiteCorreccion("adminTienda", fila.estatusValue, fila.ayudaAbierta),
        };
      };
      return {
        pedidas,
        recuperada,
        c1: await leer(c1.ordenId),
        c2: await leer(c2.ordenId),
        c3: await leer(c3.ordenId),
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("precondiciones: las dos ayudas se pidieron y la tercera se recupero", () => {
    expect(r.pedidas).toEqual(["ok", "ok"]);
    expect(r.recuperada).toBe("ok");
  });

  it("C1: con la ayuda abierta la orden sigue `en_reparto` y la tienda PUEDE corregir", () => {
    expect(r.c1).toEqual({ estatus: "en_reparto", ayudaAbierta: true, tienda: true });
  });

  it("C2: en reparto sin ayuda, la tienda NO puede (fuera de los dos grupos, como hoy)", () => {
    expect(r.c2).toEqual({ estatus: "en_reparto", ayudaAbierta: false, tienda: false });
  });

  it("C3: con la ayuda ya recuperada, tampoco", () => {
    expect(r.c3).toEqual({ estatus: "en_reparto", ayudaAbierta: false, tienda: false });
  });
});
