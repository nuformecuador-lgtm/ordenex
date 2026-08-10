import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import { ESTATUS_CON_BUCKET_EXPLICITO, estatusDelBucket } from "@/lib/types/tablero-dia";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 192 (B2.3 / B8.6) — R10, R36, R37, R39, R46, R58, R59, R64, R65.
//
// Este archivo mide EL SQL QUE EL REPOSITORIO EMITE, no un SQL escrito a mano en el test:
// espia la llamada real a `$queryRaw` y reconstruye el `Prisma.Sql` con sus parametros. Un
// test que escribiera la consulta demostraria que una consulta inventada cumple los
// requisitos, no que los cumpla la que corre en produccion.

const VENTANA = ventanaDelDiaEnCursoCR(new Date("2026-08-08T19:00:00.000Z"));
const ZONA = "11111111-1111-4111-8111-111111111111";

interface Espia {
  readonly prisma: Pick<PrismaClient, "$queryRaw">;
  readonly consultas: Prisma.Sql[];
}

function espiar(filas: readonly unknown[] = []): Espia {
  const consultas: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: (strings: TemplateStringsArray, ...valores: unknown[]) => {
      consultas.push(Prisma.sql(strings, ...valores));
      return Promise.resolve([...filas]);
    },
  };
  return { prisma: prisma as unknown as Pick<PrismaClient, "$queryRaw">, consultas };
}

/** El texto de la consulta con los parametros ya sustituidos por `$1`, `$2`, ... */
function texto(sql: Prisma.Sql): string {
  return sql.text;
}

describe("TableroDiaRepository.contarPorMensajero — el SQL", () => {
  it("resuelve TODO el tablero en UNA sola llamada a $queryRaw (R36/R64)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });
    expect(consultas).toHaveLength(1);
  });

  it("filtra por mensajero asignado y por RANGO de asignado_at: el prefijo del indice ya existente (R37)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });

    const sql = texto(consultas[0]);
    expect(sql).toMatch(/"mensajero_asignado_id"\s+IS NOT NULL/);
    expect(sql).toMatch(/"asignado_at"\s*>=\s*\$\d+/);
    expect(sql).toMatch(/"asignado_at"\s*<\s*\$\d+/);
    expect(consultas[0].values).toContain(VENTANA.desde);
    expect(consultas[0].values).toContain(VENTANA.hasta);
  });

  it("con alcance ZONA escribe el recorte en el WHERE y el zonaId viaja como PARAMETRO (R10)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, {
      tipo: "zona",
      zonaId: ZONA,
    });

    const sql = texto(consultas[0]);
    expect(sql).toMatch(/o\."zona_id"\s*=\s*\$\d+/);
    // El id NUNCA interpolado en la cadena: si apareciera, seria inyeccion por construccion.
    expect(sql).not.toContain(ZONA);
    expect(consultas[0].values).toContain(ZONA);
  });

  it("con alcance GLOBAL no aparece ningun fragmento de zona", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });
    expect(texto(consultas[0])).not.toContain('o."zona_id"');
  });

  it("aplica el recorte multi-tenant UNA vez y DESPUES de la union, sobre la orden (R6/R10)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, {
      tipo: "zona",
      zonaId: ZONA,
    });

    const sql = texto(consultas[0]);
    // Una sola aparicion: si el recorte estuviera dentro de cada CTE, un camino podria
    // olvidarselo. Y nunca sobre la zona del USUARIO mensajero (`u."zona_id"`).
    expect(sql.match(/"zona_id"/g)).toHaveLength(1);
    expect(sql).not.toMatch(/u\."zona_id"/);
    expect(sql.indexOf('o."zona_id"')).toBeGreaterThan(sql.indexOf("ids_del_dia AS"));
  });

  it("une los dos caminos con UNION (de conjuntos) y NUNCA con UNION ALL (R58)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });

    const sql = texto(consultas[0]);
    expect(sql).toMatch(/\bUNION\b/);
    expect(sql).not.toMatch(/\bUNION\s+ALL\b/);
  });

  it("acota el historial por origen_tipo Y por la ventana del dia en el mismo WHERE (R65)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });

    const sql = texto(consultas[0]);
    const recoleccion = sql.slice(
      sql.indexOf("ids_recoleccion AS"),
      sql.indexOf("ids_del_dia AS"),
    );
    expect(recoleccion).toMatch(/"origen_tipo"\s*=\s*\$\d+/);
    expect(recoleccion).toMatch(/"created_at"\s*>=\s*\$\d+/);
    expect(recoleccion).toMatch(/"created_at"\s*<\s*\$\d+/);
    expect(consultas[0].values).toContain("asignacion_recoleccion");
  });

  it("el historial NO aporta el mensajero: ids_recoleccion no toca actor_usuario_id (R60)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });
    expect(texto(consultas[0])).not.toContain("actor_usuario_id");
  });

  it("las listas de estatus viajan como PARAMETROS derivadas del mapa, no como literales (R46)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });

    const sql = texto(consultas[0]);
    const valores = consultas[0].values;
    for (const value of ESTATUS_CON_BUCKET_EXPLICITO) {
      expect(sql).not.toContain(`'${value}'`);
      expect(valores).toContain(value);
    }
    for (const value of estatusDelBucket("sinRecoger")) expect(valores).toContain(value);
    for (const value of estatusDelBucket("enReparto")) expect(valores).toContain(value);
  });

  it("es SOLO LECTURA: ni un UPDATE, INSERT o DELETE sobre asignado_at (R59)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, { tipo: "global" });

    const sql = texto(consultas[0]).toUpperCase();
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|MERGE)\b/);
  });

  it("devuelve una fila por mensajero y convierte los COUNT (bigint) a number (R39)", async () => {
    const { prisma } = espiar([
      {
        mensajero_id: "m1",
        mensajero_nombre: "Juan Perez",
        asignadas: BigInt(8),
        entregadas: BigInt(3),
        reprogramadas: BigInt(1),
        devueltas: BigInt(0),
        rechazadas: BigInt(0),
        incidentes: BigInt(0),
        sin_recoger: BigInt(2),
        en_reparto: BigInt(1),
        otros: BigInt(1),
      },
    ]);

    const filas = await new TableroDiaRepository(prisma).contarPorMensajero(VENTANA, {
      tipo: "global",
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual({
      mensajeroId: "m1",
      mensajeroNombre: "Juan Perez",
      asignadas: 8,
      entregadas: 3,
      reprogramadas: 1,
      devueltas: 0,
      rechazadas: 0,
      incidentes: 0,
      sinRecoger: 2,
      enReparto: 1,
      otros: 1,
    });
    // Un BigInt cruzando la frontera RSC revienta la Server Action: se comprueba el TIPO.
    for (const valor of Object.values(filas[0])) {
      expect(typeof valor).not.toBe("bigint");
    }
    expect(filas[0].asignadas).toBe(
      filas[0].entregadas +
        filas[0].reprogramadas +
        filas[0].devueltas +
        filas[0].rechazadas +
        filas[0].incidentes +
        filas[0].sinRecoger +
        filas[0].enReparto +
        filas[0].otros,
    );
  });
});
