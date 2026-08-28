// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import {
  capturaCuadra,
  centimosNoCapturables,
  cuadreInalcanzable,
  lineasIniciales,
  type LineaEnEdicion,
} from "@/app/(app)/mis-asignaciones/_components/desglose-captura";
import {
  DESGLOSE_TEXTOS,
  mensajeDeCuadre,
  montoExacto,
} from "@/components/shared/DesglosePagoField";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { formatMonto, monedaConfig, SIN_MONTO_RAYA } from "@/lib/config/moneda";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

/**
 * FEATURE 300 — la pantalla de entrega decía «Diferencia ₡0» y, debajo, que el desglose no
 * cuadraba.
 *
 * EL DEFECTO, reportado con captura el 2026-08-27: con un monto a cobrar de 11.898,81 el
 * resumen pintaba «A cobrar ₡11.899 · Capturado ₡11.899 · Diferencia ₡0» —el formateador de la
 * 230 redondea— y a la vez el error «El desglose debe sumar exactamente el monto a cobrar»,
 * porque `capturaCuadra` compara contra el valor EXACTO. La pantalla afirmaba que cuadra y que
 * no cuadra en el mismo golpe de vista, el mensajero se quedaba bloqueado sin un número al que
 * apuntar, y hubo que redondear 14 órdenes a mano en la base para desbloquearlas.
 *
 * LO QUE SE ARREGLA, y lo que NO:
 *  - SÍ: lo que se MUESTRA y lo que se COMPARA vuelven a ser el mismo número (`montoExacto`).
 *  - SÍ: cuando el cuadre es IMPOSIBLE, el aviso lo dice con la cifra real delante.
 *  - NO: no se admiten decimales en el input (decisión razonada en `DesglosePagoField`).
 *  - NO: no se afloja la regla de que el desglose cuadre exacto. El mensajero sigue bloqueado
 *    en ese caso — pero ahora sabe por qué y a quién avisar. Un bloqueo explicado es aceptable;
 *    uno que se contradice, no.
 *
 * La entrada de órdenes con céntimos la cierra la ficha 299; esto es la red para las que ya
 * existen o lleguen por otra vía.
 */

vi.mock("@/lib/actions/mis-asignaciones", () => ({
  gestionar: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const gestionarMock = vi.mocked(gestionar);

/** El monto EXACTO de la captura que reportó el humano. */
const CON_CENTIMOS = 11898.81;
/** El monto de una orden SANA: el caso de casi todas, que no puede cambiar de aspecto. */
const SANO = 8000;

/** El importe tal como lo pinta la configuración de moneda (nunca un `₡` escrito a mano). */
function conMoneda(monto: number): string {
  return formatMonto(monto, SIN_MONTO_RAYA);
}

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: SANO,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
    ...over,
  };
}

function foto(nombre: string): File {
  return new File(["x"], nombre, { type: "image/jpeg" });
}

/** Monta el panel con el puntero ya fijado y abre la rama de entrega. */
async function abrirEntrega(
  user: ReturnType<typeof userEvent.setup>,
  over: Partial<MiAsignacionDTO> = {},
) {
  render(
    <GestionarOrdenPanel
      orden={makeOrden(over)}
      yaActiva
      onGestionarPedido={vi.fn().mockResolvedValue(true)}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      onAbrirChat={vi.fn()}
      count={1}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Entregar" }));
}

function inputMonto(n: number): HTMLInputElement {
  return screen.getByRole("textbox", { name: `Monto línea ${n}` }) as HTMLInputElement;
}

function botonGuardar(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Guardar gestión" }) as HTMLButtonElement;
}

async function elegirMetodo(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  etiqueta: string,
) {
  await user.click(screen.getByRole("combobox", { name: `Método de pago línea ${n}` }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: etiqueta }));
}

function escribirMonto(n: number, valor: string) {
  fireEvent.change(inputMonto(n), { target: { value: valor } });
}

async function subirFoto(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Foto de evidencia de entrega"), foto("a.jpg"));
  await vi.waitFor(() =>
    expect(
      within(screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" })).getAllByRole(
        "img",
      ),
    ).toHaveLength(1),
  );
}

/** Los tres importes del resumen, en su orden: a cobrar, capturado, diferencia. */
function resumen(): (string | null)[] {
  return within(screen.getByLabelText("Resumen del cobro"))
    .getAllByRole("definition")
    .map((d) => d.textContent);
}

/**
 * Los avisos DEL EDITOR de pago, no los de la pantalla entera: el panel monta además el hilo de
 * notas, que en este montaje sin sesión pinta su propio error («no se pudieron cargar las
 * notas») y no tiene nada que ver con el cuadre. Se acota al contenedor del editor, igual que
 * hace `GestionarOrdenPanelPagos.test.tsx` para leer el error del servidor.
 */
function alertas(): (string | null)[] {
  const editor = screen.getByLabelText("Resumen del cobro").parentElement as HTMLElement;
  return within(editor)
    .queryAllByRole("alert")
    .map((a) => a.textContent);
}

function linea(metodo: LineaEnEdicion["metodo"], monto: string): LineaEnEdicion {
  return { id: `l-${metodo}-${monto}`, metodo, monto };
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", ordenId: "g1", estado: "entregada" });
});

