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
  AMBITO_DESCARGA_GESTIONES_FUNDIDA,
  COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
  filaDescargaGestionFundida,
} from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import {
  AMBITO_DESCARGA_CIERRES_HISTORICO,
  AMBITO_DESCARGA_CIERRES_PENDIENTES,
  COLUMNAS_DESCARGA_CIERRES_HISTORICO,
  COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
} from "@/app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas";
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
    // 2026-09-05 — TRES días DISTINTOS entre sí (cierre 11, gestión 12, reparto 10), y es
    // deliberado: con los tres iguales, una proyección que emitiera la fecha del cierre en la
    // celda de la gestión pasaría en verde. Es el caso que el humano pidió poder distinguir.
    fechaGestion: "2026-07-12",
    diaReparto: "2026-07-10",
    // Ficha 385 — la CUARTA fecha, y también distinta de las otras tres (creación el 8, reparto
    // el 10, cierre el 11, gestión el 12). Mismo motivo que arriba: con dos fechas iguales, una
    // proyección que confundiera una celda con otra pasaría en verde.
    fechaCreacionOrden: "2026-07-08",
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
    // Ficha 385 — el contador de LA TIENDA. Ya NO es el de la columna (lo sustituyó la 394),
    // pero sigue viajando en el DTO y por eso el fixture lo trae: es el señuelo que hace que el
    // fallo original se pueda detectar. Valor NO cero y NO uno, para que no se confunda con
    // cualquier contador ambiental.
    intentosContactoTienda: 3,
    // Ficha 394 — el contador de la COLUMNA: los intentos de ENTREGA del MENSAJERO, que es el
    // que el humano pidió y firmó el 2026-09-08. Valor DISTINTO del de la tienda por el mismo
    // motivo por el que las cuatro fechas son cuatro días distintos: con los dos iguales, una
    // celda que cogiera el contador equivocado pasaría en verde — que es justo lo que ocurrió en
    // la 385.
    intentosEntrega: 5,
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

