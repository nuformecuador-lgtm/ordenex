# 474 — Envíos automáticos por WhatsApp — design

> Requisitos en `requirements.md` (R1–R53). Medido contra `dev` @ `e4453f43` el 2026-10-05 y
> **enmendado contra `dev` @ `c53a4cc7` el mismo día** con las decisiones D1–D4 del humano y las
> maquetas aprobadas de `design-whatsapp/`. El grafo `codebase-memory` se usó para localizar; cada pieza
> citada se confirmó en el archivo real (el grafo no tenía la 470 ni `emitirOrdenRechazadaEnTransaccion`:
> esos se leyeron directamente).
>
> Lo que cambia la enmienda: §0 (filas de credenciales y avisos), §1.4 (dos columnas), §1.6 (un tipo de
> job), §2.2–§2.4 (catálogo de eventos, informe «Aviso de la app», variable común), §3 (R9), §4.2 (el
> puente, reescrito), §4.3–§4.4, §5.2 (identificador de la app), §7 (maqueta), §8, §9 (H–K), §10, §11, §12.

## 0. Qué existe hoy y qué falta (medido)

| Pieza | Dónde | Estado para esta ficha |
| --- | --- | --- |
| Plantillas (107) | `PlantillaMensaje` (`db/schema.prisma:217`), `PlantillaMensajeService`, `lib/actions/plantillas.ts`, `/configuracion/plantillas` | Se reutiliza. **Falta**: noción de «plantilla de informe» y de cabecera documento. |
| Componentes Meta | `lib/utils/whatsapp-template.ts` | `construirComponentsTemplate` solo arma `BODY` (línea 49); `construirComponentsEnvio` solo `body` (línea 67). **Falta** `HEADER`/`header` documento. |
| Ejemplos de variables | `ejemploDe` → `EJEMPLOS_POR_CLAVE` del catálogo de orden (`lib/types/plantilla-datos.ts:859`) | **Falta** que salgan del catálogo del informe para plantillas de informe. |
| Envío de template | `WhatsappCloudClient.enviarPlantilla(destino, nombre, idioma, componentes)` (`lib/clients/whatsapp-cloud.ts:121`) | Sirve tal cual: los componentes son libres. Desenlace tipado `ok`/`transitorio`/`permanente`. |
| Subida de media | `WhatsappMediaUploadClient.subir` (`lib/clients/whatsapp-media-upload.ts:106`) → `media_id` | Sirve para el PDF que se ENVÍA. **No** sirve para el ejemplo de la plantilla (eso es otra API, §5.2). |
| Credenciales | `loadWhatsappConfig` (`lib/config/whatsapp.ts:90`): `WHATSAPP_CLOUD_TOKEN` (Bearer), `WHATSAPP_NUMERO_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_API_VERSION` (por defecto `v21.0`, línea 10); base `https://graph.facebook.com` (`whatsapp-cloud.ts:19`); token SIEMPRE en cabecera `Authorization: Bearer` y nunca en URL ni log (invariante 3, `whatsapp-cloud.ts:10`) | **Falta** el ID de la app para la subida reanudable del ejemplo: se OBTIENE del token (D2, §5.2.1), sin pedirlo al humano. |
| Avisos internos | Emisor central `lib/notificaciones/emitir.ts` (`emitirFilas` → `INotificacionRepository.crear`, una fila por destinatario, dedupe por `(evento, entidad_id, destinatario)`); bindings de producción en `lib/notificaciones/notificadores.ts`, que resuelven TODOS su repositorio por `repoReal()` (línea 202); el canal de push se cablea ahí UNA vez como decorador (`conPushWeb`, `notificacion-repo-con-push.ts`), vigilado por `tests/unit/guards/push-cableado-unico.guardia.test.ts` | Se reutiliza el MISMO punto de cableado para el puente (§4.2). Enum de evento: `NotificacionEvento` (`db/schema.prisma:3163`, 18 valores). `NotificacionTipo` (línea 3151) es solo el icono (`alert`/`box`/`warning`) y no sirve como disparo. |
| Excepción transaccional | `emitirOrdenRechazadaEnTransaccion` (`emitir.ts:244`) construye `new NotificacionRepository(tx)` dentro de `GestionOrdenRepository.registrarGestionPendiente` (`GestionOrdenRepository.ts:795`): NO pasa por `repoReal()` y el decorador de push ya ignora todo `crear` con `tx` | Por eso `orden_rechazada` queda no disponible (§2.2). |
| Presentación de un aviso | `presentacionDe` (`lib/notificaciones/presentacion-aviso.ts:86`) y `accionDeAviso` / atajos (`catalogo-avisos.ts`) | Se reutiliza para el `enlace` (§2.3). |
| URL pública de la app | `NEXT_PUBLIC_APP_URL` (`lib/utils/paquete-url.ts:23`) y `NEXT_PUBLIC_SITE_URL` (`lib/utils/whatsapp-envio-valores.ts:41`) | Se reutilizan para el `enlace` (§2.3). |
| Cola | `jobs` + `JobQueueService` + `/api/cron/procesar-jobs` cada minuto (`vercel.json`) | Se reutiliza. La recurrencia por tipo (`RecurrenciaSpec`) re-encola con payload `{}`: vale para el mantenimiento diario, **no** para envíos con payload propio (§4.1). |
| Hora CR | `lib/utils/fecha-cr.ts` (`fechaCalendarioCR`, `inicioDelDiaCREnUtc`…), `hora-cr.ts`; CR = UTC−6 fijo (`analitica-rollup-diario-handler.ts:31`) | Se reutiliza. |
| Teléfono | `normalizarTelefonoWa` → `normalizarTelefonoCR` (`lib/utils/whatsapp-telefono.ts`) | Normaliza pero **no valida**. **Falta** el predicado de validez (§6.4). |
| Estados de Meta | webhook `app/api/webhooks/whatsapp/route.ts` → `parseWebhookEventos` → `ChatWhatsappService.ingerirEventos` actualiza `chat_mensaje` por `wa_message_id` | **Falta** aplicar esos estados a las entregas de esta ficha (§5.4). |
| Almacén privado | `SupabaseAlmacenDescargas` (470): bucket privado creado en el primer uso, `upsert: false`, URL firmada, purga | Patrón a copiar, **no** el bucket: el de la 470 retiene 60 min (`DESCARGA_RETENCION_MINUTOS`) y purga por listado de `tmp/`. |
| Permisos | `/configuracion` maestro-only (`lib/auth/menu-visibility.ts:545`); plantillas `ALLOWED_ROLES = {maestro}` | Se sigue el mismo patrón (R1, D1). |
| PDF | `jspdf` en `package.json` | Se usa para el informe de prueba y para el documento de ejemplo. |

## 1. Modelo de datos

Una migración de tablas + una de valores de enum de `job_tipo` + una de siembra (§1.6). Todas con
`down.sql`. Toda tabla nueva: **RLS habilitada sin policies** (solo service role), patrón `jobs` /
`geocode_cache`: guardan teléfonos y nombres.

### 1.1 `plantilla_mensaje` (columnas nuevas)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `informe_clave` | `text NULL` | `NULL` = plantilla de orden (lo de hoy). No nulo = clave de un informe del catálogo (validada en el service, no por FK: el catálogo vive en código). |
| `lleva_documento` | `boolean NOT NULL DEFAULT false` | `true` = la plantilla tiene cabecera DOCUMENT en Meta. |

CHECKs (en la migración): `NOT lleva_documento OR informe_clave IS NOT NULL` (R6, la mitad
estructural); `NOT plantilla_tienda OR informe_clave IS NULL` (una plantilla de tienda no sale por Meta).
La otra mitad de R6 (el informe no genera documento) y R7 (inmutables tras salir a Meta) van en el
service, porque dependen del catálogo y del estado.

Efecto en lecturas existentes (R8): `listarEnviables`, `findEnviableById` cuando lo llama el chat,
`listarUsablesParaTexto` y `marcarWelcomeMessage` filtran / rechazan `informe_clave IS NOT NULL`. Para
el motor se añade `findEnviableDeInformeById(id, informeClave)`.

### 1.2 `whatsapp_envio`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `nombre` | `text NOT NULL` | Único entre no borrados: índice único parcial `WHERE deleted_at IS NULL`. |
| `informe_clave` | `text NOT NULL` | |
| `plantilla_id` | `uuid NOT NULL` FK → `plantilla_mensaje(id)` `ON DELETE RESTRICT` | La plantilla tiene soft delete; el RESTRICT solo protege de un borrado físico. |
| `parametros` | `jsonb NOT NULL DEFAULT '{}'` | Validado con el esquema zod del informe al guardar y al ejecutar. |
| `disparo` | enum `whatsapp_envio_disparo` (`hora_fija`, `evento`) | |
| `dias_semana` | `smallint[] NULL` | ISO 1 = lunes … 7 = domingo, sin repetidos. |
| `hora` | `text NULL` | `HH:mm` 24 h, hora de pared CR. Texto y no `time` para no arrastrar zonas horarias. |
| `evento_clave` | `text NULL` | Un valor de `NotificacionEvento` declarado DISPONIBLE en §2.2 (validado en el service; texto y no el enum de Postgres para no atar esta tabla a las migraciones del enum de la campana). |
| `activo` | `boolean NOT NULL DEFAULT false` | R15: nace apagado. |
| `created_by`, `updated_by` | `uuid NULL` FK → `usuario` `ON DELETE SET NULL` | |
| `created_at`, `updated_at`, `deleted_at` | `timestamptz` | Soft delete (R21). |

