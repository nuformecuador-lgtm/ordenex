import { describe, it, expect, vi } from "vitest";

import { prepararConteoEntregas, type ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import {
  ConteoEntregasRepository,
  plegarEnDesenlaces,
} from "@/lib/repositories/ConteoEntregasRepository";
import { etiquetaDeDesenlace } from "@/app/(app)/analitica/_components/entregas/ConteoEntregasAnillo";
import { BUCKET_OTROS, DESENLACES } from "@/lib/types/conteo-entregas";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// El anillo es el PLIEGUE del desglose por status en seis buckets. Aquí vive esa única
// decisión, y se comprueba sin base de datos.
//
// ⚠ AQUÍ HABÍA OTRA COSA. Este archivo probaba `whereDeConsulta`, el `where` de Prisma que
// este repositorio construía cuando consultaba por su cuenta. Ese `where` desapareció el
// 2026-08-18: el repositorio delega en `ConteoPorStatusRepository`, así que el recorte —
// alcance, facetas, fecha efectiva— vive en UN solo sitio y lo cubre
// `conteo-por-status-sql.test.ts`. No se perdió cobertura: se dejó de duplicarla.

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function consultaDe(raw: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol: "maestro" }, AHORA);
  if (preparada.status !== "ok") throw new Error("filtro de prueba inválido");
  return preparada.consulta;
}

describe("Los cinco desenlaces son los del catálogo, no una lista escrita a mano", () => {
  // Los cinco nombres que pidió el humano son exactamente los valores de `GestionResultado`.
  // Y todos existen también en `ORDER_STATUS_SEED`, que es lo que permite que el pliegue
  // funcione con las dos mitades del `COALESCE` (gestión y estatus propio).
  it("los cinco existen en el catálogo de estatus", () => {
    expect(DESENLACES).toHaveLength(5);
    for (const desenlace of DESENLACES) {
      expect(ORDER_STATUS_SEED, desenlace).toContain(desenlace);
    }
  });

  it("son los que se pidieron, y en su orden", () => {
    expect(DESENLACES).toEqual([
      "entregada",
      "devuelta",
      "rechazada",
      "reprogramada",
      "incidente",
    ]);
  });
});

describe("El pliegue en seis buckets", () => {
  it("cada desenlace nombrado va a su bucket", () => {
    const plegado = plegarEnDesenlaces([
      { status: "entregada", conteo: 20 },
      { status: "devuelta", conteo: 5 },
      { status: "rechazada", conteo: 3 },
      { status: "reprogramada", conteo: 7 },
      { status: "incidente", conteo: 1 },
    ]);

    expect(plegado).toEqual({
      entregada: 20,
      devuelta: 5,
      rechazada: 3,
      reprogramada: 7,
      incidente: 1,
      [BUCKET_OTROS]: 0,
    });
  });

  // ⚠ EL CASO QUE JUSTIFICA TODO EL CAMBIO DE FUENTE. Una orden devuelta NO tiene
  // `orden.estatus = "devuelta"`: tiene `devolviendo_a_tienda` o `devuelta_a_tienda`. Si el
  // bucket saliera del estatus de la orden, «devueltas» daría cero y esas órdenes caerían en
  // «otros» — un gráfico plausible y falso.
  it("los estatus del flujo de devolución NO son el desenlace `devuelta`", () => {
    const plegado = plegarEnDesenlaces([
      { status: "devolviendo_a_tienda", conteo: 4 },
      { status: "devuelta_a_tienda", conteo: 6 },
    ]);

    expect(plegado.devuelta).toBe(0);
    expect(plegado[BUCKET_OTROS]).toBe(10);
  });

  // Sin lista negra: lo que no es uno de los cinco cae en «otros» por descarte. Un estatus
  // nuevo del catálogo entra ahí solo, en vez de desaparecer y descuadrar el total.
  it("TODO lo que no es un desenlace nombrado suma en «otros»", () => {
    const ajenos = ORDER_STATUS_SEED.filter((v) => !DESENLACES.includes(v));
    const plegado = plegarEnDesenlaces(ajenos.map((status) => ({ status, conteo: 1 })));

    expect(ajenos.length).toBeGreaterThan(0);
    expect(plegado[BUCKET_OTROS]).toBe(ajenos.length);
  });

  it("un estatus huérfano que no está en el catálogo también cae en «otros»", () => {
    expect(plegarEnDesenlaces([{ status: "estatus_fantasma", conteo: 9 }])[BUCKET_OTROS]).toBe(9);
  });

  // Los SEIS salen siempre. Un anillo al que le falta un segmento según el día se lee como si
  // esa categoría no existiera.
  it("con la entrada vacía devuelve los seis buckets en cero", () => {
    const plegado = plegarEnDesenlaces([]);

    expect(Object.keys(plegado).sort()).toEqual([...DESENLACES, BUCKET_OTROS].sort());
    expect(Object.values(plegado).every((n) => n === 0)).toBe(true);
  });

  // La mutación que este caso mata: sobrescribir en vez de acumular. Dos filas que caen en
  // «otros» tienen que sumarse, no quedarse con la última.
  it("acumula varias filas en el mismo bucket", () => {
    expect(plegarEnDesenlaces([
      { status: "en_reparto", conteo: 3 },
      { status: "sin_gestionar", conteo: 4 },
    ])[BUCKET_OTROS]).toBe(7);
  });

  // Nada se pierde por el camino: el total del anillo tiene que ser el mismo universo que el
  // del desglose por status, o los dos gráficos de la pantalla dejan de cuadrar.
  it("conserva la suma: el pliegue no pierde ni una orden", () => {
    const filas = [
      { status: "entregada", conteo: 20 },
      { status: "devuelta", conteo: 5 },
      { status: "en_reparto", conteo: 11 },
      { status: "sin_gestionar", conteo: 4 },
    ];
    const plegado = plegarEnDesenlaces(filas);

    const sumaEntrada = filas.reduce((s, f) => s + f.conteo, 0);
    const sumaSalida = Object.values(plegado).reduce((s, n) => s + n, 0);
    expect(sumaSalida).toBe(sumaEntrada);
  });
});

