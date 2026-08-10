// @vitest-environment jsdom
//
// Feature 192 (F2.4, parcial) — las TARJETAS del tablero del día: R28, R29, R30, R33 y R45.
//
// Lo que se mide aquí es lo que el supervisor lee de un vistazo y lo que decide con ello:
//   - que los OCHO contadores están, y que "todavía no terminó" no se pinta como si fuera un
//     desenlace (R28);
//   - que el orden de las tarjetas es del DATO y no del azar ni del ancho (R29);
//   - que los totales son los de las tarjetas presentadas (R30);
//   - que "hoy no hay nada asignado" se dice, y no se disfraza de tablero vacío ni de error
//     (R33);
//   - que la tarjeta es un CONTROL de verdad: alcanzable con Tab y disparable con Enter. Un
//     `onClick` sobre un `div` no es un botón.
//
// Los componentes son puros: reciben todo por props. No hay SWR, ni Server Actions, ni red.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MensajeroCard } from "@/app/(app)/monitoreo/_components/MensajeroCard";
import {
  TableroDiaRejilla,
  ordenarFilasTablero,
} from "@/app/(app)/monitoreo/_components/TableroDiaRejilla";
import { TableroDiaTotales } from "@/app/(app)/monitoreo/_components/TableroDiaTotales";
import {
  TableroDiaAvisoRefresco,
  TableroDiaSkeleton,
  TableroDiaVacio,
} from "@/app/(app)/monitoreo/_components/TableroDiaEstados";
import {
  TableroDiaCabecera,
  antiguedadTexto,
} from "@/app/(app)/monitoreo/_components/TableroDiaCabecera";
import {
  ayudaBucket,
  CLAVES_BUCKET,
  CLAVES_RESULTADO,
  ETIQUETA_BUCKET,
  ETIQUETA_RESULTADO,
} from "@/app/(app)/monitoreo/_components/contadores";
import type { FilaTableroDia, TotalesTableroDia } from "@/lib/types/tablero-dia";

afterEach(() => {
  cleanup();
});

/** Fila con los ocho contadores puestos a valores DISTINTOS: así ninguno puede pasar por otro. */
const fila = (parcial: Partial<FilaTableroDia> = {}): FilaTableroDia => ({
  mensajeroId: "m-1",
  mensajeroNombre: "Ana Rojas",
  asignadas: 21,
  entregadas: 6,
  reprogramadas: 2,
  devueltas: 3,
  rechazadas: 1,
  incidentes: 4,
  sinRecoger: 2,
  enReparto: 3,
  otros: 0,
  ...parcial,
});

const tarjetaDe = (mensajeroId: string): HTMLElement => {
  const tarjeta = document.querySelector(`[data-mensajero="${mensajeroId}"]`);
  if (!(tarjeta instanceof HTMLElement)) throw new Error(`sin tarjeta ${mensajeroId}`);
  return tarjeta;
};

const contador = (raiz: HTMLElement, clave: string): HTMLElement => {
  const nodo = raiz.querySelector(`[data-contador="${clave}"]`);
  if (!(nodo instanceof HTMLElement)) throw new Error(`sin contador ${clave}`);
  return nodo;
};