CHECK de forma del disparo: `hora_fija` ⇒ `dias_semana` no vacío, `hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
`evento_clave IS NULL`; `evento` ⇒ `evento_clave IS NOT NULL`, `dias_semana IS NULL`, `hora IS NULL`.
Índice parcial `(evento_clave) WHERE activo AND deleted_at IS NULL AND disparo = 'evento'`: es la ÚNICA
consulta que el puente hace en el camino del aviso (§4.2) y tiene que ser un index scan.

### 1.3 `whatsapp_envio_destinatario`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `envio_id` | FK → `whatsapp_envio` `ON DELETE CASCADE` | |
| `rol` | `rol_value NULL` | |
| `usuario_id` | `uuid NULL` FK → `usuario` `ON DELETE CASCADE` | |

CHECK: exactamente uno de `rol` / `usuario_id`. Únicos parciales `(envio_id, rol) WHERE rol IS NOT NULL`
y `(envio_id, usuario_id) WHERE usuario_id IS NOT NULL`. Los roles permitidos (R16: `maestro`, `admin`,
`adminSatelite`, `adminTienda`, `mensajero`) se validan en el service: es política, no forma.

### 1.4 `whatsapp_envio_ejecucion`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `envio_id` | FK → `whatsapp_envio` `ON DELETE RESTRICT` | El envío nunca se borra físicamente (R21). |
| `origen` | enum `whatsapp_envio_origen` (`programado`, `evento`, `prueba`) | |
| `fecha_cr` | `date NULL` | Solo `programado`. |
| `instante_programado` | `timestamptz NULL` | Solo `programado`. |
| `evento_clave`, `evento_referencia` | `text NULL` | Solo `evento`. `evento_referencia` = `entidad_id` del aviso (§4.2). |
| `evento_datos` | `jsonb NULL` | **Enmienda.** Solo `evento`: la foto del aviso tomada al crearlo (`{ texto, rolFila, creadoAt }`, §2.3). Sin anexo ni PII (R51). |
| `notificacion_id` | `uuid NULL` | **Enmienda.** Solo `evento`: la fila de `notificacion` que disparó el puente. Trazabilidad, SIN FK: la referencia de la campana ya es polimórfica sin FK (`schema.prisma:3410`) y no se quiere atar el historial de envíos a la vida de esa tabla. |
| `solicitada_por` | `uuid NULL` FK → `usuario` `ON DELETE SET NULL` | Solo `prueba`. |
| `estado` | enum `whatsapp_ejecucion_estado` (`pendiente`, `generando`, `enviando`, `completada`, `vacia`, `sin_destinatarios`, `omitida`, `error`) | |
| `motivo` | `text NULL` | Siempre saneado (§6.3), máx. 500. |
| `plantilla_id`, `plantilla_nombre` | snapshot | Lo que se usó, aunque luego cambie el envío. |
| `parametros` | `jsonb NULL` | Snapshot. |
| `valores` | `jsonb NULL` | Valores de variables FIJADOS (R35). No incluye `destinatario_nombre`, que es por entrega (§2.4). |
| `pdf_ruta`, `pdf_nombre` | `text NULL` | Ruta en el bucket; nombre que ve el destinatario. |
| `pdf_bytes` | `int NULL` | |
| `pdf_caduca_at`, `pdf_purgado_at` | `timestamptz NULL` | R44. |
| `media_id` | `text NULL` | `media_id` de Meta del PDF; uno por ejecución (R33). |
| `created_at`, `updated_at`, `terminada_at` | `timestamptz` | |

**Las dos claves de idempotencia de ejecución** (índices únicos parciales, a mano en la migración; Prisma
no los expresa, mismo caso que `jobs.dedupe_key`):

- `whatsapp_envio_ejecucion_programado_key` `UNIQUE (envio_id, fecha_cr) WHERE origen = 'programado'` (R23).
- `whatsapp_envio_ejecucion_evento_key` `UNIQUE (envio_id, evento_clave, evento_referencia) WHERE origen = 'evento'` (R27).

Las pruebas no tienen único (R23: no consumen el cupo). Índices de lectura: `(created_at DESC)`,
`(envio_id, created_at DESC)` (historial, R42), `(pdf_caduca_at) WHERE pdf_ruta IS NOT NULL AND
pdf_purgado_at IS NULL` (purga, R44), `(solicitada_por, envio_id, created_at DESC) WHERE origen = 'prueba'`
(R41).

### 1.5 `whatsapp_envio_entrega`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `ejecucion_id` | FK → `whatsapp_envio_ejecucion` `ON DELETE CASCADE` | |
| `usuario_id` | `uuid NULL` FK → `usuario` `ON DELETE SET NULL` | |
| `destinatario_nombre` | `text NOT NULL` | Snapshot de `usuario.nombre`. Es también el valor de la variable común `destinatario_nombre` (R53): un reintento usa este snapshot, no relee al usuario (R35). |
| `telefono` | `text NOT NULL` | Normalizado, snapshot. Nunca sale completo de la capa de datos hacia la UI (R42/R45). |
| `estado` | enum `whatsapp_entrega_estado` (`pendiente`, `en_curso`, `aceptada`, `enviada`, `entregada`, `leida`, `rechazada`, `fallida`, `telefono_invalido`) | |
| `motivo` | `text NULL` | Saneado. |
| `codigo_meta` | `int NULL` | |
| `wa_message_id` | `text NULL` | Único parcial `WHERE wa_message_id IS NOT NULL` (webhook, R38). |
| `intentos` | `int NOT NULL DEFAULT 0` | |
| `created_at`, `updated_at`, `enviada_at` | `timestamptz` | |

**Clave de idempotencia de entrega:** `UNIQUE (ejecucion_id, usuario_id)` (R23/R27). Junto con el único
de ejecución da exactamente «un mensaje por (día CR, destinatario, envío)». Es por **usuario**, no por
teléfono: la app admite teléfonos repetidos entre cuentas; R17 lo avisa.

### 1.6 `job_tipo` y siembra

Valores nuevos (una sola migración de `ALTER TYPE … ADD VALUE IF NOT EXISTS`; se pueden añadir varios en
la misma transacción, lo prohibido es USARLOS en ella):

- `whatsapp_envio_programado` — payload `{ envioId, fechaCr, hora }`. Una ocurrencia a hora fija.
- `whatsapp_envio_evento` — **enmienda.** Payload `{ evento, referencia, notificacionId, datos }`. UN
  trabajo por aviso puenteado (§4.2); su handler crea las ejecuciones.
- `whatsapp_envio_ejecucion` — payload `{ ejecucionId }`. Ejecuta una ejecución ya creada (evento).
- `whatsapp_envio_reintento` — payload `{ entregaId }`. Reintenta una entrega con fallo transitorio.
- `whatsapp_envio_mantenimiento` — payload `{}`. RECURRENTE diario 03:30 CR (09:30 UTC): purga PDFs
  caducados y re-siembra cadenas rotas (R25/R44).

`down.sql` de la migración de enum: recrear el tipo con la lista de `origin/dev` en el momento de
implementar, siguiendo `20260923120000_job_tipo_webhook_evento/down.sql` al pie de la letra (incluido el
`DROP/CREATE` del índice parcial de la 401 y el aviso «LA LISTA ES UNA FOTO»). Los `down.sql` previos NO
se tocan.

**Siembra del mantenimiento en migración, no en script** (lección: una siembra por script es un paso que
alguien olvida). Migración aparte, posterior a la del enum:
`INSERT INTO jobs (id, tipo, payload, max_intentos, run_after, dedupe_key) VALUES (gen_random_uuid(),
'whatsapp_envio_mantenimiento', '{}', 3, <próximo 09:30 UTC>, 'whatsapp_envio_mantenimiento:<fecha>')
ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`. Su `down.sql` borra las filas de ese
tipo.

## 2. Contrato de un informe

Vive en `lib/whatsapp-envios/informes/` (módulo puro salvo `generar`, que recibe sus lectores por
dependencias). Registro único: `lib/whatsapp-envios/informes/catalogo.ts` exporta
`INFORMES_WHATSAPP: ReadonlyMap<string, InformeWhatsapp<unknown>>`.

```ts
interface VariableInforme { clave: string; nombre: string; descripcion: string; ejemplo: string }

type DescriptorParametro =                       // lo que la pantalla sabe pintar
  | { campo: string; etiqueta: string; tipo: "entero" | "decimal"; min?: number; max?: number; ayuda?: string }
  | { campo: string; etiqueta: string; tipo: "booleano"; ayuda?: string }
  | { campo: string; etiqueta: string; tipo: "texto"; ayuda?: string }
  | { campo: string; etiqueta: string; tipo: "seleccion" | "seleccion_multiple";
      opciones: { origen: "fija"; valores: { valor: string; etiqueta: string }[] }
              | { origen: "catalogo"; catalogo: "zonas" | "estados_orden" | "tiendas" }; ayuda?: string }
  | { campo: string; etiqueta: string; tipo: "tabla"; columnas: DescriptorParametro[]; ayuda?: string };

