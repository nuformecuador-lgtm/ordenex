// Feature 255 (design.md §5.1) — MUDANZA, no refactor: `normalize`, `indexBy`, `lookup`,
// `resolveGeo` y `geoInputDesdeColumnasSeparadas` vivian como privados de
// `lib/services/BulkOrdenService.ts` (features 15/24/88/98/142). Se mueven aqui TAL CUAL —
// ni una cadena de mensaje, ni una rama, ni un orden de comprobacion cambian — para que la
// cotizacion por API key (feature 255) resuelva la cobertura con el MISMO codigo que la carga
// y no con una copia. Duplicar `resolveGeo` habria dado dos dueños a los tres mensajes de
// no-cobertura (`distrito no encontrado en el canton`, `distrito ambiguo en el canton`,
// `el distrito '<nombre>' no tiene zona asignada`) y habrian derivado a la primera errata
// corregida en un solo lado.
//
// La prueba de que fue una mudanza son las suites existentes de la carga (unit + integracion),
// que pasan SIN EDITAR NI UNA LINEA (R50).
//
// Logica pura: sin HTTP, sin Prisma, sin estado.
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type {
  CantonRow,
  DistritoRow,
  ProvinciaRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import { normalizeName } from "@/lib/utils/normalize";

// La resolucion geografica compara nombres del archivo contra los de la DB con el
// MISMO normalizador que indexa el arbol de zonas (lib/utils/normalize): minusculas,
// sin acentos, sin caracteres especiales y con espacios colapsados. Aplicarlo a
// AMBOS lados evita rechazar filas por erratas tipograficas (mayusculas, acentos,
// "San  Pedro" con doble espacio, puntuacion).
export function normalize(value: string): string {
  return normalizeName(value);
}

// Feature 255 (hallazgo de cierre) — MUDANZA: `distinct` vivia duplicado byte a byte como
// privado de `BulkOrdenService` y de `CotizacionOrdenService`. Se mueve aqui, junto a sus
// hermanos de T2, porque es la funcion con la que ambas vias reducen las columnas geograficas
// del lote antes de pedir los indices. Cuerpo TAL CUAL: solo se le añadio `export`.
export function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

// R19/R20: indice ambiguo-aware, clave normalizada -> filas candidatas.
// length 0 = no existe; length 1 = resuelto; length > 1 = ambiguo dentro del padre.
export function indexBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

type LookupResult<T> =
  | { status: "found"; row: T }
  | { status: "missing" }
  | { status: "ambiguous" };

function lookup<T>(index: Map<string, T[]>, key: string): LookupResult<T> {
  const bucket = index.get(key);
  if (!bucket || bucket.length === 0) return { status: "missing" };
  if (bucket.length > 1) return { status: "ambiguous" };
  return { status: "found", row: bucket[0] };
}

export interface ResolvedGeo {
  provinciaId: string;
  zonaId: string;
  cantonId: string;
  distritoId: string | null;
  // Feature 98/R2: flag de la zona resuelta del distrito, para elegir la columna del flete al
  // tarifar la carga por API. La via sesion lo ignora (R9).
  esCentral: boolean;
}

export type GeoResult =
  | { ok: true; geo: ResolvedGeo }
  | { ok: false; fieldErrors: Record<string, string[]> };

// R19/R20/R21: resuelve provincia -> canton (dentro de la provincia) -> distrito
// (dentro del canton) por nombre. El distrito es OBLIGATORIO y de el se deriva
// zonaId (modelo por-distrito, feature 24/R4/R11 decision b); una fila sin distrito,
// con distrito no resoluble, o con distrito sin zona -> error de fila.
export function resolveGeo(
  raw: { provincia: string; canton: string; distrito: string },
  provinciaIndex: Map<string, ProvinciaRow[]>,
  cantonIndex: Map<string, CantonRow[]>,
  distritoIndex: Map<string, DistritoRow[]>,
): GeoResult {
  const provinciaResult = lookup(provinciaIndex, normalize(raw.provincia));
  if (provinciaResult.status !== "found") {
    return {
      ok: false,
      fieldErrors: {
        provincia: [
          provinciaResult.status === "ambiguous"
            ? "provincia ambigua"
            : "provincia no encontrada",
        ],
      },
    };
  }
  const provincia = provinciaResult.row;

  const cantonResult = lookup(cantonIndex, `${provincia.id}::${normalize(raw.canton)}`);
  if (cantonResult.status !== "found") {
    return {
      ok: false,
      fieldErrors: {
        canton: [
          cantonResult.status === "ambiguous"
            ? "canton ambiguo en la provincia"
            : "canton no encontrado en la provincia",
        ],
      },
    };
  }
  const canton = cantonResult.row;

  // Feature 24/R4/R11: la zona de la orden se deriva del DISTRITO, que pasa a ser
  // obligatorio. Sin distrito no hay forma de resolver orden.zona_id (NOT NULL).
  if (raw.distrito.trim() === "") {
    return {
      ok: false,
      fieldErrors: {
        distrito: ["distrito requerido: la zona de la orden se deriva del distrito"],
      },
    };
  }

  const distritoResult = lookup(distritoIndex, `${canton.id}::${normalize(raw.distrito)}`);
  if (distritoResult.status !== "found") {
    return {
      ok: false,
      fieldErrors: {
        distrito: [
          distritoResult.status === "ambiguous"
            ? "distrito ambiguo en el canton"
            : "distrito no encontrado en el canton",
        ],
      },
    };
  }
  const distrito = distritoResult.row;
  // Feature 24/R4/R11 (reconciliacion feature 54): la zona de la orden se deriva
  // del DISTRITO (orden.zona_id es NOT NULL). Un distrito sin zona -> error de fila.
  if (distrito.zonaId === null) {
    return {
      ok: false,
      fieldErrors: { distrito: [`el distrito '${raw.distrito.trim()}' no tiene zona asignada`] },
    };
  }

  return {
    ok: true,
    geo: {
      provinciaId: provincia.id,
      zonaId: distrito.zonaId,
      cantonId: canton.id,
      distritoId: distrito.id,
      esCentral: distrito.esCentral, // feature 98/R2: flag de la zona del distrito.
    },
  };
}

// Feature 142 (design.md §4) — extractor de geografia INYECTADO POR VIA.
//
// `resolveFila` lo comparten `cargarMasiva` (via sesion, plantilla v3 con
// `provincia` + `canton_distrito`, feature 276) y `cargarViaApi` (via API key, feature
// 88: contrato PUBLICO con `provincia`/`canton`/`distrito`/`direccion` como campos
// separados). Cada via aporta su propio extractor; `resolveGeo` sigue recibiendo
// los mismos 3 nombres y no cambia (R33-R38).
export type GeoInput =
  | { ok: true; provincia: string; canton: string; distrito: string; direccion: string }
  | { ok: false; fieldErrors: Record<string, string[]> };

export type GeoInputExtractor = (raw: RawRow) => GeoInput;

// R38: via API key. Contrato de la feature 88 intacto: los 4 campos separados,
// con el mismo `trim()` que antes hacia `filaCargaSchema`.
export function geoInputDesdeColumnasSeparadas(raw: RawRow): GeoInput {
  return {
    ok: true,
    provincia: (raw.provincia ?? "").trim(),
    canton: (raw.canton ?? "").trim(),
    distrito: (raw.distrito ?? "").trim(),
    direccion: (raw.direccion ?? "").trim(),
  };
}
