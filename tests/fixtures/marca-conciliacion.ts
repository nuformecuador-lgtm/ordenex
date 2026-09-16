// ⭑ FICHA 431 (pasada de frontend) — LOS SEIS CAMPOS DE LA MARCA DE CONCILIACION, para los
// dobles de `CierreBodegaResumen` / `CierreBodegaResumenRow`.
//
// POR QUE UN FIXTURE Y NO SEIS LITERALES EN CADA TEST: al añadir la marca a la cabecera del
// cierre de bodega, el compilador destapó **dieciocho** archivos de test que construyen ese DTO a
// mano. Repetir ahí `faltaPorRecibir: "0.00"` habría sido rápido y MENTIRA: una consolidación sin
// marcar debe `total_efectivo` ENTERO, no cero, y un doble que dice lo contrario enseña a leer mal
// la cifra que esta ficha existe para enseñar.
//
// Estas dos funciones construyen la marca CUADRADA a partir del efectivo del propio doble, con la
// misma fórmula que el servidor (`lib/utils/conciliacion-satelite.saldoDe`), pero **sin importarla**:
// un fixture que llamara a la función de producción para calcular lo que después se afirma sería
// una aserción contra su propia fuente, y estaría siempre verde. Aquí la resta se escribe como
// dato de entrada del test, que es lo que un doble tiene que ser.

/** Los seis campos de la marca, tal como viajan en la cabecera. */
export interface MarcaConciliacionDoble {
  conciliado: boolean;
  montoRecibido: string | null;
  faltaPorRecibir: string;
  conciliadoAt: string | null;
  conciliadoPorNombre: string | null;
  conciliadoNota: string | null;
}

/**
 * SIN CONCILIAR (el estado en el que nace toda consolidación): la marca está vacía y falta por
 * llegar el efectivo ENTERO. `montoRecibido` es `null` y nunca `"0.00"`: cero recibido es otra
 * cosa (alguien contó y no había nada), y el `CHECK` de la base prohíbe la combinación.
 */
export function marcaSinConciliar(totalEfectivo: string): MarcaConciliacionDoble {
  return {
    conciliado: false,
    montoRecibido: null,
    faltaPorRecibir: totalEfectivo,
    conciliadoAt: null,
    conciliadoPorNombre: null,
    conciliadoNota: null,
  };
}

/**
 * RECIBIDA por `montoRecibido`. `faltaPorRecibir` lo pone QUIEN LLAMA, porque es justo la cifra
 * que los tests de esta ficha afirman: pasarla como parámetro obliga a escribirla a mano y así un
 * caso de «recibido incompleto» no puede colarse con la diferencia calculada por el propio
 * fixture. Con `faltaPorRecibir` distinto de cero, la presentación dice «Recibido incompleto».
 */
/**
 * La marca que le CORRESPONDE a un estado, para los dobles que construyen filas con el estado
 * como parámetro.
 *
 * ⚠️ NO es una comodidad: desde la ficha 431 el `CHECK` `cierre_bodega_conciliacion_coherente`
 * hace **imposible** en la base un `aprobado` sin marca y una marca sin `aprobado`. Un doble que
 * devolviera un `aprobado` sin conciliar describiría una fila que Postgres rechaza, y los tests
 * que corren contra él estarían midiendo un mundo que no existe.
 *
 * `rechazado` y `vencido` van SIN marca, igual que `solicitado`: el `CHECK` sólo exige la marca
 * en `aprobado`.
 */
export function marcaPorEstado(estado: string, totalEfectivo: string): MarcaConciliacionDoble {
  return estado === "aprobado"
    ? marcaRecibida(totalEfectivo, "0.00")
    : marcaSinConciliar(totalEfectivo);
}

export function marcaRecibida(
  montoRecibido: string,
  faltaPorRecibir: string,
  extra: Partial<Pick<MarcaConciliacionDoble, "conciliadoAt" | "conciliadoPorNombre" | "conciliadoNota">> = {},
): MarcaConciliacionDoble {
  return {
    conciliado: true,
    montoRecibido,
    faltaPorRecibir,
    conciliadoAt: extra.conciliadoAt ?? "2026-09-15T17:40:00.000Z",
    conciliadoPorNombre: extra.conciliadoPorNombre ?? "Ana Rojas",
    conciliadoNota: extra.conciliadoNota ?? null,
  };
}