type ResultadoInforme =
  | { tipo: "vacio"; motivo: string }                                   // R31
  | { tipo: "contenido"; valores: Record<string, string>;              // una entrada por variable declarada
      documento?: { bytes: Uint8Array; nombreArchivo: string } };       // obligatorio si se pidió (R33)

interface DatosAviso {                           // §2.3 — foto del aviso, sin anexo ni PII (R51)
  texto: string;                                 // `notificacion.descripcion` de la fila que disparó
  rolFila: RolValue;                             // rol de esa fila (decide el atajo del enlace)
  creadoAt: string;                              // ISO del instante del aviso
}

interface ContextoInforme<P> {
  parametros: P;
  ahora: Date;
  conDocumento: boolean;                         // la plantilla lleva cabecera documento
  evento?: { clave: NotificacionEvento; referencia: string; datos: DatosAviso }; // solo origen `evento`
  eventoDePrueba?: NotificacionEvento;           // solo «Probar ahora» de un envío por evento (R52)
}

interface InformeWhatsapp<P> {
  clave: string;                                 // [a-z0-9_]+
  nombre: string;
  descripcion: string;
  parametros: z.ZodType<P>;
  parametrosPorDefecto: P;                       // R13
  descriptores: DescriptorParametro[];           // formulario de la pantalla
  variables: VariableInforme[];                  // R4/R46: catálogo de variables del informe
  generaDocumento: boolean;                      // R6
  eventos: readonly NotificacionEvento[];        // eventos DISPONIBLES (§2.2) que ofrece (R14)
  generar(ctx: ContextoInforme<P>): Promise<ResultadoInforme>;
}
```

Reglas del contrato (las verifica el motor, no la buena fe del informe):

- `valores` debe traer TODAS las claves que usa la plantilla, salvo las comunes (§2.4), y cada una no
  vacía tras sanear; si no, la ejecución acaba en `error` nombrando la variable (R32). Una variable = un
  dato: el informe NO arma frases (la referencia externa metía una frase entera en un parámetro; aquí el
  texto vive en la plantilla aprobada).
- `conDocumento: true` y sin `documento` ⇒ `error` («el informe no generó el PDF»).
- «Vacío» lo decide el informe (la 475 tiene su parámetro «enviar si vacío», que en la maqueta es el
  interruptor «Enviar aunque no haya nada que informar»); el motor solo obedece.
- Los parámetros se re-validan al ejecutar (R34): si el esquema del informe cambia y deja inválido un
  envío guardado, la ejecución sale `error` con «revisa los parámetros del envío», nunca un envío con
  datos por defecto silenciosos.
- Los descriptores `catalogo` (`zonas`, `estados_orden`, `tiendas`) los resuelve la pantalla con
  lectores existentes; 475 usa `tabla` + `zonas` para «plazo y aviso por zona» (por `zona_id`, no texto).
  Si 475/476 necesitan un tipo de descriptor más, lo añaden ellas al renderizador.
- `eventos` solo puede contener eventos DISPONIBLES de §2.2: lo afirma el test del catálogo (R46/R49).

### 2.1 Informe «Prueba de envío» (R47)

Clave `prueba_envio`. Parámetros `{ simularVacio: boolean }` (por defecto `false`). Variables `fecha`
(«05/10/2026») y `hora` («05:00»), ambas CR del `ahora` del contexto. `generaDocumento: true`: PDF de una
página con jspdf («Prueba de envío automático — <fecha> <hora>»), nombre `prueba-<fecha>.pdf`.
`eventos: []`. Sirve para verificar en producción la cadena completa (plantilla con documento aprobada →
Probar ahora) antes de 475/476, y la rama «vacío».

### 2.2 Catálogo de eventos: los avisos internos (R49, D4)

`lib/whatsapp-envios/eventos.ts` exporta `EVENTOS_ENVIO_WHATSAPP`, un objeto que `satisfies
Record<NotificacionEvento, PerfilEventoEnvio>` con

```ts
type PerfilEventoEnvio =
  | { readonly disponible: true; readonly nombre: string; readonly descripcion: string;
      readonly ejemploTexto: string }                    // R52: lo que usa «Probar ahora»
  | { readonly disponible: false; readonly porQue: string };