describe("MensajeroCard — los ocho contadores (R28)", () => {
  it("muestra el nombre y las asignadas en la cabecera, y los ocho contadores restantes en el cuerpo", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    expect(within(tarjeta).getByText("Ana Rojas")).toBeInTheDocument();
    expect(contador(tarjeta, "asignadas")).toHaveTextContent("21");

    const esperado: Record<string, number> = {
      entregadas: 6,
      reprogramadas: 2,
      devueltas: 3,
      rechazadas: 1,
      incidentes: 4,
      sinRecoger: 2,
      enReparto: 3,
      otros: 0,
    };
    for (const [clave, valor] of Object.entries(esperado)) {
      const nodo = contador(tarjeta, clave);
      expect(nodo).toHaveTextContent(String(valor));
    }
    // Y con su etiqueta legible, no sólo el número suelto.
    for (const clave of CLAVES_RESULTADO) {
      expect(contador(tarjeta, clave)).toHaveTextContent(ETIQUETA_RESULTADO[clave]);
    }
    for (const clave of CLAVES_BUCKET) {
      expect(contador(tarjeta, clave)).toHaveTextContent(ETIQUETA_BUCKET[clave]);
    }
  });

  it("R28: los tres buckets de 'sin resultado' van SEPARADOS de los cinco desenlaces", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    const grupoResultados = tarjeta.querySelector('[data-grupo="resultados"]');
    const grupoSinResultado = tarjeta.querySelector('[data-grupo="sin-resultado"]');
    expect(grupoResultados).not.toBeNull();
    expect(grupoSinResultado).not.toBeNull();
    // Son dos bloques distintos, y ninguno contiene al otro.
    expect(grupoResultados!.contains(grupoSinResultado!)).toBe(false);

    for (const clave of CLAVES_RESULTADO) {
      expect(grupoResultados!.querySelector(`[data-contador="${clave}"]`)).not.toBeNull();
      expect(grupoSinResultado!.querySelector(`[data-contador="${clave}"]`)).toBeNull();
    }
    for (const clave of CLAVES_BUCKET) {
      expect(grupoSinResultado!.querySelector(`[data-contador="${clave}"]`)).not.toBeNull();
      expect(grupoResultados!.querySelector(`[data-contador="${clave}"]`)).toBeNull();
    }
  });

  it("R45/F5.2: 'Otros' se pinta aunque valga 0, con la ayuda que explica qué contiene", () => {
    render(<MensajeroCard fila={fila({ otros: 0 })} onSeleccionar={() => {}} />);
    const otros = contador(tarjetaDe("m-1"), "otros");

    expect(otros).toHaveTextContent(ETIQUETA_BUCKET.otros);
    expect(otros).toHaveTextContent("0");
    expect(otros).toHaveAttribute("title", ayudaBucket("otros"));
    // La ayuda nombra estatus concretos del catálogo, derivados del mapa de dominio: es lo
    // que convierte "Otros" en información en vez de en un cajón mudo. `por_recolectar_en_tienda`
    // vive ahí a propósito (R44).
    expect(ayudaBucket("otros")).toContain("Por recolectar en tienda");
  });
});

describe("MensajeroCard — es un CONTROL, no un div con onClick", () => {
  it("es alcanzable con Tab y se dispara con Enter, con el id del mensajero", async () => {
    const usuario = userEvent.setup();
    const onSeleccionar = vi.fn();
    render(<MensajeroCard fila={fila()} onSeleccionar={onSeleccionar} />);

    await usuario.tab();
    const tarjeta = tarjetaDe("m-1");
    expect(tarjeta).toHaveFocus();

    await usuario.keyboard("{Enter}");
    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith("m-1");
  });

  it("también se dispara con la barra espaciadora y con el ratón, y se expone con rol de botón", async () => {
    const usuario = userEvent.setup();
    const onSeleccionar = vi.fn();
    render(<MensajeroCard fila={fila()} onSeleccionar={onSeleccionar} />);

    const boton = screen.getByRole("button", { name: /Ana Rojas/ });
    expect(boton).toBe(tarjetaDe("m-1"));

    boton.focus();
    await usuario.keyboard("{ }");
    expect(onSeleccionar).toHaveBeenCalledWith("m-1");

    await usuario.click(boton);
    expect(onSeleccionar).toHaveBeenCalledTimes(2);
  });
});

describe("Rejilla — orden determinista (R29)", () => {
  const filas: readonly FilaTableroDia[] = [
    fila({ mensajeroId: "m-b", mensajeroNombre: "Bruno Díaz", asignadas: 5 }),
    fila({ mensajeroId: "m-z", mensajeroNombre: "Zoe Mora", asignadas: 9 }),
    // Empate en `asignadas` con Bruno: desempata el NOMBRE, ascendente.
    fila({ mensajeroId: "m-a", mensajeroNombre: "Ana Rojas", asignadas: 5 }),
  ];

  const nombresRenderizados = (): string[] =>
    [...document.querySelectorAll("[data-mensajero]")].map(
      (nodo) => nodo.getAttribute("data-mensajero") ?? "",
    );

  it("ordena por asignadas descendente y, a igualdad, por nombre ascendente", () => {
    expect(ordenarFilasTablero(filas).map((f) => f.mensajeroId)).toEqual([
      "m-z", // 9
      "m-a", // 5, "Ana" antes que "Bruno"
      "m-b", // 5
    ]);
  });

  it("el orden del DOM es ese mismo, y no depende del orden de entrada", () => {
    render(<TableroDiaRejilla filas={filas} onSeleccionar={() => {}} />);
    expect(nombresRenderizados()).toEqual(["m-z", "m-a", "m-b"]);

    cleanup();
    // Mismas filas barajadas: el orden pintado no cambia.
    render(
      <TableroDiaRejilla filas={[...filas].reverse()} onSeleccionar={() => {}} />,
    );
    expect(nombresRenderizados()).toEqual(["m-z", "m-a", "m-b"]);
  });

  it("no ordena en sitio el array recibido (las props no se mutan)", () => {
    const entrada = [...filas];
    ordenarFilasTablero(entrada);
    expect(entrada.map((f) => f.mensajeroId)).toEqual(["m-b", "m-z", "m-a"]);
  });

  it("no pinta ningún elemento de orden por breakpoint: el orden es del dato", () => {
    render(<TableroDiaRejilla filas={filas} onSeleccionar={() => {}} />);
    for (const nodo of document.querySelectorAll("[data-mensajero]")) {
      expect(nodo.getAttribute("class") ?? "").not.toMatch(/(^|[\s:])order-/);
    }
  });
});

