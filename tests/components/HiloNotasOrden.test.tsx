// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  HiloNotasOrden,
  type HiloNotasOrdenProps,
} from "@/components/shared/HiloNotasOrden";
import { CUERPO_MAX, type OrdenNotaDTO } from "@/lib/types/orden-nota";

// Feature 227 (T3.2, design §5) — UI del hilo. Cubre R16, R17, R18, R19 y R34.
//
// Las Server Actions se INYECTAN por props (el componente no las importa), así que aquí no
// hace falta mockear `lib/actions/orden-notas`: se pasan dobles y se afirma qué se les pide y
// qué hace la UI con cada respuesta TIPADA. Eso es justo lo que estos requisitos verifican —
// el componente no re-deriva ninguna regla: `puedeEscribir` y `esPropia` llegan del servidor.

const ORDEN_ID = "6d5f6b6e-0000-4000-8000-000000000001";

// Mismo formateador que el componente (zona fija de Costa Rica): la hora esperada se calcula,
// no se copia a mano, para que el test no dependa de la zona horaria del entorno.
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** El formateador mete espacios finos/duros (U+202F) que el DOM conserva: se normalizan a
 *  espacio normal en los dos lados para comparar lo que la persona LEE. */
function normalizar(texto: string): string {
  return texto.replace(/[   ]/g, " ");
}

function horaDe(iso: string): string {
  return normalizar(FECHA_HORA.format(new Date(iso)));
}

/** La hora tal como se ve en una fila del hilo (elemento `<time>` con su `datetime`). */
function horaVisible(fila: HTMLElement): { texto: string; iso: string | null } {
  const marca = fila.querySelector("time");
  if (!marca) throw new Error("la nota no pinta ninguna hora");
  return {
    texto: normalizar(marca.textContent ?? ""),
    iso: marca.getAttribute("datetime"),
  };
}

function nota(over: Partial<OrdenNotaDTO> = {}): OrdenNotaDTO {
  return {
    id: "n1",
    cuerpo: "El cliente no estaba en la casa.",
    autorNombre: "Tienda Central",
    rolAutor: "adminTienda",
    createdAt: "2026-08-14T15:30:00.000Z",
    esPropia: false,
    eliminada: false,
    ...over,
  };
}

