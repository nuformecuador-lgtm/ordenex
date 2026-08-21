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

import { readFileSync } from "node:fs";
import path from "node:path";

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
  CLAVES_CONTADOR,
  CLAVES_RESULTADO,
  COLOR_SEGMENTO,
  ETIQUETA_BUCKET,
  ETIQUETA_RESULTADO,
  VARIANTE_CONTADOR,
} from "@/app/(app)/monitoreo/_components/contadores";
import { iniciales } from "@/app/(app)/monitoreo/_components/filtrar-mensajeros";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import type {
  FilaTableroDia,
  PuntoRitmoEntregas,
  TotalesTableroDia,
} from "@/lib/types/tablero-dia";
import { quitarComentarios } from "../fixtures/sin-comentarios";

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

/**
 * FEATURE 258 — la serie que la tira de totales pasa a `GraficaLineas`. Coherente con los
 * totales de abajo (su último punto es `entregadas`), como la produce el servicio.
 */
const RITMO: readonly PuntoRitmoEntregas[] = [
  { hora: 0, acumulado: 0 },
  { hora: 1, acumulado: 4 },
  { hora: 2, acumulado: 10 },
];

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
    render(<TableroDiaTotales totales={totales} ritmoEntregas={RITMO} />);
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

/* ══════════════════════════════════════════════════════════════════════════════════════════
   FEATURE 258 (F1.4) — los ocho contadores sobre la primitiva `Badge`.
   Mapea: R15, R16, R17, R18, R46, R47, R71.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe("Feature 258 · R15/R16/R17 — cada contador es un `Badge` con su variante", () => {
  it("los ocho contadores son `Badge`, no un `div` con clases propias", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    for (const clave of CLAVES_CONTADOR) {
      expect(
        contador(tarjeta, clave).getAttribute("data-slot"),
        `el contador ${clave} no es la primitiva Badge`,
      ).toBe("badge");
    }
    // La cifra titular NO es uno de los ocho: es el número grande de la tarjeta y se queda
    // como estaba. Si pasara a `Badge`, dejaría de leerse de un vistazo.
    expect(contador(tarjeta, "asignadas").getAttribute("data-slot")).not.toBe("badge");
  });

  it("la variante de cada contador es EXACTAMENTE la que dice el mapa, por CLAVE", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    // Se compara contra el MAPA, no contra una clase escrita a mano: un test que afirmara
    // `bg-success-soft` seguiría verde el día que la primitiva cambie sus clases, y rojo el
    // día que las mejore. Lo que esta feature decide es la VARIANTE.
    for (const clave of CLAVES_CONTADOR) {
      expect(contador(tarjeta, clave).getAttribute("data-variant")).toBe(
        VARIANTE_CONTADOR[clave],
      );
    }
  });

  it("el mapa cubre las OCHO claves y ninguna más (exhaustivo, R16)", () => {
    // El `satisfies Record<…>` ya lo garantiza en compilación; esto lo afirma también en
    // ejecución, que es lo que queda vivo si alguien afloja el tipo a `Record<string, …>`.
    expect(Object.keys(VARIANTE_CONTADOR).sort()).toEqual([...CLAVES_CONTADOR].sort());
    expect(Object.keys(COLOR_SEGMENTO).sort()).toEqual([...CLAVES_CONTADOR].sort());
  });

  it("R17: las claves del mapa son CLAVES DE CONTADOR, nunca values del catálogo de estatus", () => {
    // `entregada` (value de estatus) con un color al lado dispara el censo de la cláusula (f)
    // de `frontera.guardia.test.ts`. `entregadas` (clave de contador) no. La diferencia es una
    // letra y es la razón por la que el mapa se clava así.
    for (const clave of Object.keys(VARIANTE_CONTADOR)) {
      expect(
        (ORDER_STATUS_SEED as readonly string[]).includes(clave),
        `${clave} es un value del catálogo de estatus: el mapa quedó clavado por estatus`,
      ).toBe(false);
    }
  });

  it("en densidad COMPACTA la etiqueta sale de la vista pero NO del nombre accesible (R45)", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} densidad="compacta" />);
    const chip = contador(tarjetaDe("m-1"), "entregadas");

    // El texto sigue completo (`sr-only` no lo saca del DOM): etiqueta + cifra.
    expect(chip).toHaveTextContent(ETIQUETA_RESULTADO.entregadas);
    expect(chip).toHaveTextContent("6");
    // Y lo que cambia es SÓLO que deja de verse.
    const etiquetaVisible = [...chip.querySelectorAll("span")].find((s) =>
      s.textContent?.includes(ETIQUETA_RESULTADO.entregadas),
    );
    expect(etiquetaVisible?.className).toContain("sr-only");
  });
});

describe("Feature 258 · R46/R47 — ni un hex ni una utilidad de paleta cruda", () => {
  // Censo de FUENTE: lo que se mide es el código, no lo renderizado. Un hex escrito en un
  // `style` no se ve en el DOM de jsdom hasta que alguien mira ese nodo concreto.
  const FUENTES = [
    "app/(app)/monitoreo/_components/contadores.ts",
    "app/(app)/monitoreo/_components/ContadoresTablero.tsx",
    "app/(app)/monitoreo/_components/ComposicionBarra.tsx",
    "app/(app)/monitoreo/_components/MensajeroCard.tsx",
    "app/(app)/monitoreo/_components/TableroDiaTotales.tsx",
  ] as const;

  it.each(FUENTES)("%s no escribe ningún color a mano", (ruta) => {
    const codigo = quitarComentarios(
      readFileSync(path.join(process.cwd(), ruta), "utf8"),
    );
    expect(codigo, "hay un hex suelto: el color sale de los tokens de globals.css").not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );
    expect(
      codigo,
      "hay una utilidad de paleta cruda de Tailwind: el color sale de los tokens semánticos",
    ).not.toMatch(
      /\b(?:bg|text|border|ring|fill|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    );
    // R18 — el identificador está censado por la guardia de frontera; se afirma también aquí
    // porque este archivo es el que lo tendría más a mano.
    expect(codigo).not.toContain("badgeVariants");
  });
});

describe("Feature 258 · R71 — el avatar de iniciales", () => {
  it("es decorativo y el nombre completo sigue presente como texto", () => {
    render(
      <MensajeroCard
        fila={fila({ mensajeroNombre: "Ángela Jiménez" })}
        onSeleccionar={() => {}}
      />,
    );
    const tarjeta = tarjetaDe("m-1");

    // Dos iniciales no identifican a nadie: el nombre entero se queda.
    expect(within(tarjeta).getByText("Ángela Jiménez")).toBeInTheDocument();

    const avatar = [...tarjeta.querySelectorAll('[aria-hidden="true"]')].find(
      (nodo) => nodo.textContent === iniciales("Ángela Jiménez"),
    );
    expect(avatar, "no hay avatar con las iniciales del nombre").toBeDefined();
    expect(iniciales("Ángela Jiménez")).toBe("ÁJ");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
   FEATURE 258 — LA ETIQUETA SE LEE ENTERA Y LA CIFRA NO SE RECORTA NUNCA.

   Dos defectos encadenados, los dos vistos en la app con datos reales y ninguno visible desde
   la suite:

   1. (2026-08-21, viewport 1440, columna de 109 px) el chip de «Reprogramadas» daba
      `scrollWidth > clientWidth` y su NÚMERO quedaba fuera de la caja visible.
   2. el arreglo por elipsis salvó el número pero dejó «Reprograma…» a la vista. Decisión del
      humano: la etiqueta ENTERA y la cifra, las dos legibles, a cualquier ancho.

   ⚠️ POR QUÉ NO VALE UN TEST DE `textContent`: en los dos casos el texto seguía COMPLETO en el
   DOM. `toHaveTextContent("Reprogramadas")` y `toHaveTextContent("1")` pasaban con los dos
   defectos puestos, y con ellos los otros 16.800 tests de la suite. Un contador que no se
   puede leer no es un contador, y ninguna aserción sobre texto lo distingue de uno que sí.

   ⚠️ Y TAMPOCO SE PUEDE MEDIR AQUÍ: jsdom no hace layout, así que `scrollWidth` y
   `clientWidth` valen 0 para todo. La medición de verdad se hizo en el navegador y está en
   `progress/impl_258_frontend.md`; lo que se fija aquí es la ANATOMÍA que produce ese
   resultado, que es lo único afirmable sin layout y lo que de verdad decide el desenlace:
   quién puede envolverse (la etiqueta), quién no puede encogerse (la cifra) y que la caja
   pueda crecer a dos líneas.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe("Feature 258 · la etiqueta se lee ENTERA y la cifra no se recorta nunca", () => {
  const partes = (chip: HTMLElement) => {
    const etiqueta = chip.querySelector('[data-parte="etiqueta"]');
    const valor = chip.querySelector('[data-parte="valor"]');
    if (!(etiqueta instanceof HTMLElement) || !(valor instanceof HTMLElement)) {
      throw new Error("el contador no separa etiqueta y cifra en dos cajas");
    }
    return { etiqueta, valor };
  };

  const clases = (nodo: HTMLElement) => nodo.className.split(/\s+/);

  it.each(["comoda", "compacta"] as const)(
    "en densidad %s la cifra NO puede encogerse, en ninguno de los ocho",
    (densidad) => {
      render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} densidad={densidad} />);
      const tarjeta = tarjetaDe("m-1");

      for (const clave of CLAVES_CONTADOR) {
        const { etiqueta, valor } = partes(contador(tarjeta, clave));

        // Son DOS cajas distintas: si compartieran nodo, lo que le pase a la etiqueta le pasa
        // al número por el mismo sitio.
        expect(etiqueta).not.toBe(valor);
        expect(
          clases(valor),
          `la cifra de ${clave} puede encogerse: con la etiqueta larga se sale de la caja`,
        ).toContain("shrink-0");
        // Y nunca con puntos suspensivos: un número a medias es un número falso.
        expect(clases(valor)).not.toContain("truncate");
      }
    },
  );

  it("en densidad cómoda la etiqueta NUNCA se parte dentro de una palabra", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    for (const clave of CLAVES_CONTADOR) {
      const chip = contador(tarjeta, clave);
      const { etiqueta } = partes(chip);

      // ⛔ `truncate` es exactamente el arreglo que el humano rechazó: deja «Reprograma…».
      expect(
        clases(etiqueta),
        `la etiqueta de ${clave} vuelve a truncarse: se lee a medias`,
      ).not.toContain("truncate");
      // ⛔ Y TAMPOCO `break-words`, que es el segundo arreglo que hubo que deshacer: evita
      // el recorte partiendo la palabra por dentro («Reprogramad / as»), y eso no es «la
      // etiqueta completa», es la etiqueta rota. Sin ninguna de las dos clases el navegador
      // sólo puede cortar ENTRE palabras, que es lo que se pidió.
      //
      // ⚠️ Y ojo: este caso NO lo cazaba el test de recorte. Una palabra partida NO desborda
      // —cabe, rompiéndose—, así que `scrollWidth > clientWidth` daba false y la suite pasaba
      // con el defecto a la vista. Por eso hace falta esta aserción además de aquélla.
      expect(
        clases(etiqueta),
        `la etiqueta de ${clave} puede partirse dentro de una palabra`,
      ).not.toContain("break-words");
      expect(clases(etiqueta)).not.toContain("break-all");
      // Y la caja tiene que poder crecer: con el `h-5` del Badge, dos líneas no caben y la
      // segunda quedaría cortada por el `overflow-hidden`.
      expect(
        clases(chip),
        "el chip conserva el alto fijo del Badge: la segunda línea se corta",
      ).toContain("h-auto");
      expect(clases(chip)).toContain("whitespace-normal");
      // Dos líneas de verdad: la etiqueta ocupa el ancho entero y la cifra va debajo.
      expect(clases(chip)).toContain("flex-col");
      expect(clases(etiqueta)).toContain("w-full");
    }
  });

it("las columnas se deciden por el ANCHO REAL de la caja, no por el viewport", () => {
    // ⚠️ ESTA CLÁUSULA ES LA QUE SOSTIENE LAS DE ARRIBA. Sin `truncate` (recortaría) y sin
    // `break-words` (partiría la palabra), lo ÚNICO que impide que «Reprogramadas» se salga
    // de su caja es que la caja sea bastante ancha. Y eso no se puede fiar al viewport: la
    // misma pantalla de 768 px da una tarjeta de 189 px —donde sólo cabe UNA columna— y una
    // tira de 700 px, donde caben tres. Por eso los umbrales son de CONTENEDOR (`@[...]`),
    // medidos contra el ancho real de la caja que los contiene.
    //
    // Los umbrales salen de una medición en el navegador, no de una estimación:
    // «Reprogramadas» pide 99,6 px y «recoger» 47 px (ver progress/impl_258_frontend.md).
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    const raiz = tarjeta.querySelector('[data-grupo="resultados"]')?.parentElement as HTMLElement;
    expect(
      raiz.className.split(/\s+/),
      "sin un contenedor de consulta, los umbrales `@[...]` no se resuelven contra nada",
    ).toContain("@container");

    const rejilla = (grupo: string) =>
      (tarjeta.querySelector(`[data-grupo="${grupo}"] .grid`) as HTMLElement).className;

    // Los cinco desenlaces: la caja más exigente («Reprogramadas»).
    expect(rejilla("resultados")).toContain("grid-cols-1");
    expect(rejilla("resultados")).toMatch(/@\[\d+rem\]:grid-cols-2/);
    expect(rejilla("resultados")).toMatch(/@\[\d+rem\]:grid-cols-3/);
    // Los tres cubos: palabras más cortas, así que llegan a tres columnas mucho antes.
    expect(rejilla("sin-resultado")).toContain("grid-cols-1");
    expect(rejilla("sin-resultado")).toMatch(/@\[\d+rem\]:grid-cols-3/);
  });

  it("en densidad compacta no hay etiqueta VISIBLE que pueda empujar a la cifra", () => {
    // Ahí el chip vuelve a ser de una línea a propósito: sin etiqueta a la vista no hay nada
    // que disputarle el ancho al número. La etiqueta sigue en el DOM (R45).
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} densidad="compacta" />);
    const tarjeta = tarjetaDe("m-1");

    for (const clave of CLAVES_CONTADOR) {
      const { etiqueta } = partes(contador(tarjeta, clave));
      expect(clases(etiqueta)).toContain("sr-only");
    }
    // Y el nombre accesible no pierde nada.
    expect(contador(tarjeta, "reprogramadas")).toHaveTextContent(
      ETIQUETA_RESULTADO.reprogramadas,
    );
  });

  it("la etiqueta completa sigue en el DOM y en el `title`, y los cubos conservan su ayuda", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");

    // El caso medido: la etiqueta más larga de las ocho.
    const chip = contador(tarjeta, "reprogramadas");
    expect(chip).toHaveTextContent(ETIQUETA_RESULTADO.reprogramadas);
    expect(chip).toHaveTextContent("2");
    expect(chip.getAttribute("title")).toContain(ETIQUETA_RESULTADO.reprogramadas);

    // Los tres cubos conservan su ayuda EXACTA: el `title` de la 192 no se pisa.
    for (const clave of CLAVES_BUCKET) {
      expect(contador(tarjeta, clave)).toHaveAttribute("title", ayudaBucket(clave));
    }
  });

  it("«Reprogramadas» no es un caso especial: los ocho de la tira se reparten igual", () => {
    // El defecto se vio en una, pero la rejilla baja a 2 columnas en pantallas estrechas y ahí
    // «Sin recoger» y «En reparto» corren el mismo riesgo. La garantía es estructural, así que
    // es la misma para las ocho y para cualquier ancho.
    render(<TableroDiaTotales totales={{ ...fila() }} ritmoEntregas={RITMO} />);
    const tira = document.querySelector('[data-slot="tablero-dia-totales"]') as HTMLElement;

    for (const clave of CLAVES_CONTADOR) {
      const { etiqueta, valor } = partes(contador(tira, clave));
      expect(clases(valor)).toContain("shrink-0");
      expect(clases(etiqueta)).not.toContain("truncate");
      expect(clases(etiqueta)).not.toContain("break-words");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
   FEATURE 258 — LA CABECERA DE LA TARJETA NO DESBORDA SU CAJA.

   El cuarto defecto de la serie, y el que enseña la lección de método: las tres mediciones
   anteriores estaban verdes porque las tres medían LOS CONTADORES. Esto estaba en la cabecera.

   Medido: entre ~768 y ~830 px coinciden la barra lateral aún desplegada y la rejilla ya en
   dos columnas, así que cada tarjeta cae a ~226 px. La cabecera pedía **259 px fijos** —su
   `scrollWidth` no bajaba de ahí por mucho que encogiera la tarjeta— y el «13» de asignadas se
   leía «1» y «Asignadas» se leía «Asignada». Y NO SCROLLEA: `Card` es `overflow-hidden` y el
   shell usa `overflow-x-clip`, así que lo que no cabe **desaparece en silencio**.

   La causa, localizada midiendo y no suponiendo: `CardHeader` es una rejilla
   `grid-cols-[1fr_auto]`, y `1fr` es `minmax(auto, 1fr)` — su mínimo es el MIN-CONTENT del
   item. Con el avatar (`shrink-0`) y el nombre en `nowrap` (por el `truncate`), ese min-content
   valía 175 px y la columna se negaba a bajar de ahí.

   ⚠️ En jsdom no hay layout, así que esto no se mide aquí: se fija el MECANISMO que lo
   produce, igual que con `shrink-0` en los contadores. La medición vive en el informe.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe("Feature 258 · la cabecera de la tarjeta cede por el NOMBRE, nunca por la cifra", () => {
  const clases = (nodo: Element) =>
    (nodo.getAttribute("class") ?? "").split(" ").filter(Boolean);

  it("el título puede encogerse: sin `min-w-0` la columna se niega a bajar de su min-content", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const titulo = tarjetaDe("m-1").querySelector('[data-slot="card-title"]');
    expect(titulo).not.toBeNull();

    expect(
      clases(titulo!),
      "sin `min-w-0` la cabecera pide un ancho fijo y la tarjeta la recorta en silencio " +
        "(`Card` es overflow-hidden y el shell `overflow-x-clip`: no hay barra de scroll)",
    ).toContain("min-w-0");
  });

  it("quien cede es el NOMBRE, con puntos suspensivos", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const tarjeta = tarjetaDe("m-1");
    const titulo = tarjeta.querySelector('[data-slot="card-title"]') as HTMLElement;

    // Un nombre propio SÍ puede truncar: lo que no puede es desaparecer una cifra.
    const nombre = [...titulo.querySelectorAll("span")].find(
      (s) => s.textContent === "Ana Rojas",
    );
    expect(nombre, "el nombre no está en su propia caja truncable").toBeDefined();
    expect(clases(nombre!)).toContain("truncate");
    expect(clases(nombre!)).toContain("min-w-0");
    // Y sigue completo en el DOM y en el nombre accesible del control.
    expect(tarjeta).toHaveTextContent("Ana Rojas");
    expect(tarjeta.getAttribute("aria-label")).toContain("Ana Rojas");
  });

  it("la cifra de asignadas NO cede, igual que las ocho de los contadores", () => {
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const asignadas = contador(tarjetaDe("m-1"), "asignadas");

    expect(
      clases(asignadas),
      "la cifra titular puede encogerse: con la tarjeta estrecha se recorta a «1» sobre «13»",
    ).toContain("shrink-0");
    expect(clases(asignadas)).not.toContain("truncate");
    expect(asignadas).toHaveTextContent("21");
  });

  it("el avatar no roba ancho al nombre: es de tamaño fijo y no crece", () => {
    // El avatar es de esta ficha (R71) y es la mitad del estrechón: 28 px + el hueco.
    render(<MensajeroCard fila={fila()} onSeleccionar={() => {}} />);
    const titulo = tarjetaDe("m-1").querySelector('[data-slot="card-title"]') as HTMLElement;
    const avatar = titulo.querySelector('[aria-hidden="true"]') as HTMLElement;

    expect(clases(avatar)).toContain("shrink-0");
  });
});
