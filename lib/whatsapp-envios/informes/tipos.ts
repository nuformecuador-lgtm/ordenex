// Ficha 474 (design §2, R46) — EL CONTRATO DE UN INFORME.
//
// Un informe es un generador registrado en el catalogo (`catalogo.ts`). Recibe sus parametros y
// produce los valores de sus variables y, si lo declara, un PDF; o responde «vacio». Las fichas
// 475 (transito) y 476 (picking) implementan este contrato; aqui nacen dos: «Prueba de envio» y
// «Aviso de la app».
//
// Reglas que el MOTOR verifica (no la buena fe del informe): todas las variables de la plantilla
// con valor no vacio tras sanear (R32); PDF presente si la plantilla lo lleva (R33); parametros
// re-validados al ejecutar (R34).
import type { z } from "zod";
import type { RolValue } from "@prisma/client";
import type { NotificacionEvento } from "@/lib/types/notificacion";

export interface VariableInforme {
  /** `[a-z0-9_]+`, unica en el informe y distinta de las comunes (R46/R53). */
  readonly clave: string;
  readonly nombre: string;
  readonly descripcion: string;
  /** Lo que se usa en la vista previa y viaja a Meta como ejemplo del parametro (R4/R5). */
  readonly ejemplo: string;
}

/** Lo que la pantalla sabe pintar como formulario de parametros. */
export type DescriptorParametro =
  | { campo: string; etiqueta: string; tipo: "entero" | "decimal"; min?: number; max?: number; ayuda?: string }
  | { campo: string; etiqueta: string; tipo: "booleano"; ayuda?: string }
  | { campo: string; etiqueta: string; tipo: "texto"; ayuda?: string }
  | {
      campo: string;
      etiqueta: string;
      tipo: "seleccion" | "seleccion_multiple";
      opciones:
        | { origen: "fija"; valores: { valor: string; etiqueta: string }[] }
        | { origen: "catalogo"; catalogo: "zonas" | "estados_orden" | "tiendas" };
      ayuda?: string;
    }
  | { campo: string; etiqueta: string; tipo: "tabla"; columnas: DescriptorParametro[]; ayuda?: string };

export type ResultadoInforme =
  | { tipo: "vacio"; motivo: string } // R31
  | {
      tipo: "contenido";
      /** Una entrada por variable declarada. */
      valores: Record<string, string>;
      /** Obligatorio si la plantilla lleva documento (R33). */
      documento?: { bytes: Uint8Array; nombreArchivo: string };
    };

/**
 * Design §2.3 — foto del aviso que disparo un envio por evento. SIN `anexo` y sin ningun dato de
 * persona (R51): el campo no existe, asi que no se puede pasar ni por descuido.
 */
export interface DatosAviso {
  /** `notificacion.descripcion` de la fila que disparo: el titulo de la tarjeta de la campana. */
  texto: string;
  /** Rol de esa fila (decide el atajo del enlace). */
  rolFila: RolValue;
  /** ISO del instante del aviso. */
  creadoAt: string;
}

export interface ContextoInforme<P> {
  parametros: P;
  ahora: Date;
  /** La plantilla lleva cabecera documento. */
  conDocumento: boolean;
  /** Solo origen `evento`. */
  evento?: { clave: NotificacionEvento; referencia: string; datos: DatosAviso };
  /** Solo «Probar ahora» de un envio por evento (R52). */
  eventoDePrueba?: NotificacionEvento;
}

export interface InformeWhatsapp<P> {
  /** `[a-z0-9_]+`. */
  readonly clave: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly parametros: z.ZodType<P>;
  /** R13: se precargan al crear un envio. */
  readonly parametrosPorDefecto: P;
  readonly descriptores: readonly DescriptorParametro[];
  readonly variables: readonly VariableInforme[];
  /** R6: solo un informe que genera documento admite plantillas con documento. */
  readonly generaDocumento: boolean;
  /**
   * Enmienda del leader a R16: ¿puede llegar a un `adminTienda`? Por defecto NO. Un informe con
   * datos de varias tiendas (transito) no puede llegar a una tienda.
   */
  readonly aptoParaAdminTienda: boolean;
  /** Eventos DISPONIBLES (lib/whatsapp-envios/eventos.ts) que ofrece (R14). */
  readonly eventos: readonly NotificacionEvento[];
  generar(ctx: ContextoInforme<P>): Promise<ResultadoInforme>;
}
