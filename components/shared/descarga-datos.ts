/**
 * Ficha 470 (design §4.1, R5/R6/R7/R15/R16/R24) — la ÚNICA vía por la que una pantalla de Familia A
 * obtiene el conjunto de su descarga.
 *
 * Llama a `prepararDescargaAction(nombre, input)`, que ejecuta en el servidor la MISMA acción de
 * descarga de siempre (misma entrada, misma sesión, mismos permisos) y decide el transporte:
 *
 *  - `modo: "directo"` ⇒ el resultado viene en la respuesta y se devuelve tal cual (R6), sin `fetch`.
 *  - `modo: "almacen"` ⇒ el conjunto es grande y quedó como objeto temporal privado: se lee con la URL
 *    firmada, se descomprime y se deserializa al MISMO objeto que habría llegado directo (R7/R8).
 *
 * Devuelve exactamente el tipo de la acción registrada: todo lo de aguas abajo (proyección de filas,
 * kardex, hojas, columnas elegidas, `construirDescarga`) no cambia. Cualquier fallo del propio sobre
 * (nombre desconocido, almacén o firma caídos) o de la lectura del objeto temporal LANZA: todos los
 * consumidores terminan en un `catch` que avisa sin producir archivo (R15/R16).
 *
 * Módulo de cliente sin React. Del registro solo importa TIPOS: el navegador no arrastra código de
 * servidor.
 */
import { prepararDescargaAction } from "@/lib/actions/descargas";
import type { NombreDescarga, RegistroDescargas } from "@/lib/actions/_shared/registro-descargas";
import { deserializarDescarga } from "@/lib/utils/codec-descarga";

/** Lo que la acción registrada bajo `K` devuelve (ya resuelto). */
export type ResultadoDescarga<K extends NombreDescarga> = Awaited<ReturnType<RegistroDescargas[K]>>;

/** Entrada que la acción registrada bajo `K` recibe (la misma que hoy). */
export type EntradaDescarga<K extends NombreDescarga> = Parameters<RegistroDescargas[K]>[0];

/** Error del transporte de una descarga (sobre inválido o lectura del objeto temporal fallida). */
export class DescargaTransporteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DescargaTransporteError";
  }
}

/**
 * R7/R16 — lee el objeto temporal con la URL firmada. Sin credenciales (la URL ya autoriza) y sin
 * caché. El objeto se sube como `application/gzip` SIN `Content-Encoding`, así que el navegador no lo
 * descomprime solo: pasa por `DecompressionStream`. Una URL caducada (Supabase responde 400/404), un
 * fallo de red o un gzip/JSON corrupto LANZAN.
 */
export async function leerDesdeAlmacen<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!res.ok || res.body === null) {
    throw new DescargaTransporteError(`descarga temporal: HTTP ${res.status}`);
  }
  const texto = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return deserializarDescarga<T>(texto);
}

function esSobre(r: unknown): r is { modo: "directo"; resultado: unknown } | { modo: "almacen"; url: string } {
  return typeof r === "object" && r !== null && "modo" in r;
}

function describirError(r: unknown): string {
  if (typeof r === "object" && r !== null) {
    const status = "status" in r ? String((r as { status: unknown }).status) : "desconocido";
    const code = "code" in r ? ` ${String((r as { code: unknown }).code)}` : "";
    return `preparar descarga: ${status}${code}`;
  }
  return "preparar descarga: respuesta inesperada";
}

/**
 * Obtiene el conjunto de la descarga registrada bajo `nombre` con la `input` de siempre.
 *
 * @throws DescargaTransporteError si el sobre es un error (R12/R15) o la lectura del objeto temporal
 * falla (R16). Los errores PROPIOS de la acción (sin sesión, sin permiso, entrada inválida, límite)
 * no lanzan: vuelven dentro del resultado, como hoy (R11).
 */
export async function descargarDatos<K extends NombreDescarga>(
  nombre: K,
  input: EntradaDescarga<K>,
): Promise<ResultadoDescarga<K>> {
  const r: unknown = await prepararDescargaAction(nombre, input);
  if (!esSobre(r)) throw new DescargaTransporteError(describirError(r));
  if (r.modo === "directo") return r.resultado as ResultadoDescarga<K>;
  if (r.modo === "almacen" && typeof r.url === "string") {
    return leerDesdeAlmacen<ResultadoDescarga<K>>(r.url);
  }
  throw new DescargaTransporteError("preparar descarga: sobre desconocido");
}
