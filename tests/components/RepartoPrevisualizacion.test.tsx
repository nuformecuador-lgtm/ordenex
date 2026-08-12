// @vitest-environment jsdom
// Feature 205 (T5.5) — la PREVISUALIZACIÓN del reparto. Cubre R32, R33, R34, R36, R37, R38,
// R44 y R56.
//
// Lo que este archivo existe para proteger es UNA propiedad, y no es «se ve bonito»: **el
// navegador no calcula dinero**. El servidor manda cada importe ya derivado y serializado, y
// acá se pinta tal cual. Por eso casi todos los casos usan una respuesta cuyas cifras NO
// cuadran entre sí a propósito —montos que no suman el importe tecleado, un pendiente que no
// es la resta— y exigen que la pantalla enseñe las del servidor: si alguien metiera una suma o
// una resta en el cliente, esas cifras cambiarían y estos casos caerían.
//
// La segunda propiedad es que los DOS avisos de deuda son dos (R56): el recorte por el tope
// habla de dinero que se cobra en el siguiente registro, y la deuda no imputable, de dinero
// que esta pantalla no sabe pagar. Fundirlos sería mentir sobre qué se puede cobrar y cuándo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SWRConfig } from "swr";

import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";
import type { PrevisualizacionRepartoDTO } from "@/lib/types/liquidacion-reparto";

const { previsualizarMock } = vi.hoisted(() => ({ previsualizarMock: vi.fn() }));

vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...args: unknown[]) => previsualizarMock(...args),
  registrarRepartoMensajeroAction: vi.fn(),
}));

import { RepartoPrevisualizacion } from "@/app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion";

// --- Datos ---------------------------------------------------------------

const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CIERRE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/**
 * La respuesta base. **Las cifras no cuadran a propósito**: se teclean 9000 y el servidor dice
 * que se aplican 4000 + 3000. Un cliente que recalculara pintaría otra cosa.
 *
 * LOS TRES IMPUTABLES SON TRES COSAS DISTINTAS, y por eso valen tres cifras distintas. Cuando
 * los tres valían `"7000.00"`, confundir uno con otro no se veía: mutar el «como máximo se
 * pueden aplicar» para que leyera `imputableTotal` en vez de `imputable` dejaba 30 tests en
 * verde. La historia de Ana, de fuera hacia dentro:
 *
 *  - **cuenta por pagar: ₡21.150** — lo que la fila de la pantalla enseña como deuda (R37);
 *  - **₡2.300 no cuelga de ningún cierre** (ajustes manuales), así que esta pantalla no los
 *    sabe pagar → `deudaNoImputable`;
 *  - **imputable TOTAL: ₡18.850** — sus cinco cierres aprobados con saldo;
 *  - **el tope recorta**: entran los TRES más antiguos y quedan DOS fuera por ₡6.450 (R56);
 *  - **imputable: ₡12.400** — lo que UN pago puede saldar ahora (4.000 + 5.000 + 3.400).
 *
 * `21.150 = 18.850 + 2.300` y `18.850 = 12.400 + 6.450`: las dos restas cuadran, así que un
 * campo puesto en el sitio de otro cambia una cifra en pantalla.
 *
 * El `tope` va a **3** y no a 50 porque el recorte solo existe con la ventana LLENA
 * (`enVentana === tope`), y con 50 harían falta cincuenta cierres para contar la misma
 * historia. Es el mismo recurso que usan los tests del servicio, y el motivo por el que el tope
 * es inyectable. El caso de R56, más abajo, sí ejercita el tope de producción.
 *
 * Se listan DOS imputaciones y la ventana tiene TRES cierres: la lista no es la ventana, es lo
 * que el monto tecleado alcanza a cubrir.
 */
