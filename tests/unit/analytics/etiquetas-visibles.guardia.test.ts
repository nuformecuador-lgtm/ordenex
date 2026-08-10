// GUARDIA DEL ARNÉS — EL TEXTO QUE EL MAESTRO LEE EN EL TABLERO, FIJADO A MANO.
//
// **El agujero que cierra, medido.** El 2026-08-07 se descubrió —mirando la app en el navegador,
// no la suite— que **ninguna** de las 25 etiquetas de `lib/analytics/metrics.ts` llevaba tilde, y
// siete estaban mal escritas en español: «Ordenes creadas», «Ordenes por estado», «Antiguedad por
// estado», «Conciliacion de cierres», «Ingreso por comision COD», «Tasa de devolucion» y «Motivos
// de devolucion». «Órdenes» es la palabra central del producto y estaba mal en la PRIMERA pantalla
// que abre el maestro. Llevaba así siete jornadas.
//
// Lo grave no fue la falta, sino que **la suite era ciega a ella**. Mutación de control del mismo
// día (`progress/impl_guardia-citas-rotas.md` §12, «M2»): quitar la tilde a DOS de las siete
// directamente en el catálogo dejaba **123 archivos y 1.500 tests en verde**. Lo único que estaba
// fijado era el TÍTULO del panel, y solo por accidente: porque vive duplicado en
// `catalogo-paneles.ts` y tres tests buscan la región por su nombre accesible literal.
//
// **Por qué el esperado va escrito A MANO.** Precedente vivo de la casa: la 189 censó
// `COLUMNAS_DESCARGA_RANKING` como «cubierta» y no lo estaba, porque su aserción hacía
// `expect(columnas.map(...)).toEqual(COLUMNAS_DESCARGA_RANKING.map(...))` — el esperado ERA la
// propia constante, así que permutar dos columnas movía los dos lados a la vez y el test seguía
// verde. Un esperado derivado del catálogo aquí sería la misma tautología: pasaría haga lo que
// haga. Por eso las 25 filas de abajo están transcritas una a una, y por eso **una métrica nueva
// pone esto rojo hasta que alguien escriba su etiqueta aquí**: el texto visible deja de ser un
// descuido invisible y pasa a ser un acto deliberado.
//
// **Qué NO es tautología.** El último caso compara la leyenda del tablero con la etiqueta del
// catálogo. Eso sí puede derivarse, porque los dos lados son **módulos independientes**: la
// duplicación es deliberada (R25 — `catalogo-paneles.ts` no importa el catálogo para no publicar
// al navegador el censo de servidor: 25 métricas con su alcance por rol, su fuente y sus nombres
// de tabla). Nada obliga hoy a que digan lo mismo, y si un día divergen el maestro leerá dos
// nombres para la misma cifra. Aquí se entera alguien.
//
// Alcance: solo el texto que se LEE. Los `descripcion:` del catálogo no entran porque no llegan a
// pantalla (el vacío que se ve sale de `textos.ts`), así que siguen la convención sin tildes del
// repo, igual que los comentarios.
import { describe, it, expect } from "vitest";

import { PANELES_OPERATIVOS } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import { METRICAS, getMetrica } from "@/lib/analytics/metrics";

