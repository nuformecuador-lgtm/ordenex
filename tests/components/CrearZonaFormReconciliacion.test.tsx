// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

/**
 * Ficha 366 (T7) — al guardar una zona editada, la respuesta del servidor
 * (T4/T6) puede traer `ordenesReconciliadas`: cuántas órdenes cambiaron de
 * `zonaId` porque su distrito ahora resuelve otra zona (§5.4/§6 de
 * design.md). El toast lo dice sólo cuando el conteo es > 0, sólo al editar
 * (`CrearZonaResult` no lleva ese campo — R13: crear nunca reconcilia).
 *
 * Se mockea `useToast` con un spy (patrón de `AsignarBodegaModal.test.tsx`)
 * para comparar el TEXTO exacto que recibe `toast.success`, no un fragmento
 * ni un `data-*`.
 */

const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
}));

vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

vi.mock("@/lib/actions/geografia", () => ({
  actualizarDistritosEspeciales: vi.fn(),
  listarArbolGeografico: vi.fn(),
}));

const { successMock } = vi.hoisted(() => ({ successMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const { CrearZonaForm, cobroVacio } = await import(
  "@/app/(app)/configuracion/tarifas/_components/CrearZonaForm"
);

function zonaDTO(id: string, nombre: string) {
  return {
    id,
    nombre,
    cobroVehiculo: false,
    distritosCount: 1,
    esCentral: false,
  };
}

/** Árbol mínimo con un solo distrito, suficiente para montar el selector. */
function arbol(): ProvinciaArbolDTO[] {
  return [
    {
      id: "p1",
      nombre: "San José",
      // FICHA 374: el flag PROPIO del nodo. Aqui todo activo: el catalogo retirado se prueba en
      // las suites de la 374.
      activo: true,
      cantones: [
        {
          id: "c1",
          nombre: "Central",
          activo: true,
          distritos: [
            {
              id: "d1",
              nombre: "Carmen",
              zonaId: null,
              zonaNombre: null,
              zonaEspecial: false,
              activo: true,
            },
          ],
        },
      ],
    },
  ];
}

/**
 * Renderiza el formulario ya con nombre y distrito precargados (`initial`),
 * así "Guardar" no necesita abrir el árbol ni escribir el nombre: lo que se
 * mide aquí es el mensaje del toast, no el resto del formulario (ya cubierto
 * por `ZonaDistritoEspecial.test.tsx`). `zonaId` presente ⇒ modo "editar"
 * llama `actualizarZona`; ausente ⇒ modo "crear" llama `crearZona`.
 */
function renderForm(
  mode: "crear" | "editar",
  zonaId?: string,
  // FICHA 377 (R11): el bloque de abajo necesita ver si el guardado avisó al
  // padre. Parámetro opcional para no tocar las cuatro llamadas de la 366.
  onSaved: () => void = vi.fn(),
) {
  return render(
    <CrearZonaForm
      mode={mode}
      provincias={arbol()}
      vehiculos={[]}
      zonas={[]}
      initial={{
        zonaId,
        nombre: "Zona X",
        distritoIds: ["d1"],
        cobro: cobroVacio(),
      }}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("Toast de guardar zona — conteo de órdenes reubicadas (366/T7)", () => {
  it("editar con ordenesReconciliadas > 0 pinta el conteo en plural", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 3,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (3 órdenes reubicadas)",
      ),
    );
  });

  it("editar con ordenesReconciliadas = 1 usa el singular (no «1 órdenes»)", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 1,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (1 orden reubicada)",
      ),
    );
  });

  it("editar con ordenesReconciliadas = 0 deja el mensaje igual que antes de esta ficha", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 0,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Zona actualizada"),
    );
  });

  it("crear zona nunca pinta un conteo: el campo no existe en CrearZonaResult", async () => {
    crearZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z2", "Zona nueva"),
    });
    const user = userEvent.setup();
    renderForm("crear");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Zona creada"),
    );
    expect(actualizarZonaMock).not.toHaveBeenCalled();
  });
});