```

Mismo mecanismo que `PUSH_ELEGIBLE` (`push-elegibles.ts:225`) y `CATALOGO_AVISOS`: un valor nuevo del
enum de la campana **no compila** hasta que alguien decida si se puede usar como disparo (R49). Sin
`default`, sin `Partial`. `ejemploTexto` es la constante o el resultado del texto REAL del emisor
(`TEXTO_CIERRE_POR_APROBAR`, `textoGeocodificacionCaida(3)`…) importado de `emitir.ts`, no una copia:
si el texto del aviso cambia, el ejemplo cambia con él.

**La regla que decide qué fila dispara**, y de la que salen casi todos los «no»: el puente solo mira
filas dirigidas a un **ROL SIN ALCANCE** (`destinatario.tipo === "rol"`, sin `tiendaId` ni `zonaId`).
Son las de la administración central, y su texto está escrito en tercera persona para quien coordina.
Una fila dirigida a un usuario dice «Tu cierre…», «Una orden tuya…»: reenviada a la lista de un envío
le hablaría a quien no es su dueño. Una fila acotada a una tienda o zona no nombra su ámbito en el
texto: «La más antigua lleva 3 días» no dice de qué tienda.

| Evento (`NotificacionEvento`) | ¿Disponible? | Nombre en la pantalla / motivo |
| --- | --- | --- |
| `postulacion_mensajero_pendiente` | Sí | «Postulación de mensajero pendiente» |
| `postulacion_recurso_pendiente` | Sí | «Ofrecieron un vehículo o una bodega» |
| `cierre_dia_por_aprobar` | Sí | «Cierre del día por aprobar» (uno por cierre) |
| `cierre_dia_vencido` | Sí | «Cierre del día vencido sin enviar» (dispara la fila de bodega, no la del mensajero) |
| `mensajero_bloqueado_por_cierres` | Sí | «Mensajero bloqueado por cierres sin aprobar» |
| `gasto_fijo_cobro_pendiente` | Sí | «Cobros de gasto fijo por aprobar» (uno por día CR) |
| `webhook_suscripcion_pausada` | Sí | «Un webhook lleva fallando» (uno por racha) |
| `geocodificacion_caida` | Sí | «El servicio de mapas rechaza las peticiones» (uno por día CR) |
| `devoluciones_represadas` | Sí | «Devoluciones represadas en bodega» (solo el ámbito global, uno por día CR) |
| `reprogramadas_esperan_cierre` | Sí | «Paquetes reprogramados para hoy retenidos por un cierre» (solo el ámbito central, uno por día CR). Nunca «reprogramadas»: lo vigila la guardia `nombres-estado-retirados`. |
| `orden_rechazada` | No | Se crea DENTRO de la transacción del registro de la gestión (`GestionOrdenRepository.ts:795`), con un repositorio propio que no pasa por `repoReal()`. Puentearlo ahí ataría el registro de la gestión al puente: un error de sentencia abortaría la transacción entera (R50). Además es uno por orden. |
| `carga_masiva_terminada` | No | Aviso personal al que lanzó la carga; no tiene fila de rol. |
| `dia_reparto_corregido` | No | Aviso personal en segunda persona al mensajero; no tiene fila de rol. |
| `cierre_dia_rechazado` | No | Aviso personal en segunda persona al mensajero; no tiene fila de rol. |
| `reparto_manana` | No | Aviso personal al mensajero; no tiene fila de rol y su cifra solo existe al leer. |
| `traspaso_ordenes_recibido` | No | Aviso personal al mensajero; no tiene fila de rol. |
| `traspaso_ordenes_cedido` | No | Aviso personal al mensajero; no tiene fila de rol. |
| `novedades_sin_gestionar` | No | Solo existe acotado a una tienda (`adminTienda` + `tiendaId`) y su texto no la nombra: sería un mensaje por tienda y por día sin decir de cuál. |

Diez disponibles, ocho no. El nombre visible NUNCA usa la sigla «SLA» (memoria del repo) ni el plural
femenino del estado retirado.

### 2.3 Informe «Aviso de la app» (R51)

Clave `aviso_interno`. Parámetros `{}` (sin descriptores). `generaDocumento: false` (R6 impide marcar
«lleva documento» en sus plantillas). `eventos`: los diez disponibles de §2.2. Variables:

| Clave | Nombre | Valor |
| --- | --- | --- |
| `titulo` | Qué pasó | `EVENTOS_ENVIO_WHATSAPP[evento].nombre`. |
| `texto` | Texto del aviso | `datos.texto`: la `descripcion` persistida de la fila que disparó, que es el título de la tarjeta de la campana (`presentacionDe` sin cifra viva devuelve `titulo = descripcion`, `presentacion-aviso.ts:107`). Ya está libre de dirección, teléfono y monto por la regla de `emitir.ts` §4.6. |
| `enlace` | Enlace a la app | `<base>` + `accionDeAviso(evento, datos.rolFila).atajo.href`, o `<base>` + `/` si el aviso no tiene atajo (hoy solo `geocodificacion_caida`) o es informativo. `<base>` = `NEXT_PUBLIC_APP_URL` y, si falta, `NEXT_PUBLIC_SITE_URL`, sin barra final. Sin ninguna de las dos, el valor queda vacío y la ejecución sale `error` nombrando `enlace` (R32): visible en el historial, no un enlace roto. |
| `fecha`, `hora` | Fecha / Hora del aviso | `datos.creadoAt` en calendario CR («05/10/2026», «05:00»). |

**Lo que NO lleva (R51), y no por olvido:** el `anexo`. En los avisos disponibles el anexo es el nombre
del postulante o del mensajero (`emitirPostulacionPendiente`, `emitirCierreDiaPorAprobar`): en la campana
lo protege la autorización por rol, y un envío puede ir a cualquier rol permitido, incluidos
`mensajero` y `adminTienda`. Se excluye por construcción: `DatosAviso` no tiene el campo.

`generar(ctx)`: con `ctx.evento` compone los cinco valores; con `ctx.eventoDePrueba` (R52) usa
`nombre` y `ejemploTexto` del catálogo y `fecha`/`hora`/`enlace` del momento; sin ninguno de los dos
(un envío de hora fija con este informe) → `vacio` con «este informe solo funciona por evento» (el
service ya lo impide al guardar, esto es el cinturón).

### 2.4 Variable común `destinatario_nombre` (R53)

La maqueta aprobada (`Formulario.dc.html`, «De dónde sale cada dato», `{{1}}` = «Nombre del
destinatario») la usa. Es la única variable POR ENTREGA: `catalogoDeVariables(informeClave)` la añade a
la de todo informe; el motor la rellena con `entrega.destinatario_nombre` (snapshot de `usuario.nombre`)
al construir los componentes de cada envío, y en «Probar ahora» con el nombre de quien pulsa. Un
`usuario.nombre` que quede vacío tras sanear hace `error` en ESA entrega con motivo «el destinatario no
tiene nombre» (no la ejecución entera). Ningún informe puede declarar una variable con esa clave (R46).

## 3. Plantillas: cambios en la 107

- `crearPlantillaSchema`/`actualizarPlantillaSchema`: campos opcionales `informeClave` (string que exista
  en el catálogo) y `llevaDocumento` (boolean).
- `PlantillaMensajeService.crear/actualizar`: valida R6 (informe sin documento) y R7 (inmutables si
  `templateId !== null || estado !== 'saved_not_aprobation'`) → `validation_error` por campo.
- `cambiarEstado` (a `inactivo`) y `eliminar`: consultan `IWhatsappEnvioRepository.nombresEncendidosConPlantilla(id)`;
  si hay alguno → nuevo resultado `en_uso` con los nombres (R10). Inyectado como dependencia opcional para
  no romper los tests existentes; el composition root (`buildPlantillaService`) DEBE pasarlo (test estático).
- `marcarMensajeBienvenida`: `informe_clave` no nulo → `no_aplica` (R8).
- `enviarAprobacion` con `llevaDocumento` (**enmienda D2**): pide el ID de la app a
  `ResolutorAppIdMeta` (§5.2.1). Si responde `no_resuelto` o falta la credencial → nuevo resultado
  `documento_no_disponible` con `{ mensaje, codigo? }` y SIN tocar el estado (R9). Texto fijo:
  «No se pudo identificar la app de Meta con el token de WhatsApp configurado (código N). Las plantillas
  con documento no se pueden enviar a aprobación hasta resolverlo; el resto sigue funcionando.» Con
  credencial ausente: «Falta configurar WhatsApp (falta WHATSAPP_CLOUD_TOKEN)», nombre de variable,
  nunca valor. El service y el resolutor se componen en `buildPlantillaService` (test estático, como R10).
- Acción nueva `estadoAppMeta()` (maestro) → `{ estado: "identificada" } | { estado: "no_identificada",
  mensaje }`. La pantalla de plantillas la llama al activar «Lleva documento adjunto» y, si no está
  identificada, pinta el mensaje bajo el interruptor (R48). No muestra el ID ni el token.
- Pantalla de plantillas: en el formulario, selector «Tipo: de orden / de informe <informe>» y switch
  «Lleva documento adjunto» (deshabilitado si el informe no genera documento o si R7 aplica). El
  `CampoVariablePicker` recibe el catálogo según el tipo; `clavesSinCampo` usa ese mismo catálogo (R4).
  Una plantilla de informe no ofrece «Plantilla de tienda» ni «Marcar bienvenida».

Convivencia de catálogos (decisión): `CAMPOS_PLANTILLA` NO se toca. Una función pura
`catalogoDeVariables(informeClave: string | null)` devuelve `{ clave, nombre, descripcion, ejemplo }[]`
desde `CAMPOS_PLANTILLA_OFRECIDOS` (null) o desde `informe.variables` + las comunes (§2.4). La vista
previa, el picker, la detección de claves desconocidas y los ejemplos que viajan a Meta leen de ahí.

## 4. Motor

### 4.1 Programación a hora fija: una cadena de jobs por envío

Función pura `proximaOcurrencia(dias, hora, desde: Date): { fechaCr, instante }` — el primer instante
CR estrictamente posterior a `desde` cuyo día ISO está en `dias`. CR es UTC−6 fijo.

- **Encender** o **guardar un envío encendido** (R20) → `enqueue('whatsapp_envio_programado',
  { envioId, fechaCr, hora }, { runAfter: instante, dedupeKey: 'wa_envio:<envioId>:<fechaCr>:<hora>',
  maxIntentos: 3 })`. Con `desde = now`, una hora ya pasada hoy cae en la próxima ocurrencia: no hay
  «recuperación» de lo pasado (R20).
- La hora va en la `dedupeKey` a propósito: con solo `envioId:fechaCr`, cambiar hoy de 12:00 a 15:00
  chocaría con el job de las 12:00 (`ON CONFLICT DO NOTHING`) y el de las 15:00 no existiría nunca.

Handler `whatsapp_envio_programado` (orden importa):

1. Lee el envío (incluidos borrados). Borrado, apagado o ya no `hora_fija` → termina sin hacer nada (R19/R21).
2. **Encola la siguiente ocurrencia ANTES de ejecutar** (desde `max(now, instante de este job)`), así un
   fallo terminal de esta ocurrencia no rompe la cadena.
3. Si `(fechaCr, hora)` del payload ya no coincide con la programación vigente (editada) → termina (job
   obsoleto; la ocurrencia válida tiene su propio job).
4. Si `now > instante + VENTANA` (`WHATSAPP_ENVIOS_VENTANA_MINUTOS`, 60) → inserta ejecución `omitida`
   con «la cola arrancó N min tarde» (`ON CONFLICT DO NOTHING`) y termina (R24).
5. `INSERT … ON CONFLICT DO NOTHING` de la ejecución `programado (envioId, fechaCr)`; relee la fila y llama
   a `EjecucionEnvioService.ejecutar(ejecucionId)`. Dos jobs concurrentes del mismo día acaban en la
   MISMA fila (R23).

Por qué no un planificador que barra cada minuto: ver Alternativa A en §9. El cron de Vercel por minuto
ya existe; el job se reclama en el drenado siguiente a su `runAfter` (R22: ≤ 2 min).

Red de seguridad (R25): el job diario de mantenimiento recorre los envíos encendidos `hora_fija` y, para
cada uno sin job `whatsapp_envio_programado` pendiente (`estado = 'pending' AND payload->>'envioId' = $1`),
encola su próxima ocurrencia. La pantalla muestra «Próximo envío: <fecha hora CR>» leyendo ese mismo job,
o el aviso «Sin próxima ejecución programada» con botón «Reprogramar» (misma acción que guardar).

### 4.2 Disparo por evento: el puente con los avisos internos (R26, R27, R50; reescrito por D4)

**Dónde se engancha.** Un decorador `conEnviosWhatsapp(base, deps): INotificacionRepository` en
`lib/notificaciones/notificacion-repo-con-envios-whatsapp.ts`, molde exacto de `conPushWeb`, cableado en
el MISMO sitio: `repoReal()` de `notificadores.ts` pasa a devolver

```ts
conEnviosWhatsapp(
  conPushWeb(new NotificacionRepository(prisma), { … como hoy … }),
  { envios: new WhatsappEnvioRepository(prisma), cola: new JobRepository(prisma) },
)
```

Como los diecisiete bindings `notificar<X>Real` resuelven su repositorio por `repoReal()`, TODOS los
productores quedan puenteados de una vez y uno nuevo lo hereda sin acordarse de nada. Es la lección de
la 410 (dos de siete notificadores muertos con la suite verde cuando cada productor tenía que inyectar
el suyo, `notificacion-repo-con-push.ts:7`), y se aplica igual (Alternativa H en §9).

**`crear(input, tx)` del decorador, en este orden:**

1. `id = await base.crear(input, tx)`. Si `id === null` (la dedupe de la campana lo absorbió) → devuelve
   `null` y NO HACE NADA MÁS: el WhatsApp sigue la suerte del aviso (R50).
2. `tx !== undefined` → devuelve `id` sin una sola consulta (R50). Hoy solo `orden_rechazada` llega con
   `tx`, y además no está disponible.
3. **Puerta barata, sin consultas** (R50): el evento no está disponible en §2.2, o la fila no va a un rol
   sin alcance, o `input.entidadId === null` → devuelve `id`.
4. Dentro de `emitirBestEffort("envios_whatsapp_evento", …)` (un fallo queda en el log con su causa y
   NUNCA se propaga, R50):
   a. `envios.hayEncendidosConEvento(evento)` — `SELECT 1 … LIMIT 1` sobre el índice parcial de §1.2.
      `false` → fin: **cero escrituras** con todos los envíos apagados (R26).
   b. `cola.enqueue("whatsapp_envio_evento", { evento, referencia: entidadId, notificacionId: id,
      datos: { texto: input.descripcion, rolFila: input.destinatario.rol, creadoAt: now.toISOString() } },
      { dedupeKey: "wa_envio_evento:<evento>:<entidadId>", maxIntentos: 3 })`.
5. Devuelve `id`.

Coste en el camino del aviso: con envíos apagados, una consulta indexada; con alguno encendido, una
consulta y un `INSERT` en `jobs`. Nada de Meta, ni de destinatarios, ni de informes (R50: «ni
ralentizar»). Se `await`ea dentro del best-effort y NO se deja como promesa suelta: en Vercel la función
se congela al responder y una promesa sin esperar se perdería sin rastro, que es la familia de fallos
mudos de este repo.

**La referencia de idempotencia es la ENTIDAD del aviso, no el id de la notificación** (Alternativa J,
§9). Medido en `emitir.ts`: cada emisión crea UNA fila por destinatario con el MISMO `(evento,
entidad_id)` — `geocodificacion_caida` crea dos (`maestro`, `admin`) por jornada, `cierre_dia_por_aprobar`
dos o tres por cierre. Con el id de la notificación cada fila sería un hecho distinto y saldrían dos
WhatsApp por un aviso. Con `entidad_id`:
- las filas hermanas de una emisión → misma `dedupeKey` → UN trabajo (R26: «exactamente uno»);
- los avisos de cadencia diaria ya llevan el día en la entidad (`gasto_fijo_cobro_pendiente`,
  `geocodificacion_caida` = `YYYY-MM-DD`; `devoluciones_represadas` = `global:YYYY-MM-DD`;
  `reprogramadas_esperan_cierre` = `central:YYYY-MM-DD`), así que «una vez por jornada y por rol» se
  convierte en un WhatsApp por jornada, y el drenador que reevalúa cada minuto no produce más;
- `webhook_suscripcion_pausada` lleva la racha (`<owner>:<sinExitoDesde>`): uno por racha;
- los de cierre llevan el `cierreId`: uno por cierre.

La `dedupeKey` del job es la primera red; la que manda es el único `(envio_id, evento_clave,
evento_referencia)` de §1.4 (Alternativa D).

**Handler `whatsapp_envio_evento`:** lee los envíos encendidos con ese evento EN ESE MOMENTO (R19: uno
apagado entre el aviso y el drenado no envía); por cada uno, `INSERT` de la ejecución `evento` con
`evento_clave`, `evento_referencia`, `evento_datos`, `notificacion_id` y `ON CONFLICT DO NOTHING` (R27);
solo si la insertó, encola `whatsapp_envio_ejecucion { ejecucionId }` con `dedupeKey
'wa_envio_ejecucion:<ejecucionId>'`. Ejecutar en un job por ejecución y no en línea aísla un envío con
50 destinatarios de los demás del lote del drenador.

**Prueba del cableado, no solo del import** (memoria «el composition root que no inyecta»): (a) guardia
estática `tests/unit/guards/envios-whatsapp-cableado.guardia.test.ts` que afirma que `repoReal()`
envuelve con `conEnviosWhatsapp` y que ningún binding de producción construye su repositorio por su
cuenta (amplía la de push, no la sustituye); (b) test de integración que emite por el binding REAL de
producción (`notificarGeocodificacionCaidaReal`) contra Postgres y cuenta filas de `jobs`: con un envío
encendido con ese evento, exactamente una; apagado, ninguna. Si alguien quita el decorador de
`repoReal()`, (b) se pone rojo aunque (a) se olvide.

### 4.3 `EjecucionEnvioService.ejecutar(ejecucionId, opciones?)`

Service puro (repos, almacén, cliente Meta, subidor, catálogo y reloj por constructor). Pasos:

1. Estado terminal (`completada`, `vacia`, `sin_destinatarios`, `omitida`, `error` definitivo) → nada.
2. Paso a `generando`. Re-valida plantilla (vigente, `activo`, `templateId`, mismo informe) y parámetros
   (R34). Fallo → `error` con motivo accionable, sin lanzar (no hay nada que reintentar).
3. Destinatarios: prueba → solo `solicitada_por`; resto → `IWhatsappEnvioRepository.resolverDestinatarios(envioId)`
   (R28: unión roles ∪ usuarios, `estado = 'activo'`, roles permitidos, dedup por `usuario.id`, orden
   estable por nombre). Cero → `sin_destinatarios` (R30) SIN generar el informe.
4. Contenido: si `valores` ya está fijado (reintento) se reutiliza junto con el PDF guardado (R35). Si no,
   `informe.generar(...)` con `evento` (origen `evento`, desde `evento_datos`) o `eventoDePrueba` (prueba
   de un envío por evento, R52). `vacio` → `vacia` + motivo (R31). `contenido` → valida y sanea (R32,
   §6.2); guarda PDF (§5.3), fija `valores`, `pdf_*` en la misma escritura.
5. PDF a Meta: si `lleva_documento` y no hay `media_id`, `subir()` una vez; `rechazado` → `error`;
   `error` (red/5xx) → lanza (la cola reintenta el job; el PDF ya guardado se reutiliza).
6. Entregas: `INSERT … ON CONFLICT (ejecucion_id, usuario_id) DO NOTHING` por destinatario con el
   snapshot de nombre y teléfono; teléfono inválido → `telefono_invalido` (R29).
7. Por cada entrega `pendiente`: **reclamo** `UPDATE … SET estado = 'en_curso' WHERE id = $1 AND estado =
   'pendiente'` (si no afecta fila, otra ejecución la tiene: se salta). Componentes = `valores` fijados +
   `destinatario_nombre` de ESA entrega (§2.4). Llamada a
   `enviarPlantilla(telefono, plantilla.nombre, idioma, componentes)`:
   - `ok` → `aceptada`, `wa_message_id`, `enviada_at` (R36).
   - `permanente` → `rechazada`, `codigo_meta`, motivo saneado.
   - `transitorio` → vuelve a `pendiente` y encola `whatsapp_envio_reintento { entregaId }`
     (`dedupeKey 'wa_envio_reintento:<entregaId>'`, `maxIntentos 5`).
   - excepción del cliente (respuesta 2xx con forma rara) → la entrega queda `en_curso` = «resultado
     desconocido» (R37). **Nunca se reenvía**: preferimos perder uno a duplicarlo, que era el fallo del
     sistema de referencia.
8. Ejecución → `completada` (`terminada_at`). Los reintentos pendientes no la reabren; el historial
   cuenta entregas por estado.

Handler `whatsapp_envio_reintento`: reclama la entrega igual que el paso 7; `transitorio` → la devuelve a
`pendiente` y **lanza** (backoff de la cola); si `job.intentos >= job.maxIntentos` → `fallida` con el
último motivo y no lanza (R36). Reutiliza `media_id`, `valores` y `destinatario_nombre` del snapshot.

Tope de 50 destinatarios (R16): el envío secuencial (timeout 10 s por llamada) cabe en una corrida del
drenador; un envío más grande pediría trocear el fan-out en jobs, que hoy no hace falta.

### 4.4 Probar ahora (R39–R41, R52)

Server action `probarEnvioWhatsapp(envioId)`: maestro (R1); rechaza si hay una prueba del mismo
`(solicitada_por, envio_id)` con `created_at > now − 30 s` (R41, consulta sobre el índice §1.4); valida
el teléfono del actor (R40) antes de crear nada; crea la ejecución `prueba` y llama a `ejecutar` EN LÍNEA
con destinatario único. Si el envío es por evento, pasa `eventoDePrueba = evento_clave` (R52): no hay
aviso real que puentear y no se inventa uno. Devuelve `{ estado, motivo?, entrega? }`. Usa la
configuración GUARDADA; la UI avisa si hay cambios sin guardar. Funciona apagado.

## 5. Integración con Meta

### 5.1 Componentes

- `construirComponentsTemplate(cuerpo, variables, opts?: { ejemplos?: (clave) => string; documento?: { headerHandle: string } })`:
  con `documento`, antepone `{ type: "HEADER", format: "DOCUMENT", example: { header_handle: [handle] } }`.
  `ejemplos` sustituye a `EJEMPLOS_POR_CLAVE` para plantillas de informe. Sin `opts`, salida idéntica a hoy
  (test de no regresión con el literal actual).
- `construirComponentsEnvio(variables, valores, opts?: { documento?: { mediaId: string; nombreArchivo: string } })`:
  con `documento`, antepone `{ type: "header", parameters: [{ type: "document", document: { id, filename } }] }`.
  Sin `opts`, salida idéntica a hoy.
- `WhatsappTemplatePort.crearTemplate/actualizarTemplate` pasan `opts` según la plantilla (catálogo de
  ejemplos + handle). `TemplatePlantillaInput` gana `informeClave` y `llevaDocumento`.

### 5.2 Documento de ejemplo (subida reanudable)

Meta exige para una cabecera de media un `header_handle` obtenido con la Resumable Upload API, que cuelga
del ID de la app: `POST /{api}/{APP_ID}/uploads?file_name&file_length&file_type=application/pdf` →
`{ id: "upload:…" }`; `POST /{api}/{upload_id}` con `Authorization: OAuth <token>`, `file_offset: 0` y el
binario → `{ h: "<handle>" }`. Nuevo cliente `WhatsappSubidaReanudableClient` (mismo molde que
`WhatsappMediaUploadClient`: `fetch` inyectable, timeout, token solo en cabecera, desenlace tipado). El
PDF de ejemplo es fijo, generado con jspdf («Documento de ejemplo»). El `APP_ID` lo da §5.2.1. Verificar
contra la API real en el recorrido (T11.4): si Meta cambia el contrato, el fallo sale como
`WhatsappPlantillaError` con el código, no en silencio.

### 5.2.1 Identificador de la app, obtenido del token (R48, D2)

`ResolutorAppIdMeta` en `lib/clients/whatsapp-app-id.ts`:

```ts
type ResultadoAppId =
  | { ok: true; appId: string; origen: "env" | "meta" }
  | { ok: false; motivo: "sin_credencial" | "http" | "red" | "timeout" | "respuesta_invalida";
      codigo?: number };                         // código HTTP o de error de Meta; nunca el cuerpo crudo
