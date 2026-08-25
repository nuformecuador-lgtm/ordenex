// Feature 230 (T3.2 · T3.3 · T3.4) — ORDEN, CENSO y PROYECCIÓN de la HOJA FUNDIDA: el archivo
// detallado de cierres, una fila por GESTIÓN, cruzando los cierres de varios mensajeros.
//
// Cubre R3 (las constantes de la marca de evidencia siguen vivas), R5, R7, R8, R9, R10, R12,
// R40, R43, R45, R46 y R47.
//
// ⚠️ OJO AL VECINO. Este archivo NO es
// `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`, que fija las CINCO
// declaraciones por sección del detalle de UN cierre. Aquélla es la salida estrecha de un
// cierre abierto y NO se retira (D4/R3); ésta es la hoja única que cruza cierres (D3). Copiar un
// esperado de un archivo al otro da un listado plausible y falso: la fundida lleva tres columnas
// que allí no existen (mensajero, fecha del cierre, resultado) y NO lleva la de evidencia.
//
// El esperado se escribe LITERAL, nunca derivado de la constante ni de `CLAVES_ESPECIFICAS`: los
// encabezados que vienen de `cierre-labels` se fijan por su TEXTO, que es lo que acaba en la
// hoja del usuario. Una permuta de dos columnas tiene que poner esto rojo.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
  filaDescargaGestionFundida,
} from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import {
  TIENE_EVIDENCIA_COL,
  TIENE_EVIDENCIA_SI,
  TIENE_EVIDENCIA_NO,
  COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
} from "@/app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas";
import type {
  CierreResultado,
  IngresoOrdenexDTO,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";

// --- Fixtures -------------------------------------------------------------

/** Ingreso de Ordenex con los seis conceptos poblados y money-safe (STRING escala 2). */
function ingreso(over: Partial<IngresoOrdenexDTO> = {}): IngresoOrdenexDTO {
  return {
    montoCobrar: "1000.10",
    cobraComision: true,
    esCentral: true,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: "100.00",
    ivaFlete: "13.00",
    fleteDevolucion: "40.00",
    ivaFleteDevolucion: "5.20",
    comisionCod: "50.00",
    ivaComisionCod: "6.50",
    fleteConIva: "113.00",
    fleteDevolucionConIva: "45.20",
    comisionConIva: "56.50",
    total: "169.50",
    tarifa: null,
    ...over,
  };
}

function gestion(
  over: Partial<CierreGestionDescargaDTO> & { resultado: CierreResultado },
): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    numGuia: 1001,
    numRemision: "REM-1",
    destinatario: "Ana Pérez",
    direccion: "Calle 1, casa 2",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    montoRecibido: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    ingresoOrdenex: ingreso(),
    ...over,
  };
}

/** Las 26 claves declaradas, para afirmar el censo de CADA fila proyectada (R9). */
const CLAVES_DECLARADAS = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave);

const LOS_CINCO: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

// --- T3.2: orden y censo --------------------------------------------------