/** Las 31 claves declaradas, para afirmar el censo de CADA fila proyectada (R9). */
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
  it("declara las 31 columnas en el orden decidido (design §6)", () => {
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave)).toEqual([
      "mensajero",
      "fechaCierre",
      "fechaGestion",
      "diaReparto",
      "fechaCreacionOrden",
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "intentosEntrega",
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
      "Fecha de gestión",
      "Día de reparto",
      "Fecha de creación de la orden",
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Intentos de entrega",
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
      "Flete por rechazo + IVA",
      "Total Ordenex",
      "Pago mensajero",
      "Ingreso bodega",
      "Indemnización",
    ]);
    // El número es parte de la decisión (D6), no una consecuencia: si alguien añade una
    // columna 32 sin reabrirla, esto lo dice con el número en la mano.
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA).toHaveLength(31);
  });

  it("NO declara una columna de fecha de asignación (decisión medida del 2026-09-05)", () => {
    // El encargo humano pedía «fecha de gestión y fecha de asignación». Se midió contra
    // producción: el día de `orden.asignado_at` coincide con `orden.fecha_reparto` en 1.063 de
    // 1.063 casos, así que una columna aparte sería la MISMA columna dos veces —y peor, porque
    // `asignado_at` es un instante que se sobrescribe en cada reasignación y se anula al
    // deshacer una asignación o al cerrar una orden sin gestionar.
    //
    // Un requisito que se cumple «porque la columna no existe» necesita su test igual: sin él,
    // la próxima persona la añade sin enterarse de que hay una decisión detrás. El motivo, con
    // los números, vive en la cabecera del módulo.
    const claves = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave);
    const encabezados = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado);
    expect(claves).not.toContain("fechaAsignacion");
    expect(claves).not.toContain("asignadoAt");
    for (const encabezado of encabezados) {
      expect(encabezado, encabezado).not.toMatch(/asignaci[oó]n|asignad/i);
    }
    // Y la proyección tampoco la emite por otra puerta: ninguna celda sale de `asignado_at`.
    for (const resultado of LOS_CINCO) {
      expect(Object.keys(filaDescargaGestionFundida(gestion({ resultado })))).not.toContain(
        "fechaAsignacion",
      );
    }
    // La decisión está ESCRITA donde se mira, con sus números: si alguien retira el párrafo, el
    // siguiente no tiene forma de saber que esto se midió.
    const modulo = readFileSync(
      resolve(
        __dirname,
        "../../../app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts",
      ),
      "utf8",
    );
    expect(modulo).toContain("1.063 de 1.063");
    expect(modulo).toContain("312 de 1.063");
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
  it("las 31 columnas salen en el orden declarado sea cual sea el resultado (R9)", () => {
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

  it("la fecha de gestión es la de la GESTIÓN y no la del cierre (2026-09-05)", () => {
    // El caso que motivó la ficha: medido contra producción, las dos difieren en 312 de 1.063
    // gestiones (29 %). Aquí se fuerza esa diferencia —cierre el 11, gestión el 12— y se exige
    // que cada celda traiga la suya. Si la proyección leyera `cierreSolicitadoAt` para poblar
    // «Fecha de gestión», las dos celdas saldrían iguales y este caso lo dice.
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(
        gestion({
          resultado,
          cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
          fechaGestion: "2026-07-12",
        }),
      );
      expect(fila.fechaGestion, resultado).toBe("2026-07-12");
      expect(fila.fechaCierre, resultado).toBe("2026-07-11");
      expect(fila.fechaGestion, resultado).not.toBe(fila.fechaCierre);
    }
  });

  it("las dos fechas nuevas salen como día calendario YYYY-MM-DD, sin hora", () => {
    // El archivo lo abre una hoja de cálculo: una hora dentro de la celda la convierte en texto
    // y rompe el orden. El servidor ya entrega el día; aquí se afirma que la proyección no le
    // añade nada ni lo reformatea.
    const fila = filaDescargaGestionFundida(
      gestion({ resultado: "entregada", fechaGestion: "2026-12-31", diaReparto: "2026-01-01" }),
    );
    expect(fila.fechaGestion).toBe("2026-12-31");
    expect(fila.diaReparto).toBe("2026-01-01");
    for (const celda of [fila.fechaGestion, fila.diaReparto]) {
      expect(String(celda)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(celda)).not.toMatch(/[T:Z]/);
    }
  });

  it("un día de reparto ausente deja la celda VACÍA y nunca la fecha del cierre (2026-09-05)", () => {
    // `orden.fecha_reparto` se ANULA al deshacer una asignación, al liberar la orden a una
    // bodega satélite y al aprobar el cierre de una orden sin gestionar. `null` es entonces un
    // desenlace legítimo, y la tentación es «arreglarlo» poniendo la fecha del cierre o la de
    // la gestión: eso inventaría un día de reparto que nadie escribió.
    const fila = filaDescargaGestionFundida(
      gestion({ resultado: "devuelta", diaReparto: null, fechaGestion: "2026-07-12" }),
    );
    expect(fila.diaReparto).toBeNull();
    expect(fila.diaReparto).not.toBe(fila.fechaCierre);
    expect(fila.diaReparto).not.toBe(fila.fechaGestion);
    expect(fila.diaReparto).not.toBe("");
    expect(fila.diaReparto).not.toBe("—");
    // Y la clave SIGUE estando: la hoja es rectangular (R10).
    expect(Object.keys(fila)).toContain("diaReparto");
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
      // Las CUATRO fechas son CUATRO días distintos: cada celda trae la suya y ninguna se
      // contamina con la de al lado.
      fechaGestion: "2026-07-12",
      diaReparto: "2026-07-10",
      fechaCreacionOrden: "2026-07-08",
      numGuia: 1001,
      numRemision: "REM-1",
      destinatario: "Ana Pérez",
      direccion: "Calle 1, casa 2",
      ubicacion: "Limón · Limón · Central · Limón",
      producto: "Caja mediana",
      tienda: "Tienda X",
      // Los del MENSAJERO (5), no los de la TIENDA (3): los dos viajan en el DTO y el fixture
      // les da valores DISTINTOS, así que una celda que cogiera el contador equivocado pone
      // rojo este `toEqual` con el número en la mano.
      intentosEntrega: 5,
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

// --- Fichas 385 y 394: los intentos de ENTREGA y la fecha de creación de la orden ----------
//
// La 385 (2026-09-07) añadió DOS columnas: la fecha de creación de la orden y los intentos de
// contacto de LA TIENDA. La 394 (2026-09-08) SUSTITUYÓ la segunda por los intentos de ENTREGA,
// que era el dato que el humano había pedido. Este bloque afirma el contrato tal como quedó, y
// afirma también —con test propio— que el contador de la tienda NO volvió a colarse.

describe("las dos columnas de la ficha 385, con la de intentos sustituida por la 394", () => {
  /** La declaración, como pares (clave, encabezado), para poder afirmar sobre la pareja. */
  const DECLARADAS = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => [c.clave, c.encabezado]);

  it("la columna de intentos es la de ENTREGA y se llama igual que en las otras tres hojas", () => {
    // ESTE es el requisito de la 394. El literal se escribe A MANO y no se lee de
    // `INTENTOS_ENTREGA_COL`: comparar un encabezado contra la constante que lo genera está
    // siempre verde y no prueba nada. Es el mismo texto que llevan `novedades-descarga-columnas`,
    // `ayuda-descarga-columnas` y `lib/manifiesto/etiquetas-columnas` — que la misma cosa se
    // llame igual en las cuatro hojas es lo que impide compararlas y creer que son dos datos.
    const columna = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.find((c) => c.clave === "intentosEntrega");
    expect(columna).toBeDefined();
    expect(columna!.encabezado).toBe("Intentos de entrega");

    // Y NINGUNA otra columna de la hoja habla de intentos: la de la tienda se SUSTITUYÓ, no se
    // dejó al lado, precisamente porque dos columnas de «intentos» en la misma hoja es lo que
    // hizo falta desenredar.
    const deIntentos = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.filter((c) =>
      /intento/i.test(c.encabezado),
    );
    expect(deIntentos.map((c) => c.clave)).toEqual(["intentosEntrega"]);
  });

  it("la hoja YA NO lleva los intentos de contacto de LA TIENDA (ficha 394)", () => {
    // La columna que la 385 puso aquí contaba `orden.intentos_contacto`: el contador que sube la
    // TIENDA desde /novedades, que es un dato de otro dueño y contesta a otra pregunta. El campo
    // sigue viajando en el DTO —y el fixture lo trae con valor 3—, así que sin este caso nada
    // impediría que alguien lo recableara a la hoja «arreglándola».
    const claves = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave);
    expect(claves).not.toContain("intentosContactoTienda");
    expect(claves).not.toContain("intentos");
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado)).not.toContain(
      "Intentos de contacto de la tienda",
    );
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(gestion({ resultado }));
      expect(Object.keys(fila), resultado).not.toContain("intentosContactoTienda");
      expect(Object.keys(fila), resultado).not.toContain("intentos");
      // Y el VALOR tampoco: el fixture da 5 al mensajero y 3 a la tienda, así que una celda que
      // leyera el campo equivocado saldría con un 3 bajo el encabezado «Intentos de entrega».
      expect(fila.intentosEntrega, resultado).toBe(5);
      expect(fila.intentosEntrega, resultado).not.toBe(3);
    }
  });

  it("los intentos salen tal cual, y el CERO se emite en vez de dejar la celda vacía", () => {
    // El DTO promete un número y NUNCA `null`: el `?? 0` lo resolvió el borde de datos. El `0`
    // es un HECHO —«nadie ha intentado entregarla todavía»— y una celda vacía diría «no se
    // sabe». Un `|| null` o un `?? ""` en la proyección pone rojo esto.
    const conIntentos = filaDescargaGestionFundida(
      gestion({ resultado: "entregada", intentosEntrega: 7 }),
    );
    expect(conIntentos.intentosEntrega).toBe(7);

    const sinIntentos = filaDescargaGestionFundida(
      gestion({ resultado: "devuelta", intentosEntrega: 0 }),
    );
    expect(sinIntentos.intentosEntrega).toBe(0);
    expect(sinIntentos.intentosEntrega).not.toBeNull();
    expect(sinIntentos.intentosEntrega).not.toBe("");
    expect(sinIntentos.intentosEntrega).not.toBeUndefined();
    // Número, no texto: quien abre la hoja ordena y suma por esta columna.
    expect(typeof sinIntentos.intentosEntrega).toBe("number");
    // Y el cero de ENTREGA no se rellena con el contador de la tienda, que aquí vale 3.
    expect(sinIntentos.intentosEntrega).not.toBe(3);
  });

  it("la fecha de creación es la de la ORDEN y no ninguna de las otras tres", () => {
    // Las cuatro fechas del fixture son cuatro días distintos a propósito (creación 8, reparto
    // 10, cierre 11, gestión 12). Si la proyección leyera la celda de al lado, dos de ellas
    // saldrían iguales y este caso lo dice; con las cuatro iguales pasaría en verde.
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(gestion({ resultado }));
      expect(fila.fechaCreacionOrden, resultado).toBe("2026-07-08");
      expect(fila.fechaCreacionOrden, resultado).not.toBe(fila.fechaCierre);
      expect(fila.fechaCreacionOrden, resultado).not.toBe(fila.fechaGestion);
      expect(fila.fechaCreacionOrden, resultado).not.toBe(fila.diaReparto);
    }
  });

  it("la fecha de creación sale como día calendario, sin hora que rompa la hoja", () => {
    // El servidor ya la entrega como día CR; aquí se afirma que la proyección no le añade nada.
    // Una hora dentro de la celda la convierte en texto y rompe el orden de la columna.
    const fila = filaDescargaGestionFundida(
      gestion({ resultado: "entregada", fechaCreacionOrden: "2026-12-31" }),
    );
    expect(fila.fechaCreacionOrden).toBe("2026-12-31");
    expect(String(fila.fechaCreacionOrden)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(fila.fechaCreacionOrden)).not.toMatch(/[T:Z]/);
  });

  it("las dos nuevas van en su sitio y NINGUNA existente cambia de orden relativo", () => {
    // (a) Posición declarada: la fecha cierra el bloque de fechas (5.ª) y los intentos van
    // entre «Tienda» y «Resultado» (13.ª). No es cosmética: las cuatro fechas juntas se leen
    // como la línea de tiempo que son, y «Resultado» tiene que quedar cerrando el bloque de lo
    // que siempre se puebla, porque es la celda que decide cuáles de las 17 siguientes traen
    // dato.
    const claves = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave);
    expect(claves.indexOf("fechaCreacionOrden")).toBe(4);
    // La 394 SUSTITUYÓ la columna de intentos en su sitio: la 13.ª sigue siendo la de intentos y
    // sigue pegada a «Resultado». Cambió de qué contador sale, no dónde va.
    expect(claves.indexOf("intentosEntrega")).toBe(12);
    expect(claves[claves.indexOf("intentosEntrega") + 1]).toBe("resultado");

    // (b) El orden RELATIVO de las 29 de antes se conserva entero. Se compara contra la lista
    // literal previa a la ficha —no contra la constante filtrada por sí misma, que siempre
    // estaría verde—: una permuta de dos columnas viejas pone esto rojo aunque el censo cuadre.
    const ANTES_DE_LA_385 = [
      "mensajero",
      "fechaCierre",
      "fechaGestion",
      "diaReparto",
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
    ];
    expect(ANTES_DE_LA_385).toHaveLength(29); // no-vacuidad: la lista de contraste es la de antes
    expect(claves.filter((c) => ANTES_DE_LA_385.includes(c))).toEqual(ANTES_DE_LA_385);
  });

  it("las dos nuevas se pueblan SIEMPRE: no dependen del resultado de la fila", () => {
    // Son datos de la ORDEN, no del desenlace de la gestión. Si alguien las metiera en
    // `CLAVES_ESPECIFICAS`, quedarían vacías en cuatro de los cinco resultados.
    for (const resultado of LOS_CINCO) {
      const fila = filaDescargaGestionFundida(
        gestion({ resultado, fechaCreacionOrden: "2026-05-01", intentosEntrega: 2 }),
      );
      expect(fila.fechaCreacionOrden, resultado).toBe("2026-05-01");
      expect(fila.intentosEntrega, resultado).toBe(2);
    }
  });

  it("los encabezados nuevos no se pisan con ninguno de los 29 anteriores", () => {
    // Dos columnas con el mismo encabezado son indistinguibles en la hoja y en el selector.
    const encabezados = DECLARADAS.map(([, encabezado]) => encabezado);
    expect(new Set(encabezados).size).toBe(encabezados.length);
  });

  it("la hoja de RESUMEN no se toca: es otro nivel y otro ámbito", () => {
    // El encargo fue sobre el DETALLE. El resumen tiene grano CIERRE (una fila por cierre, no
    // por gestión), así que «los intentos de la orden» ni siquiera tendría dónde leerse, y su
    // preferencia de columnas vive en ámbitos aparte (`cierres-pendientes`/`cierres-resueltos`).
    // Sin este caso, añadir las columnas también allí «por simetría» no rompería nada.
    for (const columnas of [
      COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
      COLUMNAS_DESCARGA_CIERRES_HISTORICO,
    ]) {
      const claves = columnas.map((c) => c.clave);
      expect(claves).not.toContain("intentosContactoTienda");
      expect(claves).not.toContain("intentosEntrega");
      expect(claves).not.toContain("fechaCreacionOrden");
      for (const columna of columnas) {
        expect(columna.encabezado).not.toMatch(/intento/i);
        expect(columna.encabezado).not.toMatch(/creaci[oó]n/i);
      }
    }
    // No-vacuidad: el resumen conserva su tamaño de siempre, 7 y 8 columnas.
    expect(COLUMNAS_DESCARGA_CIERRES_PENDIENTES).toHaveLength(7);
    expect(COLUMNAS_DESCARGA_CIERRES_HISTORICO).toHaveLength(8);
    // Y los tres ámbitos siguen siendo tres: la preferencia es POR NIVEL.
    expect(
      new Set([
        AMBITO_DESCARGA_GESTIONES_FUNDIDA,
        AMBITO_DESCARGA_CIERRES_PENDIENTES,
        AMBITO_DESCARGA_CIERRES_HISTORICO,
      ]).size,
    ).toBe(3);
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

// ---------------------------------------------------------------------------
// FICHA 408 — la celda «Motivo» de la hoja FUNDIDA dice lo mismo que la pantalla (R6)
// ---------------------------------------------------------------------------
//
// Es el mismo criterio que R45 —«SIEMPRE la etiqueta legible, JAMÁS el value del enum»— aplicado
// al motivo que compone el cron de plazos vencidos. Los literales van tecleados a mano.

describe("FICHA 408 — el motivo del cron en la hoja fundida", () => {
  it("un rechazo automático emite «Dirección errada», no la plantilla cruda (R6)", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "rechazada",
        esRechazoSla: true,
        motivo: "escalado SLA wrong_address",
      }),
    );

    expect(fila.motivo).toBe("Dirección errada");
    // La celda «Origen» de al lado es la que decide la variante, con el MISMO booleano.
    expect(fila.origenRechazo).toBe("Automático");
    expect(String(fila.motivo)).not.toContain("SLA");
    expect(String(fila.motivo)).not.toContain("wrong_address");
  });

  it("las otras dos causas también salen en castellano (R1)", () => {
    expect(
      filaDescargaGestionFundida(
        gestion({ resultado: "rechazada", esRechazoSla: true, motivo: "escalado SLA not_found" }),
      ).motivo,
    ).toBe("Cliente no localizado");
    expect(
      filaDescargaGestionFundida(
        gestion({
          resultado: "rechazada",
          esRechazoSla: true,
          motivo: "escalado SLA wrong_number",
        }),
      ).motivo,
    ).toBe("Número de celular errado");
  });

  it("el motivo que escribió el mensajero sale intacto (R2)", () => {
    const fila = filaDescargaGestionFundida(
      gestion({
        resultado: "rechazada",
        esRechazoSla: false,
        motivo: "El cliente no contesta el timbre",
      }),
    );

    expect(fila.motivo).toBe("El cliente no contesta el timbre");
    expect(fila.origenRechazo).toBe("Manual");
  });
});
