// @vitest-environment jsdom
//
// FICHA 441 — DOS CIFRAS DISTINTAS NO PUEDEN COMPARTIR SUSTANTIVO EN LA MISMA FILA.
//
// ─── EL DEFECTO QUE ESTE ARCHIVO IMPIDE ─────────────────────────────────────────────────
//
// Sobre `/analitica` conviven TRES lecturas de «ya no está en curso», medidas al implementar la
// mitad de datos de esta ficha (`progress/impl_441.md` › «Deuda abierta»):
//
//   · el HÉROE cuenta las órdenes con DESENLACE DE GESTIÓN (entregada, rechazada, devuelta,
//     reprogramada, incidente) — 525 en el período del diseño;
//   · `CicloVidaKpi` cuenta las que llegaron a un estado TERMINAL, fechadas por su cierre — otra
//     población y otro número;
//   · `CohorteCargaTabla` cuenta terminales dentro de la cohorte de carga.
//
// Las tres son preguntas legítimas y **no se unifican a propósito**. Pero si las tres escriben
// «cerradas», la fila enseña «de las 525 que ya cerraron» y, tres centímetros más allá, «(300
// órdenes cerradas)» — dos totales que se leen como el mismo y que nadie puede reconciliar.
//
// ─── CÓMO SE MIDE ───────────────────────────────────────────────────────────────────────
//
// Se renderiza la FILA ENTERA con datos donde los dos números DIFIEREN a propósito, se extraen
// todos los pares «cifra + sustantivo» del texto pintado, y se exige que cada sustantivo apunte
// a UNA sola cifra. No se compara contra una lista escrita aquí: los sustantivos salen de
// `SUSTANTIVOS_DE_LA_FILA` (`base-del-kpi.ts`), así que uno nuevo entra vigilado solo.
//
// LA MUTACIÓN QUE TIENE QUE PONER EN ROJO: devolver `ORDENES_CON_DESENLACE` a «órdenes
// cerradas». Entonces ese sustantivo apunta a 525 Y a 300 y el caso cae.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";

import { AvisoPeriodoEnCurso } from "@/app/(app)/analitica/_components/entregas/AvisoPeriodoEnCurso";
import { SUSTANTIVOS_DE_LA_FILA } from "@/app/(app)/analitica/_components/entregas/base-del-kpi";
import { CicloVidaKpi } from "@/app/(app)/analitica/_components/entregas/CicloVidaKpi";
import { KpisEfectividad } from "@/app/(app)/analitica/_components/entregas/KpisEfectividad";
import { consultarCicloVida } from "@/lib/actions/ciclo-vida";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";

vi.mock("@/lib/actions/conteo-por-status", () => ({ consultarConteoPorStatus: vi.fn() }));
vi.mock("@/lib/actions/ciclo-vida", () => ({ consultarCicloVida: vi.fn() }));

const conteoMock = vi.mocked(consultarConteoPorStatus);
const cicloMock = vi.mocked(consultarCicloVida);

/**
 * El período del diseño: 790 cargadas, 424 entregadas, 525 con desenlace de gestión.
 *
 * ⚠ EL CICLO DE VIDA DEVUELVE 300 Y NO 525, y esa diferencia es el corazón del caso: con los dos
 * números iguales, un sustantivo compartido pasaría inadvertido y este archivo estaría siempre
 * verde. Los dos números difieren en producción por la misma razón que difieren aquí — cada
 * lectura cuenta otra cosa.
 */
const PERIODO_DEL_DISENO = [
  { status: "entregado", conteo: 424 },
  { status: "devolucion_a_origen_por_rechazo", conteo: 60 },
  { status: "novedad", conteo: 41 },
  { status: "en_reparto", conteo: 265 },
];

const CERRADAS_DEL_CICLO = 300;

function renderFila() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <div>
        <KpisEfectividad />
        <CicloVidaKpi />
        <AvisoPeriodoEnCurso />
      </div>
    </SWRConfig>,
  );
}

