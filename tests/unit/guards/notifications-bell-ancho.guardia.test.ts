import { describe, it, expect } from "vitest";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// FICHA 409 (T6.4 — R22) — EL PANEL MIDE 400 px, Y ESO NO SE PUEDE MEDIR EN jsdom.
//
// El contrato visual (`design-notificaciones/Main.dc.html`) dibuja el panel con `width: 400px`, y
// hay una razón funcional detrás: el bloque accionable lleva título, línea de contexto, botón de
// atajo e instante en la MISMA fila de contenido. Con los 320 px de antes (`w-80`), el botón y el
// instante se apilan y cada aviso ocupa el doble de alto.
//
// jsdom no calcula layout: `getBoundingClientRect()` devuelve ceros y ningún test de componente
// puede afirmar el ancho. Por eso se afirma sobre el FUENTE, que es donde el ancho está declarado.
//
// La equivalencia, escrita para que nadie la «corrija»: en Tailwind v4 `w-100` es
// `calc(var(--spacing) * 100)`, y `--spacing` conserva su valor por defecto de `0.25rem` en
// `app/globals.css` (no se redefine). 100 × 0.25rem = 25rem = **400 px**.

const CAMPANA = "components/shared/NotificationsBell.tsx";

describe("R22 — el panel declara 400 px de contenido", () => {
  it("el popup usa `w-100` y ya no `w-80`", () => {
    const fuente = codigoSinComentarios(CAMPANA);

    expect(fuente).toContain("w-100");
    expect(fuente).not.toContain("w-80");
  });

  it("el ancho va sobre el POPUP, no sobre cualquier otro nodo suelto", () => {
    // Sin esta mitad, un `w-100` escondido en un chip pasaría y el panel seguiría estrecho.
    const fuente = codigoSinComentarios(CAMPANA);

    expect(fuente).toMatch(/<Popover\.Popup\s+className="[^"]*\bw-100\b/);
  });

  it("sigue acotado por el ancho de la ventana en pantallas estrechas", () => {
    // 400 px fijos en un teléfono de 360 px desbordan la pantalla: el `max-w` es parte del
    // requisito, no un adorno.
    expect(codigoSinComentarios(CAMPANA)).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("la guardia SÍ se pone roja si vuelve el ancho viejo (mutación, ejercitada aquí)", () => {
    // Mismo predicado sobre un fuente de mentira, para que las negativas de arriba no puedan
    // pasar por vacío.
    const mutado = '<Popover.Popup className="flex w-80 max-w-[calc(100vw-2rem)]">';
    expect(mutado.includes("w-80")).toBe(true);
    expect(/<Popover\.Popup\s+className="[^"]*\bw-100\b/.test(mutado)).toBe(false);
  });
});
