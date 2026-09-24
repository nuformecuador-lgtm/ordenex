// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { NOTA_AYUDA_SOLICITADA } from "@/components/shared/nota-pendiente-confirmacion";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";
import { ETIQUETA_CORRECCION_DIA } from "@/lib/utils/dia-reparto-textos";

// FICHA 454 (T2.3, R30) — la línea de tiempo pinta la CUARTA clase: los hechos sin transición
// (`orden_evento`). Se afirma:
//  - que las CUATRO clases se pintan juntas, cada una con su primera línea propia;
//  - que un hecho se lee por TEXTO («Gestión registrada», resultado con su nombre canónico, actor y
//    rol CONGELADO), sin flecha de estados: la orden no cambió de estado;
//  - la corrección («De Entregada a Rechazada») y la ida y vuelta de la ayuda;
//  - que el nombre del resultado sale del MISMO mapa que el chip de estado (no un literal propio).

afterEach(() => cleanup());

const L = ORDER_STATUS_LABELS;

const CUATRO: OrdenHistorialEntradaDTO[] = [
  {
    clase: "transicion",
    estatusOrigenValue: "mensajero_recogiendo_en_bodega",
    estatusDestinoValue: "en_reparto",
    origenTipo: "recoleccion",
    actorNombre: "Andy Cortes",
    motivo: null,
    createdAt: new Date("2026-09-23T08:00:00Z"),
  },
  {
    clase: "correccion_dia",
    fechaAnteriorISO: "2026-09-24",
    fechaNuevaISO: "2026-09-23",
    actorNombre: "Ana Perez",
    motivo: "la bodega marco el lote para el dia siguiente",
    createdAt: new Date("2026-09-23T08:30:00Z"),
  },
  {
    clase: "traspaso_mensajero",
    mensajeroAnteriorNombre: "Andy Cortes",
    mensajeroNuevoNombre: "Carlos Eduardo",
    actorNombre: "Coordinadora Ana",
    actorRol: "admin",
    motivo: "Andy se reporto enfermo",
    createdAt: new Date("2026-09-23T09:00:00Z"),
  },
  {
    clase: "evento_orden",
    tipo: "gestion_registrada",
    resultado: "entregado",
    resultadoAnterior: null,
    actorNombre: "Carlos Eduardo",
    actorRol: "mensajero",
    createdAt: new Date("2026-09-23T15:00:00Z"),
  },
];

function items(): HTMLElement[] {
  const lista = screen.getByRole("list", { name: "Línea de tiempo de la orden" });
  return within(lista).getAllByRole("listitem");
}