afterEach(() => {
  cleanup();
});

describe("feature 300 · lo mostrado y lo comparado son el MISMO número", () => {
  it("CONTROL DE NO-VACUIDAD: el formateador de siempre SÍ borra la diferencia de este monto", () => {
    // De aquí venía la contradicción, y se deja medido para que nadie lea el resto del archivo
    // como una precaución teórica: por el camino de `money()`, el monto real y el redondeo que
    // el mensajero teclea son LA MISMA CADENA, y la diferencia entre los dos se pinta como cero.
    expect(conMoneda(CON_CENTIMOS)).toBe(conMoneda(11899));
    expect(conMoneda(CON_CENTIMOS - 11899)).toBe(conMoneda(0));

    // El formateador nuevo los distingue, que es justo lo que faltaba.
    expect(montoExacto(CON_CENTIMOS)).not.toBe(montoExacto(11899));
    expect(montoExacto(CON_CENTIMOS - 11899)).not.toBe(montoExacto(0));
  });

  it("con un monto ENTERO, `montoExacto` es el formateador de siempre byte a byte", () => {
    // La red de la regresión: si esto se rompe, cambian TODAS las pantallas sanas del editor.
    const enteros = [0, 1, 320, 999, 1000, 8000, 9999, 11898, 11899, 1234567];
    for (const monto of enteros) {
      expect(montoExacto(monto), `${monto} cambió de aspecto`).toBe(conMoneda(monto));
      expect(montoExacto(-monto)).toBe(conMoneda(-monto));
    }
  });

  it("la cola decimal solo aparece cuando la hay, y con el signo delante del símbolo", () => {
    // El separador se lee de configuración, nunca se escribe a mano (`docs/architecture.md`).
    const coma = monedaConfig.separadorDecimal;
    expect(montoExacto(CON_CENTIMOS)).toBe(`${conMoneda(11898)}${coma}81`);
    expect(montoExacto(0.81)).toBe(`${conMoneda(0)}${coma}81`);
    // El cero a la izquierda de la cola no se pierde: «₡0,05», no «₡0,5».
    expect(montoExacto(0.05)).toBe(`${conMoneda(0)}${coma}05`);
    expect(montoExacto(-0.19)).toBe(`-${conMoneda(0)}${coma}19`);
  });
});

describe("feature 300 · el aviso del cuadre distingue «falta teclear» de «no se puede teclear»", () => {
  it("el bloqueo es REAL, no un mensaje pesimista: ninguna captura entera cuadra 11.898,81", () => {
    expect(cuadreInalcanzable(CON_CENTIMOS)).toBe(true);
    expect(centimosNoCapturables(CON_CENTIMOS)).toBe(81);
    // Se prueban los enteros de alrededor, incluido el redondeo que la pantalla proponía.
    for (const intento of ["11897", "11898", "11899", "11900"]) {
      expect(capturaCuadra([linea("efectivo", intento)], CON_CENTIMOS), intento).toBe(false);
    }
    // Y partirlo en dos métodos tampoco: dos enteros suman un entero.
    expect(capturaCuadra([linea("efectivo", "5000"), linea("SINPE", "6898")], CON_CENTIMOS)).toBe(
      false,
    );
  });

  it("con céntimos, el aviso NO es el de siempre y lleva los dos números reales", () => {
    const aviso = mensajeDeCuadre([linea("efectivo", "11898")], CON_CENTIMOS);

    expect(aviso).not.toBe(DESGLOSE_TEXTOS.noCuadra);
    expect(aviso).toContain(montoExacto(CON_CENTIMOS)); // el monto de verdad
    expect(aviso).toContain(montoExacto(0.81)); // lo que no se puede teclear
  });

  it("con un monto entero, el aviso es EXACTAMENTE el de siempre —o ninguno—", () => {
    expect(mensajeDeCuadre(lineasIniciales(SANO), SANO)).toBeUndefined();
    expect(mensajeDeCuadre([linea("efectivo", "5000")], SANO)).toBe(DESGLOSE_TEXTOS.noCuadra);
    expect(cuadreInalcanzable(SANO)).toBe(false);
    expect(centimosNoCapturables(SANO)).toBe(0);
  });
});

