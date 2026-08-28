// Feature 321 (design §2.2 y §2.3) — DTOs y BORDE TIPADO del historico de conversaciones.
//
// Es el unico punto donde se declara la forma de las DOS entradas del historico (listado de
// hilos y pagina de mensajes). El borde valida con zod ANTES de que nadie toque la base (R38):
// un cursor mal formado, una fecha que no es `YYYY-MM-DD`, una lista vacia o un tamaño de
// pagina fuera de rango se responden como `validation_error` SIN ejecutar consulta alguna.
//
// TRES decisiones que este archivo fija y que no son de estilo:
//
//   1. `HiloHistoricoDTO` NO declara campo de mensajes (R41). No es disciplina: es
//      ESTRUCTURAL. El listado no puede traer mensajes ni por descuido porque el tipo de
//      salida no tiene donde ponerlos. Los mensajes se piden aparte, al abrir el hilo.
//   2. La pagina de mensajes REUTILIZA `ChatMensajeVista` (`lib/types/chat-whatsapp.ts`), el
//      mismo DTO que consume el chat del mensajero. Un DTO paralelo significaria dos
//      renderizadores y que el segundo se quede atras en silencio (design §5.2, A3).
//   3. Los limites de busqueda salen de `BUSQUEDA_MIN_CHARS` / `BUSQUEDA_MAX_CHARS`
//      (`lib/types/orden.ts`), las MISMAS constantes que valida `/ordenes` y que consume el
//      control de texto de la barra de filtros: un solo origen del 3 (R37).
import { z } from "zod";

import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import { BUSQUEDA_MAX_CHARS, BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { esFechaCalendarioValida } from "@/lib/utils/fecha-cr";

// ---------------------------------------------------------------------------
// Limites de pagina (P8: «solo X conversaciones a la vez»)
// ---------------------------------------------------------------------------

/** Hilos por pagina del listado si el llamante no pide otra cosa (design §2.2). */
export const HILOS_LIMITE_DEFECTO = 25;
/** Techo del listado: mas alla, el `ORDER BY` sobre el agregado deja de estar acotado (§7). */
export const HILOS_LIMITE_MAXIMO = 50;
/** Mensajes por pagina del hilo si el llamante no pide otra cosa (design §2.3, R18). */
export const MENSAJES_LIMITE_DEFECTO = 30;
/** Techo de la pagina del hilo. */
export const MENSAJES_LIMITE_MAXIMO = 100;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * Una fila del listado: el hilo es el PAR `(orden, mensajero)` (R42), no una fila de
 * `chat_conversacion`. Por eso el identificador que viaja al cliente son los dos ids y NO una
 * lista de `conversacion_id`: los ids de fila son un detalle del almacenamiento y el servidor
 * los vuelve a resolver al abrir el hilo.
 *
 * R41 — NO declara campo de mensajes, y no debe declararlo nunca. Si alguien lo añade, el
 * listado empieza a poder traer el hilo entero y la carga perezosa deja de ser una propiedad
 * del TIPO para pasar a ser una costumbre. El test
 * `tests/unit/types/historico-conversaciones-schema.test.ts` lo fija.
 */
export interface HiloHistoricoDTO {
  ordenId: string;
  mensajeroId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  mensajeroNombre: string;
  /**
   * R43 — ultimos 4 digitos del numero con actividad MAS RECIENTE del grupo. Viaja
   * enmascarado a proposito: esta pantalla no llama a nadie, asi que el numero completo no
   * aporta y es PII del cliente (design §2.2, riesgo 6).
   */
  telefonoVigenteMasked: string;
  /** R43 — `> 1` significa que el hilo fusiona varios numeros del mismo cliente. */
  telefonosCount: number;
  /** ISO 8601. `null` = el hilo existe pero todavia no tiene ni un mensaje. */
  ultimaActividadAt: string | null;
  totalMensajes: number;
}

/**
 * Cursor del listado (R13/R15). Clave TOTAL: sin las dos claves de desempate,
 * `(ordenId, mensajeroId)`, dos hilos con el MISMO instante de ultima actividad se pisarian
 * entre paginas. No hay `OFFSET` en ningun sitio (A4).
 *
 * `ultimaActividadAt` es nullable porque el valor que ordena tambien lo es (un hilo sin
 * mensajes): el `null` es una POSICION valida del recorrido —la ultima—, no «sin cursor».
 * «Sin cursor» se expresa omitiendo la clave o mandando `null` en `cursor`.
 */
export interface CursorHilo {
  ultimaActividadAt: string | null;
  ordenId: string;
  mensajeroId: string;
}

/** Cursor de la pagina del hilo (R19/R20): `(ocurrido_at, id)`, tambien clave total. */
export interface CursorMensaje {
  ocurridoAt: string;
  id: string;
}

/** Filtros del listado (R33-R36). Toda clave es opcional; ninguna admite lista vacia. */
export interface FiltroHilosHistorico {
  /** R33 — mensajeros seleccionados. NUNCA `[]`: la lista vacia es `validation_error`. */
  mensajero_id?: string[];
  /** R34 — cota inferior, fecha calendario CR `YYYY-MM-DD`. */
  fecha_desde?: string;
  /** R34 — cota superior INCLUSIVA, fecha calendario CR `YYYY-MM-DD`. */
  fecha_hasta?: string;
  /** R35 — `num_guia` o `num_remision`, IGUALDAD exacta. Nunca coincidencia parcial. */
  orden?: string;
  /** R36 — busqueda libre por destinatario, guia, remision o nombre del mensajero. */
  q?: string;
}

export interface ListarHilosHistoricoInput {
  filtro?: FiltroHilosHistorico;
  cursor?: CursorHilo | null;
  limite?: number;
}

export type ListarHilosHistoricoResult =
  | { status: "ok"; items: HiloHistoricoDTO[]; siguiente: CursorHilo | null }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; motivo: string };

