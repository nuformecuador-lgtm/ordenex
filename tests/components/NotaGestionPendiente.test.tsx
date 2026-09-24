// @vitest-environment jsdom
// FICHA 454 (T2.2, R29) — la NOTA que acompaña al chip «En reparto» de una orden con su gestión
// registrada y el cierre sin aprobar, o con una ayuda a la tienda abierta.
//
// Formato decidido por el humano el 2026-09-23 (prevalece sobre la raya de R29/R31): «<Resultado> ·
// pendiente de confirmación», con PUNTO MEDIO, igual en todas las superficies y para los cinco
// resultados, con el nombre visible ACTUAL de cada uno (la 455 los renombrará después). La ayuda
// lleva su propia nota: «Ayuda solicitada a la tienda».
//
// LOS LITERALES VAN A MANO a propósito: la nota se arma con `estatusLabel` y el mapa de etiquetas,
// y compararla contra esa misma fuente la dejaría verde con cualquier contenido. Cuando la 455
// renombre los estados, este archivo se actualiza a mano y ese es el control.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { NotaGestionPendiente } from "@/app/(app)/ordenes/_components/NotaGestionPendiente";
import { notaGestionPendiente } from "@/app/(app)/ordenes/_components/estatus-label";
import {
  NOTA_AYUDA_SOLICITADA,
  textoPendienteConfirmacion,
} from "@/components/shared/nota-pendiente-confirmacion";

afterEach(() => cleanup());

const ESPERADAS = [
  ["entregada", "Entregada · pendiente de confirmación"],
  ["reprogramada", "Reprogramada · pendiente de confirmación"],
  ["devuelta", "Devuelta · pendiente de confirmación"],
  ["rechazada", "Rechazada · pendiente de confirmación"],
  ["incidente", "Incidente · pendiente de confirmación"],
] as const;

describe("454/R29 — el texto de la nota, para los cinco resultados", () => {
  it.each(ESPERADAS)("`%s` → «%s»", (resultado, texto) => {
    expect(notaGestionPendiente(resultado)).toBe(texto);
  });

  it("el formato es «<nombre> · pendiente de confirmación», con punto medio", () => {
    expect(textoPendienteConfirmacion("X")).toBe("X · pendiente de confirmación");
    expect(NOTA_AYUDA_SOLICITADA).toBe("Ayuda solicitada a la tienda");
  });
});

describe("454/R29 — el chip de la nota", () => {
  it.each(ESPERADAS)("con gestión pendiente `%s` pinta «%s»", (resultado, texto) => {
    render(<NotaGestionPendiente resultadoPendiente={resultado} />);
    expect(screen.getByText(texto)).toBeInTheDocument();
  });

  it("con ayuda abierta y sin gestión pendiente pinta la nota de la ayuda", () => {
    render(<NotaGestionPendiente resultadoPendiente={null} ayudaAbierta />);
    expect(screen.getByText("Ayuda solicitada a la tienda")).toBeInTheDocument();
  });

  it("si llegaran las dos, gana la gestión (el hecho más reciente)", () => {
    render(<NotaGestionPendiente resultadoPendiente="rechazada" ayudaAbierta />);
    expect(screen.getByText("Rechazada · pendiente de confirmación")).toBeInTheDocument();
    expect(screen.queryByText("Ayuda solicitada a la tienda")).toBeNull();
  });

  it("sin nada pendiente no pinta nada (no es un estado: no hay chip vacío)", () => {
    const { container } = render(<NotaGestionPendiente resultadoPendiente={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