/** Todos los sustantivos contados de la fila, el más largo primero. */
function alternativaDeSustantivos(): string {
  return SUSTANTIVOS_DE_LA_FILA.flatMap((s) => [s.plural, s.singular])
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

/**
 * Los pares «cifra → sustantivo» que la fila pinta DE VERDAD.
 *
 * Se recorren los nodos de texto uno a uno y no el `textContent` del contenedor: concatenado, el
 * final de un elemento y el principio del siguiente forman parejas que nadie escribió.
 */
function paresPintados(raiz: HTMLElement): Map<string, Set<string>> {
  const patron = new RegExp(`(\\d[\\d .,]*?)\\s+(${alternativaDeSustantivos()})`, "g");
  const pares = new Map<string, Set<string>>();
  const paseo = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);

  for (let nodo = paseo.nextNode(); nodo !== null; nodo = paseo.nextNode()) {
    // `Intl` separa los miles con espacio duro; se normaliza para que «1 234» sea una sola cifra.
    const texto = (nodo.textContent ?? "").replace(/ /g, " ");
    for (const encontrado of texto.matchAll(patron)) {
      const cifra = encontrado[1].trim();
      const sustantivo = encontrado[2];
      const cifras = pares.get(sustantivo) ?? new Set<string>();
      cifras.add(cifra);
      pares.set(sustantivo, cifras);
    }
  }

  return pares;
}

beforeEach(() => {
  vi.clearAllMocks();
  conteoMock.mockResolvedValue({
    status: "ok",
    datos: {
      porStatus: PERIODO_DEL_DISENO,
      total: 790,
      lastSync: "2026-09-17T18:30:00.000Z",
    },
  } as never);
  cicloMock.mockResolvedValue({
    status: "ok",
    datos: { promedioSegundos: 1_237_680, n: CERRADAS_DEL_CICLO },
  } as never);
});

afterEach(cleanup);

describe("El vocabulario de la fila de KPIs", () => {
  it("ningún sustantivo aparece pegado a dos cifras distintas", async () => {
    const { container } = renderFila();
    await screen.findByText(/de 790 órdenes cargadas/);

    const pares = paresPintados(container);

    // Primero: que el caso NO sea vacío. Si el héroe dejara de escribir su base, el mapa se
    // quedaría corto y la comprobación de abajo pasaría sin haber medido nada.
    expect(pares.size).toBeGreaterThanOrEqual(3);

    for (const [sustantivo, cifras] of pares) {
      expect(
        [...cifras],
        `«${sustantivo}» se usa para ${[...cifras].join(" y ")}: dos cifras, un sustantivo`,
      ).toHaveLength(1);
    }
  });

  // El caso concreto que la ficha vino a arreglar, escrito con sus dos números: si alguien
  // unifica las palabras, aquí se ve exactamente qué se rompió.
  it("las dos definiciones de «cerrada» de la fila llevan sustantivos distintos", async () => {
    const { container } = renderFila();
    await screen.findByText(/de 790 órdenes cargadas/);

    const pares = paresPintados(container);

    // El héroe: 525 órdenes CON DESENLACE de gestión.
    expect([...(pares.get("órdenes con desenlace") ?? [])]).toEqual(["525"]);
    // El ciclo de vida: 300 órdenes CERRADAS, que es otra población.
    expect([...(pares.get("órdenes cerradas") ?? [])]).toEqual([String(CERRADAS_DEL_CICLO)]);
  });

  // Y las dos frases están en pantalla a la vez, que es lo que hace comparable el defecto: un
  // lector las lee de un vistazo, una encima de la otra.
  it("las dos frases conviven en la misma fila", async () => {
    renderFila();

    expect(await screen.findByText(/525 órdenes con desenlace terminaron entregadas/)).toBeInTheDocument();
    expect(screen.getByText(`Ciclo de vida promedio (${CERRADAS_DEL_CICLO} órdenes cerradas)`)).toBeInTheDocument();
  });
});
