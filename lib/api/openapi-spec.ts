import { MSG_CARGA_SIN_TARIFA, MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import { EVENTOS_PUBLICOS } from "@/lib/types/webhook-eventos";
import { METRICAS_API_KEY, METRICAS_TODAS } from "@/lib/analytics/publicacion-api-key";
import { TOPE_FILAS_HABILITAR } from "@/lib/config/habilitacion-api";

// Feature 106 — Fuente de verdad del contrato OpenAPI 3.1 del canal integrador por API key.
// Este objeto es lo que sirve `GET /api/docs/openapi` (como JSON) y lo que renderiza Swagger UI
// en `/api-docs`. El archivo `docs/api/api-key-openapi.yaml` es un espejo textual de este objeto:
// si tocás uno, actualizá el otro. Los shapes documentados salen del CODIGO REAL:
//   - error global (feature 10): `lib/errors/{shape,codes,app-error}.ts` (appErrorToResponse/MSG).
//   - carga (features 88+103): `lib/interfaces/services/IBulkOrdenService.ts` (CargaViaApiSummary).
//   - lectura/cancelacion (feature 106): `lib/types/api-orden.ts` + servicios de lectura/cancelacion.
//   - estados: `lib/types/order-status.ts` (ORDER_STATUS_SEED); tope de lote: cargaMasivaConfig.

// Enum de estados de orden (ORDER_STATUS_SEED, lib/types/order-status.ts). Es la fuente unica de
// verdad: si el catalogo cambia, este literal debe seguirlo (y con el, el .yaml espejo).
//
// FEATURE 155/R42 — dos cambios y solo dos:
//   - BAJA del estado de fulfillment: el catalogo dejo de tenerlo, asi que no puede llegar
//     en ninguna respuesta (la migracion de esta feature reasigna las ordenes que hubiera);
//   - ALTA de `por_recolectar_en_tienda`: es el estado en que nacen ahora las ordenes creadas
//     por API, asi que documentarlo no es opcional.
// DEUDA CONOCIDA, no introducida aqui: esta lista lleva desde la feature 109 sin incorporar
// values que una orden del integrador SI puede alcanzar (`sin_gestionar` y los tres del flujo
// de devolucion de la 139). Ponerla al dia entera excede el alcance de la 155 —y el value
// terminal que declaro la 154 sigue ademas bajo el censo de "declarado y sin productor"
// (`tests/unit/guards/censo-catalogo-estados-v2.test.ts`) hasta la feature 158—, asi que la
// deuda se declara en `progress/impl_155_backend.md` en vez de arreglarse de contrabando.
// `tests/unit/api/openapi-contrato-en-reparto.test.ts` verifica que todo value de aqui exista
// en `ORDER_STATUS_SEED` y que el `.yaml` sea espejo EXACTO de este literal.
const ORDER_STATUS_ENUM = [
  "entregada",
  "devuelta",
  "devolviendo_a_tienda",
  "reprogramada",
  "por_recolectar_en_tienda", // feature 155/R42: estado de nacimiento del canal por API key
  "en_ruta_bodega_central",
  "en_bodega_central",
  "en_preparacion",
  "por_recoger",
  "en_ruta_bodega_satelite",
  "en_reparto",
  "rechazada",
  "en_bodega_satelite",
  "devuelta_a_tienda",
  "ayuda_tienda", // feature 268/R15: la IDA del ciclo de ayuda, ya emitida como evento publico
  "incidente", // feature 268/R15: desenlace terminal de la gestion, ya emitido como evento publico
];

// ⚠️ 2026-08-22 (feature 268) — la DEUDA de arriba SIGUE ABIERTA a proposito: `sin_gestionar` y los
// tres values del flujo de devolucion de la 139 continuan alcanzables y sin documentar. La 268
// añade SOLO los dos values que su propia politica de eventos publicos incorpora
// (`ayuda_tienda`, `incidente`); bajar el resto de la deuda «de contrabando» dentro de esta ficha
// esta descartado en su `design.md` §2.2. No es un olvido: es alcance declarado.

// Enum de estados del CUERPO DEL WEBHOOK (feature 268/R29). Se DERIVA de `EVENTOS_PUBLICOS`
// (`lib/types/webhook-eventos.ts`), la fuente unica de la POLITICA de eventos publicos, con un
// orden determinista (alfabetico) para que el espejo `.yaml` sea comparable posicionalmente.
// NUNCA se copia como lista literal: si la politica cambia, este enum cambia solo y
// `tests/unit/api/openapi-webhook-contrato.test.ts` se pone rojo si alguien lo desengancha.
const WEBHOOK_ESTADO_ENUM = [...EVENTOS_PUBLICOS].sort();

// Tope duro de filas por lote de carga (cargaMasivaConfig.MAX_CHUNK_ROWS, default 5000).
const MAX_CARGA_ROWS = 5000;

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Ordenex — API de integración por API key",
    version: "1.0.0",
    description: [
      "Canal de integración por **API key** para crear, listar, consultar, cancelar y eliminar órdenes.",
      "",
      "Autenticación: todos los endpoints exigen el header `Authorization: Bearer ordx_...`",
      "(API key con prefijo `ordx_`). La key identifica a un usuario dedicado que es el **dueño**",
      "de las órdenes: cada llamada opera SIEMPRE sobre las órdenes de ese dueño y sobre ninguna",
      "otra. El dueño de la key **solo ve y opera sus propias órdenes**; nunca se puede ampliar el",
      "alcance vía parámetros de la petición (un `tiendaId`/`owner` en la query se ignora).",
      "",
      "Aislamiento: una orden inexistente y una orden de otro dueño devuelven el **mismo 404**;",
      "la API no revela la existencia de recursos ajenos.",
      "",
      "Errores: shape uniforme del manejador global (feature 10) — ver el schema `Error`.",
    ].join("\n"),
  },
  servers: [
    { url: "http://localhost:3000", description: "Desarrollo local" },
    {
      url: "https://{host}",
      description: "Producción (reemplazá {host} por el dominio real)",
      variables: {
        host: { default: "app.ordenex.co", description: "Dominio del despliegue" },
      },
    },
  ],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Órdenes", description: "Carga, listado, detalle y cancelación de órdenes propias." },
  ],
  paths: {
    "/api/ordenes/api-key/carga": {
      post: {
        tags: ["Órdenes"],
        summary: "Carga de órdenes",
        operationId: "cargarOrdenes",
        description: [
          "Crea una o más órdenes en firme. Una orden nueva arranca en estado",
          "`por_recolectar_en_tienda` y recibe un `num_guia` en el acto. La respuesta incluye,",
          "por cada orden creada, su `costoEnvio`: flete + IVA de la tarifa vigente que resuelve",
          "el par (tienda, zona del distrito de esa orden), más el fulfillment si lo hay.",
          "",
          "**FULFILLMENT (2026-08).** Si tu tarifa tiene un monto de fulfillment (el servicio de",
          "bodega: tus paquetes ya están con nosotros), tus órdenes cambian en DOS cosas y las",
          "dos son visibles en la respuesta:",
          "",
          "1. **Nacen en `en_preparacion` y SIN `num_guia`** (`numGuia: null`, nunca un número",
          "   fabricado). No esperan a que un mensajero pase por tu tienda, porque el paquete ya",
          "   está en la bodega; la guía se emite después, cuando la orden se prepara. Ese lote",
          "   tampoco emite `manifiesto`: no hay entrega de bultos que firmar.",
          "2. **`costoEnvio` incluye el monto de fulfillment**, y el campo `fulfillment` de cada",
          "   orden dice cuánto de ese total es el servicio de bodega. Sin fulfillment ese campo",
          "   vale cero y `costoEnvio` es exactamente lo que era antes.",
          "",
          "El monto se resuelve por orden, con la tarifa de SU par (tienda, zona), así que un",
          "lote puede traer órdenes de las dos clases; cada fila dice en qué estado nació.",
          "",
          "**CAMBIO INCOMPATIBLE (2026-08): una fila sin tarifa ya no crea orden.** La tarifa se",
          "resuelve ANTES de persistir. Una fila cuyo par (tienda, zona) no resuelve ninguna",
          "tarifa vigente vuelve como `resultado: \"error\"` con la clave `tarifa` en `errores`",
          `(\`{ "tarifa": ["${MSG_FILA_SIN_TARIFA}"] }\`), NO se crea y NO trae ningún`,
          "`costoEnvio`. Las demás filas del mismo lote se crean con normalidad.",
          "",
          "**Si NINGUNA de las filas que llegan a la resolución de tarifa la resuelve, la",
          "respuesta es 409** y no se persiste nada: ni órdenes, ni la fila de `carga`, ni la",
          "notificación de carga terminada. Atención a la distinción, porque es la que evita un",
          "diagnóstico falso: si NINGUNA fila llega siquiera a la resolución de tarifa (todas",
          "fallan antes por validación, duplicidad o cobertura geográfica), la respuesta sigue",
          "siendo `200` con esas filas en su error de siempre, NO `409`: la tarifa no es el",
          "motivo del fallo.",
          "",
          "**CAMBIO INCOMPATIBLE (2026-07): el estado inicial cambió.** Antes las órdenes nacían",
          "en `en_ruta_bodega_central`, que afirmaba que el paquete ya viajaba hacia la bodega",
          "central sin que nadie lo hubiera recolectado. Ahora nacen en",
          "`por_recolectar_en_tienda`: el paquete espera en la tienda a que pase el mensajero, y",
          "pasa a `en_ruta_bodega_central` cuando este lo recolecta. Si tu integración compara el",
          "estado devuelto contra un literal, actualízala. El evento de webhook del nacimiento se",
          "conserva: `por_recolectar_en_tienda` es un evento público.",
          "",
          "Además, el estado interno de fulfillment en bodega fue retirado del catálogo: ya no",
          "aparece en el enum `estado` y no puede llegar en ninguna respuesta.",
          "",
          "Éxito parcial: las filas se clasifican en `creada`, `duplicada` (num_remision ya",
          "existente **en tu cuenta**: la unicidad de `num_remision` es por tienda, así que otro",
          "integrador puede usar el mismo número sin afectarte) o `error` (validación, geografía",
          "o falta de tarifa). Una respuesta 200",
          "puede contener filas con",
          `error. El lote acepta entre 1 y ${MAX_CARGA_ROWS} filas.`,
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CargaRequest" },
              examples: {
                dosFilas: {
                  summary: "Dos filas (una válida, una con teléfono faltante)",
                  value: {
                    ordenes: [
                      {
                        num_remision: "REM-0001",
                        destinatario: "Juan Pérez",
                        telefono: "88887777",
                        provincia: "San José",
                        canton: "San José",
                        distrito: "Carmen",
                        direccion: "Av. Central, 200m norte del parque",
                        producto: "Camiseta talla M",
                        peso: "1.5",
                        monto_cobrar: "25.90",
                        notas: "Entregar en la tarde",
                      },
                      {
                        num_remision: "REM-0002",
                        destinatario: "María Solís",
                        telefono: "",
                        provincia: "San José",
                        canton: "Escazú",
                        distrito: "San Rafael",
                        direccion: "Multiplaza, local 12",
                        producto: "Zapatos talla 38",
                        peso: "0.8",
                        monto_cobrar: "40.00",
                        notas: "",
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Lote procesado (puede incluir filas con error).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CargaResponse" },
                examples: {
                  resumen: {
                    summary: "Una creada, una con error",
                    value: {
                      cargaId: "9c2b7f10-5d3a-4e21-9a4b-77c8e0f1a2b3",
                      total: 2,
                      creadas: 1,
                      duplicadas: 0,
                      conError: 1,
                      filas: [
                        { fila: 1, numRemision: "REM-0001", resultado: "creada", estatus: "por_recolectar_en_tienda", numGuia: 100234 },
                        { fila: 2, numRemision: "REM-0002", resultado: "error", errores: { telefono: ["requerido"] } },
                      ],
                      ordenes: [
                        {
                          id: "6f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
                          numRemision: "REM-0001",
                          numGuia: 100234,
                          estado: "por_recolectar_en_tienda",
                          costoEnvio: "3.39",
                          fulfillment: "0.00",
                        },
                      ],
                    },
                  },
                  filaSinTarifa: {
                    summary: "Una creada y una degradada por falta de tarifa",
                    value: {
                      cargaId: "9c2b7f10-5d3a-4e21-9a4b-77c8e0f1a2b3",
                      total: 2,
                      creadas: 1,
                      duplicadas: 0,
                      conError: 1,
                      filas: [
                        { fila: 1, numRemision: "REM-0001", resultado: "creada", estatus: "por_recolectar_en_tienda", numGuia: 100234 },
                        { fila: 2, numRemision: "REM-0002", resultado: "error", errores: { tarifa: [MSG_FILA_SIN_TARIFA] } },
                      ],
                      ordenes: [
                        {
                          id: "6f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
                          numRemision: "REM-0001",
                          numGuia: 100234,
                          estado: "por_recolectar_en_tienda",
                          costoEnvio: "3.39",
                          fulfillment: "0.00",
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          // Feature 274 (R29/R31) — el 409 NUEVO de la carga. No es `$ref: Conflict` a secas
          // porque el ejemplo publicado tiene que ser LA CONSTANTE que el service emite: dos
          // cadenas (una aqui y otra en `lib/services/mensajes-tarifa.ts`) divergen a la primera
          // errata, y R38 pide exactamente lo contrario.
          "409": {
            description:
              "Ninguna de las filas que llegaron a la resolución de tarifa la resolvió: no se creó ninguna orden ni fila de carga.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: {
                  status: "error",
                  code: "CONFLICT",
                  message: MSG_CARGA_SIN_TARIFA,
                },
              },
            },
          },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/api/ordenes/api-key": {
      get: {
        tags: ["Órdenes"],
        summary: "Listado paginado de órdenes propias",
        operationId: "listarOrdenes",
        description: [
          "Devuelve las órdenes del dueño de la key, paginadas por `offset`/`limit`, con `total`",
          "para recorrer páginas. El filtro opcional `estado` solo acota; nunca amplía el alcance.",
          "Parámetros desconocidos (p. ej. `tiendaId`) se ignoran.",
          "",
          "Los filtros `desde`/`hasta`, `num_guia` y `num_remision` son opcionales, se combinan",
          "en AND y solo ACOTAN dentro de tus órdenes: un número de guía o de remisión que",
          "pertenece a otra tienda devuelve una página vacía (`items: []`, `total: 0`), nunca 404.",
        ].join("\n"),
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Cantidad de items por página (1..100).",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "offset",
            in: "query",
            required: false,
            description: "Cantidad de items a saltar (>= 0).",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
          {
            name: "estado",
            in: "query",
            required: false,
            description: "Filtra por estado exacto del catálogo.",
            schema: { type: "string", enum: ORDER_STATUS_ENUM },
          },
          {
            name: "desde",
            in: "query",
            required: false,
            description:
              "Fecha calendario mínima de creación (`YYYY-MM-DD`), inclusiva; el día se mide en hora de Costa Rica (UTC-6).",
            schema: { type: "string", format: "date", example: "2026-08-01" },
          },
          {
            name: "hasta",
            in: "query",
            required: false,
            description:
              "Fecha calendario máxima de creación (`YYYY-MM-DD`), inclusiva; el día se mide en hora de Costa Rica (UTC-6), así que cubre las 24 horas completas de ese día.",
            schema: { type: "string", format: "date", example: "2026-08-21" },
          },
          {
            name: "num_guia",
            in: "query",
            required: false,
            description:
              "Filtra por número de guía exacto. Excluye las órdenes que aún no tienen guía asignada.",
            schema: { type: "integer", minimum: 1, example: 100234 },
          },
          {
            name: "num_remision",
            in: "query",
            required: false,
            description:
              "Filtra por número de remisión exacto (sin prefijo, sin subcadena, distingue mayúsculas).",
            schema: { type: "string", minLength: 1, example: "REM-0001" },
          },
        ],
        responses: {
          "200": {
            description: "Página de órdenes.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Listado" },
                examples: {
                  pagina: {
                    summary: "Primera página con un item",
                    value: {
                      items: [
                        {
                          numGuia: 100234,
                          numRemision: "REM-0001",
                          estado: "en_ruta_bodega_central",
                          destinatario: "Juan Pérez",
                          telefonoDest: "88887777",
                          producto: "Camiseta talla M",
                          direccion: "Av. Central, 200m norte del parque",
                          montoCobrar: 25.9,
                          createdAt: "2026-07-22T14:03:11.000Z",
                        },
                      ],
                      pagination: { limit: 50, offset: 0, total: 1 },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/api/ordenes/api-key/{numGuia}": {
      parameters: [
        {
          name: "numGuia",
          in: "path",
          required: true,
          description: "Número de guía de la orden (entero positivo).",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      get: {
        tags: ["Órdenes"],
        summary: "Detalle de una orden propia",
        operationId: "detalleOrden",
        description: [
          "Detalle de UNA orden propia por `num_guia`, con sus evidencias de entrega/rechazo",
          "resueltas como URLs firmadas de corta duración (5 min). Array `evidencias` vacío si no",
          "hay. Una orden inexistente o de otro dueño devuelve el mismo 404.",
        ].join("\n"),
        responses: {
          "200": {
            description: "Detalle de la orden.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrdenDetalle" },
                examples: {
                  detalle: {
                    summary: "Orden entregada con una evidencia",
                    value: {
                      numGuia: 100234,
                      numRemision: "REM-0001",
                      estado: "entregada",
                      destinatario: "Juan Pérez",
                      telefonoDest: "88887777",
                      producto: "Camiseta talla M",
                      direccion: "Av. Central, 200m norte del parque",
                      montoCobrar: 25.9,
                      createdAt: "2026-07-22T14:03:11.000Z",
                      evidencias: [
                        {
                          resultado: "entregada",
                          contentType: "image/jpeg",
                          url: "https://<proyecto>.supabase.co/storage/v1/object/sign/gestion-evidencias/...",
                          expiraEnSegundos: 300,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/api/ordenes/api-key/{numGuia}/cancelar": {
      parameters: [
        {
          name: "numGuia",
          in: "path",
          required: true,
          description: "Número de guía de la orden a cancelar (entero positivo).",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      put: {
        tags: ["Órdenes"],
        summary: "Cancelar una orden propia",
        operationId: "cancelarOrden",
        description: [
          "Cancela una orden propia. Solo procede si el estado actual es `en_bodega_central` o",
          "`en_ruta_bodega_central`; en ese caso transiciona a `devolviendo_a_tienda`. Cualquier otro",
          "estado devuelve 409. Sin cuerpo. Una orden inexistente o de otro dueño devuelve 404.",
        ].join("\n"),
        responses: {
          "200": {
            description: "Orden cancelada.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CancelacionResponse" },
                examples: {
                  cancelada: {
                    summary: "Cancelación desde en_ruta_bodega_central",
                    value: {
                      numGuia: 100234,
                      estadoAnterior: "en_ruta_bodega_central",
                      estado: "devolviendo_a_tienda",
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    // Feature 177/R41 — los tres endpoints nuevos: consulta por identificador libre
    // (guía o remisión) y generación/re-firma del PDF de etiqueta por orden y por lote.
    "/api/ordenes/api-key/orden/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description:
            "Identificador de la orden: su `num_guia` o su `num_remision`. Si el valor casa con la guía de una orden y con la remisión de otra, gana la de la guía.",
          schema: { type: "string", minLength: 1, maxLength: 128 },
        },
      ],
      get: {
        tags: ["Órdenes"],
        summary: "Detalle de una orden propia por guía o remisión",
        operationId: "detalleOrdenPorIdentificador",
        description: [
          "Mismo detalle que `GET /api/ordenes/api-key/{numGuia}` (idéntico schema `OrdenDetalle`),",
          "pero aceptando como identificador el `num_guia` **o** el `num_remision` de la orden.",
          "Resolución: si el identificador es un entero positivo se busca primero por `num_guia`;",
          "si no hay coincidencia, se busca por `num_remision`. Nunca responde 409 por ambigüedad.",
          "",
          "Una orden inexistente, borrada o de otro dueño devuelve el mismo 404.",
        ].join("\n"),
        responses: {
          "200": {
            description: "Detalle de la orden.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrdenDetalle" },
                examples: {
                  detalle: {
                    summary: "Orden resuelta por su número de remisión",
                    value: {
                      numGuia: 100234,
                      numRemision: "REM-0001",
                      estado: "entregada",
                      destinatario: "Juan Pérez",
                      telefonoDest: "88887777",
                      producto: "Camiseta talla M",
                      direccion: "Av. Central, 200m norte del parque",
                      montoCobrar: 25.9,
                      createdAt: "2026-07-22T14:03:11.000Z",
                      evidencias: [
                        {
                          resultado: "entregada",
                          contentType: "image/jpeg",
                          url: "https://<proyecto>.supabase.co/storage/v1/object/sign/gestion-evidencias/...",
                          expiraEnSegundos: 300,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
      // FICHA 320 — el PRIMER `DELETE` del canal. Va en ESTE path (mismo recurso, otro verbo) y no
      // en un sub-recurso `/eliminar`: retira el recurso que la ruta identifica, de modo que un
      // `GET` a la misma URL pasa a devolver 404. `cancelar` es un `PUT` porque NO retira nada
      // —transiciona la orden y la deja viva—.
      delete: {
        tags: ["Órdenes"],
        summary: "Eliminar una orden propia",
        operationId: "eliminarOrden",
        description: [
          "Retira una orden propia que **todavía no se ha gestionado**. Es un borrado lógico: la",
          "orden desaparece del canal (un `GET` posterior a la misma URL devuelve 404) y libera su",
          "`num_remision` para que puedas volver a cargarla.",
          "",
          "Solo procede si el estado actual es uno de estos cuatro: `en_preparacion`,",
          "`por_recolectar_en_tienda`, `recolectando` o `en_bodega_central` —es decir, mientras el",
          "paquete sigue quieto en tu tienda o en la bodega central—. Haber generado la etiqueta NO",
          "impide eliminar. Cualquier otro estado devuelve 409.",
          "",
          "Acepta el mismo identificador que el `GET`: `num_guia` **o** `num_remision`. Usar la",
          "remisión es lo habitual aquí, porque una orden recién cargada puede no tener guía",
          "todavía.",
          "",
          "Una orden inexistente, ya eliminada o de otro dueño devuelve el mismo 404. Repetir el",
          "`DELETE` sobre una orden ya eliminada devuelve 404, no un error.",
        ].join("\n"),
        responses: {
          "200": {
            description: "Orden eliminada.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EliminacionResponse" },
                examples: {
                  conGuia: {
                    summary: "Orden ya numerada, eliminada desde en_bodega_central",
                    value: {
                      numGuia: 100234,
                      numRemision: "REM-0001",
                      estado: "en_bodega_central",
                    },
                  },
                  sinGuia: {
                    summary: "Orden recién cargada, todavía sin guía",
                    value: { numGuia: null, numRemision: "REM-0002", estado: "en_preparacion" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/api/ordenes/api-key/orden/{id}/generate": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description:
            "Identificador de la orden: su `num_guia` o su `num_remision` (misma resolución que el endpoint de detalle).",
          schema: { type: "string", minLength: 1, maxLength: 128 },
        },
      ],
      post: {
        tags: ["Órdenes"],
        summary: "PDF de etiqueta de una orden propia",
        operationId: "generarPdfOrden",
        description: [
          "Devuelve una URL firmada de corta duración con el PDF de la etiqueta de la orden.",
          "La primera llamada construye el PDF y lo almacena; las siguientes reutilizan el mismo",
          "documento y solo lo vuelven a firmar. La respuesta es idéntica en ambos casos, y la",
          "`url` cambia en cada llamada aunque el PDF sea el mismo.",
          "",
          "Solo responde a `POST`. Una orden sin guía imprimible devuelve 409.",
        ].join("\n"),
        responses: {
          "200": {
            description: "URL firmada del PDF de la etiqueta.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PdfGenerateResponse" },
                examples: {
                  primeraLlamada: {
                    summary: "Primera llamada: el PDF se construye",
                    value: {
                      url: "https://<proyecto>.supabase.co/storage/v1/object/sign/etiquetas/...",
                      expiraEnSegundos: 300,
                    },
                  },
                  reuso: {
                    summary: "Llamada posterior: solo se vuelve a firmar (misma forma)",
                    value: {
                      url: "https://<proyecto>.supabase.co/storage/v1/object/sign/etiquetas/...",
                      expiraEnSegundos: 300,
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/api/ordenes/api-key/carga/{cargaId}/generate": {
      parameters: [
        {
          name: "cargaId",
          in: "path",
          required: true,
          description:
            "Id del lote, tal como lo devuelve `cargaId` en la respuesta de `POST /api/ordenes/api-key/carga`.",
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: {
        tags: ["Órdenes"],
        summary: "PDF consolidado de etiquetas de un lote propio",
        operationId: "generarPdfCarga",
        description: [
          "Misma forma de respuesta que el PDF por orden, sobre el consolidado de todas las",
          "etiquetas imprimibles del lote (solo órdenes propias y vivas). La primera llamada lo",
          "construye; las siguientes solo vuelven a firmar, con la misma forma de respuesta.",
          "",
          "Solo responde a `POST`. Un lote inexistente o de otro dueño devuelve el mismo 404; un",
          "lote sin etiquetas imprimibles, o que excede el tope de etiquetas por PDF, devuelve 409.",
        ].join("\n"),
        responses: {
          "200": {
            description: "URL firmada del PDF consolidado del lote.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PdfGenerateResponse" },
                examples: {
                  consolidado: {
                    summary: "Consolidado del lote recién construido",
                    value: {
                      url: "https://<proyecto>.supabase.co/storage/v1/object/sign/etiquetas/...",
                      expiraEnSegundos: 300,
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    // Feature 255 (R47) — OCTAVO endpoint del canal: cotización previa, lectura pura.
    "/api/ordenes/api-key/cotizacion": {
      post: {
        tags: ["Órdenes"],
        summary: "Cotización de un lote (no crea nada)",
        operationId: "cotizarOrdenes",
        description: [
          "Cotiza un lote de filas **sin crear nada**: por cada fila devuelve si hay cobertura y",
          "cuánto costaría la orden en los DOS escenarios posibles (entregada y devuelta).",
          "",
          "**Acepta el MISMO cuerpo que `POST /api/ordenes/api-key/carga`, sin recortarlo.** Las",
          "filas son pares clave/valor de TEXTO, con la geografía en columnas SEPARADAS",
          "(`provincia`, `canton`, `distrito`, `direccion`) y `monto_cobrar` como texto. Las claves",
          "que la cotización no usa se ignoran en silencio. `num_remision` es OPCIONAL aquí y solo",
          "sirve para correlacionar la respuesta con tu fila: si no viene, la fila responde",
          "`numRemision: null`. No hay deduplicación de ninguna clase, ni contra el lote ni contra",
          `las órdenes existentes. El lote acepta entre 1 y ${MAX_CARGA_ROWS} filas: el mismo tope`,
          "que la carga.",
          "",
          "**Lectura pura.** Este endpoint NO crea órdenes, NO consume ningún número de guía y NO",
          "persiste nada: ni orden, ni lote de carga, ni historial, ni movimiento de wallet, ni",
          "notificación, ni registro de auditoría. Llamarlo dos veces con el mismo cuerpo no cambia",
          "ningún estado.",
          "",
          "**Supuesto declarado: `cobra_comision = true`.** La cotización asume que la orden que se",
          "crearía cobra comisión COD (el mismo default de la columna `orden.cobra_comision`), así",
          "que el escenario entregado incluye siempre `comision` e `ivaComision`. Una orden que",
          "acabara creándose sin comisión costaría menos que lo cotizado aquí.",
          "",
          "**Los importes se emiten SOLO formateados.** Cada importe viene en una única forma:",
          "símbolo de moneda, parte entera agrupada con separador de miles, separador decimal y",
          "exactamente DOS decimales, con el signo negativo DELANTE del símbolo (`-₡1.578,00`). NO",
          "hay un campo crudo de escala 2 en paralelo: el string formateado ES el contrato. Si tu",
          "integración necesita operar con el número, parsealo en tu lado.",
          "",
          "**La cotización es POR ORDEN: la respuesta NO trae un bloque de totales del lote.**",
          "Hasta el 2026-08-31 se emitía un `totales` que sumaba cada fila cotizada en el escenario",
          "entregado Y en el devuelto a la vez, es decir dos compilados bajo las premisas de «100%",
          "entregas» y «100% rechazos»: ninguna de las dos describe un lote real, y se leían como",
          "el precio de la operación. Se retiró. Los contadores `total`, `cotizadas` y `conError`",
          "siguen ahí; el agregado, con la premisa de entrega que corresponda a tu operación, lo",
          "haces con los importes de cada fila.",
          "",
          "**Una fila se queda sin precio por DOS motivos distintos, no uno:** porque su geografía",
          "no tiene cobertura (o no valida), o porque el par (tienda, zona de esa fila) no resuelve",
          "tarifa vigente. Los dos llegan por el mismo canal —`resultado: \"error\"` con sus",
          "mensajes por campo— y los dos cuentan en `conError`.",
          "",
          "Éxito parcial: una fila sin cobertura (o que no valida) se marca `resultado: \"error\"`",
          "con sus mensajes por campo y NO trae `costos`; las demás se cotizan igual y la respuesta",
          "sigue siendo 200. No existe el resultado `duplicada`: sin persistencia no significa nada.",
          "Una fila cuyo par (tienda, zona) no resuelve tarifa vigente se degrada por ESE MISMO",
          `camino: \`resultado: "error"\` con \`{ "tarifa": ["${MSG_FILA_SIN_TARIFA}"] }\` y sin`,
          "bloque `costos` —nunca un importe en cero—.",
          "",
          "El **409** existe sólo para el caso extremo: cuando NINGUNA de las filas que llegan a la",
          "resolución de tarifa la resuelve. Entonces no se cotiza ni una fila y la respuesta no",
          "trae ningún importe. Ya NO significa «la tienda no tiene tarifa vigente»: una fila suelta",
          "sin tarifa vuelve en `error` dentro de un `200`. Y si ninguna fila llega siquiera a",
          "resolver tarifa (todas sin cobertura o sin validar), la respuesta es `200` con todas",
          "las filas en `error`, NO `409`.",
          "",
          "**`/carga` aplica hoy EXACTAMENTE el mismo criterio de lote.** La asimetría que este",
          "contrato declaraba —la carga toleraba la falta de tarifa creando la orden con un costo",
          "de envío en cero— dejó de existir: allí una fila sin tarifa tampoco se crea, y un lote",
          "en el que ninguna resuelve también responde 409.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CotizacionRequest" },
              examples: {
                dosFilas: {
                  summary: "Dos filas (una con cobertura, una con distrito inexistente)",
                  value: {
                    ordenes: [
                      {
                        provincia: "San José",
                        canton: "Escazú",
                        distrito: "San Rafael",
                        direccion: "Multiplaza, local 12",
                        monto_cobrar: "25900",
                        num_remision: "REM-0001",
                      },
                      {
                        provincia: "San José",
                        canton: "Escazú",
                        distrito: "Distrito que no existe",
                        direccion: "Sin referencia",
                        monto_cobrar: "18000",
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Lote cotizado (puede incluir filas con error).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CotizacionResponse" },
                examples: {
                  resumen: {
                    summary: "Una cotizada (con sus dos escenarios) y una con error",
                    value: {
                      total: 2,
                      cotizadas: 1,
                      conError: 1,
                      filas: [
                        {
                          fila: 1,
                          numRemision: "REM-0001",
                          resultado: "cotizada",
                          costos: {
                            entregado: {
                              flete: "₡2.500,00",
                              iva: "₡325,00",
                              comision: "₡906,50",
                              ivaComision: "₡117,85",
                              fulfillment: "₡0,00",
                              total: "₡22.050,65",
                            },
                            devuelto: {
                              flete: "₡1.396,46",
                              iva: "₡181,54",
                              comision: "₡0,00",
                              fulfillment: "₡0,00",
                              total: "-₡1.578,00",
                            },
                          },
                        },
                        {
                          fila: 2,
                          numRemision: null,
                          resultado: "error",
                          errores: { distrito: ["distrito no encontrado en el canton"] },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": {
            description:
              "Ninguna de las filas que llegaron a la resolución de tarifa la resolvió: no se cotiza ninguna fila.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: {
                  status: "error",
                  code: "CONFLICT",
                  message: "la tienda no tiene una tarifa vigente asociada: no se puede cotizar",
                },
              },
            },
          },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    // Feature 267 (R39) — NOVENO endpoint del canal: la analitica de las propias ordenes.
    //
    // La lista de paths estaba firmada en OCHO desde la 255 y publicar esto la puso ROJA: ESE es
    // su trabajo. Sube a NUEVE A PROPOSITO, en el mismo commit que publica el endpoint y en los
    // DOS artefactos (aqui y en `docs/api/api-key-openapi.yaml`), no de contrabando.
    "/api/ordenes/api-key/analitica": {
      get: {
        tags: ["Órdenes"],
        summary: "Series diarias de tus métricas sobre tus órdenes",
        operationId: "consultarAnalitica",
        description: [
          "Devuelve una **serie diaria por métrica**, calculada exclusivamente sobre las órdenes",
          "de la tienda dueña de la key. El recorte no es un filtro que se pueda ampliar: sale de",
          "la propia key, así que no hay ningún parámetro para pedir datos de otra tienda (y si se",
          "envía uno, se ignora).",
          "",
          "**Varias métricas por llamada.** `metricas` acepta una lista separada por comas",
          "(`metricas=entregas,devoluciones`) o el valor especial **`all`**, que trae todas las",
          "publicables. `all` no se combina con ids: o `all`, o la lista. Un id repetido se sirve",
          "una sola vez, conservando su primera posición.",
          "",
          "**La respuesta tiene SIEMPRE la misma forma,** se pida una métrica o diez: el rango una",
          "vez en la raíz y las series en `metricas[]`, en el orden pedido (el del `enum` cuando se",
          "pidió `all`).",
          "",
          "**El lote es todo o nada.** Si UNA de las métricas pedidas no está en el `enum` de",
          "abajo, la llamada entera responde **403** y no se sirve ninguna — exactamente el mismo",
          "403 que una métrica que no existe: las dos respuestas son idénticas a propósito.",
          "",
          "**La ventana se pide con `desde` y `hasta`, igual que en el listado.** Mismos nombres,",
          "mismo formato `YYYY-MM-DD` y misma semántica: el día se mide en hora de Costa Rica",
          "(UTC-6) y `hasta` es **inclusivo**. Los dos son obligatorios y no hay atajos tipo",
          "«últimos 7 días»: así el rango de una respuesta nunca depende de cuándo se llamó. La",
          "ventana no puede superar 366 días contando ambos extremos.",
          "",
          "**`data` trae solo los días que se pueden leer, y OMITE los que no.** Un día del rango",
          "puede faltar en `data`, y falta a propósito, por una de dos razones: (a) es **el día en",
          "curso**, que todavía no está cerrado y siempre se vería más bajo que un día completo; o",
          "(b) cae **por debajo del horizonte de nuestro histórico**, donde la cifra sería cero por",
          "falta de datos y no por falta de operación. En los dos casos publicar el número sería",
          "enseñarte una caída de tu operación que no ocurrió, así que el día **no aparece**. La",
          "ausencia es el dato: **no rellenes los huecos con ceros**.",
          "",
          "**`data` puede venir vacío, y eso es una respuesta `200` correcta** — por ejemplo si",
          "pides `desde=hoy&hasta=hoy`, porque hoy todavía no está cerrado. No es un error.",
          "",
          "**`rango` es el eco EXACTO de lo que pediste, sin recortar,** aunque `data` no llegue",
          "hasta `hasta`. Lo pedido y lo servible son dos cosas distintas y se leen por separado.",
          "",
          "**`valor` puede ser `null`, y `null` NO es `0`:** significa «no se sabe» (por ejemplo,",
          "una tasa cuyo denominador fue cero ese día). Un día con `valor: null` SÍ aparece en",
          "`data`: es un día cerrado cuyo resultado es indefinido, no un día que falte.",
          "",
          "**Qué cuenta cada métrica, porque no todas cuentan lo mismo.** `entregas`,",
          "`devoluciones`, `rechazos`, `reprogramaciones`, `tasa_entrega`, `tasa_devolucion` y",
          "`tasa_rechazo` cuentan **gestiones, no órdenes**: una orden reprogramada y entregada",
          "después aporta **dos** gestiones. `ordenes_creadas` y `ordenes_por_estado` cuentan",
          "**órdenes**. `tiempo_ciclo` no cuenta nada: mide una **duración**. Consecuencia",
          "práctica: **dos métricas que no cuentan lo mismo no son sumables entre sí** — sumar",
          "gestiones con órdenes da un total que no significa nada.",
          "",
          "Este canal no publica importes ni identifica a los mensajeros de la operación.",
        ].join("\n"),
        parameters: [
          {
            name: "metricas",
            in: "query",
            required: true,
            description:
              "Ids separados por comas, o `all` para todas las publicables. Solo los valores del enum se publican por este canal; `all` no se combina con ids.",
            // El enum se DERIVA de la lista blanca (`lib/analytics/publicacion-api-key.ts`), la
            // fuente unica de que se publica. Copiarlo como literal aqui garantizaria que un dia
            // diverja de lo que el endpoint concede de verdad. El centinela viaja en el MISMO
            // enum y desde la MISMA fuente, por el mismo motivo.
            schema: {
              type: "string",
              enum: [...METRICAS_API_KEY, METRICAS_TODAS],
            },
            example: "entregas,devoluciones",
          },
          {
            name: "desde",
            in: "query",
            required: true,
            description:
              "Fecha calendario de Costa Rica (UTC-6), inclusiva. Formato `YYYY-MM-DD`.",
            schema: { type: "string", format: "date" },
            example: "2026-08-01",
          },
          {
            name: "hasta",
            in: "query",
            required: true,
            description:
              "Fecha calendario de Costa Rica (UTC-6), INCLUSIVA. Formato `YYYY-MM-DD`. La ventana no puede superar 366 días contando ambos extremos.",
            schema: { type: "string", format: "date" },
            example: "2026-08-21",
          },
        ],
        responses: {
          "200": {
            description: "Series diarias de las métricas pedidas, sobre tus órdenes.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AnaliticaRespuesta" },
                examples: {
                  serie: {
                    summary:
                      "Dos métricas; se pidieron tres días y el tercero (hoy) no viene: no está cerrado",
                    value: {
                      rango: { desde: "2026-08-19", hasta: "2026-08-21" },
                      metricas: [
                        {
                          metrica: "entregas",
                          unidad: "conteo",
                          data: [
                            { fecha: "2026-08-19", valor: 41 },
                            { fecha: "2026-08-20", valor: 37 },
                          ],
                        },
                        {
                          metrica: "tasa_entrega",
                          unidad: "porcentaje",
                          data: [
                            { fecha: "2026-08-19", valor: 0.93 },
                            { fecha: "2026-08-20", valor: null },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    // Feature 266 (T7.1, R28) — HABILITACION POR LOTE de pedidos con novedad. El NOVENO endpoint
    // del canal. La `description` dice las tres cosas que el integrador NO puede adivinar leyendo
    // el schema: que solo dos estados son habilitables, que una `devuelta` nunca cambia de estado
    // y que el lote tiene tope de 100 filas.
    "/api/ordenes/api-key/habilitar": {
      post: {
        tags: ["Órdenes"],
        summary: "Habilitar pedidos con novedad (lote)",
        operationId: "habilitarOrdenes",
        description: [
          "Habilita, en lote, pedidos que quedaron con una novedad: por cada fila se registra la",
          "habilitación con su nota y, cuando corresponde, la orden vuelve a `en_reparto`.",
          "",
          "**Solo DOS estados son habilitables: `ayuda_tienda` y `devuelta`.** Ningún otro lo es.",
          "En particular `reprogramada` **NO** es habilitable por este endpoint y devuelve",
          "`estado_no_habilitable`, igual que `rechazada`, `incidente` y `sin_gestionar`.",
          "",
          "**Una orden `devuelta` NUNCA cambia de estado**: siempre responde",
          "`habilitada_sin_cambio_de_estado`. No es una degradación ni un fallo — su paquete ya",
          "volvió a la bodega, así que no hay nadie en la calle a quien devolvérselo. De los dos",
          "estados habilitables, **solo `ayuda_tienda` (y solo si conserva mensajero asignado)**",
          "puede producir `habilitada` con estado `en_reparto`.",
          "",
          `**El lote acepta entre 1 y ${TOPE_FILAS_HABILITAR} filas.** Un lote vacío, sin la clave`,
          "`ordenes`, con un cuerpo que no es JSON o con más filas que el tope responde **422** y",
          "no procesa ninguna fila: es el único 4xx que tira el lote entero, junto con 401 y 403.",
          "",
          "**Éxito parcial:** una fila mal formada, duplicada dentro del mismo lote, inexistente o",
          "en un estado no habilitable se marca `resultado: \"error\"` con su `error.codigo`, y las",
          "demás se procesan igual. La respuesta sigue siendo **200 aunque TODAS las filas fallen**.",
          "`resultados` conserva el orden y la cantidad de las filas enviadas: podés casar por",
          "índice.",
          "",
          "**Repetir la llamada:** habilitar dos veces la misma orden devuelve `estado_no_habilitable`",
          "en la segunda llamada —ya está en `en_reparto`, que no es habilitable— y no escribe nada.",
          "No se devuelve un acuse `habilitada` falso.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HabilitacionRequest" },
              examples: {
                dosFilas: {
                  summary: "Dos filas: una en ayuda con mensajero y una devuelta",
                  value: {
                    ordenes: [
                      { num_guia: 100234, nota: "el cliente pidió reintento mañana" },
                      { num_guia: 100235, nota: "dirección corregida por el call center" },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Lote procesado (puede incluir filas con error).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HabilitacionResponse" },
                examples: {
                  resumen: {
                    summary: "Una habilitada, una sin cambio de estado y una con error",
                    value: {
                      resumen: {
                        total: 3,
                        habilitadas: 1,
                        habilitadasSinCambioDeEstado: 1,
                        conError: 1,
                      },
                      resultados: [
                        {
                          numGuia: 100234,
                          resultado: "habilitada",
                          estado: "en_reparto",
                          error: null,
                        },
                        {
                          numGuia: 100235,
                          resultado: "habilitada_sin_cambio_de_estado",
                          estado: "devuelta",
                          error: null,
                        },
                        {
                          numGuia: 999999,
                          resultado: "error",
                          estado: null,
                          error: {
                            codigo: "no_encontrada",
                            mensaje: "no existe una orden viva con esa guia",
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "422": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
  },
  // ---------------------------------------------------------------------------------------------
  // Feature 256/R24 — WEBHOOKS SALIENTES. Seccion de NIVEL SUPERIOR de OpenAPI 3.1 (fuera de
  // `paths:`): describe lo que Ordenex ENVIA al callback del integrador, no lo que el integrador
  // pide. Va aqui y NO dentro de `paths` a proposito: la lista de endpoints del canal por API key
  // esta congelada en `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` y publicar un
  // webhook no es dar de alta un endpoint.
  //
  // ⏳ 2026-08-22 (FEATURE 268/R28/R29) — AQUI DECIA, y ya no es cierto:
  // «⚠️ `data.estado` se documenta como `type: string` con PROSA que remite al catalogo de
  // `OrdenListItem`, SIN `enum` literal de estados: enumerarlo aqui añadiria un 5.º catalogo de
  // estados al contrato y pondria ROJA `tests/unit/api/openapi-contrato-en-reparto.test.ts`
  // (design 256 §5.2)».
  //
  // AHORA `data.estado` SI LLEVA `enum`, y por tres razones:
  //
  // (a) POR QUE AHORA SI SE ENUMERA. Sin enum, el integrador no tiene forma de saber que values
  //     puede recibir por este canal: la prosa lo mandaba al catalogo de `OrdenListItem`, que es
  //     el catalogo de las RESPUESTAS REST y es MAS GRANDE que lo que el webhook emite. La 268
  //     amplia el vocabulario emitido (`ayuda_tienda`, `incidente`) y publicar la lista exacta
  //     pasa a ser parte del aviso a integradores, no un adorno.
  //
  // (b) POR QUE ES SEMANTICAMENTE CORRECTO. El enum NO es el catalogo entero: se DERIVA de
  //     `EVENTOS_PUBLICOS` (`WEBHOOK_ESTADO_ENUM`, R29), que son los 12 values que este webhook
  //     puede emitir de verdad. Los 16 de `OrdenListItem.estado` son un SUPERCONJUNTO: incluyen
  //     estados internos (`en_preparacion`, `por_recoger`, `en_bodega_satelite`,
  //     `en_ruta_bodega_satelite`) que nunca viajan en un evento. Documentar el superconjunto era
  //     lo incorrecto; no documentar nada, tambien.
  //
  // (c) POR QUE EL GUARD SIGUE EN 4 (el miedo de la 256 era infundado; design 268 §7.5).
  //     `openapi-contrato-en-reparto.test.ts` no cuenta «enums», cuenta enums DE ESTADO con el
  //     predicado `esEnumDeEstado`, que exige `entregada` **Y** `por_recoger`. El enum derivado de
  //     la politica contiene `entregada` pero NO `por_recoger` (es uno de los internos que el
  //     webhook no emite), asi que no entra en el recuento: los bloques siguen siendo CUATRO.
  //     Esto no se cree por fe: lo afirma `tests/unit/api/openapi-webhook-contrato.test.ts`.
  //
  // El `enum` de los valores de `motivo` SI se escribia ya: no es un catalogo de estados y no
  // afecta al recuento. La 268 lo AMPLIA con las tres causas de incidente.
  //
  // ⚠️ Ojo tambien con la PROSA: `tests/unit/types/intentos-no-alcance.test.ts` (160/R31) prohibe
  // la subcadena «intentos» en TODO el spec serializado. Por eso aqui se habla de «reintento», en
  // singular: no lo «corrijas» al plural.
  webhooks: {
    "orden.estado_actualizado": {
      post: {
        tags: ["Órdenes"],
        summary: "Cambio de estado de una orden (evento saliente)",
        operationId: "webhookOrdenEstadoActualizado",
        // La entrega no lleva `Authorization`: se autentica con la firma HMAC de las cabeceras.
        security: [],
        description: [
          "Ordenex **envía** este evento al callback configurado por el dueño de la tienda cada vez",
          "que una orden suya cambia a un estado publicable. Es una petición SALIENTE de Ordenex",
          "hacia el integrador: no es un endpoint que el integrador llame.",
          "",
          "El destino se deriva SIEMPRE del dueño de la orden: un evento nunca se entrega al callback",
          "de otro dueño.",
          "",
          "**Firma.** Cada entrega lleva `X-Ordenex-Timestamp` (instante unix en segundos) y",
          "`X-Ordenex-Signature` (`sha256=<hex>`, HMAC-SHA256 sobre la cadena",
          "`${timestamp}.${cuerpo}` con el secreto de la suscripción). El `cuerpo` es el JSON EXACTO",
          "recibido, byte a byte: verificá la firma sobre el texto crudo ANTES de parsearlo, y",
          "descartá las entregas cuyo timestamp quede fuera de tu ventana anti-replay.",
          "",
          "**Idempotencia.** Una misma entrega puede repetirse (reintento tras un fallo transitorio,",
          "o duplicado): deduplicá por `eventoId`, que es determinista para un mismo cambio de estado.",
          "",
          "Respondé 2xx para confirmar la recepción; cualquier otra respuesta se trata como fallo",
          "transitorio y la entrega se reintenta.",
        ].join("\n"),
        parameters: [
          {
            name: "X-Ordenex-Signature",
            in: "header",
            required: true,
            description:
              "Firma de la entrega: `sha256=<hex>`, HMAC-SHA256 de `${timestamp}.${cuerpo}` con el secreto de la suscripción.",
            schema: { type: "string", pattern: "^sha256=[0-9a-f]{64}$" },
          },
          {
            name: "X-Ordenex-Timestamp",
            in: "header",
            required: true,
            description:
              "Instante unix en SEGUNDOS en que se firmó la entrega. Entra en el mensaje firmado y es el insumo de tu ventana anti-replay.",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["evento", "eventoId", "ocurridoAt", "data"],
                properties: {
                  evento: {
                    type: "string",
                    const: "orden.estado_actualizado",
                    description: "Nombre del evento. Estable.",
                  },
                  eventoId: {
                    type: "string",
                    description:
                      "Identificador determinista del evento (`webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAt>`). Dos entregas del MISMO cambio de estado lo repiten: deduplicá por este valor.",
                  },
                  ocurridoAt: {
                    type: "string",
                    format: "date-time",
                    description: "Instante del cambio de estado (ISO 8601, UTC).",
                  },
                  data: {
                    type: "object",
                    // ⏳ 2026-08-22 (feature 268/R28) — la frase de la 256 decia «las cuatro claves
                    // están SIEMPRE presentes» a secas. Sigue siendo verdad para esas cuatro, pero
                    // ya no describe el objeto entero: hay una QUINTA clave, `evidenciasUrl`, que
                    // es OPCIONAL y se OMITE salvo en `incidente`. Se dice cual es cual para que el
                    // consumidor no tenga que deducirlo.
                    description:
                      "Las cuatro claves `numGuia`, `numRemision`, `estado` y `motivo` están SIEMPRE presentes, sea cual sea el estado: el consumidor no ramifica por estado para saber si existen (`motivo` viaja como `null` cuando no aplica, nunca omitido). A ellas se suma UNA clave OPCIONAL, `evidenciasUrl`, que SÍ se omite salvo en los eventos con `estado: \"incidente\"`.",
                    required: ["numGuia", "numRemision", "estado", "motivo"],
                    properties: {
                      numGuia: {
                        type: ["integer", "null"],
                        description: "Número de guía de la orden (null si aún no está asignado).",
                      },
                      numRemision: {
                        type: "string",
                        description: "Remisión de la orden (la que envió el integrador).",
                      },
                      estado: {
                        type: "string",
                        // feature 268/R29: DERIVADO de `EVENTOS_PUBLICOS`, nunca copiado a mano.
                        enum: WEBHOOK_ESTADO_ENUM,
                        description:
                          "Estado destino de la orden, con el MISMO value crudo del catálogo que publica `OrdenListItem.estado` (y, por herencia, `OrdenDetalle`). El `enum` de arriba es la POLÍTICA de eventos públicos: la lista EXACTA y COMPLETA de values que este webhook puede entregar, y un SUBCONJUNTO del catálogo de `OrdenListItem.estado`. Los estados internos de preparación y ruteo satélite que ese catálogo documenta (`en_preparacion`, `por_recoger`, `en_bodega_satelite`, `en_ruta_bodega_satelite`) NO viajan nunca en un evento. La lista puede CRECER de forma aditiva en el futuro, siempre con aviso previo: tratá un value desconocido como «ignorar», no como error.",
                      },
                      motivo: {
                        type: ["string", "null"],
                        enum: [
                          "not_found",
                          "wrong_number",
                          "wrong_address",
                          "danado", // feature 268/R20: causa de INCIDENTE, en español (158/Q-B)
                          "perdido",
                          "robado",
                          null,
                        ],
                        description: [
                          "Causa TIPIFICADA del cambio de estado, con el value crudo del enum y sin traducir. El",
                          "campo transporta DOS enums distintos y cuál aplica lo decide `estado`:",
                          "",
                          "- **`estado: \"devuelta\"`** → causa de la devolución: `not_found` (destinatario no",
                          "  encontrado), `wrong_number` (teléfono equivocado), `wrong_address` (dirección",
                          "  equivocada). Estos tres NO aparecen nunca con otro estado.",
                          "- **`estado: \"incidente\"`** → causa del incidente: `danado`, `perdido`, `robado`. Estos",
                          "  tres NO aparecen nunca con otro estado.",
                          "- **cualquier otro `estado`** → siempre `null`.",
                          "",
                          "⚠️ **La asimetría de idioma es DELIBERADA, no un error que corregir.** Las causas de",
                          "devolución van en INGLÉS y las de incidente en ESPAÑOL (`danado` sin eñe, `perdido`,",
                          "`robado`) porque cada enum se publicó con el value crudo de su catálogo interno y",
                          "renombrar cualquiera de los dos rompería a los integradores que ya lo consumen.",
                          "Decisión consciente y firmada (73/F1.4-g y 158/Q-B): no se «armoniza» en el futuro.",
                          "",
                          "Es `null` en todo evento cuyo `estado` NO sea `devuelta` ni `incidente`, y es `null`",
                          "**también** en una `devuelta` (o un `incidente`) sin causa registrada — órdenes cerradas",
                          "antes de que la causa se pidiera; ese histórico no se rellenó. El contrato no distingue",
                          "«no hubo causa» de «no se registró»:",
                          "en los dos casos viaja `null`, el campo NUNCA se omite y la entrega es normal.",
                          "",
                          "**Es el motivo VIGENTE EN EL MOMENTO DE LA ENTREGA**, no una foto del instante del",
                          "cambio de estado: el webhook dice exactamente lo mismo que dice la aplicación en ese",
                          "instante. Si la devolución se re-gestiona entre dos entregas del mismo `eventoId`, la",
                          "segunda lleva la causa vigente entonces; deduplicá por `eventoId` y quedate con la",
                          "última entrega.",
                          "",
                          "⚠️ Transporta EXCLUSIVAMENTE la causa tipificada. NO es el texto libre que el mensajero",
                          "escribe al gestionar la orden —que comparte el nombre `motivo` en la base de datos y NO",
                          "se emite NUNCA en este webhook—, ni ningún otro dato del destinatario.",
                        ].join("\n"),
                      },
                      // feature 268/R24/R30 — la QUINTA clave, y la unica OPCIONAL del objeto:
                      // deliberadamente FUERA de `required`.
                      evidenciasUrl: {
                        type: "string",
                        format: "uri",
                        description: [
                          "Enlace al detalle de esta orden en el canal por API key",
                          "(`GET /api/ordenes/api-key/orden/{id}`), cuyo array `evidencias[]` incluye las",
                          "evidencias del incidente con `resultado: \"incidente\"`.",
                          "",
                          "**Es el único campo OPCIONAL de `data`.** Viaja SOLO en los eventos con",
                          "`estado: \"incidente\"`, y se OMITE —no viaja como `null`— tanto en cualquier otro",
                          "estado como en un `incidente` para el que no se pueda resolver el enlace. Ramificá",
                          "por «la clave existe», no por su valor.",
                          "",
                          "⚠️ **NO es una URL firmada y NO lleva credencial.** Es un enlace ESTABLE y",
                          "determinista: sin token, sin expiración, no caduca, y las dos entregas de un mismo",
                          "`eventoId` (por ejemplo tras un reintento) llevan exactamente el mismo valor. Por eso",
                          "**no podés abrirlo sin autenticarte**: invocalo con tu propio",
                          "`Authorization: Bearer ordx_...`, igual que cualquier otra llamada al canal, y el",
                          "detalle te devolverá las URLs firmadas frescas de las fotos, con su TTL corto. La",
                          "credencial la ponés vos; el cuerpo del webhook nunca la transporta.",
                        ].join("\n"),
                      },
                    },
                  },
                },
              },
              // feature 268/R30 — el ejemplo de la 256 (`devuelta`/`not_found`) NO se pierde: pasa a
              // ser el primero de un mapa `examples`, y se le suma el caso de `incidente`, que es el
              // unico que muestra la clave opcional `evidenciasUrl` y la causa en español.
              examples: {
                devuelta: {
                  summary: "Devolución con causa tipificada (sin `evidenciasUrl`)",
                  value: {
                    evento: "orden.estado_actualizado",
                    eventoId:
                      "webhook_estado:018f2c31-0000-4000-8000-000000000001:7:2026-08-21T10:00:00.000Z",
                    ocurridoAt: "2026-08-21T10:00:00.000Z",
                    data: {
                      numGuia: 100234,
                      numRemision: "REM-0001",
                      estado: "devuelta",
                      motivo: "not_found",
                    },
                  },
                },
                incidente: {
                  summary: "Incidente: causa en español y enlace estable a las evidencias",
                  value: {
                    evento: "orden.estado_actualizado",
                    eventoId:
                      "webhook_estado:018f2c31-0000-4000-8000-000000000002:21:2026-08-22T14:30:00.000Z",
                    ocurridoAt: "2026-08-22T14:30:00.000Z",
                    data: {
                      numGuia: 100235,
                      numRemision: "REM-0002",
                      estado: "incidente",
                      motivo: "robado",
                      evidenciasUrl:
                        "https://app.ordenex.co/api/ordenes/api-key/orden/018f2c31-0000-4000-8000-000000000002",
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Recepción confirmada. Cualquier 2xx vale; cualquier otra respuesta se trata como fallo transitorio y la entrega se reintenta.",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key con prefijo `ordx_` en el header `Authorization: Bearer ordx_...`.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        description:
          "Shape uniforme de error del manejador global (feature 10). `status` siempre `\"error\"`.",
        required: ["status", "code", "message"],
        properties: {
          status: { type: "string", const: "error" },
          code: {
            type: "string",
            enum: ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL"],
            description: "Código estable (independiente del status HTTP).",
          },
          message: { type: "string", description: "Mensaje fijo en español." },
          details: {
            type: "object",
            description: "Detalle opcional. En 422 lleva `fieldErrors` (campo -> lista de errores).",
            additionalProperties: true,
          },
        },
      },
      OrdenListItem: {
        type: "object",
        description: "Item público de una orden propia (sin ids internos ni PII de terceros).",
        required: [
          "numGuia",
          "numRemision",
          "estado",
          "destinatario",
          "telefonoDest",
          "producto",
          "direccion",
          "montoCobrar",
          "createdAt",
        ],
        properties: {
          numGuia: { type: ["integer", "null"], description: "Número de guía (null si aún no asignado)." },
          numRemision: { type: "string" },
          estado: { type: "string", enum: ORDER_STATUS_ENUM },
          destinatario: { type: "string" },
          telefonoDest: { type: "string" },
          producto: { type: "string" },
          direccion: { type: ["string", "null"] },
          montoCobrar: { type: ["number", "null"], description: "Monto a cobrar (COD)." },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Pagination: {
        type: "object",
        required: ["limit", "offset", "total"],
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 0, description: "Total de órdenes que cumplen el filtro." },
        },
      },
      Listado: {
        type: "object",
        required: ["items", "pagination"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/OrdenListItem" } },
          pagination: { $ref: "#/components/schemas/Pagination" },
        },
      },
      Evidencia: {
        type: "object",
        // feature 268/R31: el detalle por API key deja de mostrar solo entrega y rechazo — las
        // evidencias del INCIDENTE (por las dos procedencias: gestión del mensajero y reporte del
        // admin) se exponen con la MISMA forma, y por eso `resultado` gana un tercer value.
        description:
          "Evidencia de entrega, rechazo o incidente, con URL firmada de corta duración. Las de incidente llegan con `resultado: \"incidente\"` y son las que enlaza el campo `evidenciasUrl` del webhook.",
        required: ["resultado", "contentType", "url", "expiraEnSegundos"],
        properties: {
          resultado: { type: "string", enum: ["entregada", "rechazada", "incidente"] },
          contentType: { type: ["string", "null"], description: "MIME del archivo (p. ej. image/jpeg)." },
          url: { type: "string", format: "uri", description: "URL firmada (vence a los 5 min)." },
          expiraEnSegundos: { type: "integer", description: "TTL de la URL firmada en segundos (300)." },
        },
      },
      OrdenDetalle: {
        allOf: [
          { $ref: "#/components/schemas/OrdenListItem" },
          {
            type: "object",
            required: ["evidencias"],
            properties: {
              evidencias: {
                type: "array",
                description: "Evidencias de la orden ([] si no hay).",
                items: { $ref: "#/components/schemas/Evidencia" },
              },
            },
          },
        ],
      },
      CargaRequest: {
        type: "object",
        required: ["ordenes"],
        properties: {
          ordenes: {
            type: "array",
            minItems: 1,
            maxItems: MAX_CARGA_ROWS,
            description: `Filas a cargar (1..${MAX_CARGA_ROWS}). Todos los valores son texto.`,
            items: { $ref: "#/components/schemas/CargaRow" },
          },
        },
      },
      CargaRow: {
        type: "object",
        description:
          "Una fila de carga. Todas las claves son strings. Las requeridas se validan en el servidor; una fila inválida no aborta el lote (se reporta como `error`).",
        required: [
          "num_remision",
          "destinatario",
          "telefono",
          "provincia",
          "canton",
          "distrito",
          "direccion",
          "producto",
          "peso",
          "monto_cobrar",
        ],
        properties: {
          num_remision: { type: "string", description: "Identificador de remisión (dedup por este valor)." },
          destinatario: { type: "string" },
          telefono: { type: "string" },
          provincia: { type: "string" },
          canton: { type: "string" },
          distrito: { type: "string" },
          direccion: { type: "string" },
          producto: { type: "string" },
          peso: { type: "string", description: "Peso en kg como texto (p. ej. \"1.5\")." },
          monto_cobrar: { type: "string", description: "Monto COD como texto (p. ej. \"25.90\")." },
          notas: { type: "string" },
        },
        additionalProperties: { type: "string" },
      },
      CargaRowResult: {
        type: "object",
        description: "Resultado por fila del lote.",
        required: ["fila", "numRemision", "resultado"],
        properties: {
          fila: { type: "integer", description: "Índice 1-based dentro de `ordenes`." },
          numRemision: { type: "string" },
          resultado: { type: "string", enum: ["creada", "duplicada", "error"] },
          estatus: { type: "string", description: "Estado (en creada/duplicada); nunca ids internos." },
          numGuia: { type: "integer", description: "Número de guía asignado (solo en `creada`)." },
          errores: {
            type: "object",
            description:
              "Errores por campo (solo en `error`). Las claves suelen ser columnas de la fila, pero no siempre: la clave `tarifa` señala que el par (tienda, zona) de esa fila no resuelve tarifa vigente y por eso la orden no se creó.",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
      },
      CargaOrden: {
        type: "object",
        description: "Una orden efectivamente creada (bloque plano listo para consumir).",
        required: ["id", "numRemision", "numGuia", "estado", "costoEnvio", "fulfillment"],
        properties: {
          id: { type: "string", format: "uuid", description: "Id interno de la orden creada." },
          numRemision: { type: "string" },
          numGuia: {
            type: ["integer", "null"],
            description:
              "Número de guía asignado en el acto. Es `null` —y solo entonces— cuando la orden nació en `en_preparacion` por fulfillment: la guía se emite más tarde y nunca se fabrica un número.",
          },
          estado: { type: "string", enum: ORDER_STATUS_ENUM },
          costoEnvio: {
            type: "string",
            description:
              "Costo total del envío (flete + IVA de la tarifa vigente del par (tienda, zona), MÁS el fulfillment si lo hay), string escala 2. Toda orden creada lo trae con un importe real: una fila sin tarifa no llega a crearse. Distinto de `monto_cobrar`/COD.",
          },
          fulfillment: {
            type: "string",
            description:
              "Cuánto de `costoEnvio` es el servicio de bodega, string escala 2. `\"0.00\"` si tu tarifa no tiene fulfillment — y entonces `costoEnvio` es solo flete + IVA. Nunca `null`.",
          },
        },
      },
      CargaResponse: {
        type: "object",
        required: ["total", "creadas", "duplicadas", "conError", "filas", "ordenes"],
        properties: {
          // Feature 177/R45: el integrador necesita este id para llamar a
          // `POST /api/ordenes/api-key/carga/{cargaId}/generate`. Es `null` cuando el lote no
          // creó ninguna orden (no hubo carga que registrar), por eso NO va en `required`.
          cargaId: {
            type: ["string", "null"],
            format: "uuid",
            description:
              "Id del lote creado, para pedir después el PDF consolidado. `null` si el lote no creó ninguna orden.",
          },
          total: { type: "integer", description: "Filas recibidas." },
          creadas: { type: "integer" },
          duplicadas: { type: "integer" },
          conError: { type: "integer" },
          filas: { type: "array", items: { $ref: "#/components/schemas/CargaRowResult" } },
          ordenes: { type: "array", items: { $ref: "#/components/schemas/CargaOrden" } },
        },
      },
      CancelacionResponse: {
        type: "object",
        required: ["numGuia", "estadoAnterior", "estado"],
        properties: {
          numGuia: { type: "integer" },
          estadoAnterior: { type: "string", enum: ORDER_STATUS_ENUM },
          estado: { type: "string", const: "devolviendo_a_tienda" },
        },
      },
      // FICHA 320 — respuesta del `DELETE`. Devuelve la IDENTIDAD de lo retirado y el estado que
      // tenia. `numGuia` es nullable a proposito: la orden que mas se elimina es la que todavia no
      // tiene guia. No lleva un `eliminada: true` — el 200 ya lo dice, y un campo constante no
      // habilita ninguna decision del cliente (misma razon por la que se retiro `generado`).
      EliminacionResponse: {
        type: "object",
        required: ["numGuia", "numRemision", "estado"],
        properties: {
          numGuia: {
            type: ["integer", "null"],
            description: "Guía de la orden eliminada; `null` si aún no tenía.",
          },
          numRemision: {
            type: "string",
            description: "Tu número de remisión. Vuelve a quedar libre para reutilizarlo.",
          },
          estado: {
            type: "string",
            description: "Estado que la orden tenía al eliminarla (eliminar no cambia el estado).",
            enum: ["en_preparacion", "por_recolectar_en_tienda", "recolectando", "en_bodega_central"],
          },
        },
      },
      PdfGenerateResponse: {
        type: "object",
        description:
          "URL firmada de corta duración con el PDF de etiqueta (de una orden o de un lote). La URL se firma en cada llamada: nunca es una URL persistida.",
        required: ["url", "expiraEnSegundos"],
        properties: {
          url: { type: "string", format: "uri", description: "URL firmada del PDF." },
          expiraEnSegundos: {
            type: "integer",
            description: "TTL de la URL firmada en segundos (300 por defecto).",
          },
        },
      },
      // ── Feature 255 — cotización previa (lectura pura). Todos los importes son STRINGS ya
      // formateados (símbolo + miles + exactamente 2 decimales, signo delante del símbolo):
      // NO existe un campo crudo de escala 2 en paralelo.
      CotizacionRequest: {
        type: "object",
        required: ["ordenes"],
        properties: {
          ordenes: {
            type: "array",
            minItems: 1,
            maxItems: MAX_CARGA_ROWS,
            description: `Filas a cotizar (1..${MAX_CARGA_ROWS}, el mismo tope que la carga). Todos los valores son texto.`,
            items: { $ref: "#/components/schemas/CotizacionRow" },
          },
        },
      },
      CotizacionRow: {
        type: "object",
        description: [
          "Una fila a cotizar. Es la MISMA fila cruda que acepta `POST /api/ordenes/api-key/carga`:",
          "podés mandar el cuerpo de la carga sin recortarlo y las claves que la cotización no usa",
          "se ignoran. `num_remision` es opcional y solo correlaciona.",
          "",
          "NINGUNA clave de la fila está en `required`, y es deliberado: el servidor NO rechaza el",
          "lote por una fila incompleta. La terna geográfica (`provincia`, `canton`, `distrito`) es",
          "NECESARIA para poder cotizar la fila, pero su ausencia NO es un 422 del lote: esa fila",
          "vuelve con `resultado: \"error\"` y el detalle bajo la clave del campo que falta, y las",
          "demás filas se cotizan igual (éxito parcial). Declararla `required` haría que un cliente",
          "generado con validación estricta rechazara EN LOCAL un cuerpo que el servidor acepta y",
          "responde 200.",
          "",
          "Cuándo recibís 422: solo por el lote entero — `ordenes` vacío o por encima del tope",
          "(o un valor que no sea texto). Cuándo recibís 200 con filas en `error`: por cualquier",
          "problema de una fila concreta — terna ausente o vacía, distrito no encontrado, distrito",
          "ambiguo, distrito sin zona asignada, o `monto_cobrar` con formato inválido.",
        ].join("\n"),
        properties: {
          provincia: {
            type: "string",
            description:
              "Necesaria para cotizar la fila. Si falta, la fila sale con `resultado: \"error\"` (no un 422 del lote).",
          },
          canton: {
            type: "string",
            description:
              "Necesario para cotizar la fila. Si falta, la fila sale con `resultado: \"error\"` (no un 422 del lote).",
          },
          distrito: {
            type: "string",
            description:
              "Su zona decide la columna de flete. Necesario para cotizar la fila: si falta, no se encuentra, es ambiguo o no tiene zona, la fila sale con `resultado: \"error\"` (no un 422 del lote).",
          },
          direccion: { type: "string", description: "Se acepta; no participa del precio." },
          monto_cobrar: {
            type: "string",
            description:
              "Monto COD como texto (p. ej. \"25900\"). Base de la comisión; vacío o ausente se trata como cero.",
          },
          num_remision: {
            type: "string",
            description:
              "OPCIONAL: solo correlación. No se deduplica ni contra el lote ni contra las órdenes existentes.",
          },
        },
        additionalProperties: { type: "string" },
      },
      CotizacionEscenarioEntregado: {
        type: "object",
        description:
          "Costo si la orden se ENTREGA: seis conceptos. `total` es lo que RECIBE la tienda = monto a cobrar − (flete + iva + comision + ivaComision + fulfillment), y es negativo si no hay COD que cubra lo facturado.",
        required: ["flete", "iva", "comision", "ivaComision", "fulfillment", "total"],
        properties: {
          flete: { type: "string", description: "Flete de la zona del distrito, formateado." },
          iva: { type: "string", description: "IVA del flete, formateado." },
          comision: { type: "string", description: "Comisión COD, formateada." },
          ivaComision: { type: "string", description: "IVA de la comisión, formateado." },
          fulfillment: {
            type: "string",
            description:
              "Monto fijo del servicio de bodega por orden, formateado. Cero si tu tarifa no tiene fulfillment; nunca ausente.",
          },
          total: { type: "string", description: "Lo que recibe la tienda, formateado." },
        },
      },
      CotizacionEscenarioDevuelto: {
        type: "object",
        description:
          "Costo si la orden se DEVUELVE, es decir si el paquete vuelve a tu tienda: cinco conceptos, SIN `ivaComision` (no hay comisión que gravar). `comision` es un cero EXPLÍCITO — la afirmación de que una devolución no cobra comisión COD, no un dato ausente. `fulfillment` en cambio SÍ se cobra: el servicio de bodega ya se prestó. `total` es la DEUDA de la tienda = −(flete + iva + fulfillment), y por eso es negativo. **Cuándo se cobra este escenario:** al cerrarse la orden como RECHAZADA, que es el resultado con el que el paquete regresa. Un intento de entrega fallido que aún se puede reprogramar o recuperar NO cobra nada por sí solo; los importes de aquí aparecen cuando el retorno se consuma.",
        required: ["flete", "iva", "comision", "fulfillment", "total"],
        properties: {
          flete: { type: "string", description: "Flete de devolución, formateado." },
          iva: { type: "string", description: "IVA del flete de devolución, formateado." },
          comision: {
            type: "string",
            description: "Siempre cero formateado: una devolución no cobra comisión COD.",
          },
          fulfillment: {
            type: "string",
            description:
              "El MISMO monto que en el escenario entregado: preparar y despachar el paquete ya costó, lo reciba el destinatario o no. Cero si tu tarifa no tiene fulfillment.",
          },
          total: { type: "string", description: "Deuda de la tienda, formateada (negativa)." },
        },
      },
      CotizacionCostos: {
        type: "object",
        description: "Los DOS escenarios de una fila con cobertura. Ausente en una fila `error`.",
        required: ["entregado", "devuelto"],
        properties: {
          entregado: { $ref: "#/components/schemas/CotizacionEscenarioEntregado" },
          devuelto: { $ref: "#/components/schemas/CotizacionEscenarioDevuelto" },
        },
      },
      CotizacionRowResult: {
        type: "object",
        description:
          "Resultado por fila. No existe `duplicada`: sin persistencia no significa nada.",
        required: ["fila", "numRemision", "resultado"],
        properties: {
          fila: { type: "integer", description: "Índice 1-based dentro de `ordenes`." },
          numRemision: {
            type: ["string", "null"],
            description: "El `num_remision` que mandaste, tal cual; `null` si la fila no lo trajo.",
          },
          resultado: { type: "string", enum: ["cotizada", "error"] },
          costos: { $ref: "#/components/schemas/CotizacionCostos" },
          errores: {
            type: "object",
            description:
              "Errores por campo (solo en `error`). Las claves suelen ser columnas de la fila, pero no siempre: la clave `tarifa` señala que el par (tienda, zona) de esa fila no resuelve tarifa vigente y por eso no se cotizó.",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
      },
      CotizacionResponse: {
        type: "object",
        // Sin bloque `totales` (retirado el 2026-08-31): la cotización es POR ORDEN.
        required: ["total", "cotizadas", "conError", "filas"],
        properties: {
          total: { type: "integer", description: "Filas recibidas." },
          cotizadas: { type: "integer" },
          conError: { type: "integer" },
          filas: { type: "array", items: { $ref: "#/components/schemas/CotizacionRowResult" } },
        },
      },
      // Feature 267 (R39) — el contrato de `GET /api/ordenes/api-key/analitica`. Es el espejo
      // publicado de `AnaliticaSerieApiKeyDTO` (`lib/api/analitica-api-key-dto.ts`): si el DTO
      // gana o pierde un campo, este schema y el `.yaml` cambian con el, en el mismo commit.
      // P4-bis (2026-08-23) — EL SOBRE. El endpoint sirve un LOTE, asi que la unidad publicada
      // es esta y no la serie suelta: el `rango` UNA vez —lo comparten todas por construccion— y
      // las series en `metricas[]`, en el orden pedido. La forma no cambia con el numero de
      // metricas pedidas: un contrato que cambiara de forma obligaria a escribir dos parsers.
      AnaliticaRespuesta: {
        type: "object",
        required: ["rango", "metricas"],
        properties: {
          rango: {
            type: "object",
            description:
              "Eco del rango efectivo, común a todas las series y en el mismo formato que la petición.",
            required: ["desde", "hasta"],
            properties: {
              desde: { type: "string", format: "date", example: "2026-08-19" },
              hasta: {
                type: "string",
                format: "date",
                description: "Inclusivo, hora de Costa Rica.",
                example: "2026-08-21",
              },
            },
          },
          metricas: {
            type: "array",
            description: "Una entrada por métrica pedida, en el orden pedido. Nunca vacío.",
            items: { $ref: "#/components/schemas/AnaliticaSerie" },
          },
        },
      },
      // 2026-08-24 — la serie publica TRES campos. `unidadDeConteo` salió del payload (es un
      // hecho del catálogo, y va en la descripción del endpoint) y `cobertura` salió entera: su
      // información la lleva ahora la OMISIÓN de puntos en `data`.
      AnaliticaSerie: {
        type: "object",
        required: ["metrica", "unidad", "data"],
        properties: {
          metrica: { type: "string", description: "Id de la métrica pedida.", example: "entregas" },
          unidad: {
            type: "string",
            description: "Unidad de la cifra (p. ej. `conteo`, `porcentaje`, `dias`).",
          },
          data: {
            type: "array",
            description:
              "Los días SERVIBLES del rango, en orden. NO trae un punto por cada día pedido: se omiten el día en curso (aún no cerrado) y los días por debajo del horizonte del histórico, porque ahí un cero sería falta de datos y no falta de operación. Puede venir vacío, y eso es un 200 correcto. No rellenes los huecos con ceros.",
            items: {
              type: "object",
              required: ["fecha", "valor"],
              properties: {
                fecha: { type: "string", format: "date", example: "2026-08-20" },
                valor: {
                  type: ["number", "null"],
                  description: "`null` significa «no se sabe» (por ejemplo, denominador cero). NUNCA se sustituye por 0. Un día con `valor: null` SÍ está en `data`: está cerrado, pero su resultado es indefinido.",
                },
              },
            },
          },
        },
      },
      // Feature 266 (T7.1) — cuerpo y respuesta de la habilitacion por lote.
      HabilitacionRequest: {
        type: "object",
        required: ["ordenes"],
        properties: {
          ordenes: {
            type: "array",
            minItems: 1,
            maxItems: TOPE_FILAS_HABILITAR,
            description: `Entre 1 y ${TOPE_FILAS_HABILITAR} filas. Fuera de ese rango: 422 y ninguna fila procesada.`,
            items: { $ref: "#/components/schemas/HabilitacionRow" },
          },
        },
      },
      HabilitacionRow: {
        type: "object",
        description:
          "Una fila del lote. Si `num_guia` o `nota` no cumplen, la fila responde `error`/`fila_invalida` y el resto del lote se procesa igual: NO es un 422 del lote.",
        required: ["num_guia", "nota"],
        properties: {
          num_guia: {
            type: "integer",
            minimum: 1,
            description: "Número de guía de una orden propia. No se acepta como texto.",
          },
          nota: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description:
              "Motivo de la habilitación, OBLIGATORIO. Se recorta y se guarda en la bitácora de la orden; no viaja en el historial de estados.",
          },
        },
      },
      HabilitacionResponse: {
        type: "object",
        required: ["resumen", "resultados"],
        properties: {
          resumen: { $ref: "#/components/schemas/HabilitacionResumen" },
          resultados: {
            type: "array",
            description:
              "MISMO orden y MISMA cantidad que las filas enviadas: se puede casar por índice.",
            items: { $ref: "#/components/schemas/HabilitacionRowResult" },
          },
        },
      },
      HabilitacionResumen: {
        type: "object",
        description: "`total` = `habilitadas` + `habilitadasSinCambioDeEstado` + `conError`.",
        required: ["total", "habilitadas", "habilitadasSinCambioDeEstado", "conError"],
        properties: {
          total: { type: "integer", description: "Filas recibidas." },
          habilitadas: { type: "integer", description: "Volvieron a `en_reparto`." },
          habilitadasSinCambioDeEstado: {
            type: "integer",
            description: "Se registró la habilitación y el estado NO cambió.",
          },
          conError: { type: "integer" },
        },
      },
      HabilitacionRowResult: {
        type: "object",
        required: ["numGuia", "resultado", "estado", "error"],
        properties: {
          numGuia: {
            description: "La guía tal como se envió (si la fila era inválida, puede no ser entero).",
          },
          resultado: {
            type: "string",
            enum: ["habilitada", "habilitada_sin_cambio_de_estado", "error"],
            description:
              "`habilitada`: la orden volvió a `en_reparto`. `habilitada_sin_cambio_de_estado`: se registró y el estado NO cambió (SIEMPRE el caso de una `devuelta`). `error`: la fila no se procesó.",
          },
          estado: {
            type: ["string", "null"],
            description: "Estado en el que la orden quedó; `null` cuando la fila falló.",
          },
          error: {
            type: ["object", "null"],
            required: ["codigo", "mensaje"],
            properties: {
              codigo: {
                type: "string",
                enum: [
                  "fila_invalida",
                  "duplicada_en_lote",
                  "no_encontrada",
                  "estado_no_habilitable",
                ],
                description:
                  "`fila_invalida`: `num_guia`/`nota` no cumplen. `duplicada_en_lote`: la guía ya apareció antes en el mismo lote. `no_encontrada`: no hay orden viva con esa guía para esta key (no distingue «no existe» de «es de otro dueño»). `estado_no_habilitable`: el estado actual no es `ayuda_tienda` ni `devuelta` —incluye `reprogramada` y la segunda habilitación de una orden ya en `en_reparto`—.",
              },
              mensaje: { type: "string" },
            },
          },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "API key ausente, mal formada o desconocida.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { status: "error", code: "UNAUTHORIZED", message: "No hay una sesion valida." },
          },
        },
      },
      Forbidden: {
        description: "El usuario dueño de la key no está activo.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              status: "error",
              code: "FORBIDDEN",
              message: "No tienes permiso para realizar esta accion.",
            },
          },
        },
      },
      NotFound: {
        description: "La orden no existe o pertenece a otro dueño (mismo 404).",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              status: "error",
              code: "NOT_FOUND",
              message: "El recurso solicitado no existe.",
            },
          },
        },
      },
      Conflict: {
        description: "El estado actual de la orden no permite la operación.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              status: "error",
              code: "CONFLICT",
              message: "La operacion entra en conflicto con el estado actual.",
            },
          },
        },
      },
      ValidationError: {
        description: "Entrada inválida (query, path o cuerpo).",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              status: "error",
              code: "VALIDATION_ERROR",
              message: "Los datos enviados no son validos.",
              details: { fieldErrors: { limit: ["Number must be less than or equal to 100"] } },
            },
          },
        },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