describe("las etiquetas del catálogo de métricas — el texto que se lee en el tablero", () => {
  it("son exactamente estas 25, con su acentuación, y en este orden", () => {
    // Si nace la 26.ª, este caso se pone rojo hasta que su etiqueta pase por aquí. Es el mismo
    // contrato que la guardia de columnas de descarga: lo que el usuario lee no nace desnudo.
    expect(
      METRICAS.length,
      "el catálogo cambió de tamaño: si nació una métrica, escribe su etiqueta en la lista de " +
        "abajo (a mano, no la derives del catálogo); si se retiró una, quítala de la lista",
    ).toBe(25);

    expect(METRICAS.map((m) => [m.id, m.etiqueta])).toEqual([
      // --- 15 operativas ---
      ["ordenes_creadas", "Órdenes creadas"],
      ["ordenes_por_estado", "Órdenes por estado"],
      ["entregas", "Entregas"],
      ["devoluciones", "Devoluciones"],
      ["rechazos", "Rechazos"],
      ["reprogramaciones", "Reprogramaciones"],
      ["incidentes", "Incidentes"],
      ["sin_gestionar", "Sin gestionar"],
      ["tasa_entrega", "Tasa de entrega"],
      ["tasa_devolucion", "Tasa de devolución"],
      ["tasa_rechazo", "Tasa de rechazo"],
      ["primer_intento_ok", "Entrega al primer intento"],
      ["motivos_devolucion", "Motivos de devolución"],
      ["tiempo_ciclo", "Tiempo de ciclo"],
      // `antigüedad` lleva DIÉRESIS y no acento: es aguda terminada en `-d`.
      ["aging_por_estado", "Antigüedad por estado"],
      // --- 10 financieras ---
      ["cod_recaudado", "COD recaudado"],
      ["ingreso_flete", "Ingreso por flete"],
      ["ingreso_comision_cod", "Ingreso por comisión COD"],
      ["ingreso_iva", "Ingreso por IVA"],
      ["egresos", "Egresos"],
      ["dinero_en_caja", "Dinero en caja"],
      // «Ordenex» es la marca: no lleva tilde, y no es un olvido.
      ["ganancia_ordenex", "Ganancia de Ordenex"],
      ["cuenta_por_pagar_tienda", "Cuenta por pagar a tiendas"],
      ["cuenta_por_pagar_mensajero", "Cuenta por pagar a mensajeros"],
      ["conciliacion_cierres", "Conciliación de cierres"],
    ]);
  });
});

describe("los rótulos del tablero operativo — la otra mitad del texto visible", () => {
  it("los títulos de panel son estos seis, escritos a mano", () => {
    // El `titulo` es el nombre accesible de la región (`GraficaMarco` lo usa como `aria-label`):
    // es lo que el maestro lee como encabezado del panel Y lo que un lector de pantalla anuncia.
    // Dos NO son etiquetas de métrica y por eso no salen del catálogo ni pueden cruzarse con él:
    // «Resultado de las gestiones» (el panel junta cuatro) y «Órdenes sin gestionar» (la métrica
    // se llama «Sin gestionar»; el panel la nombra entera).
    expect(PANELES_OPERATIVOS.map((p) => p.titulo)).toEqual([
      "Órdenes creadas",
      "Órdenes por estado",
      "Resultado de las gestiones",
      "Órdenes sin gestionar",
      "Tasa de entrega",
      "Tiempo de ciclo",
    ]);
  });

  it("las leyendas son estas nueve, escritas a mano", () => {
    expect(PANELES_OPERATIVOS.flatMap((p) => p.metricas.map((m) => [m.metricaId, m.etiqueta]))).toEqual(
      [
        ["ordenes_creadas", "Órdenes creadas"],
        ["ordenes_por_estado", "Órdenes por estado"],
        ["entregas", "Entregas"],
        ["devoluciones", "Devoluciones"],
        ["rechazos", "Rechazos"],
        ["incidentes", "Incidentes"],
        ["sin_gestionar", "Sin gestionar"],
        ["tasa_entrega", "Tasa de entrega"],
        ["tiempo_ciclo", "Tiempo de ciclo"],
      ],
    );
  });

  it("ninguna leyenda se ha separado de la etiqueta del catálogo", () => {
    // Aquí SÍ se compara una fuente con otra, y no es tautología: son dos módulos independientes
    // por decisión (R25). Nada en el código obliga a que coincidan; esta es la única costura.
    for (const panel of PANELES_OPERATIVOS) {
      for (const metrica of panel.metricas) {
        const delCatalogo = getMetrica(metrica.metricaId);
        expect(delCatalogo, `\`${metrica.metricaId}\` no existe en el catálogo`).toBeDefined();
        expect(
          metrica.etiqueta,
          `el panel «${panel.titulo}» llama «${metrica.etiqueta}» a lo que el catálogo llama ` +
            `«${delCatalogo?.etiqueta}»: el maestro leería dos nombres para la misma cifra`,
        ).toBe(delCatalogo?.etiqueta);
      }
    }
  });
});
