// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CierreFacturaDetalle,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

/**
 * FICHA 414 — EL COMPROBANTE DEJA DE ATRIBUIRLE AL MENSAJERO GESTIONES QUE NO HIZO.
 *
 * Cubre R1, R2, R3, R4, R7 y R8 sobre el componente suelto (`CierreFacturaDetalle`). Que la
 * PANTALLA real le pase `audiencia="mensajero"` lo cubre su hermano,
 * `CierreDiaComprobanteMarcasDeOrigen.test.tsx` (R5/R9).
 *
 * ── EL DEFECTO, EN UNA FILA
 * Desde la 408 el motivo dice la verdad —«Dirección errada · lo rechazó el sistema al vencerse el
 * plazo de la devolución»— y el distintivo de al lado decía «Manual · lo registró el mensajero».
 * Y mentía por DOS caminos: también rotulaba «Manual» un rechazo hecho por la TIENDA. Para esta
 * audiencia `CierreDiaRepository` fija `esRechazoSla: false`, así que el badge caía SIEMPRE en la
 * rama «Manual». Fuera el distintivo que no puede afirmar nada cierto, dentro la marca que sí.
 *
 * ── LAS DOS TRAMPAS QUE ESTE ARCHIVO TIENE PROHIBIDAS, escritas antes que su verde
 *
 *  1. **NINGÚN literal se compara contra la constante que lo emite.** Ni `RECHAZO_*_BADGE_*`, ni
 *     `GESTION_TIENDA_BADGE_*`, ni una llamada a `motivoGestionLegible`: una aserción contra su
 *     propia fuente está siempre verde y sale igual de verde con las palabras rotas. Todos los
 *     textos de aquí van TECLEADOS A MANO, abajo.
 *  2. **Un caso de ausencia con la fila PLEGADA pasa en verde sin el arreglo.** Todo el bloque
 *     desplegado vive dentro de `{open ? … : null}`, así que «no encuentro el badge» es cierto
 *     también cuando no hay nada que encontrar. Por eso cada caso de ausencia DESPLIEGA la fila y
 *     lo demuestra: afirma primero el texto largo del motivo, que sólo existe con la fila abierta.
 *     Eso es el control de no-vacuidad, y la mutación 8 del `design.md` §9 es su autocomprobación.
 *
 * ── LO QUE NO AFIRMA
 * jsdom no compone estilos: nada de aquí dice «se ve bien». Y `title` sólo sirve al puntero — por
 * eso cada nota se afirma también como `aria-label`, que es lo que oye un lector de pantalla.
 */

// ── LOS LITERALES, TECLEADOS A MANO (ver la trampa 1) ───────────────────────────────────────

/** El distintivo de origen del ADMIN, con sus dos rótulos y sus dos notas (R2). */
const ORIGEN_AUTOMATICO_LABEL = "Automático";
const ORIGEN_AUTOMATICO_NOTA =
  "Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero).";
const ORIGEN_MANUAL_LABEL = "Manual";
const ORIGEN_MANUAL_NOTA = "Rechazo registrado manualmente por el mensajero.";

/** La marca que el mensajero SÍ puede leer (R7/R9), la misma de su tabla en vivo. */
const TIENDA_LABEL = "La tienda";
const TIENDA_NOTA =
  "Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la foto son suyos. Cuenta en tu cierre igual.";

/** El texto autosuficiente del motivo (408/R11): la variante que se lee SIN distintivo al lado. */
const MOTIVO_LARGO =
  "Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución";
/** La variante corta: la que se lee CUANDO el distintivo acompaña al motivo (408/R9). */
const MOTIVO_CORTO = "Dirección errada";

/** El renglón vecino del distintivo, que este arreglo NO puede llevarse por delante (R3). */
const INGRESO_BODEGA_LABEL = "Ingreso de bodega por rechazos";
const INGRESO_BODEGA_MONTO = "₡1.500";

/** La cadena EXACTA que el cron de plazos vencidos deja guardada en `gestion_orden.motivo`. */
const MOTIVO_GUARDADO_DEL_CRON = "escalado SLA wrong_address";

// ── Semilla ─────────────────────────────────────────────────────────────────────────────────