function previsualizacion(
  parcial: Partial<PrevisualizacionRepartoDTO> = {},
): PrevisualizacionRepartoDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    imputable: "12400.00",
    imputableTotal: "18850.00",
    cuentaPorPagar: "21150.00",
    deudaNoImputable: { hay: true, monto: "2300.00" },
    recorte: { aplicado: true, tope: 3, enVentana: 3, fuera: 2, montoFuera: "6450.00" },
    imputaciones: [
      {
        cierreId: CIERRE_A,
        solicitadoAt: "2026-07-28T06:00:00.000Z",
        pendienteActual: "4000.00",
        monto: "4000.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
      {
        cierreId: CIERRE_B,
        solicitadoAt: "2026-07-30T06:00:00.000Z",
        pendienteActual: "5000.00",
        monto: "3000.00",
        pendienteDespues: "2000.00",
        parcial: true,
      },
    ],
    sobrante: "0.00",
    excede: false,
    excluidos: [],
    ...parcial,
  };
}

function montar(monto = "9000.00", esperaMs = 0) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RepartoPrevisualizacion mensajeroId={MENSAJERO} monto={monto} esperaMs={esperaMs} />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previsualizarMock.mockResolvedValue({ status: "ok", previsualizacion: previsualizacion() });
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R32/R34 — se pinta lo que dice el servidor, y no se calcula nada", () => {
  it("enseña a qué cierres se aplicaría y cuánto a cada uno, TAL CUAL", async () => {
    montar();

    expect(await screen.findByText("Se aplica ₡4.000,00")).toBeInTheDocument();
    expect(screen.getByText("Se aplica ₡3.000,00")).toBeInTheDocument();
    // Y el cierre se nombra por el día trabajado, que es la antigüedad que ordena el reparto.
    expect(screen.getByText("Cierre del 2026-07-28")).toBeInTheDocument();
    expect(screen.getByText("Cierre del 2026-07-30")).toBeInTheDocument();
  });

  it("los importes del SERVIDOR mandan: se cambia uno en la respuesta y cambia el pintado", async () => {
    // Ésta es la prueba de que no hay aritmética en el cliente. Se manda el MISMO monto
    // tecleado y una respuesta distinta: si la pantalla dedujera algo del monto, pintaría lo
    // mismo que antes.
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        imputaciones: [
          {
            cierreId: CIERRE_A,
            solicitadoAt: "2026-07-28T06:00:00.000Z",
            pendienteActual: "4000.00",
            monto: "1234.56",
            pendienteDespues: "2765.44",
            parcial: true,
          },
        ],
      }),
    });
    montar();

    expect(await screen.findByText("Se aplica ₡1.234,56")).toBeInTheDocument();
    expect(screen.getByText(/Queda pendiente: ₡2\.765,44/)).toBeInTheDocument();
    // Y no aparece por ningún lado el total tecleado: acá nadie suma.
    expect(screen.queryByText(/₡9\.000,00/)).not.toBeInTheDocument();
  });

  it("no manda al servidor un monto que no tiene forma de monto: pide la lectura sin él", async () => {
    montar("no es un monto");

    expect(await screen.findByText(/Escribí un monto/)).toBeInTheDocument();
    expect(previsualizarMock).toHaveBeenCalledWith({ mensajeroId: MENSAJERO });
    // Y no se cuela un `monto` vacío en la petición: el schema del borde es `.strict()`.
    expect(previsualizarMock.mock.calls[0][0]).not.toHaveProperty("monto");
  });

  it("con monto legible, la petición lleva el monto y NUNCA un cierre (R9)", async () => {
    montar("9000.00");
    await screen.findByText("Se aplica ₡4.000,00");

    expect(previsualizarMock).toHaveBeenCalledWith({
      mensajeroId: MENSAJERO,
      monto: "9000.00",
    });
  });
});

describe("R33 — la imputación parcial va marcada, con lo que le queda a ese cierre", () => {
  it("marca la parcial y solo la parcial, y dice el resto de su cierre", async () => {
    montar();

    const marcas = await screen.findAllByText("Pago parcial");
    expect(marcas).toHaveLength(1);
    // El cierre parcial es el segundo y su resto lo dijo el servidor.
    expect(screen.getByText(/Pendiente hoy: ₡5\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/Queda pendiente: ₡2\.000,00/)).toBeInTheDocument();
  });
});