describe("454/R30 — la línea de tiempo pinta las CUATRO clases", () => {
  it("cada clase sale en su fila, en el orden del servidor, con su primera línea propia", () => {
    render(<HistorialOrdenTimeline entradas={CUATRO} />);
    const filas = items();
    expect(filas).toHaveLength(4);
    expect(within(filas[0]).getByText(L.en_reparto)).toBeTruthy();
    expect(within(filas[1]).getByText(ETIQUETA_CORRECCION_DIA)).toBeTruthy();
    expect(within(filas[2]).getByText("Traspaso a otro mensajero")).toBeTruthy();
    expect(within(filas[3]).getByText("Gestión registrada")).toBeTruthy();
  });

  it("la gestión registrada dice el resultado con su nombre CANÓNICO, el actor y su rol congelado", () => {
    render(<HistorialOrdenTimeline entradas={CUATRO} />);
    const fila = items()[3];
    expect(within(fila).getByText(`Resultado: ${L.entregado}`)).toBeTruthy();
    expect(
      within(fila).getByText(`Por Carlos Eduardo (${ROL_LABELS.mensajero})`),
    ).toBeTruthy();
    // No es una transición: ni flecha ni nombre de estado de origen.
    expect(within(fila).queryByText("→")).toBeNull();
    expect(within(fila).queryByText(L.en_reparto)).toBeNull();
  });

  it("la corrección dice «de A a B» con los nombres canónicos", () => {
    render(
      <HistorialOrdenTimeline
        entradas={[
          {
            clase: "evento_orden",
            tipo: "gestion_corregida",
            resultado: "devolucion_a_origen_por_rechazo",
            resultadoAnterior: "entregado",
            actorNombre: "Ana Solis",
            actorRol: "admin",
            createdAt: new Date("2026-09-23T18:00:00Z"),
          },
        ]}
      />,
    );
    const fila = items()[0];
    expect(within(fila).getByText("Gestión corregida")).toBeTruthy();
    expect(within(fila).getByText(`De ${L.entregado} a ${L.devolucion_a_origen_por_rechazo}`)).toBeTruthy();
  });

  it("la anulación, y un resultado `devuelta` se nombra con la etiqueta de su estado", () => {
    render(
      <HistorialOrdenTimeline
        entradas={[
          {
            clase: "evento_orden",
            tipo: "gestion_anulada",
            resultado: "novedad",
            resultadoAnterior: null,
            actorNombre: "Carlos Eduardo",
            actorRol: "mensajero",
            createdAt: new Date("2026-09-23T16:00:00Z"),
          },
        ]}
      />,
    );
    const fila = items()[0];
    expect(within(fila).getByText("Gestión anulada")).toBeTruthy();
    expect(within(fila).getByText(`Resultado: ${L.novedad}`)).toBeTruthy();
  });

  it("la ayuda: la ida lleva la nota «Ayuda solicitada a la tienda» y la vuelta dice que se cerró", () => {
    render(
      <HistorialOrdenTimeline
        entradas={[
          {
            clase: "evento_orden",
            tipo: "ayuda_solicitada",
            resultado: null,
            resultadoAnterior: null,
            actorNombre: "Carlos Eduardo",
            actorRol: "mensajero",
            createdAt: new Date("2026-09-23T10:00:00Z"),
          },
          {
            clase: "evento_orden",
            tipo: "ayuda_rescatada",
            resultado: null,
            resultadoAnterior: null,
            actorNombre: "Tienda Uno",
            actorRol: "adminTienda",
            createdAt: new Date("2026-09-23T11:00:00Z"),
          },
          {
            clase: "evento_orden",
            tipo: "ayuda_habilitada_api",
            resultado: null,
            resultadoAnterior: null,
            actorNombre: "Tienda Uno",
            actorRol: "adminTienda",
            createdAt: new Date("2026-09-23T12:00:00Z"),
          },
        ]}
      />,
    );
    const [ida, vuelta, api] = items();
    expect(within(ida).getByText(NOTA_AYUDA_SOLICITADA)).toBeTruthy();
    expect(NOTA_AYUDA_SOLICITADA).toBe("Ayuda solicitada a la tienda");
    expect(within(vuelta).getByText("Ayuda cerrada: la orden vuelve a gestionarse")).toBeTruthy();
    expect(
      within(vuelta).getByText(`Por Tienda Uno (${ROL_LABELS.adminTienda})`),
    ).toBeTruthy();
    expect(within(api).getByText("Ayuda cerrada por la integración de la tienda")).toBeTruthy();
    // Los hechos de la ayuda no llevan línea de resultado.
    expect(within(ida).queryByText(/^Resultado:/)).toBeNull();
  });

  // ⏳ 2026-09-24 (FICHA 455, T2.7; R11): la fila histórica se sigue leyendo (R40 de la 454), ahora con
  // su nombre histórico MARCADO «(estado retirado)», el mismo en toda superficie interna.
  it("R40 · 455/R11 — una transición HISTÓRICA hacia un estado retirado se lee con su nombre histórico, marcado", () => {
    render(
      <HistorialOrdenTimeline
        entradas={[
          {
            clase: "transicion",
            estatusOrigenValue: "en_reparto",
            estatusDestinoValue: "ayuda_tienda",
            origenTipo: "solicitud_ayuda_tienda",
            actorNombre: "Carlos Eduardo",
            motivo: null,
            createdAt: new Date("2026-09-01T10:00:00Z"),
          },
        ]}
      />,
    );
    const fila = items()[0];
    expect(within(fila).getByText("Ayuda solicitada a la tienda (estado retirado)")).toBeTruthy();
    expect(within(fila).queryByText("ayuda_tienda")).toBeNull();
  });
});
