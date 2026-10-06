// @vitest-environment jsdom
//
// Ficha 475 (T6.2, R34–R38) — el PANEL de parámetros del informe de tránsito dentro del formulario
// de un envío. La vista previa (server action) se dobla: lo que se afirma es lo que el panel PINTA
// y lo que MANDA al formulario. Los números esperados van LITERALES (partida 10/2 y 20/5 → días 8 y
// 15), no recalculados con las funciones del módulo: así una partida cambiada pone esto en rojo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";

import type { InformeDTO } from "@/lib/types/envios-whatsapp";

const previsualizar = vi.fn();
vi.mock("@/lib/actions/informe-transito", () => ({
  previsualizarInformeTransito: (...x: unknown[]) => previsualizar(...x),
}));

import { ParamsTransito } from "@/app/(app)/configuracion/envios-whatsapp/_components/ParamsTransito";
import { ParametrosInforme } from "@/app/(app)/configuracion/envios-whatsapp/_components/ParametrosInforme";

const ZONAS = [
  { id: "z-gam", nombre: "GAM", esCentral: true },
  { id: "z-coco", nombre: "FGAM El Coco", esCentral: false },
  { id: "z-sur", nombre: "FGAM Zona Sur", esCentral: false },
];

/** Partida literal (R5): no se importa `PARAMETROS_POR_DEFECTO` para no afirmar contra su fuente. */
function partida(): Record<string, unknown> {
  const sinUmbral = null;
  return {
    hito: "entrada_bodega_central",
    zonas: [],
    estados: [
      { estado: "en_ruta_bodega_central", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "en_bodega_central", incluido: true, paradoSiMasDeDias: 2 },
      { estado: "mensajero_recogiendo_en_bodega", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "en_ruta_bodega_satelite", incluido: true, paradoSiMasDeDias: 2 },
      { estado: "en_bodega_satelite", incluido: true, paradoSiMasDeDias: 2 },
      { estado: "en_reparto", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "reprogramado", incluido: true, paradoSiMasDeDias: 3 },
      { estado: "novedad", incluido: true, paradoSiMasDeDias: 1 },
      { estado: "novedad_interna", incluido: true, paradoSiMasDeDias: 1 },
      { estado: "incidente", incluido: true, paradoSiMasDeDias: 1 },
      { estado: "devolucion_a_origen_por_rechazo", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "por_devolver_a_bodega_central", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "devolviendo_a_bodega_central", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "por_devolver_a_tienda", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "devolviendo_a_tienda", incluido: true, paradoSiMasDeDias: sinUmbral },
      { estado: "en_preparacion", incluido: false, paradoSiMasDeDias: sinUmbral },
      { estado: "por_recolectar_en_tienda", incluido: false, paradoSiMasDeDias: sinUmbral },
      { estado: "recolectando", incluido: false, paradoSiMasDeDias: sinUmbral },
    ],
    enviarSiVacio: false,
  };
}

const ZONAS_PARTIDA = [
  { zonaId: "z-gam", plazoDias: 10, avisoDias: 2 },
  { zonaId: "z-coco", plazoDias: 20, avisoDias: 5 },
  { zonaId: "z-sur", plazoDias: 20, avisoDias: 5 },
];

/** El formulario de la 474 en miniatura: guarda los parámetros y los deja ver. */
let ultimos: Record<string, unknown> = {};
function Harness({
  inicial,
  errores = {},
}: {
  inicial: Record<string, unknown>;
  errores?: Record<string, string[]>;
}) {
  const [v, setV] = useState(inicial);
  useEffect(() => {
    ultimos = v;
  }, [v]);
  return (
    <ParamsTransito
      etiqueta="Parámetros del informe de tránsito"
      valores={v}
      onCambiar={(c, x) => setV((p) => ({ ...p, [c]: x }))}
      errores={errores}
      retardoMs={0}
    />
  );
}

function ok(total: number, parados: number, sinHito: number) {
  return { status: "ok", zonas: ZONAS, totalEnAlerta: total, parados, sinHito };
}

async function montar(inicial = partida(), errores: Record<string, string[]> = {}) {
  render(<Harness inicial={inicial} errores={errores} />);
  await screen.findByTestId("zona-z-gam");
}

beforeEach(() => {
  ultimos = {};
  previsualizar.mockReset();
  previsualizar.mockResolvedValue(ok(15, 8, 0));
});
afterEach(cleanup);