describe("Totales (R30)", () => {
  const totales: TotalesTableroDia = {
    asignadas: 30,
    entregadas: 10,
    reprogramadas: 4,
    devueltas: 5,
    rechazadas: 3,
    incidentes: 2,
    sinRecoger: 4,
    enReparto: 2,
    otros: 0,
  };

  it("muestra la suma de CADA contador con el mismo desglose que una tarjeta", () => {
    render(<TableroDiaTotales totales={totales} />);
    const bloque = document.querySelector('[data-slot="tablero-dia-totales"]');
    expect(bloque).toBeInstanceOf(HTMLElement);
    const raiz = bloque as HTMLElement;

    expect(contador(raiz, "asignadas")).toHaveTextContent("30");
    for (const clave of [...CLAVES_RESULTADO, ...CLAVES_BUCKET]) {
      expect(contador(raiz, clave)).toHaveTextContent(String(totales[clave]));
    }
    // La identidad de R25 la garantiza el servicio; aquí sólo se comprueba que lo que se
    // pinta es coherente con ella y que ningún contador se quedó fuera del bloque.
    const suma =
      totales.entregadas +
      totales.reprogramadas +
      totales.devueltas +
      totales.rechazadas +
      totales.incidentes +
      totales.sinRecoger +
      totales.enReparto +
      totales.otros;
    expect(suma).toBe(totales.asignadas);
  });
});

describe("Estados de la pantalla (R32, R33)", () => {
  it("R33: el vacío se dice de forma EXPLÍCITA y no como error", () => {
    render(<TableroDiaVacio />);

    expect(screen.getByText(/Sin órdenes asignadas hoy/i)).toBeInTheDocument();
    expect(screen.getByText(/aparecerá aquí/i)).toBeInTheDocument();
    // No es un error: no hay ningún `role="alert"` en el estado vacío.
    expect(screen.queryByRole("alert")).toBeNull();
    // Y no se disfraza de tablero con ceros: no hay ni una tarjeta.
    expect(document.querySelector("[data-mensajero]")).toBeNull();
  });

  it("R32: el aviso de fallo de refresco es distinguible del vacío y del skeleton", () => {
    render(<TableroDiaAvisoRefresco />);
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent(/No se pudo actualizar/i);
    expect(aviso).toHaveTextContent(/últimos datos obtenidos/i);
  });

  it("el skeleton se anuncia como carga en curso y no como datos", () => {
    render(<TableroDiaSkeleton tarjetas={3} />);
    const skeleton = screen.getByRole("status");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector("[data-mensajero]")).toBeNull();
  });
});

describe("Cabecera: fecha CR + antigüedad del DATO (R34)", () => {
  const GENERADO_AT = "2026-08-08T15:00:00.000Z";

  it("calcula la antigüedad contra `generadoAt`, no contra el momento del render", () => {
    // 45 s es el PEOR CASO REAL del sistema: caché de 15 s sobre refresco de 30 s. La
    // pantalla tiene que decirlo, no anunciar "hace 0 s".
    const ahora = new Date("2026-08-08T15:00:45.000Z");
    render(
      <TableroDiaCabecera fecha="2026-08-08" generadoAt={GENERADO_AT} ahora={ahora} />,
    );

    expect(screen.getByText(/hace 45 s/i)).toBeInTheDocument();
    expect(screen.queryByText(/hace 0 s/i)).toBeNull();
  });

  it("un dato viejo se anuncia como viejo (minutos), y uno recién leído como reciente", () => {
    expect(antiguedadTexto(GENERADO_AT, new Date("2026-08-08T15:00:02.000Z"))).toMatch(
      /hace 2 s/,
    );
    expect(antiguedadTexto(GENERADO_AT, new Date("2026-08-08T15:03:00.000Z"))).toMatch(
      /hace 3 min/,
    );
  });

  it("muestra la fecha calendario CR del día representado", () => {
    render(
      <TableroDiaCabecera
        fecha="2026-08-08"
        generadoAt={GENERADO_AT}
        ahora={new Date(GENERADO_AT)}
      />,
    );
    // Sin conversión a la zona del navegador: el día pintado es el que dice el dato.
    expect(screen.getByText(/8 de agosto de 2026/i)).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("dateTime", GENERADO_AT);
  });
});
