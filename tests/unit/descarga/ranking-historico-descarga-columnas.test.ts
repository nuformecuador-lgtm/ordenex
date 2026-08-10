import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_RANKING_HISTORICO,
  filaDescargaRankingHistorico,
} from "@/app/(app)/ranking/historico/_components/ranking-historico-descarga-columnas";
import { tituloRankingHistorico } from "@/app/(app)/ranking/historico/_components/ranking-historico-labels";
import { nombreArchivoDescarga } from "@/lib/utils/descarga-dataset";
import type { RankingSnapshotFilaDTO } from "@/lib/types/ranking-snapshot";

// Feature 196 (T5.4) — ORDEN, CENSO y PROYECCIÓN de las columnas del archivo del histórico.
// Cubre R34 y R35.
//
// Por qué existe además del test de componente: allí el esperado ES la propia constante
// (`columnas.map(c => c.key)` contra `COLUMNAS_DESCARGA_RANKING_HISTORICO.map(c => c.clave)`),
// así que permutar dos columnas mueve los dos lados a la vez y el caso sigue verde. Es la
// «cobertura tautológica» que la 189 censó en el gemelo del ranking en vivo. Aquí el esperado
// va escrito A MANO, que es lo único que sujeta el orden de verdad.

const FILA_PODIO: RankingSnapshotFilaDTO = {
  puesto: 1,
  posicion: 1,
  mensajeroId: "b1a2c3d4-0000-4000-8000-000000000001",
  nombre: "Ana Mensajera",
  entregadas: 5,
  asignadas: 5,
  pct: "100.0",
  premioMonto: "5000.00",
  premioDescripcion: "Bono oro",
};

const FILA_SIN_PODIO: RankingSnapshotFilaDTO = {
  puesto: 7,
  posicion: null,
  mensajeroId: "b1a2c3d4-0000-4000-8000-000000000007",
  nombre: "Caro Sin Ruta",
  entregadas: 0,
  asignadas: 0,
  pct: null,
  premioMonto: null,
  premioDescripcion: null,
};

describe("columnas de descarga del ranking histórico", () => {
  it("declara sus columnas en el orden de la pantalla (design §7)", () => {
    expect(COLUMNAS_DESCARGA_RANKING_HISTORICO.map((c) => c.clave)).toEqual([
      "puesto",
      "posicion",
      "mensajero",
      "porcentaje",
      "entregadas",
      "asignadas",
      "premio",
    ]);
    expect(COLUMNAS_DESCARGA_RANKING_HISTORICO.map((c) => c.encabezado)).toEqual([
      "Puesto",
      "Posición",
      "Mensajero",
      "% del día",
      "Entregadas",
      "Asignadas",
      "Premio",
    ]);
  });

  it("R34: la proyección no contiene el id interno del mensajero", () => {
    // El identificador de negocio de la fila es el NOMBRE CONGELADO (R16), que además es el
    // único que sigue siendo cierto si el mensajero se renombró después del congelado.
    const proyectada = filaDescargaRankingHistorico(FILA_PODIO);

    expect(Object.keys(proyectada)).not.toContain("mensajeroId");
    expect(Object.values(proyectada)).not.toContain(FILA_PODIO.mensajeroId);
    expect(COLUMNAS_DESCARGA_RANKING_HISTORICO.map((c) => c.clave)).not.toContain(
      "mensajeroId",
    );
    // Y la proyección emite EXACTAMENTE las claves declaradas, ni una más.
    expect(Object.keys(proyectada).sort()).toEqual(
      COLUMNAS_DESCARGA_RANKING_HISTORICO.map((c) => c.clave).sort(),
    );
  });

  it("proyecta el premio y el porcentaje como el STRING del servidor, sin símbolos", () => {
    // R31 money-safe: la pantalla pinta `₡5000.00` y `100.0%`; el símbolo es presentación y
    // en una hoja convertiría una celda numérica en texto. Un `Number` intermedio, además,
    // dejaría `"100.0"` en `"100"` y `"5000.00"` en `5000`.
    const proyectada = filaDescargaRankingHistorico(FILA_PODIO);

    expect(proyectada).toEqual({
      puesto: 1,
      posicion: 1,
      mensajero: "Ana Mensajera",
      porcentaje: "100.0",
      entregadas: 5,
      asignadas: 5,
      premio: "5000.00",
    });
  });

  it("`posicion`, `pct` y `premioMonto` nulos dejan la celda VACÍA, no un «—» ni un 0", () => {
    // El guion es presentación: en una hoja de cálculo se leería como un valor. Y un 0
    // afirmaría un porcentaje que nadie calculó — sin asignadas el porcentaje es INDEFINIDO,
    // que no es cero.
    const proyectada = filaDescargaRankingHistorico(FILA_SIN_PODIO);

    expect(proyectada.posicion).toBeNull();
    expect(proyectada.porcentaje).toBeNull();
    expect(proyectada.premio).toBeNull();
    expect(Object.values(proyectada)).not.toContain("—");
    // El puesto y los conteos SÍ salen: la fila está en la lista aunque no esté en el podio.
    expect(proyectada.puesto).toBe(7);
    expect(proyectada.asignadas).toBe(0);
  });
});

describe("nombre del archivo del ranking histórico (R35)", () => {
  it("el título lleva la fecha consultada, así que el archivo también", () => {
    const titulo = tituloRankingHistorico("2026-08-09");
    expect(titulo).toBe("Ranking del día 2026-08-09");

    const nombre = nombreArchivoDescarga(titulo, "xlsx", new Date(2026, 7, 10));
    expect(nombre).toBe("ranking-del-dia-2026-08-09-2026-08-10.xlsx");
  });

  it("dos fechas distintas producen dos archivos con nombres distintos", () => {
    // Es el punto de R35: sin la fecha dentro del título, la descarga del martes y la del
    // miércoles se llamarían igual y la segunda pisaría a la primera.
    const hoy = new Date(2026, 7, 10);
    const martes = nombreArchivoDescarga(tituloRankingHistorico("2026-08-04"), "xlsx", hoy);
    const miercoles = nombreArchivoDescarga(tituloRankingHistorico("2026-08-05"), "xlsx", hoy);

    expect(martes).not.toBe(miercoles);
    expect(martes).toContain("2026-08-04");
    expect(miercoles).toContain("2026-08-05");
  });
});