function montar(props: {
  notas: OrdenNotaDTO[];
  puedeEscribir: boolean;
  compositorColapsado?: boolean;
  onPublicar?: HiloNotasOrdenProps["onPublicar"];
  onBorrar?: HiloNotasOrdenProps["onBorrar"];
  onRefrescar?: HiloNotasOrdenProps["onRefrescar"];
}) {
  const onPublicar =
    props.onPublicar ?? vi.fn().mockResolvedValue({ status: "ok", nota: nota() });
  const onBorrar = props.onBorrar ?? vi.fn().mockResolvedValue({ status: "ok" });
  const onRefrescar = props.onRefrescar ?? vi.fn();
  render(
    <HiloNotasOrden
      ordenId={ORDEN_ID}
      notas={props.notas}
      puedeEscribir={props.puedeEscribir}
      onPublicar={onPublicar}
      onBorrar={onBorrar}
      onRefrescar={onRefrescar}
      compositorColapsado={props.compositorColapsado}
    />,
  );
  return { onPublicar, onBorrar, onRefrescar };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("HiloNotasOrden", () => {
  // R16
  it("pinta cada nota con su autor y su hora y distingue las propias", () => {
    const ajena = nota({
      id: "n-tienda",
      autorNombre: "Tienda Central",
      cuerpo: "El cliente pidió reintentar mañana.",
      createdAt: "2026-08-14T15:30:00.000Z",
      esPropia: false,
    });
    const propia = nota({
      id: "n-mensajero",
      autorNombre: "Carlos Mora",
      rolAutor: "mensajero",
      cuerpo: "Voy de camino, llego en 20 minutos.",
      createdAt: "2026-08-14T16:05:00.000Z",
      esPropia: true,
    });
    montar({ notas: [ajena, propia], puedeEscribir: true });

    const filas = screen.getAllByRole("listitem");
    expect(filas).toHaveLength(2);

    // Autor y hora, en las dos.
    expect(within(filas[0]).getByText("Tienda Central")).toBeTruthy();
    expect(horaVisible(filas[0])).toEqual({
      texto: horaDe("2026-08-14T15:30:00.000Z"),
      iso: "2026-08-14T15:30:00.000Z",
    });
    expect(within(filas[1]).getByText("Carlos Mora")).toBeTruthy();
    expect(horaVisible(filas[1])).toEqual({
      texto: horaDe("2026-08-14T16:05:00.000Z"),
      iso: "2026-08-14T16:05:00.000Z",
    });

    // Propia vs ajena: marca distinta, y sin comparar ids en el cliente (llega del DTO).
    expect(filas[0].getAttribute("data-propia")).toBe("false");
    expect(filas[1].getAttribute("data-propia")).toBe("true");
    expect(filas[0].className).not.toBe(filas[1].className);
    expect(within(filas[1]).getByText(/Vos/)).toBeTruthy();
  });

  // R17
  it("tras publicar y tras eliminar solicita el refresco de datos del servidor", async () => {
    const user = userEvent.setup();
    const onPublicar = vi.fn().mockResolvedValue({ status: "ok", nota: nota() });
    const onBorrar = vi.fn().mockResolvedValue({ status: "ok" });
    const onRefrescar = vi.fn();
    montar({
      notas: [nota({ id: "mia", esPropia: true, autorNombre: "Carlos Mora" })],
      puedeEscribir: true,
      onPublicar,
      onBorrar,
      onRefrescar,
    });

    await user.type(screen.getByLabelText("Escribí una nota"), "Ya lo intenté dos veces");
    await user.click(screen.getByRole("button", { name: "Publicar nota" }));

    expect(onPublicar).toHaveBeenCalledWith({
      ordenId: ORDEN_ID,
      cuerpo: "Ya lo intenté dos veces",
    });
    expect(onRefrescar).toHaveBeenCalledTimes(1);
    // El hilo pintado sale del servidor: el borrador se vacía y no se inyecta la nota a mano.
    expect(
      (screen.getByLabelText("Escribí una nota") as HTMLTextAreaElement).value,
    ).toBe("");

    await user.click(screen.getByRole("button", { name: /^Eliminar mi nota/ }));

    expect(onBorrar).toHaveBeenCalledWith({ ordenId: ORDEN_ID, notaId: "mia" });
    expect(onRefrescar).toHaveBeenCalledTimes(2);
  });

  // R18
  it("muestra el motivo del rechazo y no pinta el cambio como aplicado", async () => {
    const user = userEvent.setup();
    const onPublicar = vi.fn().mockResolvedValue({ status: "forbidden" });
    const onBorrar = vi.fn().mockResolvedValue({ status: "forbidden" });
    const onRefrescar = vi.fn();
    montar({
      notas: [
        nota({
          id: "mia",
          esPropia: true,
          autorNombre: "Carlos Mora",
          cuerpo: "Nota que sigue vigente",
        }),
      ],
      puedeEscribir: true,
      onPublicar,
      onBorrar,
      onRefrescar,
    });

    const compositor = screen.getByLabelText("Escribí una nota") as HTMLTextAreaElement;
    await user.type(compositor, "Intento fallido");
    await user.click(screen.getByRole("button", { name: "Publicar nota" }));

    expect(screen.getByRole("alert").textContent).toMatch(
      /No podés escribir en esta orden/,
    );
    // Nada se pintó como aplicado: ni se refrescó, ni se perdió el borrador, ni apareció
    // una nota nueva en el hilo.
    expect(onRefrescar).not.toHaveBeenCalled();
    expect(compositor.value).toBe("Intento fallido");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /^Eliminar mi nota/ }));

    expect(screen.getByRole("alert").textContent).toMatch(
      /No se pudo eliminar la nota/,
    );
    expect(onRefrescar).not.toHaveBeenCalled();
    // La nota rechazada sigue con su cuerpo, sin marca de eliminada.
    expect(screen.getByText("Nota que sigue vigente")).toBeTruthy();
    expect(screen.queryByText("Nota eliminada")).toBeNull();

    // Un rechazo de validación dice qué corregir, con el tope real del módulo.
    onPublicar.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { cuerpo: ["demasiado largo"] },
    });
    await user.click(screen.getByRole("button", { name: "Publicar nota" }));
    expect(screen.getByRole("alert").textContent).toContain(String(CUERPO_MAX));
  });

  // R19
  it("con puedeEscribir muestra el compositor y sin él lo oculta junto a los controles de borrado", () => {
    const propia = nota({ id: "mia", esPropia: true, autorNombre: "Carlos Mora" });

    const { unmount } = render(
      <HiloNotasOrden
        ordenId={ORDEN_ID}
        notas={[propia]}
        puedeEscribir
        onPublicar={vi.fn()}
        onBorrar={vi.fn()}
        onRefrescar={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Escribí una nota")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Eliminar mi nota/ })).toBeTruthy();
    unmount();

    // Fuera de la ventana del rol: el hilo se ve, pero no hay por dónde escribir ni borrar.
    render(
      <HiloNotasOrden
        ordenId={ORDEN_ID}
        notas={[propia]}
        puedeEscribir={false}
        onPublicar={vi.fn()}
        onBorrar={vi.fn()}
        onRefrescar={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByLabelText("Escribí una nota")).toBeNull();
    expect(screen.queryByRole("button", { name: /Publicar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Eliminar/ })).toBeNull();
    cleanup();

    // Hilo vacío dentro de la ventana: estado vacío legible + compositor operativo.
    montar({ notas: [], puedeEscribir: true });
    expect(screen.getByRole("status").textContent).toMatch(/Todavía no hay notas/);
    expect(screen.getByLabelText("Escribí una nota")).toBeTruthy();
  });

  // R34
  it("pinta «nota eliminada» conservando el hueco", () => {
    const notas = [
      nota({ id: "a", cuerpo: "Primera", createdAt: "2026-08-14T15:00:00.000Z" }),
      nota({
        id: "b",
        cuerpo: "", // el texto borrado NO cruza el borde: llega vacío
        eliminada: true,
        esPropia: true,
        autorNombre: "Carlos Mora",
        rolAutor: "mensajero",
        createdAt: "2026-08-14T15:30:00.000Z",
      }),
      nota({ id: "c", cuerpo: "Tercera", createdAt: "2026-08-14T16:00:00.000Z" }),
    ];
    montar({ notas, puedeEscribir: true });

    const filas = screen.getAllByRole("listitem");
    expect(filas).toHaveLength(3);

    // El hueco se conserva EN SU POSICIÓN, con su autor y su hora.
    const borrada = filas[1];
    expect(within(borrada).getByText("Nota eliminada")).toBeTruthy();
    expect(within(borrada).getByText("Carlos Mora")).toBeTruthy();
    expect(horaVisible(borrada)).toEqual({
      texto: horaDe("2026-08-14T15:30:00.000Z"),
      iso: "2026-08-14T15:30:00.000Z",
    });
    // Y no se ofrece borrar lo ya borrado.
    expect(within(borrada).queryByRole("button", { name: /Eliminar/ })).toBeNull();

    // Las vecinas quedan intactas.
    expect(within(filas[0]).getByText("Primera")).toBeTruthy();
    expect(within(filas[2]).getByText("Tercera")).toBeTruthy();
  });
});

// Pedido humano del 2026-08-19 — en el panel de gestión el hilo se LEE: las notas y un botón
// «Agregar nota». El compositor no se pinta hasta pedirlo. Se afirma la AUSENCIA del área de
// texto, no solo la presencia del botón: sin eso, dejarla montada y meramente escondida
// pasaría por bueno.
describe("HiloNotasOrden — compositor plegado (pedido humano 2026-08-19)", () => {
  it("con `compositorColapsado` lista las notas y ofrece «Agregar nota», sin área de texto", () => {
    montar({
      notas: [nota({ cuerpo: "El cliente no estaba." })],
      puedeEscribir: true,
      compositorColapsado: true,
    });

    expect(screen.getByText("El cliente no estaba.")).toBeTruthy();
    const agregar = screen.getByRole("button", { name: "Agregar nota" });
    expect(agregar).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Escribí una nota")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publicar nota" })).toBeNull();
  });

  it("al pulsar «Agregar nota» se despliega el compositor con el foco dentro", async () => {
    const user = userEvent.setup();
    montar({ notas: [], puedeEscribir: true, compositorColapsado: true });

    await user.click(screen.getByRole("button", { name: "Agregar nota" }));

    const area = screen.getByLabelText("Escribí una nota");
    expect(area).toBeTruthy();
    // Quien pidió escribir ya puede teclear: sin foco haría falta un segundo clic.
    expect(document.activeElement).toBe(area);
    expect(screen.getByRole("button", { name: "Publicar nota" })).toBeTruthy();
  });

  it("«Cancelar» pliega el compositor y CONSERVA lo tecleado", async () => {
    const user = userEvent.setup();
    montar({ notas: [], puedeEscribir: true, compositorColapsado: true });

    await user.click(screen.getByRole("button", { name: "Agregar nota" }));
    await user.type(screen.getByLabelText("Escribí una nota"), "Medio escrito");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    // El cierre tiene un tramo de animación: lo que importa es que vuelve el disparador…
    expect(screen.getByRole("button", { name: "Agregar nota" })).toBeTruthy();
    // …y que al reabrir el borrador sigue ahí (cerrar no es descartar).
    await user.click(screen.getByRole("button", { name: "Agregar nota" }));
    expect(screen.getByLabelText("Escribí una nota")).toHaveValue("Medio escrito");
  });

  it("publicar con éxito vuelve a plegar el compositor y relee el hilo", async () => {
    const user = userEvent.setup();
    const onPublicar = vi.fn().mockResolvedValue({ status: "ok", nota: nota() });
    const { onRefrescar } = montar({
      notas: [],
      puedeEscribir: true,
      compositorColapsado: true,
      onPublicar,
    });

    await user.click(screen.getByRole("button", { name: "Agregar nota" }));
    await user.type(screen.getByLabelText("Escribí una nota"), "Ya la entregué");
    await user.click(screen.getByRole("button", { name: "Publicar nota" }));

    await vi.waitFor(() => expect(onRefrescar).toHaveBeenCalled());
    expect(onPublicar).toHaveBeenCalledWith({
      ordenId: ORDEN_ID,
      cuerpo: "Ya la entregué",
    });
    expect(screen.getByRole("button", { name: "Agregar nota" })).toBeTruthy();
  });

  it("sin la prop, el compositor sigue abierto de entrada (modal de novedades)", () => {
    montar({ notas: [], puedeEscribir: true });

    expect(screen.getByLabelText("Escribí una nota")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agregar nota" })).toBeNull();
    // Y no aparece un «Cancelar» que no plegaría nada.
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("en solo lectura no hay ni compositor ni botón para pedirlo", () => {
    montar({
      notas: [nota()],
      puedeEscribir: false,
      compositorColapsado: true,
    });

    expect(screen.queryByRole("button", { name: "Agregar nota" })).toBeNull();
    expect(screen.queryByLabelText("Escribí una nota")).toBeNull();
    expect(screen.getByText("Ahora mismo solo podés leer este hilo.")).toBeTruthy();
  });
});