describe("R38 — el importe que no cabe se avisa ANTES de confirmar", () => {
  it("avisa con el sobrante y el máximo, los dos del servidor", async () => {
    // Se teclean ₡14.400 y la ventana solo admite ₡12.400: sobran ₡2.000.
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({ excede: true, sobrante: "2000.00" }),
    });
    montar("14400.00");

    // El máximo es el de la VENTANA (₡12.400), no el imputable total (₡18.850): decir el total
    // aquí propondría un importe que el servidor rechazaría con `excede`, que es justo lo que
    // este aviso existe para evitar.
    expect(
      await screen.findByText(
        /supera lo que se puede pagar ahora: sobran ₡2\.000,00\. Como máximo se pueden aplicar ₡12\.400,00/,
      ),
    ).toBeInTheDocument();
  });

  it("sin exceso, no hay aviso de exceso", async () => {
    montar();
    await screen.findByText("Se aplica ₡4.000,00");
    expect(screen.queryByText(/supera lo que se puede pagar/)).not.toBeInTheDocument();
  });
});

describe("R56/R37 — los DOS avisos de deuda son dos, y se distinguen", () => {
  it("con recorte aplicado dice cuántos entran, cuántos quedan y cuánto suman", async () => {
    // El tope de PRODUCCIÓN (50) con la ventana llena: 53 cierres aprobados con saldo por
    // ₡202.800, de los que entran los 50 más antiguos (₡184.300) y quedan 3 por ₡18.500. Aquí
    // toda la deuda cuelga de algún cierre, así que el OTRO aviso no tiene por qué aparecer y
    // el caso lo dice explícitamente en vez de heredarlo del fixture.
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        imputable: "184300.00",
        imputableTotal: "202800.00",
        cuentaPorPagar: "202800.00",
        deudaNoImputable: { hay: false, monto: "0.00" },
        recorte: { aplicado: true, tope: 50, enVentana: 50, fuera: 3, montoFuera: "18500.00" },
      }),
    });
    montar();

    expect(
      await screen.findByText(
        /alcanza a los 50 cierres más antiguos\. Quedan 3 cierres por ₡18\.500,00/,
      ),
    ).toBeInTheDocument();
    // Y NO aparece el otro aviso: hablan de cosas distintas.
    expect(screen.queryByText(/no corresponde a ningún cierre/)).not.toBeInTheDocument();
  });

  it("la cifra del aviso sale de `enVentana` y NO de `tope`, que es otro campo", async () => {
    // Este caso existe porque los dos campos son INDISTINGUIBLES en toda respuesta que el
    // servidor sepa construir: `recorte.aplicado` es `fuera > 0`, y que alguien quede fuera
    // exige que la ventana se haya llenado, así que `enVentana === tope` siempre que este aviso
    // se pinta. Está medido: con los cuatro fixtures «realistas» de la 205, pintar aquí
    // `recorte.tope` en vez de `recorte.enVentana` dejaba los 34 casos en verde. El invariante
    // que lo causa está fijado aparte —«con recorte, la ventana está LLENA», en
    // `tests/unit/utils/reparto-liquidacion-mensajero.test.ts`—, así que el día que deje de
    // valer, ese caso avisa.
    //
    // Por eso el `tope` va a un valor CENTINELA que hoy el servidor no puede emitir junto a un
    // recorte. No falsea nada de lo que se ve: este componente **no pinta el tope en ningún
    // sitio**, así que el centinela solo puede llegar a la pantalla por la vía de leer el campo
    // equivocado. El resto de la respuesta es la de siempre y sus cifras siguen cuadrando.
    const SENTINELA = 7;
    const ESPERADO =
      "Este pago alcanza a los 3 cierres más antiguos. " +
      "Quedan 2 cierres por ₡6.450,00, que se pagan en el siguiente registro.";
    // Autocomprobación: si el centinela apareciera dentro de la frase correcta, el caso pasaría
    // sin comprobar nada. Vale para el número y para cualquier dígito de los importes.
    expect(ESPERADO).not.toContain(String(SENTINELA));

    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        recorte: { aplicado: true, tope: SENTINELA, enVentana: 3, fuera: 2, montoFuera: "6450.00" },
      }),
    });
    montar();

    const aviso = await screen.findByText(/cierres más antiguos/);
    expect(aviso).toHaveTextContent(ESPERADO);
    // Y el centinela no llegó a la pantalla por ninguna vía.
    expect(aviso.textContent).not.toContain(String(SENTINELA));
  });

  it("con deuda no imputable lo dice, y sin ella no lo dice", async () => {
    // Cada mitad FIJA los dos interruptores, no solo el suyo: heredar el otro del fixture es lo
    // que dejaba pasar una confusión entre los dos avisos.
    // Primera mitad: los cuatro cierres del mensajero caben en la ventana (sin recorte) y suman
    // ₡12.400 de los ₡14.900 que se le deben; los ₡2.500 restantes no cuelgan de ninguno.
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        imputable: "12400.00",
        imputableTotal: "12400.00",
        cuentaPorPagar: "14900.00",
        deudaNoImputable: { hay: true, monto: "2500.00" },
        recorte: { aplicado: false, tope: 3, enVentana: 3, fuera: 0, montoFuera: "0.00" },
      }),
    });
    const { unmount } = montar();

    expect(
      await screen.findByText(
        /₡2\.500,00 de la cuenta por pagar no corresponde a ningún cierre/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cierres más antiguos/)).not.toBeInTheDocument();

    unmount();
    cleanup();
    // Segunda mitad: la deuda entera cuelga de cierres (`cuentaPorPagar === imputableTotal`),
    // así que no hay nada que avisar por ese lado. El recorte del fixture SIGUE puesto, y el
    // aviso que no debe aparecer es el otro.
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        cuentaPorPagar: "18850.00",
        deudaNoImputable: { hay: false, monto: "0.00" },
      }),
    });
    montar();
    await screen.findByText("Se aplica ₡4.000,00");
    expect(screen.queryByText(/no corresponde a ningún cierre/)).not.toBeInTheDocument();
    expect(screen.getByText(/cierres más antiguos/)).toBeInTheDocument();
  });

  it("con los DOS activos aparecen los DOS textos, distinguibles (R56)", async () => {
    previsualizarMock.mockResolvedValue({
      status: "ok",
      // Los DOS a la vez, y las cifras siguen cuadrando: 12.400 (ventana) + 4.000 (recortados)
      // = 16.400 imputables, y 16.400 + 1.500 (lo que no cuelga de ningún cierre) = 17.900 de
      // cuenta por pagar.
      previsualizacion: previsualizacion({
        imputableTotal: "16400.00",
        cuentaPorPagar: "17900.00",
        recorte: { aplicado: true, tope: 3, enVentana: 3, fuera: 2, montoFuera: "4000.00" },
        deudaNoImputable: { hay: true, monto: "1500.00" },
      }),
    });
    montar();

    const recorte = await screen.findByText(/Quedan 2 cierres por ₡4\.000,00/);
    const noImputable = screen.getByText(/₡1\.500,00 de la cuenta por pagar/);
    expect(recorte).toBeInTheDocument();
    expect(noImputable).toBeInTheDocument();
    // Dos párrafos distintos: nadie los fundió en un mensaje.
    expect(recorte).not.toBe(noImputable);
    expect(recorte.textContent).not.toContain("no corresponde a ningún cierre");
    expect(noImputable.textContent).not.toContain("cierres más antiguos");
  });
});

