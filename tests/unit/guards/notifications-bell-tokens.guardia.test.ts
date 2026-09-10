import { describe, it, expect } from "vitest";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// FICHA 409 (T6.4 — R27) — EL PANEL SE PINTA CON TOKENS, Y TODO CONTROL CONSERVA SU ANILLO.
//
// LOS HEX DEL CONTRATO VISUAL SON DEL TEMA CLARO Y NO SE COPIAN. `design-notificaciones/*.dc.html`
// está dibujado con `#12233f`, `#f26419`, `#fee2e2`… y pegarlos aquí repetiría, línea por línea,
// el bug que la feature 208 arregló en ESTA MISMA campana: iba con `navy` fijo y en modo oscuro el
// disparador medía 1.03–1.11:1, o sea que la campana del encabezado DESAPARECÍA. Cada hex del
// mockup tiene su token: `-soft` de fondo (fijo, con la técnica soft-badge `bg-{sem}/15` en
// oscuro) y `-strong` de texto (gira con el tema). Ver `DESIGN.md`.
//
// Guardia porque ESCANEA EL FUENTE: ningún grafo de imports la seleccionaría, y en modo rápido las
// guardias corren siempre.

const CAMPANA = "components/shared/NotificationsBell.tsx";

/** Los controles ENFOCABLES del panel, por su etiqueta de apertura. */
const CONTROLES = ["<button", "<Popover.Trigger", "<Popover.Close", "<a "] as const;

function codigo(): string {
  return codigoSinComentarios(CAMPANA);
}

function cuenta(fuente: string, aguja: string): number {
  return fuente.split(aguja).length - 1;
}

describe("R27 — ni un color fijo en la campana", () => {
  it("el fuente no contiene ningún `#rrggbb` ni `rgb(`/`hsl(`", () => {
    const fuente = codigo();

    expect(fuente).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(fuente).not.toMatch(/#[0-9a-fA-F]{3}\b/);
    expect(fuente).not.toContain("rgb(");
    expect(fuente).not.toContain("rgba(");
    expect(fuente).not.toContain("hsl(");
  });

  it("tampoco las paletas crudas de Tailwind ni el `navy` fijo sobre superficie que gira", () => {
    const fuente = codigo();

    // La 210 y la 208 dejaron los dos nombres por los que este defecto vuelve.
    expect(fuente).not.toMatch(/\b(bg|text|border)-(red|green|blue|amber|emerald|slate|zinc)-\d{2,3}\b/);
    expect(fuente).not.toMatch(/\b(text|bg)-navy\b/);
  });

  it("los colores semánticos van en su par `-soft` + `-strong`, con su variante oscura", () => {
    // El control POSITIVO de las negativas de arriba: sin él, un componente sin un solo color
    // pasaría los dos casos anteriores en verde.
    const fuente = codigo();

    for (const semantico of ["danger", "info", "warning"]) {
      expect(fuente).toContain(`bg-${semantico}-soft`);
      expect(fuente).toContain(`text-${semantico}-strong`);
      // «Que gira sobre fijo, también error» (DESIGN.md): el `-soft` es FIJO, así que en oscuro
      // el fondo tiene que componerse del acento al 15 % o la tinta se aclara con él.
      expect(fuente).toContain(`dark:bg-${semantico}/15`);
    }
  });
});

describe("R27 — cada control enfocable conserva el anillo de foco estándar", () => {
  it("el anillo es el del repo, escrito una sola vez y a mano en este aserto", () => {
    // El literal se afirma A MANO: comparar la constante del componente consigo misma estaría
    // siempre verde. `DESIGN.md` fija `ring-3` + `ring-ring/50`.
    expect(codigo()).toContain(
      'const ANILLO_FOCO = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50"',
    );
  });

  it("TODOS los controles enfocables lo llevan: se cuentan controles contra anillos", () => {
    const fuente = codigo();

    const controles = CONTROLES.reduce((n, tag) => n + cuenta(fuente, tag), 0);
    // Autocomprobación: si la extracción fallara, `0 === 0` pasaría en verde sin haber mirado
    // ningún control. Hoy son siete (disparador, marcar leídas, sonido, dos filtros, el atajo y
    // el descartar), y bajar de cinco es señal de que el barrido dejó de encontrarlos.
    expect(controles).toBeGreaterThanOrEqual(5);

    // Cada uso de la constante es un control vestido; el que sobra es su declaración.
    const usos = cuenta(fuente, "ANILLO_FOCO") - 1;
    expect(usos).toBe(controles);
  });

  it("la guardia SÍ se pone roja si a un control le falta el anillo (mutación)", () => {
    // Se ejercita el MISMO conteo sobre un fuente de mentira con dos botones y un solo anillo:
    // demuestra que el aserto de arriba no es una igualdad que se cumpla sola.
    const mutado = [
      'const ANILLO_FOCO = "x";',
      "<button className={ANILLO_FOCO} />",
      "<button className={cn()} />",
    ].join("\n");

    const controles = CONTROLES.reduce((n, tag) => n + cuenta(mutado, tag), 0);
    const usos = cuenta(mutado, "ANILLO_FOCO") - 1;
    expect(controles).toBe(2);
    expect(usos).toBe(1);
    expect(usos).not.toBe(controles);
  });

  it("el `Link` del atajo va SIEMPRE dentro del `Popover.Close`, para que cerrar el panel no dependa de nadie", () => {
    // R21: activar el atajo navega Y cierra el panel. Un `<Link>` suelto navegaría dejando el
    // popover abierto sobre la pantalla de destino.
    const fuente = codigo();
    expect(cuenta(fuente, "<Link")).toBe(cuenta(fuente, "render={<Link"));
  });
});
