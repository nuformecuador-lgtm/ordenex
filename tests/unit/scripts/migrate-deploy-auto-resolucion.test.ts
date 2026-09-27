import { describe, expect, it } from "vitest";

import {
  decidirAutoResolucion,
  MIGRACIONES_AUTO_RESOLUBLES,
} from "@/scripts/migrate-deploy-guardas";

/**
 * FICHA 432 — la decision de tocar `_prisma_migrations`, probada sobre texto real.
 *
 * Lo que se protege aqui NO es que el desatasco funcione: es que NO se dispare cuando no debe.
 * Auto-resolver un P3009 cualquiera convertiria el paso de despliegue en una maquina de
 * enmascarar fallos: una migracion que falle por un dato corrupto quedaria marcada como
 * revertida y el build seguiria en verde.
 */

/** La salida REAL del build caido el 2026-09-16, recortada. No inventada. */
const SALIDA_DEL_INCIDENTE = `
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from db/schema.prisma.
Error: P3009

migrate found failed migrations in the target database, new migrations will not be applied.
Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve
The \`20260918120200_zona_sinpe_no_nulo\` migration started at 2026-09-16 02:33:54.040711 UTC failed
`;

describe("432 — decidirAutoResolucion", () => {
  it("⭑ desatasca el incidente real: P3009 sobre la migracion de la 429", () => {
    const decision = decidirAutoResolucion(SALIDA_DEL_INCIDENTE);
    expect(decision.resolver).toBe(true);
    if (!decision.resolver) throw new Error("inalcanzable: el expect de arriba ya fallo");
    expect(decision.migracion).toBe("20260918120200_zona_sinpe_no_nulo");
  });

  it("⭑ NO toca nada si el fallo no es P3009, aunque nombre a la migracion de la lista", () => {
    // El caso que hace peligrosa una deteccion por nombre a secas: la migracion aparece en la
    // salida porque es la que se estaba aplicando cuando reventó por OTRA cosa.
    const otroFallo = `
      Applying migration \`20260918120200_zona_sinpe_no_nulo\`
      Error: P3018 — A migration failed to apply.
      Database error: syntax error at or near "ADD"
    `;
    const decision = decidirAutoResolucion(otroFallo);
    expect(decision.resolver).toBe(false);
    if (decision.resolver) throw new Error("inalcanzable");
    expect(decision.motivo).toMatch(/no es P3009/i);
  });

  it("⭑ NO toca nada si es P3009 pero de OTRA migracion: ahi el fallo es real", () => {
    const ajena = `
      Error: P3009
      The \`20260814120000_ruta_optimizada_trazado\` migration started at 2026-09-16 failed
    `;
    const decision = decidirAutoResolucion(ajena);
    expect(decision.resolver).toBe(false);
    if (decision.resolver) throw new Error("inalcanzable");
    expect(decision.motivo).toMatch(/lista blanca/i);
  });

  it("no se dispara con una salida vacia ni con un exito", () => {
    expect(decidirAutoResolucion("").resolver).toBe(false);
    expect(
      decidirAutoResolucion("No pending migrations to apply.").resolver,
    ).toBe(false);
  });

  it("⭑ la lista blanca tiene UNA entrada, y es deliberado", () => {
    // Si alguien añade una segunda sin pensarlo, este caso lo obliga a pasar por aqui y a
    // leer por que esta lista existe. No es una lista de configuracion: es la salida de un
    // incidente concreto, y caduca cuando las tres bases esten al dia.
    expect(MIGRACIONES_AUTO_RESOLUBLES).toEqual(["20260918120200_zona_sinpe_no_nulo"]);
  });

  it("anti-vacuidad: la salida del incidente contiene de verdad las dos senales", () => {
    // Sin esto, cambiar el fixture a un texto vacio dejaria el primer caso pasando por el
    // motivo equivocado.
    expect(SALIDA_DEL_INCIDENTE).toContain("P3009");
    expect(SALIDA_DEL_INCIDENTE).toContain("20260918120200_zona_sinpe_no_nulo");
  });
});
