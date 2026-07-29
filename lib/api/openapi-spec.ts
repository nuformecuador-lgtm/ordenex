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
//   - BAJA de `en_fulfillment`: el catalogo dejo de tenerlo, asi que no puede llegar en ninguna
//     respuesta (la migracion de esta feature reasigna las ordenes que estuvieran ahi);
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
];

// Tope duro de filas por lote de carga (cargaMasivaConfig.MAX_CHUNK_ROWS, default 5000).
const MAX_CARGA_ROWS = 5000;

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Ordenex — API de integración por API key",
    version: "1.0.0",
    description: [
      "Canal de integración por **API key** para crear, listar, consultar y cancelar órdenes.",
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
          "Crea una o más órdenes en firme. Cada orden nueva arranca en estado",
          "`por_recolectar_en_tienda` y recibe un `num_guia` en el acto. La respuesta incluye,",
          "por cada orden creada, su `costoEnvio` (flete + IVA de la tarifa vigente de la tienda;",
          "`\"0.00\"` si la tienda no tiene tarifa vigente).",
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
          "existente) o `error` (validación/geografía). Una respuesta 200 puede contener filas con",
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
    "/api/ordenes/api-key": {
      get: {
        tags: ["Órdenes"],
        summary: "Listado paginado de órdenes propias",
        operationId: "listarOrdenes",
        description: [
          "Devuelve las órdenes del dueño de la key, paginadas por `offset`/`limit`, con `total`",
          "para recorrer páginas. El filtro opcional `estado` solo acota; nunca amplía el alcance.",
          "Parámetros desconocidos (p. ej. `tiendaId`) se ignoran.",
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
        description: "Evidencia de entrega/rechazo con URL firmada de corta duración.",
        required: ["resultado", "contentType", "url", "expiraEnSegundos"],
        properties: {
          resultado: { type: "string", enum: ["entregada", "rechazada"] },
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
            description: "Errores por campo (solo en `error`).",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
      },
      CargaOrden: {
        type: "object",
        description: "Una orden efectivamente creada (bloque plano listo para consumir).",
        required: ["id", "numRemision", "numGuia", "estado", "costoEnvio"],
        properties: {
          id: { type: "string", format: "uuid", description: "Id interno de la orden creada." },
          numRemision: { type: "string" },
          numGuia: { type: "integer" },
          estado: { type: "string", enum: ORDER_STATUS_ENUM },
          costoEnvio: {
            type: "string",
            description:
              "Costo del envío (flete + IVA), string escala 2. \"0.00\" si la tienda no tiene tarifa vigente. Distinto de `monto_cobrar`/COD.",
          },
        },
      },
      CargaResponse: {
        type: "object",
        required: ["total", "creadas", "duplicadas", "conError", "filas", "ordenes"],
        properties: {
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