resolver(): Promise<ResultadoAppId>
```

1. **Anulación**: `process.env.WHATSAPP_APP_ID` con valor no vacío (trim) → `{ ok: true, origen: "env" }`
   sin red.
2. **Caché de proceso**: si ya hay un `appId` resuelto en este proceso, se devuelve sin red. Solo se
   cachea el ÉXITO: un fallo transitorio no debe dejar la función rota hasta el siguiente arranque, y
   esta llamada es rara (abrir el formulario de una plantilla con documento, enviarla a aprobación).
3. **Consulta**: `loadWhatsappConfig()` (si lanza → `sin_credencial`, nombrando la variable en el
   mensaje de §3). `GET https://graph.facebook.com/<apiVersion>/app` — misma `GRAPH_BASE` y misma
   `apiVersion` (`WHATSAPP_API_VERSION`, por defecto `v21.0`) que el cliente actual — con
   `Authorization: Bearer <WHATSAPP_CLOUD_TOKEN>`, timeout 10 s. Graph devuelve la app dueña del token
   `{ id, … }`. `id` debe ser solo dígitos; si no → `respuesta_invalida`.
   - **El token va en la cabecera y no en `?access_token=`** como en el ejemplo del humano: Graph acepta
     las dos formas y la de la cabecera es la invariante 3 de `whatsapp-cloud.ts` (token nunca en URL,
     porque las URLs acaban en logs).
   - **No se implementa la alternativa `debug_token`**: exige el token como `input_token` en la query
     string, que rompe esa misma invariante. Si el recorrido real (T11.4) demuestra que `/app` no sirve
     para el tipo de token de producción, la salida es poner `WHATSAPP_APP_ID` (la anulación de 1) —
     y entonces sí haría falta que alguien copie el ID del panel de Meta—; no se debilita la invariante.