const CABECERA: CierreFacturaCabecera = {
  cierreId: "c414001",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  totales: {
    efectivo: "0.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "0.00",
  },
  totalPagoMensajero: "0.00",
  totalIngresoBodegaRechazos: "1500.00",
  solicitadoAt: "2026-09-09T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

function gestion(
  over: Partial<CierreDetalleGestion> & {
    gestionId: string;
    resultado: CierreResultado;
  },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    fechaGestion: "2026-09-09",
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    direccion: "Calle 1, casa 2",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    montoRecibido: null,
    metodoPago: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function grupos(over: Partial<CierreGrupos> = {}): CierreGrupos {
  return {
    entregada: [],
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
    ...over,
  };
}

/** El rechazo que compuso el cron: la fila que abrió esta ficha. */
function rechazoDelCron(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return gestion({
    gestionId: "g-cron",
    resultado: "rechazada",
    numRemision: "REM-CRON",
    motivo: MOTIVO_GUARDADO_DEL_CRON,
    ingresoBodegaRechazo: "1500.00",
    ...over,
  });
}

type Audiencia = "admin" | "mensajero";

/** Monta el comprobante. Sin `audiencia` es la vista del ADMIN, que es el default del componente. */
function montar(gs: CierreGrupos, audiencia?: Audiencia) {
  render(
    audiencia === undefined ? (
      <CierreFacturaDetalle cierre={CABECERA} grupos={gs} />
    ) : (
      <CierreFacturaDetalle cierre={CABECERA} grupos={gs} audiencia={audiencia} />
    ),
  );
}

/** Despliega la fila de esa orden: el bloque con el motivo y las marcas sólo existe abierto. */
async function desplegar(numRemision: string, destinatario = "Ana Pérez") {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Detalle de la orden ${numRemision} · ${destinatario}` }),
  );
}

/** Cambia de sección: el comprobante sólo pinta las filas de la pestaña activa. */
async function verSeccion(nombre: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${nombre}`) }));
}

/** El valor pintado junto a un rótulo del desplegable («Motivo: …»), sin el rótulo. */
function valorDe(rotulo: string): string {
  const etiqueta = screen.getByText(`${rotulo}:`);
  const fila = etiqueta.parentElement as HTMLElement;
  return (fila.textContent ?? "").replace(`${rotulo}:`, "").trim();
}

/**
 * EL CONTROL DE NO-VACUIDAD, en una función para que ningún caso de ausencia pueda olvidarlo.
 *
 * Afirma que la fila está ABIERTA leyendo el texto largo del motivo, que sólo se monta con
 * `open === true`. Sin esto, un `queryByText(...)` que devuelve `null` no distingue «el badge no
 * se pinta» de «no hay bloque desplegado donde mirar», y el caso pasaría verde SIN el arreglo.
 */
function laFilaEstaAbierta(): void {
  expect(
    screen.getByText(MOTIVO_LARGO),
    "la fila no está desplegada: sin el bloque abierto, afirmar una ausencia no prueba nada",
  ).toBeInTheDocument();
}

/** Ni el rótulo ni la nota del distintivo de origen, en ninguna de sus dos ramas. */
function noHayDistintivoDeOrigen(): void {
  expect(screen.queryAllByText(ORIGEN_MANUAL_LABEL)).toHaveLength(0);
  expect(screen.queryAllByText(ORIGEN_AUTOMATICO_LABEL)).toHaveLength(0);
  expect(screen.queryAllByLabelText(ORIGEN_MANUAL_NOTA)).toHaveLength(0);
  expect(screen.queryAllByLabelText(ORIGEN_AUTOMATICO_NOTA)).toHaveLength(0);
}

/** Ni el rótulo ni la nota de la marca «La tienda». */
function noHayMarcaDeTienda(): void {
  expect(screen.queryAllByText(TIENDA_LABEL)).toHaveLength(0);
  expect(screen.queryAllByLabelText(TIENDA_NOTA)).toHaveLength(0);
}

afterEach(() => {
  cleanup();
});

// ── R1 ──────────────────────────────────────────────────────────────────────────────────────

describe("R1 — en el comprobante del mensajero no se muestra el distintivo de origen", () => {
  it("la fila del rechazo del cron no lleva «Manual» ni «Automático» ni sus notas", async () => {
    montar(grupos({ rechazada: [rechazoDelCron()] }), "mensajero");
    await desplegar("REM-CRON");

    // Control de no-vacuidad ANTES de afirmar la ausencia (ver la trampa 2 de la cabecera).
    laFilaEstaAbierta();

    noHayDistintivoDeOrigen();
  });

  it("tampoco se la lleva la frase que le atribuía el rechazo a él", async () => {
    montar(grupos({ rechazada: [rechazoDelCron()] }), "mensajero");
    await desplegar("REM-CRON");
    laFilaEstaAbierta();

    // La nota viajaba en `title` además de en `aria-label`: si quedara sólo en el atributo, el
    // `queryAllByLabelText` de arriba no la vería y la contradicción seguiría viva en el puntero.
    for (const nodo of Array.from(document.querySelectorAll("[title]"))) {
      expect(nodo.getAttribute("title")).not.toBe(ORIGEN_MANUAL_NOTA);
      expect(nodo.getAttribute("title")).not.toBe(ORIGEN_AUTOMATICO_NOTA);
    }
  });

  it("y un rechazo que el mensajero SÍ registró tampoco lo lleva: no es caso por caso", async () => {
    // El arreglo es por AUDIENCIA y no por fila: esta vista no puede afirmar el origen de
    // ninguna, ni siquiera de las que acierta por casualidad.
    montar(
      grupos({
        rechazada: [
          rechazoDelCron({
            gestionId: "g-suyo",
            numRemision: "REM-SUYO",
            motivo: "El cliente no estaba y no contestó",
          }),
        ],
      }),
      "mensajero",
    );
    await desplegar("REM-SUYO");

    // Control de no-vacuidad propio: este caso no tiene el texto largo, así que se afirma el
    // motivo que SÍ escribió él, que también vive sólo dentro del bloque desplegado.
    expect(valorDe("Motivo")).toBe("El cliente no estaba y no contestó");

    noHayDistintivoDeOrigen();
  });
});