describe("R36 — los excluidos son un CONTEO por estado, no un listado", () => {
  it("dice cuántos hay de cada estado, con su rótulo", async () => {
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        excluidos: [
          { estado: "rechazado", cantidad: 9 },
          { estado: "solicitado", cantidad: 3 },
        ],
      }),
    });
    montar();

    expect(
      await screen.findByText(
        "Estos cierres no pueden recibir pago porque no están aprobados: 9 rechazados, 3 solicitados.",
      ),
    ).toBeInTheDocument();
  });

  it("sin excluidos, el aviso NO aparece", async () => {
    montar();
    await screen.findByText("Se aplica ₡4.000,00");
    expect(screen.queryByText(/no pueden recibir pago/)).not.toBeInTheDocument();
  });

  it("un historial largo sigue siendo UNA línea por estado: no se listan cierres", async () => {
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        excluidos: [{ estado: "rechazado", cantidad: 900 }],
      }),
    });
    montar();

    const aviso = await screen.findByText(/900 rechazados/);
    // UNA línea, no 900: ni un identificador de cierre ni una fecha en el aviso. Quien quiera
    // el inventario abre la pantalla de cierres, que es adonde lleva el enlace.
    expect(aviso.textContent).not.toContain(CIERRE_A);
    expect(aviso.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("R44 — cada cierre nombrado lleva el mismo enlace a su detalle", () => {
  it("un enlace por cierre, a `/cierres-admin?cierre=<id>` y con nombre propio", async () => {
    montar();

    const enlaces = await screen.findAllByRole("link", { name: /^Ver el cierre/ });
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0]).toHaveAttribute("href", `/cierres-admin?cierre=${CIERRE_A}`);
    expect(enlaces[1]).toHaveAttribute("href", `/cierres-admin?cierre=${CIERRE_B}`);
    // Dos enlaces distintos, dos nombres accesibles distintos: un lector de pantalla los
    // distingue sin ver la fila. El nombre CONTIENE el texto visible («Label in Name»): quien
    // dicta por voz «ver el cierre» puede activarlo.
    expect(
      screen.getByRole("link", { name: new RegExp(`^Ver el cierre\\s*\\(${CIERRE_A}\\)$`) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: new RegExp(`^Ver el cierre\\s*\\(${CIERRE_B}\\)$`) }),
    ).toBeInTheDocument();
  });
});