describe("orden de las columnas de la hoja fundida (T3.2)", () => {
  it("declara las 27 columnas en el orden decidido (design §6)", () => {
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave)).toEqual([
      "mensajero",
      "fechaCierre",
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "resultado",
      "montoCobrar",
      "fulfillment",
      "recibido",
      "pago_efectivo",
      "pago_SINPE",
      "pago_transferencia",
      "nuevaFecha",
      "origenRechazo",
      "causa",
      "motivo",
      "fleteConIva",
      "comisionConIva",
      "fleteDevolucionConIva",
      "ingresoTotal",
      "pagoMensajero",
      "ingresoBodega",
      "indemnizacion",
    ]);
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado)).toEqual([
      "Mensajero",
      "Fecha del cierre",
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Resultado",
      "A cobrar",
      "Fulfillment",
      "Recibido",
      "Efectivo",
      "SINPE",
      "Transferencia",
      "Nueva fecha",
      "Origen",
      "Causa",
      "Motivo",
      "Flete + IVA",
      "Comisión + IVA",
      "Flete devolución + IVA",
      "Total Ordenex",
      "Pago mensajero",
      "Ingreso bodega",
      "Indemnización",
    ]);
    // El número es parte de la decisión (D6), no una consecuencia: si alguien añade una
    // columna 28 sin reabrirla, esto lo dice con el número en la mano.
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA).toHaveLength(27);
  });

  it("del flete de devolución queda UNA columna, la agrupada (2026-08-19, revierte D7)", () => {
    // D7 había conservado las TRES (par partido para la devuelta, agrupada para la rechazada).
    // Ahora las dos pueblan la agrupada y el par partido se retiró de la hoja: eran dos
    // columnas para un importe que siempre se lee sumado.
    expect(CLAVES_DECLARADAS).toContain("fleteDevolucionConIva");
    expect(CLAVES_DECLARADAS).not.toContain("fleteDevolucion");
    expect(CLAVES_DECLARADAS).not.toContain("ivaFleteDevolucion");
  });

  it("la fundida no declara ni estado del cierre ni destino (R12)", () => {
    // D9: son datos del grano CIERRE y se quedan en la descarga general.
    expect(CLAVES_DECLARADAS).not.toContain("estado");
    expect(CLAVES_DECLARADAS).not.toContain("destino");
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado)).not.toContain("Estado");
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado)).not.toContain("Destino");
  });
});

// --- T3.3: proyección por resultado --------------------------------------