describe("El repositorio delega en el desglose por status", () => {
  // No consulta por su cuenta: pasa la MISMA consulta al repositorio del desglose. Es lo que
  // garantiza que los dos gráficos no puedan discrepar sobre cuántas entregadas hubo.
  it("pasa la consulta tal cual y pliega lo que recibe", async () => {
    const consulta = consultaDe({ zona_id: ["z1"] });
    const porStatus = {
      contarPorStatus: vi.fn().mockResolvedValue([
        { status: "entregada", conteo: 20 },
        { status: "devuelta_a_tienda", conteo: 6 },
      ]),
    };

    const resultado = await new ConteoEntregasRepository(porStatus).contar(consulta);

    expect(porStatus.contarPorStatus).toHaveBeenCalledWith(consulta);
    expect(resultado.porDesenlace).toMatchObject({ entregada: 20, [BUCKET_OTROS]: 6 });
  });
});

// La etiqueta de cada segmento. Se deriva del `value` del catálogo, sin tabla escrita a mano:
// `order_status` no tiene columna `label` y una tabla propia se desincronizaría en silencio
// el próximo renombre (ya pasó tres veces: features 135, 153 y 154).
describe("La etiqueta de un desenlace", () => {
  it("pone en plural y capitaliza los cinco desenlaces", () => {
    expect(etiquetaDeDesenlace("entregada")).toBe("Entregadas");
    expect(etiquetaDeDesenlace("devuelta")).toBe("Devueltas");
    expect(etiquetaDeDesenlace("rechazada")).toBe("Rechazadas");
    expect(etiquetaDeDesenlace("reprogramada")).toBe("Reprogramadas");
    expect(etiquetaDeDesenlace("incidente")).toBe("Incidentes");
  });

  // ⚠ El bucket «otros» YA está en plural. Sin la guarda salía «Otross» en la leyenda — y se
  // vio en un test, no en producción, que es exactamente para lo que están.
  it("no vuelve a pluralizar lo que ya termina en «s»", () => {
    expect(etiquetaDeDesenlace(BUCKET_OTROS)).toBe("Otros");
  });

  it("los seis segmentos del anillo tienen etiqueta y ninguna se repite", () => {
    const etiquetas = [...DESENLACES, BUCKET_OTROS].map(etiquetaDeDesenlace);

    expect(etiquetas).toHaveLength(6);
    expect(new Set(etiquetas).size).toBe(6);
  });
});