describe("feature 300 · lo que ve el mensajero con la orden de la captura", () => {
  it("el caso reportado: NUNCA «Diferencia ₡0» junto a un error de descuadre", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user, { montoCobrar: CON_CENTIMOS });

    const [aCobrar, capturado, diferencia] = resumen();

    // 1. El monto a cobrar se enseña COMO ES. La pantalla vieja decía «₡11.899», que es el
    //    número que el mensajero tecleaba y el que el sistema rechazaba.
    expect(aCobrar).toBe(montoExacto(CON_CENTIMOS));
    expect(aCobrar).not.toBe(conMoneda(11899));

    // 2. La línea nace con lo MÁXIMO que el editor admite, no con un valor por encima de su
    //    propio tope (el `Math.round` de `textoDeMonto` proponía 11.899).
    expect(inputMonto(1).value).toBe("11898");
    expect(capturado).toBe(conMoneda(11898));

    // 3. LA CONTRADICCIÓN, muerta: la diferencia ya no se pinta como cero mientras hay error.
    expect(diferencia).toBe(montoExacto(0.81));
    expect(diferencia).not.toBe(conMoneda(0));

    // 4. Y el aviso explica el bloqueo con la cifra delante, en vez de pedir lo imposible.
    expect(alertas()).not.toContain(DESGLOSE_TEXTOS.noCuadra);
    const aviso = alertas().find((t) => t?.includes(montoExacto(CON_CENTIMOS)));
    expect(aviso, "el aviso no nombra el monto real").toBeDefined();
    expect(aviso).toContain(montoExacto(0.81));
  });

  it("teclear el redondeo ya no cuela: el tope acota y la entrega sigue bloqueada", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user, { montoCobrar: CON_CENTIMOS });

    await elegirMetodo(user, 1, "Efectivo");
    escribirMonto(1, "11899"); // lo que la pantalla vieja pre-cargaba
    expect(inputMonto(1).value).toBe("11898"); // el tope, que ahora sí acota

    await subirFoto(user); // lo único que falla es el cuadre
    expect(botonGuardar()).toBeDisabled();
    fireEvent.click(botonGuardar());
    expect(gestionarMock).not.toHaveBeenCalled();

    // Y el resumen sigue siendo coherente consigo mismo: hay diferencia y se ve.
    expect(resumen()[2]).toBe(montoExacto(0.81));
    expect(alertas().some((t) => t?.includes(montoExacto(0.81)))).toBe(true);
  });
});

describe("feature 300 · la orden SANA se entrega exactamente igual que ayer", () => {
  it("el resumen de un monto entero no cambia ni un carácter y no hay ningún aviso", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    expect(resumen()).toEqual([conMoneda(SANO), conMoneda(SANO), conMoneda(0)]);
    expect(alertas()).toEqual([]);
  });

  it("un descuadre normal sigue diciendo la frase de siempre", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    await elegirMetodo(user, 1, "Efectivo");
    escribirMonto(1, "5000");

    expect(alertas()).toContain(DESGLOSE_TEXTOS.noCuadra);
    expect(resumen()).toEqual([conMoneda(SANO), conMoneda(5000), conMoneda(3000)]);
    expect(botonGuardar()).toBeDisabled();
  });

  it("y la entrega llega hasta la action con el mismo `FormData` de siempre", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    await elegirMetodo(user, 1, "Efectivo");
    await subirFoto(user);
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("montoRecibido")).toBe("8000");
    expect(fd.getAll("pagoMetodo")).toEqual(["efectivo"]);
    expect(fd.getAll("pagoMonto")).toEqual(["8000"]);
  });
});