/**
 * ⭑ FICHA 377 (T7 / R8-R11, R13) — LA MITAD DE PANTALLA DEL SEGUNDO CONTEO.
 *
 * El backend de la 377 dejó de mover de zona las órdenes cuyo paquete ya está
 * recibido en una bodega (R2) y devuelve cuántas fueron
 * (`ordenesRetenidasEnBodegaSatelite`, medido contra Postgres real en
 * `zona-reconciliacion-ordenes.test.ts` y reenviado por el service y la Server
 * Action). Hasta T7 ese número llegaba al navegador y NO se pintaba: el
 * servidor informaba y la pantalla callaba, que es justo el fallo mudo que R8
 * existe para cerrar.
 *
 * Estos casos comparan el texto **literal** que recibe `toast.success`. NO se
 * compara contra `mensajeGuardado` ni contra ninguna otra fuente del propio
 * componente: una aserción contra su propia fuente está siempre verde y no
 * mediría nada, porque cambiar el texto en el módulo cambiaría también el
 * esperado.
 *
 * Los cuatro casos de la 366 de arriba quedan INTACTOS a propósito: son el
 * ancla del texto de antes de esta ficha, y además sus mocks no traen el campo
 * nuevo, así que también demuestran que una respuesta sin él no ensucia el
 * mensaje.
 */
describe("Toast de guardar zona — órdenes que se quedaron en su bodega (377/T7)", () => {
  it("⭑ R8: con retenidas > 0 el toast dice las DOS cosas, no solo las reubicadas", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 12,
      ordenesRetenidasEnBodegaSatelite: 3,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (12 órdenes reubicadas). 3 órdenes no cambiaron de zona porque su paquete ya está en una bodega.",
      ),
    );
  });

  it("⭑ R8: sin ninguna reubicada, la frase de las retenidas aparece igual", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 0,
      ordenesRetenidasEnBodegaSatelite: 3,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada. 3 órdenes no cambiaron de zona porque su paquete ya está en una bodega.",
      ),
    );
  });

  it("⭑ R8: 1 retenida va en singular (ni «1 órdenes» ni «cambiaron»)", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 1,
      ordenesRetenidasEnBodegaSatelite: 1,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (1 orden reubicada). 1 orden no cambió de zona porque su paquete ya está en una bodega.",
      ),
    );
  });

  it("⭑ R10: con retenidas = 0 el mensaje es EXACTAMENTE el de antes de esta ficha", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 12,
      ordenesRetenidasEnBodegaSatelite: 0,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Ni «0 órdenes», ni «ninguna», ni un punto de más: el caso normal —que es
    // la enorme mayoría de los guardados— no se ensucia con el conteo nuevo.
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (12 órdenes reubicadas)",
      ),
    );
  });

  it("⭑ R10: sin reubicar y sin retener, «Zona actualizada» a secas", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 0,
      ordenesRetenidasEnBodegaSatelite: 0,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Zona actualizada"),
    );
  });

  it("⭑ R11: retener NO bloquea el guardado, no abre ningún modal y avisa al padre", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 0,
      ordenesRetenidasEnBodegaSatelite: 7,
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderForm("editar", "z1", onSaved);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Un solo clic basta: si el aviso se hubiera implementado como una
    // confirmación previa, el padre no se enteraría hasta un segundo clic.
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(actualizarZonaMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("⭑ R13: crear zona no pinta el conteo aunque la respuesta lo trajera", async () => {
    // `CrearZonaResult` no lleva los conteos (crear ni reconcilia ni retiene).
    // Se devuelven aquí a propósito para medir que quien decide es `esEditar` y
    // no la forma de la respuesta: leer el campo sin mirar el modo pintaría un
    // «N órdenes» en un guardado que no movió ni retuvo nada.
    crearZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z2", "Zona nueva"),
      ordenesReconciliadas: 4,
      ordenesRetenidasEnBodegaSatelite: 9,
    });
    const user = userEvent.setup();
    renderForm("crear");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Zona creada"),
    );
    expect(actualizarZonaMock).not.toHaveBeenCalled();
  });
});
