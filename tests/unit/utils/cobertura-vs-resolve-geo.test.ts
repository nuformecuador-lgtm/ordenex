import { describe, it, expect } from "vitest";

import type {
  CantonRow,
  DistritoRow,
  ProvinciaRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { DistritoCoberturaRow } from "@/lib/interfaces/repositories/ICoberturaRepository";
import { zonaUnicaDeDistrito } from "@/lib/repositories/_shared/zona-colapso";
import {
  MSG_CANTON_RETIRADO,
  MSG_PROVINCIA_RETIRADA,
  indexBy,
  msgDistritoRetirado,
  normalize,
  resolveGeo,
} from "@/lib/services/geo-resolucion";
import type { MotivoSinCobertura } from "@/lib/types/cobertura";
import { clasificarCobertura } from "@/lib/utils/cobertura-distrito";

import { fila } from "./_cobertura-fixtures";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 465 / R15 — «COBERTURA = Sí» SI Y SOLO SI LA CARGA DE ORDENES ACEPTA LA DIRECCION.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// La vara de medir es `resolveGeo`, la funcion REAL que usan la carga masiva y la cotizacion por
// API. Se le dan los indices tal como los construye `OrdenRepository` (`disponible` compuesto con
// la cadena, `zonaId` colapsado por `zonaUnicaDeDistrito`) y se exige, para las 24 combinaciones
// de (provincia, canton, distrito) activo/retirado × (0, 1, 2) zonas:
//   - `cobertura === resolveGeo(...).ok`, y
//   - el motivo casa con el campo y el mensaje con que `resolveGeo` rechaza.
// Si un dia `resolveGeo` gana una regla nueva o cambia su precedencia, esto se pone rojo en vez
// de que el Excel mienta.

interface Caso {
  row: DistritoCoberturaRow;
  ids: { provincia: string; canton: string; distrito: string };
}

function combinaciones(): Caso[] {
  const casos: Caso[] = [];
  let i = 0;
  for (const provinciaActiva of [true, false]) {
    for (const cantonActivo of [true, false]) {
      for (const distritoActivo of [true, false]) {
        for (const nZonas of [0, 1, 2]) {
          i += 1;
          const zonas = Array.from({ length: nZonas }, (_, k) => ({
            id: `z-${i}-${k}`,
            nombre: `Zona ${i}-${k}`,
            esCentral: k === 0,
          }));
          casos.push({
            // Una provincia por caso: los nombres no colisionan en los indices.
            row: fila({
              provincia: `Provincia ${i}`,
              canton: "Cantón Único",
              distrito: "Distrito Ñandú",
              provinciaActiva,
              cantonActivo,
              distritoActivo,
              zonas,
            }),
            ids: { provincia: `p-${i}`, canton: `c-${i}`, distrito: `d-${i}` },
          });
        }
      }
    }
  }
  return casos;
}

const CASOS = combinaciones();

// Los indices de `resolveGeo`, con las MISMAS claves que la carga (`BulkOrdenService`).
const provincias: ProvinciaRow[] = CASOS.map(({ row, ids }) => ({
  id: ids.provincia,
  nombre: row.provincia.nombre,
  disponible: row.provincia.activo,
}));
const cantones: CantonRow[] = CASOS.map(({ row, ids }) => ({
  id: ids.canton,
  nombre: row.canton.nombre,
  provinciaId: ids.provincia,
  disponible: row.provincia.activo && row.canton.activo,
}));
const distritos: DistritoRow[] = CASOS.map(({ row, ids }) => {
  const zona = zonaUnicaDeDistrito(row.zonas);
  return {
    id: ids.distrito,
    nombre: row.distrito.nombre,
    cantonId: ids.canton,
    disponible: row.disponible,
    zonaId: zona?.id ?? null,
    esCentral: zona?.esCentral ?? false,
    esZonaEspecial: row.distrito.zonaEspecial === true,
  };
});
const provinciaIndex = indexBy(provincias, (p) => normalize(p.nombre));
const cantonIndex = indexBy(cantones, (c) => `${c.provinciaId}::${normalize(c.nombre)}`);
const distritoIndex = indexBy(distritos, (d) => `${d.cantonId}::${normalize(d.nombre)}`);

/** El rechazo que corresponde a cada motivo, en el idioma de `resolveGeo`. */
function rechazoEsperado(motivo: MotivoSinCobertura, distrito: string): Record<string, string[]> {
  switch (motivo) {
    case "provincia_retirada":
      return { provincia: [MSG_PROVINCIA_RETIRADA] };
    case "canton_retirado":
      return { canton: [MSG_CANTON_RETIRADO] };
    case "distrito_retirado":
      return { distrito: [msgDistritoRetirado(distrito)] };
    case "sin_zona":
    case "varias_zonas":
      // La carga colapsa 0 y >1 zonas al mismo `null`: un solo mensaje para los dos motivos.
      return { distrito: [`el distrito '${distrito}' no tiene zona asignada`] };
  }
}

describe("465/R15 — la cobertura del Excel es la de la carga de ordenes", () => {
  it("cubre las 24 combinaciones (anti-vacuidad)", () => {
    expect(CASOS).toHaveLength(24);
    // Y no son todas del mismo lado: hay aceptadas y rechazadas de los cinco motivos.
    const dtos = CASOS.map(({ row }) => clasificarCobertura(row, new Set()));
    expect(dtos.filter((d) => d.cobertura)).toHaveLength(1);
    expect(new Set(dtos.map((d) => d.motivo))).toEqual(
      new Set([null, "provincia_retirada", "canton_retirado", "distrito_retirado", "sin_zona", "varias_zonas"]),
    );
  });

  it.each(CASOS.map((c, i) => [i + 1, c] as const))(
    "caso %i: cobertura === resolveGeo(...).ok y el motivo casa con su rechazo",
    (_n, { row }) => {
      const dto = clasificarCobertura(row, new Set());
      const geo = resolveGeo(
        { provincia: row.provincia.nombre, canton: row.canton.nombre, distrito: row.distrito.nombre },
        provinciaIndex,
        cantonIndex,
        distritoIndex,
      );

      expect(dto.cobertura).toBe(geo.ok);
      if (geo.ok) {
        expect(dto.motivo).toBeNull();
      } else {
        expect(dto.motivo).not.toBeNull();
        expect(geo.fieldErrors).toEqual(rechazoEsperado(dto.motivo!, row.distrito.nombre));
      }
    },
  );
});
