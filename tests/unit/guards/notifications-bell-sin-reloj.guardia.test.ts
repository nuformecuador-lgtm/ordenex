import { describe, it, expect } from "vitest";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// FICHA 409 (T6.3 — R31/R32) — LA CAMPANA NO LEE EL RELOJ DEL NAVEGADOR.
//
// El instante relativo («hace 2 h», «ayer») se resuelve EN EL SERVIDOR y viaja al cliente ya
// resuelto como texto, en el campo `cuando` del DTO. Aquí se vigila la otra mitad: que nadie lo
// vuelva a calcular en el cliente.
//
// POR QUÉ ES UNA GUARDIA Y NO UN TEST DE COMPORTAMIENTO. `Date.now()` en el render de un
// componente cliente que se renderiza también en el servidor produce DOS TEXTOS DISTINTOS para el
// mismo nodo, y React lo resuelve con una discrepancia de hidratación silenciosa: no hay excepción
// que capturar ni aserto de comportamiento que se ponga rojo. La lección ya está escrita en
// `hooks/usePreferenciaSonido.ts`, que existe justo por esto.
//
// Se podría argumentar que hoy la lista vive en un `Popover.Portal` y sólo se monta al abrir, así
// que no llegaría a hidratarse. No se acepta: sería una propiedad ACCIDENTAL del componente de
// popover, y el día que alguien lo cambiara el fallo volvería, mudo.
//
// Guardia (`*.guardia.test.ts`) porque ESCANEA EL FUENTE en vez de importarlo: ningún grafo de
// imports la seleccionaría en el modo rápido, y las guardias corren siempre.

const CAMPANA = "components/shared/NotificationsBell.tsx";
const HOOK = "hooks/useNotificaciones.ts";

describe("R32 — el componente de la campana no lee el reloj", () => {
  it("el fuente no contiene `Date.now(` ni `new Date(`", () => {
    // Sin comentarios: la prosa de este árbol NOMBRA a propósito lo que el código tiene prohibido,
    // y un barrido sobre el texto crudo denunciaría la explicación en vez del defecto.
    const codigo = codigoSinComentarios(CAMPANA);

    expect(codigo).not.toContain("Date.now(");
    expect(codigo).not.toContain("new Date(");
    // Ni las vías laterales para lo mismo: formatear una fecha en el cliente es el defecto, no la
    // forma concreta de leer el reloj.
    expect(codigo).not.toContain("toLocaleDateString");
    expect(codigo).not.toContain("toLocaleTimeString");
    expect(codigo).not.toContain("Intl.RelativeTimeFormat");
  });

  it("el hook que la alimenta tampoco lo lee", () => {
    const codigo = codigoSinComentarios(HOOK);

    expect(codigo).not.toContain("Date.now(");
    expect(codigo).not.toContain("new Date(");
  });

  it("el instante se PINTA desde el campo que llega resuelto, no desde `createdAt`", () => {
    // El control positivo de las ausencias de arriba: si el componente no pintara `cuando`, las
    // tres negativas seguirían verdes con la campana sin instante ninguno.
    const codigo = codigoSinComentarios(CAMPANA);

    expect(codigo).toContain("notificacion.cuando");
    // `createdAt` sigue viajando, pero SÓLO como `title` del elemento (design §3.4).
    expect(codigo).toContain("title={notificacion.createdAt}");
  });

  it("la guardia SÍ se pone roja ante el reloj (mutación, ejercitada aquí)", () => {
    // Mismo predicado que los asertos de arriba, sobre un fuente de mentira: demuestra que
    // `not.toContain` no está pasando por vacío.
    const conReloj = "const ahora = Date.now();";
    expect(conReloj.includes("Date.now(")).toBe(true);
    expect(codigoSinComentarios(CAMPANA).includes("Date.now(")).toBe(false);
  });
});