describe("proyección de una gestión a una fila de la hoja fundida (T3.3)", () => {
  it("las 27 columnas salen en el orden declarado sea cual sea el resultado (R9)", () => {
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(gestion({ resultado }));
      // Mismas claves, mismo orden de inserción y NINGUNA de más: la hoja es rectangular.
      expect(Object.keys(fila), resultado).toEqual(CLAVES_DECLARADAS);
    }
  });

  it("toda fila lleva la columna Resultado con la etiqueta singular de su resultado (R7)", () => {
    const etiquetas = LOS_CINCO.map(
      (resultado) => filaDescargaGestionFundida(gestion({ resultado })).resultado,
    );
    expect(etiquetas).toEqual([
      "Entregada",
      "Reprogramada",
      "Devuelta",
      "Rechazada",
      "Incidente",
    ]);
  });

  it("toda fila lleva el nombre del mensajero dueño del cierre (R8)", () => {
    // Sin esta columna, al cruzar cierres dos filas de dos mensajeros son indistinguibles: el
    // nombre iba en el NOMBRE del archivo cuando el archivo era de un solo cierre.
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(
        gestion({ resultado, mensajeroNombre: "Beto Mensajero" }),
      );
      expect(fila.mensajero, resultado).toBe("Beto Mensajero");
    }
  });

  it("emite una fila por gestión y ninguna fila agregada (R5/D2)", () => {
    // El grano es la GESTIÓN: tres gestiones del mismo cierre y del mismo mensajero son TRES
    // filas, cada una con su remisión, y no un resumen por mensajero ni por resultado.
    const gestiones = [
      gestion({ resultado: "entregada", numRemision: "REM-1" }),
      gestion({ resultado: "reprogramada", numRemision: "REM-2" }),
      gestion({ resultado: "incidente", numRemision: "REM-3" }),
    ];
    const filas = gestiones.map(filaDescargaGestionFundida);
    expect(filas).toHaveLength(3);
    expect(filas.map((f) => f.numRemision)).toEqual(["REM-1", "REM-2", "REM-3"]);
    // El orden recibido se conserva: la proyección no ordena ni agrupa nada (R11 lo garantiza
    // el servidor; aquí se afirma que esto no lo deshace).
    expect(filas.map((f) => f.resultado)).toEqual(["Entregada", "Reprogramada", "Incidente"]);
  });

  it("la fila de una ENTREGADA puebla sus diez específicas y deja vacías las otras siete", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "entregada",
        montoRecibido: "1000.10",
        pagos: [{ metodo: "SINPE", monto: "1000.10" }],
      }),
    );
    expect(fila).toEqual({
      mensajero: "Ana Mensajera",
      fechaCierre: "2026-07-11",
      numGuia: 1001,
      numRemision: "REM-1",
      destinatario: "Ana Pérez",
      direccion: "Calle 1, casa 2",
      ubicacion: "Limón · Limón · Central · Limón",
      producto: "Caja mediana",
      tienda: "Tienda X",
      resultado: "Entregada",
      montoCobrar: "1000.10",
      // El fixture de `ingreso()` trae `tarifa: null` (gap R9): sin tarifa congelada no hay
      // fulfillment que mostrar, y la celda queda vacía como el resto de lo que no se congeló.
      fulfillment: null,
      recibido: "1000.10",
      pago_efectivo: null,
      pago_SINPE: "1000.10",
      pago_transferencia: null,
      nuevaFecha: null,
      origenRechazo: null,
      causa: null,
      motivo: null,
      fleteConIva: "113.00",
      comisionConIva: "56.50",
      fleteDevolucionConIva: null,
      ingresoTotal: "169.50",
      pagoMensajero: "100.10",
      ingresoBodega: null,
      indemnizacion: null,
    });
  });

  it("la fila de una REPROGRAMADA solo puebla a cobrar, nueva fecha, motivo y pago", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "reprogramada",
        fechaReprogramacion: "2026-07-20",
        motivo: "Nadie en casa",
      }),
    );
    expect(fila.nuevaFecha).toBe("2026-07-20");
    expect(fila.motivo).toBe("Nadie en casa");
    expect(fila.montoCobrar).toBe("1000.10");
    expect(fila.pagoMensajero).toBe("100.10");
    // Una reprogramación no deriva ningún concepto de ingreso: la pantalla no los pinta y el
    // archivo tampoco los lleva, aunque el snapshot los traiga.
    expect(fila.fleteConIva).toBeNull();
    expect(fila.comisionConIva).toBeNull();
    expect(fila.ingresoTotal).toBeNull();
    expect(fila.recibido).toBeNull();
    // Y tampoco lleva medios de pago: no hubo recaudo que repartir.
    expect(fila.pago_efectivo).toBeNull();
    expect(fila.pago_SINPE).toBeNull();
    expect(fila.pago_transferencia).toBeNull();
  });

  it("la fila de una DEVUELTA puebla el flete de devolución AGRUPADO (2026-08-19)", () => {
    const fila = filaDescargaGestionFundida(
      gestion({ resultado: "devuelta", motivo: "Rechazó el paquete" }),
    );
    // Antes poblaba el par partido y dejaba vacío el agrupado (D7). Ahora lee lo mismo que la
    // rechazada, que es lo que las dos tablas muestran.
    expect(fila.fleteDevolucionConIva).toBe("45.20");
    expect(fila.ingresoTotal).toBe("169.50");
    expect(fila.origenRechazo).toBeNull();
  });

  it("la fila de una RECHAZADA puebla el flete de devolución AGRUPADO", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "rechazada",
        esRechazoSla: true,
        motivo: "Plazo vencido",
        ingresoBodegaRechazo: "12.00",
      }),
    );
    expect(fila.fleteDevolucionConIva).toBe("45.20");
    expect(fila.ingresoBodega).toBe("12.00");
    expect(fila.origenRechazo).toBe("Automático");
  });

  it("la fila de un INCIDENTE puebla causa e indemnización, y ni paga al mensajero ni ingresa a bodega", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "incidente",
        causaIncidente: "danado",
        motivo: "Caja aplastada",
        indemnizacion: "250.00",
        // Aunque el snapshot los trajera, un incidente no los enseña.
        pagoMensajero: "100.10",
        ingresoBodegaRechazo: "9.99",
      }),
    );
    expect(fila.causa).toBe("Paquete dañado");
    expect(fila.indemnizacion).toBe("250.00");
    expect(fila.pagoMensajero).toBeNull();
    expect(fila.ingresoBodega).toBeNull();
  });

  it("una columna que no aplica al resultado deja la celda vacía y no se omite (R10)", () => {
    // La diferencia que importa: la clave ESTÁ (la hoja es rectangular) y su valor es `null`,
    // no `undefined` ni un relleno.
    const fila = filaDescargaGestionFundida(gestion({ resultado: "incidente" }));
    expect(Object.keys(fila)).toEqual(CLAVES_DECLARADAS);
    expect(fila).toHaveProperty("fleteConIva", null);
    expect(fila).toHaveProperty("recibido", null);
    expect(fila.nuevaFecha).toBeNull();
    expect(fila.nuevaFecha).not.toBeUndefined();
  });

  it("resultado, causa y origen salen como etiqueta legible (R45)", () => {
    const entregada = filaDescargaGestionFundida(
      gestion({
        resultado: "entregada",
        pagos: [{ metodo: "efectivo", monto: "500.00" }],
      }),
    );
    const incidente = filaDescargaGestionFundida(
      gestion({ resultado: "incidente", causaIncidente: "perdido" }),
    );
    const rechazada = filaDescargaGestionFundida(
      gestion({ resultado: "rechazada", esRechazoSla: false }),
    );

    expect(entregada.resultado).toBe("Entregada");
    expect(incidente.causa).toBe("Paquete perdido");
    expect(rechazada.origenRechazo).toBe("Manual");
    // El medio de pago ya no es una CELDA sino un ENCABEZADO, y ahí la etiqueta legible sigue
    // siendo obligatoria: la celda lleva el monto pelado.
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado)).toContain("Efectivo");
    expect(entregada.pago_efectivo).toBe("500.00");

    // Y NINGUNA de las tres celdas es el value del enum.
    for (const valor of [entregada.resultado, incidente.causa, rechazada.origenRechazo]) {
      expect(["entregada", "incidente", "rechazada", "efectivo", "perdido"]).not.toContain(valor);
    }
  });

  it("los montos salen como el string del snapshot, sin símbolo ni separador (R43/R44)", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "entregada",
        montoRecibido: "1234567.89",
        pagos: [
          { metodo: "efectivo", monto: "1000000.00" },
          { metodo: "SINPE", monto: "234567.89" },
        ],
        ingresoOrdenex: ingreso({ montoCobrar: "1234567.89", total: "1000.00" }),
      }),
    );
    // El STRING TAL CUAL: ni `₡`, ni separador de miles, ni redondeo, ni `number`.
    expect(fila.recibido).toBe("1234567.89");
    expect(fila.montoCobrar).toBe("1234567.89");
    expect(fila.ingresoTotal).toBe("1000.00");
    expect(typeof fila.recibido).toBe("string");
    for (const clave of [
      "recibido",
      "montoCobrar",
      "ingresoTotal",
      "pago_efectivo",
      "pago_SINPE",
    ] as const) {
      expect(String(fila[clave]), clave).not.toMatch(/[₡$]/);
      expect(String(fila[clave]), clave).not.toMatch(/\d,\d/);
    }
    // Cada medio en SU columna, también money-safe: el STRING del snapshot, sin `money()`.
    expect(fila.pago_efectivo).toBe("1000000.00");
    expect(fila.pago_SINPE).toBe("234567.89");
    expect(fila.pago_transferencia).toBeNull();
  });

  it("un dato nulo deja la celda vacía y nunca el guion de pantalla (R46)", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "reprogramada",
        numGuia: null,
        direccion: null,
        distritoNombre: null,
        motivo: null,
        // Sin tarifa vigente al solicitar (gap conocido de la 69): no hay ingreso ninguno.
        ingresoOrdenex: null,
        pagoMensajero: null,
      }),
    );
    expect(fila.numGuia).toBeNull();
    expect(fila.direccion).toBeNull();
    expect(fila.motivo).toBeNull();
    expect(fila.montoCobrar).toBeNull();
    expect(fila.pagoMensajero).toBeNull();
    // El distrito ausente NO deja un separador colgando ni un hueco: se omite el tramo.
    expect(fila.ubicacion).toBe("Limón · Limón · Central");
    // «—» es un marcador de PANTALLA: en una hoja de cálculo es un dato falso.
    for (const celda of Object.values(fila)) {
      expect(celda).not.toBe("—");
    }
  });

  it("una indemnización sin capturar deja la celda vacía y nunca cero (R47)", () => {
    // `null` = el admin todavía no puso el monto al aprobar. Un `0` diría «no se indemniza»,
    // que es exactamente lo contrario, y en una hoja de dinero se lee como decisión tomada.
    const fila = filaDescargaGestionFundida(
      gestion({ resultado: "incidente", causaIncidente: "robado", indemnizacion: null }),
    );
    expect(fila.indemnizacion).toBeNull();
    expect(fila.indemnizacion).not.toBe(0);
    expect(fila.indemnizacion).not.toBe("0");
    expect(fila.indemnizacion).not.toBe("0.00");
  });
});

