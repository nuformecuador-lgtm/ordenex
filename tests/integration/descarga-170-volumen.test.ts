/**
 * Feature 170 (T G.2) — VOLUMEN de la descarga, en el punto exacto donde el rollout se
 * juega su promesa: el tope.
 *
 * El round-trip de la 151 (`descarga-dataset-roundtrip.test.ts`) ya demuestra que 60 filas
 * entran y 60 salen. Lo que no demuestra —y es lo que la fase 1 promete a 25 tablas— es qué
 * pasa EN el tope y UN PASO por encima:
 *
 *   - con N filas exactas se produce un archivo COMPLETO y releíble (R28);
 *   - con N+1 no se produce archivo NINGUNO, y el aviso dice total, tope y qué hacer
 *     (R26/R27).
 *
 * Se hace sobre la tabla MÁS ANCHA del rollout (órdenes, 15 columnas): es la que produce el
 * archivo más pesado y la que primero daría problemas si el tope estuviera mal elegido. El
 * peso medido queda anotado en `progress/impl_170-export-todas-las-tablas.md`; si algún día
 * ese número se dispara, la salida es BAJAR N, nunca truncar el archivo.
 *
 * Va en `tests/integration/` y no en unitarios porque atraviesa piezas reales de tres capas
 * —proyección de columnas, adaptadores de cliente y generador binario— sin dobles.
 */
import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ORDENES,
  filaDescargaOrden,
} from "@/app/(app)/ordenes/_components/ordenes-descarga-columnas";
import { filasLocales, filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { descargaConfig } from "@/lib/config/descarga";
import { construirDescarga } from "@/lib/utils/descarga-dataset";
import type { OrdenListItemDTO } from "@/lib/types/orden";

/** El tope ÚNICO de la app (P5). No se escribe 5000: si cambia, este test cambia con él. */
const N = descargaConfig.MAX_FILAS;

const TITULO = "Órdenes";
const ENCABEZADOS = COLUMNAS_DESCARGA_ORDENES.map((c) => c.encabezado);

/** Techo de peso del archivo del tope, en MB. Ver la cabecera: es un aviso, no un adorno. */
const PESO_MAXIMO_MB = 20;

function orden(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 100000 + i,
    numRemision: `REM-${String(i).padStart(6, "0")}`,
    estatusId: "est-uuid",
    estatusValue: "entregada",
    destinatario: `Destinatario de prueba ${i}`,
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-uuid",
    provinciaId: "prov-uuid",
    cantonId: "canton-uuid",
    distritoId: "distrito-uuid",
    producto: `Producto ${i}`,
    peso: 1.5,
    notas: null,
    direccion: `Calle ${i}, casa ${i % 90}`,
    montoCobrar: 1000 + i,
    intentosEntrega: i % 3,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
    relaciones: {
      estatus: { id: "est-uuid", value: "entregada" },
      tienda: {
        id: "tienda-uuid",
        nombre: "Tienda Relación",
        email: "tienda@x.com",
        telefono: "022222222",
        tarifa: null,
      },
      zona: { id: "zona-uuid", nombre: "Zona Norte", esCentral: false },
      provincia: { id: "prov-uuid", nombre: "San José" },
      canton: { id: "canton-uuid", nombre: "Escazú" },
      distrito: { id: "distrito-uuid", nombre: "San Rafael" },
      mensajeroAsignado: { id: "mens-uuid", nombre: "Luis Mora" },
    },
  } as OrdenListItemDTO;
}

/** `n` órdenes distintas entre sí (nada de la misma fila repetida: comprimiría de más). */
function dataset(n: number): OrdenListItemDTO[] {
  return Array.from({ length: n }, (_, i) => orden(i));
}