Nunca se loguea ni se devuelve el token ni el cuerpo de la respuesta; el log lleva operación, estado y
código. Quien lo consume: `PlantillaMensajeService.enviarAprobacion` (R9) y la acción `estadoAppMeta`
(R48). El envío de mensajes y el resto de la 107 NO dependen de él.

### 5.3 Almacén del PDF

`SupabaseAlmacenEnviosWhatsapp` clonando `SupabaseAlmacenDescargas`: bucket PRIVADO
`WHATSAPP_ENVIOS_BUCKET` (por defecto `whatsapp-envios`), creado en el primer uso; ruta
`<envioId>/<ejecucionId>.pdf`; `upload(..., { upsert: false })` (R43: nunca sobrescribe; la ruta es única
por ejecución); `firmar(ruta, 300)`; `borrar(rutas[])` que propaga el error del SDK. `pdf_caduca_at =
created_at + WHATSAPP_ENVIOS_RETENCION_DIAS` (30, decisión D3). La purga es **por base**, no por listado:
el handler de mantenimiento toma hasta 500 ejecuciones con `pdf_caduca_at < now AND pdf_purgado_at IS
NULL`, borra los objetos y marca `pdf_purgado_at` (R44). Así el historial sabe distinguir «caducado».

### 5.4 Estados del webhook (R38)

En `app/api/webhooks/whatsapp/route.ts`, DESPUÉS de `service.ingerirEventos(eventos)`, se llama a
`EntregaEstadoService.aplicar(eventos.statuses)` (inyectable en `WebhookDeps`). Por cada status:
`UPDATE whatsapp_envio_entrega SET estado = $nuevo, … WHERE wa_message_id = $1 AND rango(estado) <
rango($nuevo)` con `rango`: `aceptada` 1 < `enviada` 2 < `entregada` 3 < `leida` 4; `fallida` (desde
webhook) solo pisa 1–2. Un error de esta actualización se registra (sin PII) y NO cambia el 200 ni la
ingesta del chat. Los `wa_message_id` del chat y de las entregas no colisionan (son ids de Meta únicos).

## 6. Reglas puras (lib/whatsapp-envios/*.ts, sin red ni base)

### 6.1 `proximaOcurrencia` — §4.1.

### 6.2 Saneado de valores (R32)
`sanearValor(v)`: `\r\n|\r|\n|\t` → espacio; cualquier racha de espacios → uno; `trim`. Vacío tras sanear = faltante. (Meta rechaza parámetros con saltos de línea, tabuladores o más de
cuatro espacios seguidos.) Se aplica también a `texto` del aviso y a `destinatario_nombre`.

### 6.3 Motivo saneado (R45)
`motivoMeta(codigoMeta: number | null)`: diccionario fijo de los códigos frecuentes (131026 «el número no
tiene WhatsApp o no puede recibir», 131047 «fuera de la ventana de 24 h», 132000/132001 «la plantilla no
coincide o no existe en Meta», 132012 «el formato de los parámetros no coincide con la plantilla»,
131053 «Meta no pudo procesar el PDF», 130429/131056 «límite de envío de Meta», 131049 «Meta limitó la
entrega para no saturar al destinatario») y por defecto «Meta rechazó el envío (código N)». El `detalle`
crudo del cliente (que puede repetir datos de la petición) **no** se persiste ni se muestra; va al log
ya redactado por `chat-logger` como hoy.

### 6.4 Teléfono válido
`telefonoValido(raw)`: `n = normalizarTelefonoWa(raw)`; válido si `n` son solo dígitos, longitud 10–15
y, si empieza por `506`, longitud exactamente 11. `""`, 7 dígitos o un `506` truncado son inválidos.

### 6.5 Enmascarado
`enmascararTelefono(n)` → `•••• 7777`. Lo aplica el repositorio de lectura del historial: el teléfono
completo no sale de la capa de datos hacia la UI.

### 6.6 Puerta del puente (R50)
`filaPuenteable(input: CrearNotificacionInput): boolean` — pura: evento disponible en §2.2 ∧
`destinatario.tipo === "rol"` ∧ sin `tiendaId` ∧ sin `zonaId` ∧ `entidadId !== null`. La usa el paso 3
del decorador y su test recorre las 18 entradas.

## 7. Rutas, acciones y pantalla

- Página `app/(app)/configuracion/envios-whatsapp/page.tsx` (Server Component; `resolveActorFromSession`;
  no maestro → aviso «sin permiso», R1). Entrada de menú al FINAL de los hijos de «Configuración» (R2:
  `primerDestino` toma el primer hijo, así que el final no mueve el aterrizaje). En la maqueta aparece
  entre «Plantillas» y «Geografía»: si el orden real del menú lo permite sin mover el primer hijo, se
  sigue la maqueta; el test de R2 manda.
- Server actions en `lib/actions/envios-whatsapp.ts` (zod en el borde, patrón `lib/actions/plantillas.ts`):
  `listarEnvios`, `obtenerEnvio`, `crearEnvio`, `actualizarEnvio`, `encenderEnvio`, `apagarEnvio`,
  `borrarEnvio`, `previsualizarDestinatarios` (R17, no escribe), `listarEventosDisponibles` (R49: los
  diez de §2.2 con su nombre), `probarEnvioWhatsapp`, `listarEjecuciones`, `obtenerEjecucion`,
  `firmarPdfEjecucion` (R43; `caducado` si `pdf_purgado_at` no es nulo). En `lib/actions/plantillas.ts`,
  `estadoAppMeta` (R48). Ninguna ruta API nueva. Ningún cron nuevo en `vercel.json`.
- Service `WhatsappEnvioService` (CRUD + reglas R11–R21, `ALLOWED_ROLES = {maestro}`) y
  `EjecucionEnvioService` (§4.3). Repos `WhatsappEnvioRepository`, `WhatsappEjecucionRepository`.
  Interfaces en `lib/interfaces/{services,repositories,external}/`.

