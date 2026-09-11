import { describe, it, expect } from "vitest";

import {
  prepararConteoEntregas,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import { CohorteCargaRepository } from "@/lib/repositories/CohorteCargaRepository";

// Ficha 411 / T5.3 — UNA sola consulta por lectura (R38).
//
// EL MODO DE FALLO QUE ESTO CIERRA: una consulta POR DIA del rango. Es la forma natural de
// escribirlo si uno piensa la tabla fila a fila, no se ve en pantalla —los numeros salen bien— y
// con el tope de 366 dias significa hasta 366 viajes a la base por cada pintado, multiplicados
// por cada combinacion de filtro y por cada usuario que abra la analitica.
//
// El espia cuenta las llamadas a `$queryRaw` del cliente que el repositorio recibe. Es lo unico
// que hace falta: el cliente esta tipado como `Pick<PrismaClient, "$queryRaw">`, asi que no hay
// otra puerta a la base.

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function consultaDe(raw: object): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol: "maestro" } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

/** Cliente de mentira que solo cuenta: devuelve una fila cualquiera con la forma esperada. */
function prismaEspia() {
  const llamadas: string[] = [];
  const prisma = {
    $queryRaw: (trozos: TemplateStringsArray, ...valores: unknown[]) => {
      llamadas.push(trozos.join("?"));
      void valores;
      return Promise.resolve([{ dia: "2026-08-16", desenlace: "viva", n: 1, seg: null }]);
    },
  };
  return { prisma, llamadas };
}

describe("R38 · la cohorte se resuelve en UNA consulta, no una por dia", () => {
  const casos: [string, object][] = [
    ["un solo dia", { rango: "personalizado", desde: "2026-08-16", hasta: "2026-08-16" }],
    ["una semana", { rango: "personalizado", desde: "2026-08-10", hasta: "2026-08-16" }],
    ["un mes", { rango: "personalizado", desde: "2026-07-17", hasta: "2026-08-16" }],
    ["el tope de 366 dias", { rango: "personalizado", desde: "2025-08-17", hasta: "2026-08-16" }],
    ["un preset", { rango: "semana" }],
    [
      "con las seis facetas puestas",
      {
        rango: "personalizado",
        desde: "2026-08-10",
        hasta: "2026-08-16",
        zona_id: ["z1", "z2"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
        mensajero_id: ["m1"],
      },
    ],
  ];

  it.each(casos)("con %s hace exactamente una llamada a `$queryRaw`", async (_nombre, raw) => {
    const { prisma, llamadas } = prismaEspia();

    await new CohorteCargaRepository(prisma as never).contarCohortes(consultaDe(raw));

    expect(llamadas).toHaveLength(1);
  });

  it("y esa unica consulta trae la agrupacion por dia dentro, no fuera", async () => {
    // Anti-vacio del caso anterior: una sola llamada que no agrupara nada dejaria el troceo en
    // memoria, que es la otra mitad del mismo error.
    const { prisma, llamadas } = prismaEspia();

    await new CohorteCargaRepository(prisma as never).contarCohortes(
      consultaDe({ rango: "personalizado", desde: "2026-08-10", hasta: "2026-08-16" }),
    );

    expect(llamadas[0]).toContain("GROUP BY 1, 2");
    expect(llamadas[0]).toContain("ORDER BY 1 DESC, 2 ASC");
  });

  it("dos lecturas seguidas son dos consultas, no una cacheada por accidente", async () => {
    // El repositorio no cachea: eso es del servicio. Si aqui hubiera memoria, el `lastSync` y la
    // invalidacion por tag dejarian de significar nada.
    const { prisma, llamadas } = prismaEspia();
    const repo = new CohorteCargaRepository(prisma as never);
    const consulta = consultaDe({ rango: "personalizado", desde: "2026-08-10", hasta: "2026-08-16" });

    await repo.contarCohortes(consulta);
    await repo.contarCohortes(consulta);

    expect(llamadas).toHaveLength(2);
  });
});