describe("Descarga · volumen en el tope (feature 170, T G.2)", () => {
  it(
    "un archivo de N filas se relee con las mismas cabeceras y el mismo nº de filas",
    { timeout: 120_000 },
    async () => {
      // R28: en el tope EXACTO se entrega el dataset entero. Ni una fila menos, y sin
      // truncado silencioso: se cuenta lo que sale del binario, no lo que entró.
      const filas = dataset(N).map(filaDescargaOrden);
      expect(filas).toHaveLength(N);

      const archivo = await construirDescarga(
        { titulo: TITULO, columnas: COLUMNAS_DESCARGA_ORDENES, filas },
        new Date("2026-07-31T12:00:00Z"),
      );

      expect(archivo.nombreArchivo).toBe("ordenes-2026-07-31.xlsx");
      expect(typeof archivo.contenido).not.toBe("string");
      if (typeof archivo.contenido === "string") return;

      // Peso medido del archivo del tope para la tabla más ancha (15 columnas). Queda
      // anotado en la bitácora; el techo es la señal de que hay que revisar N.
      const pesoMB = archivo.contenido.byteLength / (1024 * 1024);
      // La medición es un ENTREGABLE de T G.2, no ruido: se imprime para que el número de
      // la bitácora se pueda volver a comprobar corriendo el test, en vez de creerlo.
      console.log(
        `[T G.2] xlsx de ${N} filas × ${ENCABEZADOS.length} columnas: ${pesoMB.toFixed(2)} MB (${archivo.contenido.byteLength} bytes)`,
      );
      expect(pesoMB).toBeLessThan(PESO_MAXIMO_MB);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        archivo.contenido as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );

      expect(workbook.worksheets).toHaveLength(1);
      const hoja = workbook.worksheets[0]!;
      expect(hoja.name).toBe(TITULO);

      const cabeceras: string[] = [];
      hoja.getRow(1).eachCell((cell) => cabeceras.push(String(cell.value ?? "")));
      expect(cabeceras).toEqual(ENCABEZADOS);

      // N filas dentro ⇒ N filas fuera.
      expect(hoja.rowCount).toBe(N + 1);

      // La PRIMERA y la ÚLTIMA sobreviven en su posición: un recorte por página o por
      // buffer se habría comido justamente la última.
      const columnaGuia = ENCABEZADOS.indexOf("Nº Guía") + 1;
      expect(hoja.getRow(2).getCell(columnaGuia).value).toBe(filas[0]!.numGuia);
      expect(hoja.getRow(N + 1).getCell(columnaGuia).value).toBe(filas[N - 1]!.numGuia);
    },
  );

  it("con N+1 filas no se produce archivo y el mensaje trae total y tope", async () => {
    // R26/R27 por las DOS puertas del tope, que son las dos familias del rollout:
    //
    //  - Familia B (`filasLocales`): el array vive en el cliente y el tope se aplica ahí.
    //  - Familia A (`filasDesdeResultado`): el tope lo aplica el SERVICIO y devuelve
    //    `limite_excedido`; el adaptador lo traduce a un aviso accionable.
    //
    // En ambos casos la respuesta correcta es la MISMA: ninguna fila, y un mensaje que dice
    // cuántas hay, cuál es el tope y qué hacer. Un archivo a medias sería mucho peor.
    const total = N + 1;

    const local = await filasLocales(dataset(total), filaDescargaOrden);
    expect(local.status).toBe("error");
    if (local.status !== "error") return;
    expect(local.mensaje).toContain(String(total));
    expect(local.mensaje).toContain(String(N));
    expect(local.mensaje).toMatch(/acota los filtros/i);
    expect(local).not.toHaveProperty("filas");

    const servidor = await filasDesdeResultado(
      { status: "limite_excedido", total, limite: N },
      filaDescargaOrden,
    );
    expect(servidor.status).toBe("error");
    if (servidor.status !== "error") return;
    expect(servidor.mensaje).toBe(local.mensaje); // el MISMO texto por las dos puertas
    expect(servidor).not.toHaveProperty("filas");

    // Y lo que cierra R28: sin filas no hay archivo. El generador común ni se invoca —el
    // control corta antes—, y si alguien lo invocara con cero columnas, protesta.
    await expect(
      construirDescarga({ titulo: TITULO, columnas: [], filas: [] }),
    ).rejects.toThrow(/al menos una columna/);
  });
});