**UI: la maqueta APROBADA de `design-whatsapp/` es la referencia** (`Main`, `Formulario`, `Historial`,
`Vacio`, `ListaMovil`, `FormularioMovil`; `ParamsTransito`/`ParamsPicking`/`Pdf*` son de 475/476).
Correspondencia con este spec:

| Maqueta | Spec |
| --- | --- |
| Lista (`Main`, `ListaMovil`, `Vacio`): nombre, plantilla, «Cuándo», interruptor, último envío con su estado | R11, R15, R19, R25 (próximo envío o aviso), R42 |
| Formulario «Qué se manda»: nombre, plantilla aprobada («lleva documento»), «Informe adjunto» con su panel de parámetros | R11–R13, R33. El selector de informe ofrece los del catálogo; la plantilla se filtra por informe (R12). Con «Cuando pase algo», el informe es «Aviso de la app» y solo se ofrecen plantillas suyas. |
| «A quién»: roles con conteo (incluido «Admin de tienda»), personas, «Lo recibirán N personas», aviso de teléfonos que no sirven | R16 (adminTienda permitido), R17 |
| «Cuándo»: días + hora CR, o «Cuando pase algo» con un desplegable | R11, R14, R49. El valor de ejemplo «Al vencer un paquete» de la maqueta es ilustrativo: la lista real son los diez eventos disponibles de §2.2, con su nombre en español claro. |
| «Enviar aunque no haya nada que informar» | Parámetro del informe que lo declare (475/476); el motor solo obedece «vacío» (R31). No se pinta para `prueba_envio` ni `aviso_interno`. |
| «Probar ahora (solo a mí)» y su nota | R39–R41, R52 |
| Vista previa + «De dónde sale cada dato» (`{{1}}` = nombre del destinatario) | R4, R53 |
| Historial: estados, «Sin novedades» | R42. «Sin novedades» es la etiqueta de pantalla del estado `vacia`. |
| Aviso de app de Meta no identificada (no está en la maqueta) | R48: bajo el interruptor «Lleva documento adjunto» de Plantillas, texto de §3. |

Texto de UI: lenguaje llano; nada de «SLA».

## 8. Configuración (env)

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `WHATSAPP_APP_ID` | — (opcional, **solo anulación**) | §5.2.1. Sin ella el ID se obtiene del token. |
| `WHATSAPP_ENVIOS_BUCKET` | `whatsapp-envios` | §5.3 |
| `WHATSAPP_ENVIOS_RETENCION_DIAS` | `30` | R44 (D3) |
| `WHATSAPP_ENVIOS_VENTANA_MINUTOS` | `60` | R24 |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | existentes | Base del `enlace` (§2.3). |

Las credenciales de envío son las existentes (`loadWhatsappConfig`), cargadas perezosamente en los
handlers: un env ausente falla ESE job con su motivo en `last_error`, no el drenado de los demás (patrón
`whatsapp-bienvenida-handler.ts`). Además, la ejecución afectada queda `error` con «WhatsApp no está
configurado», visible en el historial. El puente (§4.2) NO carga credenciales de WhatsApp: no las
necesita para encolar.

## 9. Alternativas descartadas

- **A. Un planificador recurrente cada minuto que barra los envíos debidos.** Encaja en `RecurrenciaSpec`
  y no necesita cadena por envío, pero mete **1.440 filas al día** en `jobs`, tabla que hoy no tiene purga
  (`JobRepository` no borra nada), compite cada minuto por el lote de 10 del drenador (memoria «cola:
  inanición por lote de 10») y su forma de fallar es la peor: si la cadena del planificador se rompe,
  TODOS los envíos callan a la vez. La cadena por envío cuesta una fila por envío y día, rompe de uno en
  uno y la pantalla lo muestra (R25).
- **B. Un cron de Vercel por envío** (como hacía el sistema externo, uno a las 05:00 y otro a las 05:55).
  Exige desplegar para cambiar una hora: contradice «parametrizable desde pantalla».
- **C. Reutilizar el bucket `descargas` de la 470.** Su retención es de 60 min y su purga lista `tmp/`
  por antigüedad; meter PDFs de 30 días allí obligaría a cambiar la purga de otra ficha y mezclaría
  objetos efímeros con historial.
- **D. Idempotencia solo con `jobs.dedupe_key`.** El dedupe del job evita encolar dos veces, no enviar
  dos veces: un re-claim por visibility timeout ejecuta el MISMO job dos veces. Por eso la idempotencia
  vive en las tablas de dominio (únicos de ejecución y de entrega + reclamo condicional de la entrega).
- **E. Catálogo de variables por informe dentro de `CAMPOS_PLANTILLA`.** Ese catálogo lee de
  `DatosPlantilla` (una orden y su mensajero); meter variables de informe ahí las ofrecería en las
  plantillas de orden y obligaría a fingir `leer(datos)`. Se mantienen separados y se elige por
  `informe_clave`.
- **F. Deduplicar por teléfono.** Lo descarta el humano (idempotencia por usuario); se avisa en R17.
- **G. Envío «al menos una vez» (reintentar una entrega `en_curso`).** Duplicaría mensajes ante un
  timeout tras el que Meta sí envió; el sistema de referencia duplicaba. Se elige «como mucho una vez»
  con el estado visible «resultado desconocido» (R37).
- **H. Un notificador de WhatsApp inyectado en cada productor de avisos** (o una llamada explícita
  `DisparadorEnviosWhatsapp.emitir(...)` en cada choke point, que era el diseño previo a D4). Son
  diecisiete bindings `notificar<X>Real` y sus composition roots: el productor que se olvida no rompe nada,
  simplemente no envía. Es el fallo medido el 2026-08-23 (dos de siete notificadores muertos con la suite
  verde) que la 410 cerró con UN decorador en `repoReal()`. Se copia esa solución.
- **I. Pedir `WHATSAPP_APP_ID` al humano** (diseño previo a D2). Dejaba R5 bloqueada por un dato que el
  token ya sabe, y añadía una variable por entorno que alguien tiene que copiar del panel de Meta. Queda
  solo como anulación.
- **J. Referencia de idempotencia = id de la notificación.** Cada emisión crea una fila por destinatario
  con su propio id: `geocodificacion_caida` haría dos WhatsApp por jornada, `cierre_dia_por_aprobar`
  hasta tres por cierre. La entidad es el hecho; el id, la copia de un destinatario.
- **K. Puentear `orden_rechazada` dentro de su transacción** (encolando en la misma `tx`, como hace el
  webhook de la 454). Funciona mientras nada falle; cuando falle, un error de sentencia aborta la
  transacción entera y revierte el registro de la gestión del mensajero por un WhatsApp, además de
  alargar el `FOR UPDATE` sobre la orden. R50 lo prohíbe. Queda no disponible y documentado (§2.2).

## 10. Mapa de trazabilidad R → test

Rutas bajo `tests/`. «int» = integración contra Postgres (`tests/integration/db/`), obligatoria donde el
requisito vive en un `WHERE` o en un índice (memoria «probar el WHERE donde vive»); cada test de
integración siembra sus filas y se mata con una mutación antes de darlo por bueno (memoria «test de
integración verde sin datos»).