// --- T3.4: la ausencia de evidencia, con test propio ----------------------

describe("la hoja fundida no tiene NADA de evidencia (T3.4, R40/R41)", () => {
  // Un requisito que se cumple «porque la columna no existe» necesita su test IGUAL: sin él, la
  // próxima persona añade la columna sin enterarse de que hay una decisión detrás (D8). Añadir
  // a mano una columna «Tiene evidencia» a la fundida pone rojo este bloque.
  const MENCIONA_EVIDENCIA = /evidencia|adjunt|foto|imagen|firmad|signed|storage|url/i;

  it("la fundida no declara ninguna columna de evidencia y ninguna celda la lee (R40)", () => {
    for (const columna of COLUMNAS_DESCARGA_GESTIONES_FUNDIDA) {
      expect(columna.clave).not.toMatch(MENCIONA_EVIDENCIA);
      expect(columna.encabezado).not.toMatch(MENCIONA_EVIDENCIA);
    }
    // Y en la fila proyectada tampoco aparece por otra puerta.
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(gestion({ resultado }));
      expect(Object.keys(fila)).not.toContain("tieneEvidencia");
      expect(Object.keys(fila)).not.toContain("evidenciaUrl");
      for (const [clave, celda] of Object.entries(fila)) {
        expect(clave, resultado).not.toMatch(MENCIONA_EVIDENCIA);
        if (typeof celda === "string") {
          expect(celda, `${resultado}.${clave}`).not.toMatch(/https?:\/\//i);
        }
      }
    }
  });

  it("el DTO que alimenta la fila no declara campo de evidencia alguno (R41)", () => {
    // El DTO es un `interface`, así que no existe en runtime: se lee el FUENTE de la interfaz,
    // que es donde vive la decisión. Es la misma técnica de las guardias de prosa del repo.
    const fuente = readFileSync(
      resolve(__dirname, "../../../lib/interfaces/services/ICierresAdminService.ts"),
      "utf8",
    );
    const bloque = fuente.slice(
      fuente.indexOf("export interface CierreGestionDescargaDTO"),
    );
    const cuerpo = bloque.slice(0, bloque.indexOf("\n}"));
    expect(cuerpo).toContain("mensajeroNombre"); // no-vacuidad: el bloque leído es el DTO
    expect(cuerpo).not.toMatch(/^\s*evidencia/im);
    expect(cuerpo).not.toMatch(/^\s*tieneEvidencia/im);
    expect(cuerpo).not.toMatch(/^\s*gestionId/im);
    expect(cuerpo).not.toMatch(/^\s*ordenId/im);
  });

  it("las constantes de la marca de evidencia siguen exportadas y sin cambios (R3)", () => {
    // D8 retiró la COLUMNA de la fundida, no el mecanismo: `TIENE_EVIDENCIA_*` y el helper
    // siguen sirviendo a las cinco descargas por sección, que no se retiran (D4/R3).
    expect(TIENE_EVIDENCIA_COL).toBe("Tiene evidencia");
    expect(TIENE_EVIDENCIA_SI).toBe("Sí");
    expect(TIENE_EVIDENCIA_NO).toBe("No");
    expect(
      COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS.map((c) => c.encabezado),
    ).toContain(TIENE_EVIDENCIA_COL);
  });
});
