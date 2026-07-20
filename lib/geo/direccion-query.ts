// Feature 91 (design §4, R15/R16/R17) — construccion de la consulta que se envia al
// proveedor de geocodificacion y de la HUELLA que indexa la cache.
//
// DOS NORMALIZACIONES DISTINTAS, DELIBERADAMENTE:
//
//   |                            | consulta al proveedor | huella de cache |
//   | trim + colapso de espacios | si                    | si              |
//   | minusculas                 | NO                    | si              |
//   | quitar diacriticos         | NO                    | si              |
//
// La CONSULTA conserva acentos y capitalizacion: Google los usa como senal y degradarlos
// empeora el resultado. La HUELLA los normaliza para que "San Jose" y "SAN JOSÉ"
// compartan entrada de cache (R17).
import { createHash } from "node:crypto";
import { collapseSpaces, stripDiacritics } from "@/lib/geo/normalize";

/** Pais fijo del negocio: todas las ordenes son de Costa Rica. */
const PAIS = "Costa Rica";

// Todos los componentes admiten `undefined` ademas de `null`: esta funcion se alimenta de
// filas de DB proyectadas en varios writers y un campo AUSENTE debe comportarse igual que
// uno vacio (omitirse), nunca reventar en mitad de la transaccion del writer.
export interface ComponentesDireccion {
  direccion: string | null | undefined;
  distritoNombre: string | null | undefined;
  cantonNombre: string | null | undefined;
  provinciaNombre: string | null | undefined;
}

/** trim + colapso de espacios tolerando ausencia (null/undefined -> ""). */
function normalizar(raw: string | null | undefined): string {
  return raw === null || raw === undefined ? "" : collapseSpaces(raw);
}

/**
 * R15/R16: consulta legible para el proveedor. Une con ", " los componentes NO vacios
 * (omitiendo los ausentes, sin dejar separadores vacios) y anade el pais.
 *
 * Devuelve `null` cuando la direccion libre esta vacia tras normalizar (gate F1.4-Q5):
 * geocodificar solo con catalogo devolveria el centroide del canton, un APPROXIMATE
 * inutil que cuesta dinero y ensucia el dato con coordenadas que PARECEN validas.
 */
export function construirQueryDireccion(c: ComponentesDireccion): string | null {
  const direccion = normalizar(c.direccion);
  if (direccion === "") return null;

  const partes = [
    direccion,
    normalizar(c.distritoNombre),
    normalizar(c.cantonNombre),
    normalizar(c.provinciaNombre),
    PAIS,
  ];
  return partes.filter((p) => p !== "").join(", ");
}

/**
 * R17: huella determinista de una consulta, insensible a mayusculas, acentos y espacios
 * redundantes. SHA-256 en hex.
 *
 * Es una funcion HERMANA de `hashApiKey`, no una reutilizacion (gate F1.4-Q6): aquella
 * documenta su justificacion para SECRETOS DE ALTA ENTROPIA ("no hay tabla precomputable
 * para 2^256 valores aleatorios"), lo que NO aplica a una direccion postal, que es
 * adivinable. Mantenerlas separadas permite ademas cambiar `hashApiKey` (p. ej. anadir
 * sal) sin invalidar toda la cache de geocodificacion.
 */
export function hashDireccion(query: string): string {
  const normalizada = stripDiacritics(collapseSpaces(query)).toLowerCase();
  return createHash("sha256").update(normalizada, "utf8").digest("hex");
}