describe("la lectura: espera, estados y fallo", () => {
  it("espera antes de consultar y no pide una previsualización por tecla", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <RepartoPrevisualizacion mensajeroId={MENSAJERO} monto="1" esperaMs={500} />
        </SWRConfig>,
      );
      expect(previsualizarMock).toHaveBeenCalledTimes(1); // la del monto inicial

      for (const monto of ["15", "150", "1500"]) {
        rerender(
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <RepartoPrevisualizacion mensajeroId={MENSAJERO} monto={monto} esperaMs={500} />
          </SWRConfig>,
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      }
      // Tres teclas dentro de la espera: ninguna consulta nueva todavía.
      expect(previsualizarMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(previsualizarMock).toHaveBeenCalledTimes(2);
      expect(previsualizarMock).toHaveBeenLastCalledWith({
        mensajeroId: MENSAJERO,
        monto: "1500",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("mientras carga lo dice, y no finge un reparto vacío", () => {
    let resolver: ((valor: unknown) => void) | undefined;
    previsualizarMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    montar();

    expect(screen.getByRole("status")).toHaveTextContent("Calculando el reparto…");
    expect(screen.queryByText(/Se aplica/)).not.toBeInTheDocument();
    resolver?.({ status: "ok", previsualizacion: previsualizacion() });
  });

  it("un rechazo del servidor se avisa y no se pinta ningún importe", async () => {
    previsualizarMock.mockResolvedValue({ status: "forbidden" });
    montar();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo calcular el reparto. Cambiá el monto o volvé a intentarlo.",
    );
    expect(screen.queryByText(/Se aplica/)).not.toBeInTheDocument();
  });
});

describe("money-safe", () => {
  it("el componente no convierte ningún importe a número", () => {
    // La contracara de todo lo de arriba, leída del CÓDIGO: sin `Number(`, sin `parseFloat`,
    // sin `parseInt` y sin `toFixed`, en el navegador no queda forma de operar con dinero.
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx",
    );
    for (const patron of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(fuente, `patrón ${patron}`).not.toMatch(patron);
    }
    // Y tampoco trae una biblioteca de decimales por la puerta de atrás.
    expect(fuente).not.toMatch(/from\s+"(@prisma\/client|decimal\.js[^"]*)"/);
  });
});
