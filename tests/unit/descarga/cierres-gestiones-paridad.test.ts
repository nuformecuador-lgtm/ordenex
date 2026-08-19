// Feature 230 (T7.5) — PARIDAD de los dos caminos de la descarga detallada (R26) y cobertura de
// la GAM (R27).
//
// Qué se afirma y por qué no basta con mirar el código una vez: la feature tiene DOS bordes de
// lectura —uno por pantalla, porque los conjuntos son disjuntos (design §2.6)— y UNA sola
// declaración de columnas. El modo de fallo que esto cierra es el clásico de las salidas
// gemelas: alguien añade una columna «para bodega», nace una segunda declaración, y a los tres
// meses los dos archivos que decían ser el mismo tienen columnas distintas. Aquí se afirma que
// hay UNA declaración, UNA proyección y que las dos pantallas las consumen.
//
// La paridad de los DTOs que devuelven los dos repositorios la cubre
// `tests/unit/repositories/cierres-gestiones-descarga-dto.test.ts` (backend). Esto es la mitad
// de arriba: misma fila proyectada y misma hoja.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
  filaDescargaGestionFundida,
} from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import type { IngresoOrdenexDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";

const RAIZ = path.resolve(__dirname, "../../..");

function fuente(relativa: string): string {
  const texto = readFileSync(path.join(RAIZ, relativa), "utf8");
  expect(texto.length, `${relativa} está vacío`).toBeGreaterThan(500);
  return texto;
}

function ingreso(over: Partial<IngresoOrdenexDTO> = {}): IngresoOrdenexDTO {
  return {
    montoCobrar: "1000.10",
    cobraComision: true,
    esCentral: false,
    flete: "100.00",
    ivaFlete: "13.00",
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: "50.00",
    ivaComisionCod: "6.50",
    fleteConIva: "113.00",
    fleteDevolucionConIva: null,
    comisionConIva: "56.50",
    total: "169.50",
    tarifa: null,
    ...over,
  };
}

/**
 * La MISMA gestión, tal como la devolvería cualquiera de los dos servicios. Es el mismo DTO
 * —`CierreGestionDescargaDTO`— a propósito: el de bodega lo IMPORTA en vez de redeclararlo, que
 * es lo que hace que esta comparación signifique algo.
 */
function gestion(over: Partial<CierreGestionDescargaDTO> = {}): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    numGuia: 1001,
    numRemision: "REM-1",
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "1000.10",
    pagos: [{ metodo: "SINPE", monto: "1000.10" }],
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

describe("paridad de los dos caminos de la descarga detallada (R26)", () => {
  it("los dos caminos proyectan la misma fila desde la misma declaración de columnas", () => {
    // (a) La misma gestión, venga del camino A (cierres del día) o del B (bodega), da la MISMA
    // fila: no hay proyección «de bodega».
    const porCierresDelDia = filaDescargaGestionFundida(gestion());
    const porCierresDeBodega = filaDescargaGestionFundida(gestion());
    expect(porCierresDeBodega).toEqual(porCierresDelDia);
    expect(Object.keys(porCierresDeBodega)).toEqual(
      COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.clave),
    );

    // (b) Y hay UNA sola declaración en el árbol: ni una constante gemela «de bodega», ni una
    // segunda función de proyección. Es la mitad que evita la divergencia futura.
    const modulo = fuente(
      "app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts",
    );
    expect(modulo.match(/export const COLUMNAS_DESCARGA_GESTIONES_/g) ?? []).toHaveLength(1);
    expect(modulo.match(/export function filaDescargaGestion/g) ?? []).toHaveLength(1);

    // (c) Las dos pantallas montan el MISMO componente de diálogo, que es quien las consume.
    // Ninguna importa la declaración por su cuenta para «ajustarla».
    for (const pantalla of [
      "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
      "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
    ]) {
      const texto = fuente(pantalla);
      expect(texto, pantalla).toMatch(/import \{ DescargarGestionesDialog \} from "\.\/DescargarGestionesDialog";/);
      expect(texto, pantalla).not.toMatch(/COLUMNAS_DESCARGA_GESTIONES_FUNDIDA/);
    }
  });

  it("una gestión con destino bodega central sale por el camino de cierres del día (R27)", () => {
    // La GAM no tiene camino propio ni trato especial: es el alcance del maestro en
    // `cierres-admin` (design §2.6). Dos gestiones idénticas salvo por `esCentral` producen
    // exactamente la MISMA fila — si la hoja distinguiera la central, aquí habría diferencia.
    const central = filaDescargaGestionFundida(
      gestion({ ingresoOrdenex: ingreso({ esCentral: true }) }),
    );
    const satelite = filaDescargaGestionFundida(
      gestion({ ingresoOrdenex: ingreso({ esCentral: false }) }),
    );
    expect(central).toEqual(satelite);
    // Y `esCentral` no es ninguna de las 26 columnas: es un dato de tarifa, no de la gestión.
    expect(Object.keys(central)).not.toContain("esCentral");
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.map((c) => c.encabezado)).not.toContain("Central");
  });
});
