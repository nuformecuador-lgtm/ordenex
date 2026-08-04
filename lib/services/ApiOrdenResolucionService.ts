// Feature 177 (design §4.2, T10) — Resolucion del identificador libre `{id}` del canal
// integrador por API key: normaliza, consulta UNA vez al repositorio (que trae hasta DOS filas
// SIN desempatar) y aplica la PRECEDENCIA FIJA decidida por el humano en la puerta F1.4:
// `num_guia` gana, `num_remision` es el fallback. Logica de NEGOCIO pura: sin HTTP, sin Prisma.
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  IApiOrdenResolucionService,
  ResolverOrdenResult,
} from "@/lib/interfaces/services/IApiOrdenResolucionService";

/**
 * Subconjunto del repositorio que este service consume (DI por interfaz, sin obligar a los
 * tests a construir toda la superficie de `IOrdenRepository`).
 */
type ResolucionRepo = Pick<IOrdenRepository, "findByGuiaORemisionForOwner">;

/**
 * Cota superior de `orden.num_guia`: la columna es `Int` de Postgres (int4,
 * `db/schema.prisma:480`). Un identificador mayor NO puede ser una guia existente, y enviarlo
 * a la query lo unico que consigue es un error del driver por desbordamiento. Se trata como
 * "no es candidato a guia" y la resolucion cae solo en `num_remision` (R8).
 */
const MAX_INT4 = 2_147_483_647;

/**
 * R8/R9 — candidato a `num_guia`. Se exige la representacion DECIMAL CANONICA de un entero
 * positivo (`^[1-9][0-9]*$`); cualquier otra cosa devuelve `null` y la resolucion cae solo en
 * `num_remision`. Casos que devuelven `null` y por que:
 *   - `"007"`: NO es canonica. `num_remision` es texto y se compara por IGUALDAD EXACTA (R10);
 *     `"007"` es un identificador de remision plausible, mientras que interpretarlo como la
 *     guia 7 seria una normalizacion silenciosa que R10 prohibe. Se resuelve solo por remision.
 *   - `"1.5"`, `"1e3"`, `"0x10"`, `"+7"`, `" 12 "` sin trim, `"12abc"`, `""`: no son enteros.
 *   - `"-3"`, `"0"`: no son POSITIVOS.
 *   - `"9999999999"` (> int4): entero positivo pero fuera del rango de la columna (ver MAX_INT4).
 * Nota: `Number.parseInt`/`Number()` NO sirven aqui — aceptarian `"1.5"`, `"1e3"` o `"12abc"`.
 */
function candidatoNumGuia(identificador: string): number | null {
  if (!/^[1-9][0-9]*$/.test(identificador)) return null;
  const n = Number(identificador);
  if (n > MAX_INT4) return null;
  return n;
}

export class ApiOrdenResolucionService implements IApiOrdenResolucionService {
  constructor(private readonly repo: ResolucionRepo) {}

  async resolver(actor: Actor, identificador: string): Promise<ResolverOrdenResult> {
    // Normalizacion: SOLO trim de espacios de borde. Nada de mayusculas/acentos/comodines: la
    // comparacion contra `num_remision` es exacta (R10).
    const normalizado = identificador.trim();
    const numGuia = candidatoNumGuia(normalizado);

    // R4: el owner sale SIEMPRE del actor autenticado, jamas de un parametro de la peticion.
    const filas = await this.repo.findByGuiaORemisionForOwner(
      { numGuia, numRemision: normalizado },
      actor.usuarioId,
    );

    // R11/R12: sin coincidencias propias y vivas -> 404 uniforme en el borde.
    if (filas.length === 0) return { status: "not_found" };

    // R14 (precedencia ABSOLUTA): si alguna fila casa por guia, esa gana, aunque OTRA fila
    // distinta case por remision con el mismo `{id}`. La segunda coincidencia se descarta en
    // silencio (riesgo declarado (a) en requirements.md).
    if (numGuia !== null) {
      const porGuia = filas.find((f) => f.numGuia === numGuia);
      if (porGuia) {
        return { status: "ok", orden: { id: porGuia.id, numGuia: porGuia.numGuia }, via: "num_guia" };
      }
    }

    // R15 (fallback): ninguna guia coincide -> se resuelve por remision.
    const porRemision = filas.find((f) => f.numRemision === normalizado);
    if (porRemision) {
      return {
        status: "ok",
        orden: { id: porRemision.id, numGuia: porRemision.numGuia },
        via: "num_remision",
      };
    }

    // Defensivo: el repo solo puede devolver filas que casen por una de las dos columnas, asi
    // que este camino es inalcanzable con un repo correcto. R15 exige que la salida sea
    // `not_found` y NUNCA un conflicto.
    return { status: "not_found" };
  }
}
