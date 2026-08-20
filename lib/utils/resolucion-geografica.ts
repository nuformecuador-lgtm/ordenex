// Feature 248 (D12/R35) — extraído de BulkOrdenService: resolución geográfica
// COMPARTIDA entre el camino que CREA órdenes (carga masiva por sesión y carga por
// API key) y el cotizador (superficie pública + canal por API key).
//
// Es un util PURO (`docs/architecture.md`: «utils/ — helpers puros, sin side
// effects»): no importa Prisma, no importa ningún repositorio y no consulta la base.
// Recibe los índices ya cargados y devuelve un resultado. Las queries siguen en la
// capa de repositorio (`findAllProvincias` / `findCantonesByProvinciaIds` /
// `findDistritosByCantonIds`).
//
// Los mensajes de `fieldErrors` se conservan CARÁCTER A CARÁCTER respecto de la
// versión privada que vivía en `BulkOrdenService`: los tests de carga masiva y de
// carga por API los afirman literalmente y no deben tocarse (R36).
import { normalizeName } from "@/lib/utils/normalize";

// Tipos ESTRUCTURALES mínimos (no se importa `ProvinciaRow`/`CantonRow`/`DistritoRow`
// de `@/lib/interfaces/repositories/IOrdenRepository`): un util puro no debe depender
// de la interfaz de un repositorio. `resolveGeo` es genérico sobre estos contratos, de
// modo que las filas del repositorio de órdenes —y las del catálogo delgado del
// cotizador— son asignables sin cambio alguno.
export interface ProvinciaLike {
  id: string;
  nombre: string;
}

export interface CantonLike {
  id: string;
  nombre: string;
  provinciaId: string;
}

export interface DistritoLike {
  id: string;
  nombre: string;
  cantonId: string;
  zonaId: string | null;
  esCentral: boolean;
}

// La resolucion geografica compara nombres del archivo contra los de la DB con el
// MISMO normalizador que indexa el arbol de zonas (lib/utils/normalize): minusculas,
// sin acentos, sin caracteres especiales y con espacios colapsados. Aplicarlo a
// AMBOS lados evita rechazar filas por erratas tipograficas (mayusculas, acentos,
// "San  Pedro" con doble espacio, puntuacion).
export function normalize(value: string): string {
  return normalizeName(value);
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

export type LookupResult<T> =
  | { status: "found"; row: T }
  | { status: "missing" }
  | { status: "ambiguous" };

export function lookup<T>(index: Map<string, T[]>, key: string): LookupResult<T> {
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
export function resolveGeo<
  P extends ProvinciaLike,
  C extends CantonLike,
  D extends DistritoLike,
>(
  raw: { provincia: string; canton: string; distrito: string },
  provinciaIndex: Map<string, P[]>,
  cantonIndex: Map<string, C[]>,
  distritoIndex: Map<string, D[]>,
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

// Feature 248 (D2/D12/R35) — LA regla del distrito multi-zona, y el unico sitio donde vive.
//
// La zona del distrito sale de la N:M `zona_distrito` (feature 24): un distrito con
// EXACTAMENTE una zona resuelve `orden.zona_id`; con 0 zonas no tiene zona asignada
// (error de fila en la carga, "sin cobertura" en el cotizador); con >1 es ambiguo y NO
// derivable (mismo trato seguro: no se inventa una zona). El caso normal de negocio es
// 1 zona por distrito.
//
// Una definicion, dos lecturas: la carga solo mira `unica` (cualquier otro estado ->
// `zonaId: null` / `esCentral: false`, exactamente el comportamiento historico); el
// cotizador ramifica por los tres estados para distinguir "sin cobertura" de "no
// determinado".
export type ZonaDeDistrito =
  | { estado: "unica"; zonaId: string; zonaNombre: string; esCentral: boolean }
  | { estado: "ninguna" }
  | { estado: "ambigua"; cuantas: number };

export function zonaDeDistrito(
  zonas: readonly { zonaId: string; nombre: string; esCentral: boolean }[],
): ZonaDeDistrito {
  if (zonas.length === 0) return { estado: "ninguna" };
  if (zonas.length > 1) return { estado: "ambigua", cuantas: zonas.length };
  const unica = zonas[0];
  return {
    estado: "unica",
    zonaId: unica.zonaId,
    zonaNombre: unica.nombre,
    esCentral: unica.esCentral,
  };
}