describe("R34 — el panel de la maqueta", () => {
  it("pinta TODAS las zonas reales con plazo, aviso y «entra en alerta el día N»", async () => {
    await montar();
    const gam = screen.getByTestId("zona-z-gam");
    expect(within(gam).getByText("GAM")).toBeTruthy();
    expect((within(gam).getByLabelText("Plazo máximo de GAM") as HTMLInputElement).value).toBe("10");
    expect((within(gam).getByLabelText("Avisar antes en GAM") as HTMLInputElement).value).toBe("2");
    expect(within(gam).getByText(/el día 8$/)).toBeTruthy();
    for (const id of ["z-coco", "z-sur"]) {
      const fila = screen.getByTestId(`zona-${id}`);
      expect(within(fila).getByText(/el día 15$/)).toBeTruthy();
    }
    expect(screen.getAllByRole("listitem").filter((li) => li.dataset.testid?.startsWith("zona-"))).toHaveLength(3);
  });

  it("recalcula «el día N» en el acto al cambiar plazo o aviso", async () => {
    const user = userEvent.setup();
    await montar();
    const plazo = screen.getByLabelText("Plazo máximo de GAM");
    await user.clear(plazo);
    await user.type(plazo, "12");
    expect(within(screen.getByTestId("zona-z-gam")).getByText(/el día 10$/)).toBeTruthy();
  });

  it("tres opciones de hito, con la de partida elegida", async () => {
    await montar();
    const grupo = screen.getByRole("radiogroup", { name: "Desde cuándo se cuentan los días" });
    const radios = within(grupo).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByText("Desde que entra a bodega central")).toBeTruthy();
    expect(screen.getByText("Desde que se crea la orden")).toBeTruthy();
    expect(screen.getByText("Desde que se genera la guía")).toBeTruthy();
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  });

  it("los 18 estados ofrecidos con su casilla y su umbral; los de cierre logístico no se listan y se dice", async () => {
    await montar();
    expect(screen.getAllByRole("checkbox")).toHaveLength(18);
    expect(screen.getByRole("checkbox", { name: "En bodega central" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Entregado" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Devuelta a tienda/ })).toBeNull();
    expect(
      (screen.getByLabelText("Parado si lleva más de (días), En bodega central") as HTMLInputElement).value,
    ).toBe("2");
    expect((screen.getByLabelText("Parado si lleva más de (días), Reprogramado") as HTMLInputElement).value).toBe("3");
    expect(
      screen.getByText(
        "Los estados con cierre logístico (por ejemplo Entregado o Devuelta a tienda) no se listan: nunca entran.",
      ),
    ).toBeTruthy();
  });

  it("no usa la sigla SLA en ningún texto", async () => {
    await montar();
    expect(document.body.textContent ?? "").not.toMatch(/SLA/);
  });
});

describe("R35 — zonas sin plazo propio: partida de su tipo y se guardan TODAS", () => {
  it("sin entradas, rellena cada zona con la partida de su tipo (GAM 10/2, fuera 20/5)", async () => {
    await montar();
    await waitFor(() => expect(ultimos.zonas).toEqual(ZONAS_PARTIDA));
  });

  it("una zona con plazo propio lo conserva y las demás reciben la partida", async () => {
    await montar({ ...partida(), zonas: [{ zonaId: "z-sur", plazoDias: 30, avisoDias: 7 }] });
    await waitFor(() =>
      expect(ultimos.zonas).toEqual([
        { zonaId: "z-gam", plazoDias: 10, avisoDias: 2 },
        { zonaId: "z-coco", plazoDias: 20, avisoDias: 5 },
        { zonaId: "z-sur", plazoDias: 30, avisoDias: 7 },
      ]),
    );
    expect(within(screen.getByTestId("zona-z-sur")).getByText(/el día 23$/)).toBeTruthy();
  });

  it("al editar una zona se manda una entrada por CADA zona mostrada", async () => {
    const user = userEvent.setup();
    await montar();
    const aviso = screen.getByLabelText("Avisar antes en FGAM El Coco");
    await user.clear(aviso);
    await user.type(aviso, "3");
    await waitFor(() =>
      expect(ultimos.zonas).toEqual([
        { zonaId: "z-gam", plazoDias: 10, avisoDias: 2 },
        { zonaId: "z-coco", plazoDias: 20, avisoDias: 3 },
        { zonaId: "z-sur", plazoDias: 20, avisoDias: 5 },
      ]),
    );
  });
});

describe("R36 — «Volver a los valores de partida»", () => {
  it("restablece hito, plazos de todas las zonas, estados incluidos y umbrales", async () => {
    const user = userEvent.setup();
    await montar({
      ...partida(),
      hito: "creacion",
      zonas: [{ zonaId: "z-gam", plazoDias: 4, avisoDias: 1 }],
    });
    await user.click(screen.getByRole("checkbox", { name: "En reparto" }));
    const umbral = screen.getByLabelText("Parado si lleva más de (días), Novedad");
    await user.clear(umbral);
    await user.type(umbral, "9");
    await user.click(screen.getByRole("checkbox", { name: "Recolectando" }));

    await user.click(screen.getByRole("button", { name: "Volver a los valores de partida" }));

    await waitFor(() => expect(ultimos.hito).toBe("entrada_bodega_central"));
    expect(ultimos.zonas).toEqual(ZONAS_PARTIDA);
    expect(ultimos.estados).toEqual(partida().estados);
    expect((screen.getByLabelText("Plazo máximo de GAM") as HTMLInputElement).value).toBe("10");
    expect(screen.getAllByRole("radio")[0]?.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "En reparto" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Recolectando" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("R37 — estado no incluido: «no entra» y umbral no editable", () => {
  it("los no incluidos de partida dicen «no entra» y su número está deshabilitado", async () => {
    await montar();
    const fila = screen.getByTestId("estado-en_preparacion");
    expect(within(fila).getByText("no entra")).toBeTruthy();
    expect((screen.getByLabelText("Parado si lleva más de (días), En preparación") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("Parado si lleva más de (días), En bodega central") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("desmarcar un estado lo pasa a «no entra» y deshabilita su número; volver a marcarlo lo habilita", async () => {
    const user = userEvent.setup();
    await montar();
    const casilla = screen.getByRole("checkbox", { name: "En bodega central" });
    const numero = screen.getByLabelText("Parado si lleva más de (días), En bodega central") as HTMLInputElement;
    await user.click(casilla);
    expect(within(screen.getByTestId("estado-en_bodega_central")).getByText("no entra")).toBeTruthy();
    expect(numero.disabled).toBe(true);
    const enviado = (ultimos.estados as { estado: string; incluido: boolean }[]).find((e) => e.estado === "en_bodega_central");
    expect(enviado?.incluido).toBe(false);
    await user.click(casilla);
    expect(numero.disabled).toBe(false);
  });
});

describe("R38 — conteo de hoy con valores válidos; errores por campo y sin conteo con inválidos", () => {
  it("muestra «hoy entrarían N paquetes (M parados)» y los que no tienen el momento de inicio", async () => {
    previsualizar.mockResolvedValue(ok(15, 8, 4));
    await montar();
    const conteo = await screen.findByTestId("conteo-transito");
    expect(conteo.textContent).toContain("Con estos valores, hoy entrarían 15 paquetes (8 parados).");
    expect(conteo.textContent).toContain("4 paquetes en esos estados aún no han pasado por ese momento");
  });

  it("sin paquetes sin hito no dice nada de ellos; y en singular habla en singular", async () => {
    previsualizar.mockResolvedValue(ok(1, 1, 0));
    await montar();
    const conteo = await screen.findByTestId("conteo-transito");
    expect(conteo.textContent).toBe("Con estos valores, hoy entrarían 1 paquete (1 parado).");
  });

  it("al cambiar un valor válido vuelve a preguntar con los parámetros nuevos (sin escribir nada)", async () => {
    const user = userEvent.setup();
    await montar();
    await screen.findByTestId("conteo-transito");
    previsualizar.mockResolvedValue(ok(3, 0, 0));
    await user.click(screen.getByText("Desde que se crea la orden"));
    await waitFor(() => expect(screen.getByTestId("conteo-transito").textContent).toContain("3 paquetes (0 parados)"));
    const ultimaLlamada = previsualizar.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(ultimaLlamada.hito).toBe("creacion");
    expect(ultimaLlamada.zonas).toEqual(ZONAS_PARTIDA);
  });

  it("aviso >= plazo: error junto al campo, en claro, sin conteo y sin preguntar al servidor", async () => {
    const user = userEvent.setup();
    await montar();
    await screen.findByTestId("conteo-transito");
    const llamadas = previsualizar.mock.calls.length;
    const aviso = screen.getByLabelText("Avisar antes en GAM");
    await user.clear(aviso);
    await user.type(aviso, "10");

    const error = await screen.findByText(
      "Pon un número entero de días entre 0 y 9: el aviso tiene que ser menor que el plazo.",
    );
    expect(aviso.getAttribute("aria-invalid")).toBe("true");
    expect(aviso.getAttribute("aria-describedby")).toBe(error.closest("[role=alert]")?.id);
    const filaGam = screen.getByTestId("zona-z-gam").textContent ?? "";
    expect(filaGam).not.toMatch(/el día/);
    expect(filaGam).toContain("Entra en alerta —");
    expect(screen.queryByTestId("conteo-transito")).toBeNull();
    expect(screen.getByText("Corrige los campos marcados para ver cuántos paquetes entrarían hoy.")).toBeTruthy();
    // "1" es válido (1 < 10): una llamada como mucho, por la pulsación intermedia; "10" no se pregunta.
    const enviados = previsualizar.mock.calls.slice(llamadas).map((c) => (c[0] as { zonas: { avisoDias: number }[] }).zonas[0]?.avisoDias);
    expect(enviados).not.toContain(10);
  });

  it("ningún estado incluido: error bajo la lista de estados y sin conteo", async () => {
    const todosFuera = {
      ...partida(),
      estados: (partida().estados as { estado: string }[]).map((e) => ({ ...e, incluido: false })),
    };
    previsualizar.mockResolvedValue({ status: "validation_error", fieldErrors: { "parametros.estados": ["estados: incluye al menos un estado."] }, zonas: ZONAS });
    await montar(todosFuera);
    expect(await screen.findByText("Marca al menos un estado.")).toBeTruthy();
    expect(screen.queryByTestId("conteo-transito")).toBeNull();
  });

  it("umbral de parado fuera de rango: error en su fila", async () => {
    const user = userEvent.setup();
    await montar();
    const umbral = screen.getByLabelText("Parado si lleva más de (días), Novedad");
    await user.clear(umbral);
    await user.type(umbral, "91");
    const fila = screen.getByTestId("estado-novedad");
    expect(await within(fila).findByText("Pon un número entero de días entre 0 y 90, o déjalo vacío.")).toBeTruthy();
    expect(screen.queryByTestId("conteo-transito")).toBeNull();
  });

  it("un error del servidor al guardar sale junto a su campo, en claro", async () => {
    await montar(
      { ...partida(), zonas: ZONAS_PARTIDA },
      { "parametros.zonas.1.plazoDias": ["plazoDias: debe estar entre 1 y 365."] },
    );
    expect(
      within(screen.getByTestId("zona-z-coco")).getByText("Pon un número entero de días entre 1 y 365."),
    ).toBeTruthy();
  });

  it("si la vista previa falla, lo dice en vez de enseñar un conteo", async () => {
    previsualizar.mockReset();
    previsualizar.mockResolvedValueOnce(ok(15, 8, 0)).mockRejectedValue(new Error("db caída"));
    const user = userEvent.setup();
    await montar();
    await screen.findByTestId("conteo-transito");
    await user.click(screen.getByText("Desde que se genera la guía"));
    expect(
      await screen.findByText("No se pudo calcular cuántos paquetes entrarían hoy. Inténtalo de nuevo en un momento."),
    ).toBeTruthy();
    expect(screen.queryByTestId("conteo-transito")).toBeNull();
  });

  it("si no se pueden cargar las zonas, lo dice y deja reintentar", async () => {
    previsualizar.mockReset();
    previsualizar.mockRejectedValueOnce(new Error("db caída")).mockResolvedValue(ok(2, 0, 0));
    const user = userEvent.setup();
    render(<Harness inicial={partida()} />);
    expect(await screen.findByText("No se pudieron cargar las zonas. Inténtalo de nuevo en un momento.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("zona-z-gam")).toBeTruthy();
  });
});

describe("design §8.1 — el renderizador de la 474 pinta el panel del descriptor `panel`", () => {
  const INFORME: InformeDTO = {
    clave: "transito",
    nombre: "Informe de tránsito",
    descripcion: "",
    generaDocumento: true,
    aptoParaAdminTienda: false,
    soloPorEvento: false,
    eventos: [],
    parametrosPorDefecto: partida(),
    descriptores: [
      {
        campo: "transito",
        etiqueta: "Parámetros del informe de tránsito",
        tipo: "panel",
        panel: "transito",
        campos: ["hito", "zonas", "estados"],
      },
      { campo: "enviarSiVacio", etiqueta: "Enviar aunque no haya nada que informar", tipo: "booleano" },
    ],
    variables: [],
  };

  it("pinta ParamsTransito (no el «todavía no se puede editar») y le pasa SOLO los errores de sus campos", async () => {
    render(
      <ParametrosInforme
        informe={INFORME}
        valores={{ ...partida(), zonas: ZONAS_PARTIDA }}
        onCambiar={() => {}}
        errores={{
          "parametros.zonas.0.avisoDias": ["avisoDias: debe estar entre 0 y 9 (menor que el plazo)."],
          "parametros.enviarSiVacio": ["enviarSiVacio: debe ser sí o no."],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Parámetros del informe de tránsito" })).toBeTruthy();
    expect(screen.queryByText(/todavía no se puede editar/)).toBeNull();
    expect(screen.getByRole("switch", { name: "Enviar aunque no haya nada que informar" })).toBeTruthy();
    await screen.findByTestId("zona-z-gam");
    expect(
      within(screen.getByTestId("zona-z-gam")).getByText(
        "Pon un número entero de días entre 0 y 9: el aviso tiene que ser menor que el plazo.",
      ),
    ).toBeTruthy();
    // El de enviarSiVacio lo pinta el switch genérico, no el panel: aparece UNA vez.
    expect(screen.getAllByText("enviarSiVacio: debe ser sí o no.")).toHaveLength(1);
  });
});