| R | Test |
| --- | --- |
| R1 | `unit/services/whatsapp-envio-service.test.ts` (cada método con `admin`, `mensajero`, sin actor → forbidden sin llamar al repo); `unit/app/configuracion-envios-whatsapp-page.test.tsx` |
| R2 | `unit/auth/menu-visibility-envios-whatsapp.test.ts` (+ `destino-post-login.test.ts` sigue verde) |
| R3, R6, R7, R10 | `unit/services/plantilla-mensaje-informe.test.ts`; int `plantilla-mensaje-informe-checks.test.ts` (CHECKs) |
| R4 | `unit/utils/catalogo-de-variables.test.ts` (incluye la común `destinatario_nombre`); `unit/app/plantillas-picker-informe.test.tsx` |
| R5 | `unit/utils/whatsapp-template-documento.test.ts` (HEADER DOCUMENT + no regresión literal); `unit/services/whatsapp-template-port-documento.test.ts` |
| R8 | int `plantilla-enviables-excluye-informe.test.ts` (los tres lectores); `unit/services/plantilla-bienvenida-informe.test.ts` |
| R9 | `unit/services/plantilla-enviar-aprobacion-sin-app-id.test.ts` (resolutor `no_resuelto` y credencial ausente → `documento_no_disponible` con el texto de §3, estado sin cambiar, sin token en el mensaje) |
| R11–R13, R16, R18 | `unit/services/whatsapp-envio-service.test.ts` (R16 con `adminTienda` aceptado y `apiKey` rechazado) |
| R14 | `unit/services/whatsapp-envio-service.test.ts` (evento no disponible → error; evento disponible no ofrecido por el informe → error; `aviso_interno` + disponible → ok) |
| R15 | `unit/services/whatsapp-envio-service.test.ts` + int `whatsapp-envio-defaults.test.ts` |
| R17 | `unit/services/previsualizar-destinatarios.test.ts`; int `whatsapp-envio-resolver-destinatarios.test.ts` |
| R19, R20, R21 | `unit/services/jobs/whatsapp-envio-programado-handler.test.ts` (apagado, borrado, obsoleto, hora pasada); `unit/services/jobs/whatsapp-envio-evento-handler.test.ts` (envío apagado entre el aviso y el drenado → ninguna ejecución) |
| R22 | `unit/whatsapp-envios/proxima-ocurrencia.test.ts`; `unit/api/procesar-jobs-registro-envios.test.ts` (los cinco handlers registrados; mantenimiento en `buildRecurrencias`) |
| R23 | int `whatsapp-envio-idempotencia-programado.test.ts` (dos ejecuciones concurrentes del mismo día → 1 ejecución y 1 entrega por usuario; prueba no consume cupo) |
| R24 | `unit/services/jobs/whatsapp-envio-programado-handler.test.ts` (ventana) |
| R25 | `unit/services/jobs/whatsapp-envio-mantenimiento-handler.test.ts`; int `whatsapp-envio-cadena-rota.test.ts` (WHERE del job pendiente por `payload->>'envioId'`) |
| R26 | **int `whatsapp-envio-puente-aviso.test.ts`** — emite por el binding REAL `notificarGeocodificacionCaidaReal` (dos filas: `maestro` y `admin`) con un envío ENCENDIDO por `geocodificacion_caida` → exactamente UN job `whatsapp_envio_evento`; con el envío APAGADO → cero jobs de ese tipo; re-emitir la misma jornada → sigue habiendo uno. Mutaciones obligatorias: quitar `conEnviosWhatsapp` de `repoReal()` ⇒ rojo; quitar `activo` del WHERE de `hayEncendidosConEvento` ⇒ rojo. `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts` (dobles: encola con la `dedupeKey` y el payload de §4.2) |
| R27 | int `whatsapp-envio-idempotencia-evento.test.ts` (el handler corrido dos veces con la misma referencia → 1 ejecución por envío; dos envíos encendidos → 2 ejecuciones); `unit/services/jobs/whatsapp-envio-evento-handler.test.ts` |
| R28 | int `whatsapp-envio-resolver-destinatarios.test.ts` (rol ∪ usuario, solo `activo`, dedup, incluye `adminTienda`, excluye `apiKey`/borrados) |
| R29–R35 | `unit/services/ejecucion-envio-service.test.ts` (dobles de informe, almacén, Meta) |
| R32 | `unit/whatsapp-envios/sanear-valor.test.ts` |
| R36, R37 | `unit/services/ejecucion-envio-service.test.ts`; `unit/services/jobs/whatsapp-envio-reintento-handler.test.ts`; int `whatsapp-envio-entrega-reclamo.test.ts` (UPDATE condicional) |
| R38 | int `whatsapp-envio-entrega-estado-webhook.test.ts` (no retrocede); `unit/api/webhook-whatsapp-entregas.test.ts` (cableado + 200 aunque falle) |
| R39–R41 | `unit/services/ejecucion-envio-prueba.test.ts`; int `whatsapp-envio-prueba-limite.test.ts` (ventana de 30 s) |
| R42 | int `whatsapp-envio-historial.test.ts` (orden, filtro, conteos, teléfono enmascarado) |
| R43 | `unit/storage/supabase-almacen-envios-whatsapp.test.ts` (`upsert: false`, ruta por ejecución, firmado) |
| R44 | int `whatsapp-envio-purga-seleccion.test.ts`; `unit/services/jobs/whatsapp-envio-mantenimiento-handler.test.ts` |
| R45 | `unit/whatsapp-envios/motivo-meta.test.ts`; `unit/services/ejecucion-envio-sin-pii.test.ts` (ni token ni teléfono en motivo/log) |
| R46 | `unit/whatsapp-envios/catalogo-informes.test.ts` (recorre el catálogo REAL; ningún informe declara `destinatario_nombre`; `eventos` ⊆ disponibles) |
| R47 | `unit/whatsapp-envios/informe-prueba-envio.test.ts` |
| R48 | `unit/clients/whatsapp-app-id.test.ts` con `fetch` doble: **éxito** (GET `/<apiVersion>/app`, `Authorization: Bearer`, token ausente de la URL, `id` numérico; segunda llamada SIN fetch por la caché); **anulación por env** (`WHATSAPP_APP_ID` → cero llamadas a fetch, `origen: "env"`); **fallo** (HTTP 400, red, timeout, `id` no numérico → `ok: false` con motivo y código; el fallo NO se cachea: la siguiente llamada vuelve a pedir). `unit/app/plantillas-aviso-app-meta.test.tsx` (con `no_identificada`, el texto aparece bajo el interruptor y el resto del formulario sigue operable) |
| R49 | `unit/whatsapp-envios/eventos-envio.test.ts` (las 18 entradas de `NotificacionEvento` declaradas; diez disponibles exactamente las de §2.2; ningún nombre contiene «SLA» ni «reprogramadas»; el `satisfies Record` hace que un valor nuevo no compile, cubierto por el typecheck); `unit/app/envios-whatsapp-formulario.test.tsx` (el desplegable ofrece solo disponibles) |
| R50 | `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts`: `crear` con `tx` → cero llamadas al repo de envíos y a la cola; `crear` deduplicado (`null`) → cero; evento no disponible, fila a usuario, fila con `zonaId`, `entidadId` nulo → cero llamadas; repo de envíos que LANZA → `crear` devuelve el id y el logger recibe el error con `envios_whatsapp_evento`. `unit/whatsapp-envios/fila-puenteable.test.ts` (§6.6, las 18). `unit/guards/envios-whatsapp-cableado.guardia.test.ts` (estática: `repoReal()` envuelve con `conEnviosWhatsapp`) |
| R51 | `unit/whatsapp-envios/informe-aviso-interno.test.ts` (los cinco valores desde `DatosAviso`; enlace con atajo y sin atajo; sin base URL → `enlace` vacío; `DatosAviso` sin campo de anexo — test de tipo `@ts-expect-error`); `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts` (el payload del job no lleva `anexo`) |
| R52 | `unit/services/ejecucion-envio-prueba.test.ts` (envío por evento → `titulo`/`texto` del ejemplo del catálogo) |
| R53 | `unit/services/ejecucion-envio-service.test.ts` (dos destinatarios → cada componente lleva SU nombre; nombre vacío → error en esa entrega); `unit/utils/catalogo-de-variables.test.ts` |

Migraciones: `tests/integration/db/whatsapp-envios-migration.test.ts` (tablas con RLS habilitada, índices
únicos parciales existen con su predicado, columnas `evento_datos` y `notificacion_id`, `down.sql`
presentes).

## 11. Riesgos

- **Doble envío con el sistema externo.** Nacen apagados (R15). El orden de puesta en marcha lo decide el
  humano: apagar el externo, encender aquí. Va en la nota de release.
- **`GET /app` y la subida reanudable no se han probado contra Meta desde este repo.** Se aíslan en dos
  clientes y la plantilla de prueba (R47) los ejercita en el recorrido (T11.4) antes de 475/476. Si
  `/app` no sirve para el tipo de token de producción, la pantalla lo dirá (R48) y la salida es la
  anulación por env (§5.2.1).
- **Ráfaga por evento.** `cierre_dia_por_aprobar` es uno por cierre: con 18 mensajeros son hasta 18
  WhatsApp al día por envío. Es lo que el maestro configura; la vista de «Cuándo» lo dice con el nombre
  del evento.
- **Un productor de avisos muerto deja muerto su envío.** El puente hereda la cobertura de los bindings
  `notificar<X>Real`; si un service no inyecta el suyo, no hay aviso y tampoco WhatsApp. No lo agrava,
  pero tampoco lo arregla: el test de R26 usa el binding real de `geocodificacion_caida` y no prueba los
  otros nueve.
- **Plantilla con documento editada tras aprobarse**: R7 bloquea cambios de estructura; editar el cuerpo
  sigue el flujo 107 (vuelve a `pending`) y, mientras tanto, la ejecución sale `error` visible (R34) y
  R10 impide desactivarla con un envío encendido.
- **Base local compartida entre worktrees**: las migraciones de esta ficha pondrán rojo el gate de otras
  ramas que compartan la base local (memoria). Avisar al leader antes de migrar.
- **`next build`**: el gate no lo corre; revisar el build de Vercel del PR antes de mergear (memoria).

## 12. Despliegue

- Migraciones aditivas; `migrate deploy` en build (preview migra: `MIGRATE_ON_PREVIEW`).
- **No hace falta crear ninguna variable de entorno nueva** (D2): `WHATSAPP_APP_ID` solo si el recorrido
  demuestra que `/app` no la resuelve. El resto de env tiene defaults; comprobar que `NEXT_PUBLIC_APP_URL`
  o `NEXT_PUBLIC_SITE_URL` existe en Production (si no, los envíos por evento salen `error` por `enlace`,
  visibles en el historial).
- Verificación en producción: abrir Plantillas, crear plantilla de informe «Prueba de envío» con
  documento → confirmar que NO aparece el aviso de app no identificada → enviar a aprobación → al
  aprobarse, crear envío con ella → Probar ahora → comprobar mensaje con PDF en el teléfono y la fila en
  el historial; activar «simular vacío» → Probar ahora → historial «Sin novedades». Para el disparo por
  evento: plantilla de «Aviso de la app» aprobada, envío por `gasto_fijo_cobro_pendiente` o el evento que
  el humano elija → Probar ahora (R52). Luego borrar esos envíos (o dejarlos apagados).