/**
 * Entrada de la pagina de mensajes. NO acepta filtros de fecha, y eso es R17: el hilo abierto
 * se lee COMPLETO aunque el listado estuviera filtrado por un solo dia. El `.strict()` de
 * abajo convierte esa regla en un rechazo del borde, no en una omision silenciosa.
 */
export interface ListarMensajesHistoricoInput {
  ordenId: string;
  mensajeroId: string;
  /** `null`/ausente = pagina MAS RECIENTE (R21). Se pagina hacia ATRAS. */
  cursor?: CursorMensaje | null;
  limite?: number;
}

export type ListarMensajesHistoricoResult =
  | {
      status: "ok";
      /** Orden cronologico ASCENDENTE, entrantes y salientes entrelazados (R40). */
      mensajes: ChatMensajeVista[];
      /** `null` = no hay mas hacia atras. */
      anterior: CursorMensaje | null;
      cabecera: HiloHistoricoDTO;
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "validation_error"; motivo: string };

// ---------------------------------------------------------------------------
// Esquemas zod del borde (R38)
// ---------------------------------------------------------------------------

/**
 * Fecha CALENDARIO `YYYY-MM-DD` de verdad. El regex solo mide la FORMA y `2026-02-31` la
 * cumple: `esFechaCalendarioValida` hace el round-trip que caza el dia que RUEDA al mes
 * siguiente (`lib/utils/fecha-cr.ts`). Es un `z.string()`, no un `refine` del objeto, para que
 * los esquemas de abajo sigan siendo `ZodObject` y conserven su `.strict()`.
 */
const fechaCalendario = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD")
  .refine(esFechaCalendarioValida, "Fecha inexistente en el calendario");

/** Lista NO vacia de ids no vacios: la misma regla del resto de filtros de catalogo (R32). */
const idList = z.array(z.string().min(1)).nonempty();

const idRequerido = z.string().min(1);

/**
 * Instante ISO 8601 con zona. Los cursores los EMITE el servidor, asi que aqui no se esta
 * siendo amable con nadie: se esta comprobando que el cursor que vuelve es uno de los que
 * salieron y no una cadena cualquiera colada por el cliente.
 */
const instanteIso = z.iso.datetime({ offset: true });

export const filtroHilosHistoricoSchema = z
  .object({
    mensajero_id: idList.optional(),
    fecha_desde: fechaCalendario.optional(),
    fecha_hasta: fechaCalendario.optional(),
    // R35: valor libre, la IGUALDAD la impone el repositorio. `min(1)` porque una cadena
    // vacia significaria «sin filtro», y eso se expresa OMITIENDO la clave.
    orden: z.string().trim().min(1).max(BUSQUEDA_MAX_CHARS).optional(),
    // R36/R37: `.trim()` ANTES de `.min()` a proposito — `"  a  "` es 1 caracter, no 5.
    q: z.string().trim().min(BUSQUEDA_MIN_CHARS).max(BUSQUEDA_MAX_CHARS).optional(),
  })
  .strict();

export const cursorHiloSchema = z
  .object({
    // Requerida y NULLABLE: la clave tiene que VENIR, su valor puede ser `null`. Un cursor al
    // que le falta esta clave esta mal formado y el borde lo rechaza (R38).
    ultimaActividadAt: instanteIso.nullable(),
    ordenId: idRequerido,
    mensajeroId: idRequerido,
  })
  .strict();

export const listarHilosHistoricoSchema = z
  .object({
    filtro: filtroHilosHistoricoSchema.optional(),
    cursor: cursorHiloSchema.nullable().optional(),
    limite: z.number().int().min(1).max(HILOS_LIMITE_MAXIMO).optional(),
  })
  .strict()
  // R34/R39: rango no invertido. La comparacion lexicografica de `YYYY-MM-DD` equivale a la
  // cronologica (ancho fijo, mayor a menor), la misma regla que `conRefinesDeCreacion`.
  .refine(
    (entrada) => {
      const desde = entrada.filtro?.fecha_desde;
      const hasta = entrada.filtro?.fecha_hasta;
      return !(desde && hasta) || desde <= hasta;
    },
    { path: ["filtro", "fecha_hasta"], message: "El rango de fechas esta invertido" },
  );

export const cursorMensajeSchema = z
  .object({
    ocurridoAt: instanteIso,
    id: idRequerido,
  })
  .strict();

export const listarMensajesHistoricoSchema = z
  .object({
    ordenId: idRequerido,
    mensajeroId: idRequerido,
    cursor: cursorMensajeSchema.nullable().optional(),
    limite: z.number().int().min(1).max(MENSAJES_LIMITE_MAXIMO).optional(),
  })
  // R17: `.strict()` es lo que hace que un `fecha_desde` en la entrada del HILO sea un
  // `validation_error` y no una clave ignorada. El hilo abierto no se recorta por fecha.
  .strict();