// ── R2 ──────────────────────────────────────────────────────────────────────────────────────

describe("R2 — en el comprobante del admin el distintivo sigue exactamente igual", () => {
  it("un rechazo del cron mantiene «Automático» con su nota accesible completa", async () => {
    montar(grupos({ rechazada: [rechazoDelCron({ esRechazoSla: true })] }));
    await desplegar("REM-CRON");

    const badge = screen.getByText(ORIGEN_AUTOMATICO_LABEL);
    expect(badge).toHaveAttribute("aria-label", ORIGEN_AUTOMATICO_NOTA);
    expect(badge).toHaveAttribute("title", ORIGEN_AUTOMATICO_NOTA);
  });

  it("un rechazo del mensajero mantiene «Manual» con la suya", async () => {
    montar(grupos({ rechazada: [rechazoDelCron({ esRechazoSla: false })] }));
    await desplegar("REM-CRON");

    const badge = screen.getByText(ORIGEN_MANUAL_LABEL);
    expect(badge).toHaveAttribute("aria-label", ORIGEN_MANUAL_NOTA);
    expect(badge).toHaveAttribute("title", ORIGEN_MANUAL_NOTA);
  });
});

// ── R3 ──────────────────────────────────────────────────────────────────────────────────────

describe("R3 — ocultar el distintivo no se lleva por delante a su vecino", () => {
  it("el renglón «Ingreso de bodega por rechazos» sigue con su monto, y el motivo entero", async () => {
    // El renglón vive en el MISMO fragmento `rechazada` del que sale el distintivo. Es deuda
    // heredada de la 408 y está fuera de alcance por decisión del humano: este caso existe para
    // que el arreglo no la resuelva por accidente ni la empeore.
    montar(grupos({ rechazada: [rechazoDelCron()] }), "mensajero");
    await desplegar("REM-CRON");

    expect(valorDe(INGRESO_BODEGA_LABEL)).toBe(INGRESO_BODEGA_MONTO);
    expect(valorDe("Motivo")).toBe(MOTIVO_LARGO);
  });
});

// ── R4 ──────────────────────────────────────────────────────────────────────────────────────

describe("R4 — el texto autosuficiente aparece exactamente donde no hay distintivo", () => {
  it("1. mensajero con `esRechazoSla: false` (lo que manda el servidor): texto largo y sin distintivo", async () => {
    montar(grupos({ rechazada: [rechazoDelCron({ esRechazoSla: false })] }), "mensajero");
    await desplegar("REM-CRON");

    expect(valorDe("Motivo")).toBe(MOTIVO_LARGO);
    noHayDistintivoDeOrigen();
  });

  it("2. admin con `esRechazoSla: true`: la celda dice «Dirección errada» y el distintivo dice el resto", async () => {
    montar(grupos({ rechazada: [rechazoDelCron({ esRechazoSla: true })] }));
    await desplegar("REM-CRON");

    // Exactamente el literal corto: donde hay distintivo, la celda no repite lo que él ya dice.
    expect(valorDe("Motivo")).toBe(MOTIVO_CORTO);
    expect(screen.getByText(ORIGEN_AUTOMATICO_LABEL)).toBeInTheDocument();
  });

  it("3. mensajero con `esRechazoSla: true`: texto largo IGUAL, y sigue sin distintivo", async () => {
    // ⚠️ ESTE ESTADO EL SERVIDOR NO LO PRODUCE HOY (`CierreDiaRepository`, decisión 102/R11), y se
    // declara como tal: no afirma nada sobre datos de producción, afirma el CONTRATO del
    // componente. Es el único aserto capaz de distinguir `!esMensajero && g.esRechazoSla` de
    // `g.esRechazoSla` en el argumento del traductor — con `false` en el DTO los dos dan lo mismo.
    // Y no atornilla ningún bug: afirma la dirección correcta, «sin marcador ⇒ texto largo».
    montar(grupos({ rechazada: [rechazoDelCron({ esRechazoSla: true })] }), "mensajero");
    await desplegar("REM-CRON");

    expect(valorDe("Motivo")).toBe(MOTIVO_LARGO);
    expect(valorDe("Motivo")).not.toBe(MOTIVO_CORTO);
    noHayDistintivoDeOrigen();
  });
});

// ── R7 ──────────────────────────────────────────────────────────────────────────────────────

describe("R7 — el comprobante del mensajero dice cuándo la gestión la registró la tienda", () => {
  /** Dos resultados DISTINTOS, los dos registrados por la tienda, en el mismo comprobante. */
  function conLasDosDeLaTienda(): CierreGrupos {
    return grupos({
      entregada: [
        gestion({
          gestionId: "g-ent-tienda",
          resultado: "entregada",
          numRemision: "REM-ENT",
          destinatario: "Beto Mora",
          montoRecibido: "8000.00",
          pagoMensajero: "1200.00",
          desdeAyudaTienda: true,
        }),
      ],
      rechazada: [rechazoDelCron({ desdeAyudaTienda: true })],
    });
  }

  it("una ENTREGA registrada por la tienda va marcada, con su nota completa", async () => {
    // ⚠️ EL FALLO MUDO DE ESTA MITAD, y por eso el caso es una `entregada`: anidar la marca
    // dentro del fragmento `g.resultado === "rechazada"` —donde vivía el distintivo que se
    // retira— dejaría esta fila MUDA sin romper nada visible. `desdeAyudaTienda` es ORTOGONAL al
    // resultado: en la tabla en vivo vive en las columnas comunes, o sea en las cinco secciones.
    montar(conLasDosDeLaTienda(), "mensajero");
    await verSeccion("Entregadas");
    await desplegar("REM-ENT", "Beto Mora");

    const marca = screen.getByText(TIENDA_LABEL);
    expect(marca).toHaveAttribute("aria-label", TIENDA_NOTA);
    expect(marca).toHaveAttribute("title", TIENDA_NOTA);
  });

  it("un RECHAZO registrado por la tienda va marcado igual, con la misma nota", async () => {
    montar(conLasDosDeLaTienda(), "mensajero");
    await verSeccion("Rechazadas");
    await desplegar("REM-CRON");

    const marca = screen.getByText(TIENDA_LABEL);
    expect(marca).toHaveAttribute("aria-label", TIENDA_NOTA);
    expect(marca).toHaveAttribute("title", TIENDA_NOTA);
  });

  it("y en ese rechazo la marca CONVIVE con el motivo, que sigue diciendo lo suyo", async () => {
    // Las dos cosas responden preguntas distintas: el motivo dice POR QUÉ, la marca dice QUIÉN.
    montar(conLasDosDeLaTienda(), "mensajero");
    await verSeccion("Rechazadas");
    await desplegar("REM-CRON");

    expect(valorDe("Motivo")).toBe(MOTIVO_LARGO);
    expect(screen.getByText(TIENDA_LABEL)).toBeInTheDocument();
  });
});

// ── R8 ──────────────────────────────────────────────────────────────────────────────────────

describe("R8 — la ausencia de esa marca también es una afirmación", () => {
  it("si NO la registró la tienda, el comprobante del mensajero no la marca", async () => {
    // La ausencia significa «la registraste vos», no «no lo sé»: `desdeAyudaTienda` es
    // obligatorio en el DTO y se deriva del historial. Por eso este caso va emparejado con R7.
    montar(grupos({ rechazada: [rechazoDelCron({ desdeAyudaTienda: false })] }), "mensajero");
    await desplegar("REM-CRON");
    laFilaEstaAbierta();

    noHayMarcaDeTienda();
  });

  it("y en el comprobante del ADMIN no se estrena: tampoco cuando la registró la tienda", async () => {
    // Hoy el admin no tiene esta marca en NINGUNA de sus superficies. Dársela es otra decisión,
    // con otra justificación, y no se toma aquí.
    montar(grupos({ rechazada: [rechazoDelCron({ desdeAyudaTienda: true })] }));
    await desplegar("REM-CRON");
    laFilaEstaAbierta();

    noHayMarcaDeTienda();
  });

  it("una ENTREGA del admin registrada por la tienda tampoco la estrena", async () => {
    montar(
      grupos({
        entregada: [
          gestion({
            gestionId: "g-ent-admin",
            resultado: "entregada",
            numRemision: "REM-ENT",
            destinatario: "Beto Mora",
            montoRecibido: "8000.00",
            desdeAyudaTienda: true,
          }),
        ],
      }),
    );
    await desplegar("REM-ENT", "Beto Mora");

    // Control de no-vacuidad de este caso: «Recibido» sólo se monta con la fila abierta.
    expect(valorDe("Recibido")).toBe("₡8.000");

    noHayMarcaDeTienda();
  });
});
