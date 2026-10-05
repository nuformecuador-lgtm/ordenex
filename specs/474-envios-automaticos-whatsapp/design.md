# 474 — Envíos automáticos por WhatsApp — design

> Requisitos en `requirements.md` (R1–R47). Medido contra `dev` @ `e4453f43` el 2026-10-05. El grafo
> `codebase-memory` se usó para localizar; cada pieza citada se confirmó en el archivo real (el grafo no
> tenía la 470: `purga-descargas` se leyó directamente).

## 0. Qué existe hoy y qué falta (medido)

| Pieza | Dónde | Estado para esta ficha |
| --- | --- | --- |
| Plantillas (107) | `PlantillaMensaje` (`db/schema.prisma:217`), `PlantillaMensajeService`, `lib/actions/plantillas.ts`, `/configuracion/plantillas` | Se reutiliza. **Falta**: noción de «plantilla de informe» y de cabecera documento. |
| Componentes Meta | `lib/utils/whatsapp-template.ts` | `construirComponentsTemplate` solo arma `BODY` (línea 49); `construirComponentsEnvio` solo `body` (línea 67). **Falta** `HEADER`/`header` documento. |
| Ejemplos de variables | `ejemploDe` → `EJEMPLOS_POR_CLAVE` del catálogo de orden (`lib/types/plantilla-datos.ts:859`) | **Falta** que salgan del catálogo del informe para plantillas de informe. |
| Envío de template | `WhatsappCloudClient.enviarPlantilla(destino, nombre, idioma, componentes)` (`lib/clients/whatsapp-cloud.ts:121`) | Sirve tal cual: los componentes son libres. Desenlace tipado `ok`/`transitorio`/`permanente`. |
| Subida de media | `WhatsappMediaUploadClient.subir` (`lib/clients/whatsapp-media-upload.ts:106`) → `media_id` | Sirve para el PDF que se ENVÍA. **No** sirve para el ejemplo de la plantilla (eso es otra API, §5.2). |
| Credenciales | `loadWhatsappConfig` (`lib/config/whatsapp.ts:90`): token, numeroId, wabaId | **Falta** `WHATSAPP_APP_ID` para la subida reanudable del ejemplo (Pregunta abierta 2). |
| Cola | `jobs` + `JobQueueService` + `/api/cron/procesar-jobs` cada minuto (`vercel.json`) | Se reutiliza. La recurrencia por tipo (`RecurrenciaSpec`) re-encola con payload `{}`: vale para el mantenimiento diario, **no** para envíos con payload propio (§4.1). |
| Hora CR | `lib/utils/fecha-cr.ts` (`fechaCalendarioCR`, `inicioDelDiaCREnUtc`…), `hora-cr.ts`; CR = UTC−6 fijo (`analitica-rollup-diario-handler.ts:31`) | Se reutiliza. |
| Teléfono | `normalizarTelefonoWa` → `normalizarTelefonoCR` (`lib/utils/whatsapp-telefono.ts`) | Normaliza pero **no valida**. **Falta** el predicado de validez (§6.4). |
| Estados de Meta | webhook `app/api/webhooks/whatsapp/route.ts` → `parseWebhookEventos` → `ChatWhatsappService.ingerirEventos` actualiza `chat_mensaje` por `wa_message_id` | **Falta** aplicar esos estados a las entregas de esta ficha (§5.4). |
| Almacén privado | `SupabaseAlmacenDescargas` (470): bucket privado creado en el primer uso, `upsert: false`, URL firmada, purga | Patrón a copiar, **no** el bucket: el de la 470 retiene 60 min (`DESCARGA_RETENCION_MINUTOS`) y purga por listado de `tmp/`. |
| Permisos | `/configuracion` maestro-only (`lib/auth/menu-visibility.ts:545`); plantillas `ALLOWED_ROLES = {maestro}` | Se sigue el mismo patrón (R1). |
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
| `evento_clave` | `text NULL` | |
| `activo` | `boolean NOT NULL DEFAULT false` | R15: nace apagado. |
| `created_by`, `updated_by` | `uuid NULL` FK → `usuario` `ON DELETE SET NULL` | |
| `created_at`, `updated_at`, `deleted_at` | `timestamptz` | Soft delete (R21). |

CHECK de forma del disparo: `hora_fija` ⇒ `dias_semana` no vacío, `hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
`evento_clave IS NULL`; `evento` ⇒ `evento_clave IS NOT NULL`, `dias_semana IS NULL`, `hora IS NULL`.
Índice parcial `(evento_clave) WHERE activo AND deleted_at IS NULL AND disparo = 'evento'` (el emisor de
eventos lo consulta en caliente).

### 1.3 `whatsapp_envio_destinatario`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `envio_id` | FK → `whatsapp_envio` `ON DELETE CASCADE` | |
| `rol` | `rol_value NULL` | |
| `usuario_id` | `uuid NULL` FK → `usuario` `ON DELETE CASCADE` | |

CHECK: exactamente uno de `rol` / `usuario_id`. Únicos parciales `(envio_id, rol) WHERE rol IS NOT NULL`
y `(envio_id, usuario_id) WHERE usuario_id IS NOT NULL`. Los roles permitidos (R16) se validan en el
service: es política, no forma.

### 1.4 `whatsapp_envio_ejecucion`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `envio_id` | FK → `whatsapp_envio` `ON DELETE RESTRICT` | El envío nunca se borra físicamente (R21). |
| `origen` | enum `whatsapp_envio_origen` (`programado`, `evento`, `prueba`) | |
| `fecha_cr` | `date NULL` | Solo `programado`. |
| `instante_programado` | `timestamptz NULL` | Solo `programado`. |
| `evento_clave`, `evento_referencia` | `text NULL` | Solo `evento`. |
| `solicitada_por` | `uuid NULL` FK → `usuario` `ON DELETE SET NULL` | Solo `prueba`. |
| `estado` | enum `whatsapp_ejecucion_estado` (`pendiente`, `generando`, `enviando`, `completada`, `vacia`, `sin_destinatarios`, `omitida`, `error`) | |
| `motivo` | `text NULL` | Siempre saneado (§6.3), máx. 500. |
| `plantilla_id`, `plantilla_nombre` | snapshot | Lo que se usó, aunque luego cambie el envío. |
| `parametros` | `jsonb NULL` | Snapshot. |
| `valores` | `jsonb NULL` | Valores de variables FIJADOS (R35). |
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
| `destinatario_nombre` | `text NOT NULL` | Snapshot. |
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

interface ContextoInforme<P> {
  parametros: P;
  ahora: Date;
  conDocumento: boolean;                         // la plantilla lleva cabecera documento
  evento?: { clave: string; referencia: string };
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
  eventos: string[];                             // claves de EVENTOS_ENVIO_WHATSAPP que ofrece (R14)
  generar(ctx: ContextoInforme<P>): Promise<ResultadoInforme>;
}
```

Reglas del contrato (las verifica el motor, no la buena fe del informe):

- `valores` debe traer TODAS las claves que usa la plantilla y cada una no vacía tras sanear; si no, la
  ejecución acaba en `error` nombrando la variable (R32). Una variable = un dato: el informe NO arma
  frases (la referencia externa metía una frase entera en un parámetro; aquí el texto vive en la
  plantilla aprobada).
- `conDocumento: true` y sin `documento` ⇒ `error` («el informe no generó el PDF»).
- «Vacío» lo decide el informe (la 475 tiene su parámetro «enviar si vacío»); el motor solo obedece.
- Los parámetros se re-validan al ejecutar (R34): si el esquema del informe cambia y deja inválido un
  envío guardado, la ejecución sale `error` con «revisa los parámetros del envío», nunca un envío con
  datos por defecto silenciosos.
- Los descriptores `catalogo` (`zonas`, `estados_orden`, `tiendas`) los resuelve la pantalla con
  lectores existentes; 475 usa `tabla` + `zonas` para «plazo y aviso por zona» (por `zona_id`, no texto).
  Si 475/476 necesitan un tipo de descriptor más, lo añaden ellas al renderizador.

Catálogo de eventos: `lib/whatsapp-envios/eventos.ts` exporta `EVENTOS_ENVIO_WHATSAPP`
(`{ clave, nombre, descripcion }[]`). **Nace vacío** (Pregunta abierta 4). Los tests registran un evento
de prueba por inyección del catálogo.

### 2.1 Informe «Prueba de envío» (R47)

Clave `prueba_envio`. Parámetros `{ simularVacio: boolean }` (por defecto `false`). Variables `fecha`
(«05/10/2026») y `hora` («05:00»), ambas CR del `ahora` del contexto. `generaDocumento: true`: PDF de una
página con jspdf («Prueba de envío automático — <fecha> <hora>»), nombre `prueba-<fecha>.pdf`.
`eventos: []`. Sirve para verificar en producción la cadena completa (plantilla con documento aprobada →
Probar ahora) antes de 475/476, y la rama «vacío».

## 3. Plantillas: cambios en la 107

- `crearPlantillaSchema`/`actualizarPlantillaSchema`: campos opcionales `informeClave` (string que exista
  en el catálogo) y `llevaDocumento` (boolean).
- `PlantillaMensajeService.crear/actualizar`: valida R6 (informe sin documento) y R7 (inmutables si
  `templateId !== null || estado !== 'saved_not_aprobation'`) → `validation_error` por campo.
- `cambiarEstado` (a `inactivo`) y `eliminar`: consultan `IWhatsappEnvioRepository.nombresEncendidosConPlantilla(id)`;
  si hay alguno → nuevo resultado `en_uso` con los nombres (R10). Inyectado como dependencia opcional para
  no romper los tests existentes; el composition root (`buildPlantillaService`) DEBE pasarlo (test estático).
- `marcarMensajeBienvenida`: `informe_clave` no nulo → `no_aplica` (R8).
- `enviarAprobacion` con `llevaDocumento`: necesita el handle del ejemplo (§5.2). Sin `WHATSAPP_APP_ID`
  → `no_configurado` con `pieza: "WHATSAPP_APP_ID"` sin tocar estado (R9).
- Pantalla de plantillas: en el formulario, selector «Tipo: de orden / de informe <informe>» y switch
  «Lleva documento adjunto» (deshabilitado si el informe no genera documento o si R7 aplica). El
  `CampoVariablePicker` recibe el catálogo según el tipo; `clavesSinCampo` usa ese mismo catálogo (R4).
  Una plantilla de informe no ofrece «Plantilla de tienda» ni «Marcar bienvenida».

Convivencia de catálogos (decisión): `CAMPOS_PLANTILLA` NO se toca. Una función pura
`catalogoDeVariables(informeClave: string | null)` devuelve `{ clave, nombre, descripcion, ejemplo }[]`
desde `CAMPOS_PLANTILLA_OFRECIDOS` (null) o desde `informe.variables`. La vista previa, el picker, la
detección de claves desconocidas y los ejemplos que viajan a Meta leen de ahí.

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

### 4.2 Disparo por evento

`DisparadorEnviosWhatsapp.emitir(eventoClave, referencia, tx?)` — punto único que llamarán los
choke points del dominio. Dentro de la transacción que recibe (patrón `webhook_evento` de la 454, que
encola en la misma tx que el hecho): lee envíos encendidos con ese evento (índice §1.2), inserta la
ejecución `evento` con `ON CONFLICT DO NOTHING` (R27) y, solo si la insertó, encola
`whatsapp_envio_ejecucion { ejecucionId }` con `dedupeKey 'wa_envio_ejecucion:<ejecucionId>'`. Un
evento desconocido para el catálogo lanza (error de programación, lo caza un test).

### 4.3 `EjecucionEnvioService.ejecutar(ejecucionId, opciones?)`

Service puro (repos, almacén, cliente Meta, subidor, catálogo y reloj por constructor). Pasos:

1. Estado terminal (`completada`, `vacia`, `sin_destinatarios`, `omitida`, `error` definitivo) → nada.
2. Paso a `generando`. Re-valida plantilla (vigente, `activo`, `templateId`, mismo informe) y parámetros
   (R34). Fallo → `error` con motivo accionable, sin lanzar (no hay nada que reintentar).
3. Destinatarios: prueba → solo `solicitada_por`; resto → `IWhatsappEnvioRepository.resolverDestinatarios(envioId)`
   (R28: unión roles ∪ usuarios, `estado = 'activo'`, roles permitidos, dedup por `usuario.id`, orden
   estable por nombre). Cero → `sin_destinatarios` (R30) SIN generar el informe.
4. Contenido: si `valores` ya está fijado (reintento) se reutiliza junto con el PDF guardado (R35). Si no,
   `informe.generar(...)`. `vacio` → `vacia` + motivo (R31). `contenido` → valida y sanea (R32, §6.2);
   guarda PDF (§5.3), fija `valores`, `pdf_*` en la misma escritura.
5. PDF a Meta: si `lleva_documento` y no hay `media_id`, `subir()` una vez; `rechazado` → `error`;
   `error` (red/5xx) → lanza (la cola reintenta el job; el PDF ya guardado se reutiliza).
6. Entregas: `INSERT … ON CONFLICT (ejecucion_id, usuario_id) DO NOTHING` por destinatario; teléfono
   inválido → `telefono_invalido` (R29).
7. Por cada entrega `pendiente`: **reclamo** `UPDATE … SET estado = 'en_curso' WHERE id = $1 AND estado =
   'pendiente'` (si no afecta fila, otra ejecución la tiene: se salta). Llamada a
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
último motivo y no lanza (R36). Reutiliza `media_id` y `valores` de la ejecución.

Tope de 50 destinatarios (R16): el envío secuencial (timeout 10 s por llamada) cabe en una corrida del
drenador; un envío más grande pediría trocear el fan-out en jobs, que hoy no hace falta.

### 4.4 Probar ahora (R39–R41)

Server action `probarEnvioWhatsapp(envioId)`: maestro (R1); rechaza si hay una prueba del mismo
`(solicitada_por, envio_id)` con `created_at > now − 30 s` (R41, consulta sobre el índice §1.4); valida
el teléfono del actor (R40) antes de crear nada; crea la ejecución `prueba` y llama a `ejecutar` EN LÍNEA
con destinatario único. Devuelve `{ estado, motivo?, entrega? }`. Usa la configuración GUARDADA; la UI
avisa si hay cambios sin guardar. Funciona apagado.

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
PDF de ejemplo es fijo, generado con jspdf («Documento de ejemplo»). Env nueva `WHATSAPP_APP_ID`
(opcional: sin ella, R9). Verificar contra la API real en la implementación: si Meta cambia el contrato,
el fallo sale como `WhatsappPlantillaError` con el código, no en silencio.

### 5.3 Almacén del PDF

`SupabaseAlmacenEnviosWhatsapp` clonando `SupabaseAlmacenDescargas`: bucket PRIVADO
`WHATSAPP_ENVIOS_BUCKET` (por defecto `whatsapp-envios`), creado en el primer uso; ruta
`<envioId>/<ejecucionId>.pdf`; `upload(..., { upsert: false })` (R43: nunca sobrescribe; la ruta es única
por ejecución); `firmar(ruta, 300)`; `borrar(rutas[])` que propaga el error del SDK. `pdf_caduca_at =
created_at + WHATSAPP_ENVIOS_RETENCION_DIAS` (por defecto 30). La purga es **por base**, no por listado:
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
cuatro espacios seguidos.)

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

## 7. Rutas, acciones y pantalla

- Página `app/(app)/configuracion/envios-whatsapp/page.tsx` (Server Component; `resolveActorFromSession`;
  no maestro → aviso «sin permiso», R1). Entrada de menú al FINAL de los hijos de «Configuración» (R2:
  `primerDestino` toma el primer hijo, así que el final no mueve el aterrizaje).
- Server actions en `lib/actions/envios-whatsapp.ts` (zod en el borde, patrón `lib/actions/plantillas.ts`):
  `listarEnvios`, `obtenerEnvio`, `crearEnvio`, `actualizarEnvio`, `encenderEnvio`, `apagarEnvio`,
  `borrarEnvio`, `previsualizarDestinatarios` (R17, no escribe), `probarEnvioWhatsapp`, `listarEjecuciones`,
  `obtenerEjecucion`, `firmarPdfEjecucion` (R43; `caducado` si `pdf_purgado_at` no es nulo).
  Ninguna ruta API nueva. Ningún cron nuevo en `vercel.json`.
- Service `WhatsappEnvioService` (CRUD + reglas R11–R21, `ALLOWED_ROLES = {maestro}`) y
  `EjecucionEnvioService` (§4.3). Repos `WhatsappEnvioRepository`, `WhatsappEjecucionRepository`.
  Interfaces en `lib/interfaces/{services,repositories,external}/`.

UI funcional (la maqueta la hace /design en `design-whatsapp/`; esto es lo que debe contener):

1. **Lista de envíos**: nombre, informe, plantilla (y si lleva PDF), disparo legible («L–V 05:00» /
   «Evento: …»), destinatarios resumidos, interruptor encendido/apagado, próximo envío o aviso (R25),
   última ejecución con su estado, acciones Editar, Probar ahora, Borrar.
2. **Formulario de envío**: nombre; informe (descripción visible); plantilla filtrada por ese informe y
   compatible, con aviso «sin plantillas aprobadas para este informe» y enlace a Plantillas; parámetros
   renderizados desde los descriptores con sus valores por defecto; disparo (días de la semana + hora CR,
   o evento si el informe ofrece alguno); destinatarios (roles permitidos + buscador de usuarios) con la
   lista resuelta y los avisos de R17; guardar no enciende.
3. **Probar ahora**: confirma «se enviará solo a ti (•••• 1234)», muestra el resultado (aceptado,
   rechazado con motivo, vacío, error).
4. **Historial**: tabla paginada (R42) con filtro por envío; detalle de ejecución con entregas y botón
   «Descargar PDF» o «PDF caducado».

Texto de UI: lenguaje llano; nada de «SLA».

## 8. Configuración (env)

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `WHATSAPP_APP_ID` | — (opcional) | §5.2. Sin ella, aprobar plantilla con documento → R9. |
| `WHATSAPP_ENVIOS_BUCKET` | `whatsapp-envios` | §5.3 |
| `WHATSAPP_ENVIOS_RETENCION_DIAS` | `30` | R44 |
| `WHATSAPP_ENVIOS_VENTANA_MINUTOS` | `60` | R24 |

Las credenciales de envío son las existentes (`loadWhatsappConfig`), cargadas perezosamente en los
handlers: un env ausente falla ESE job con su motivo en `last_error`, no el drenado de los demás (patrón
`whatsapp-bienvenida-handler.ts`). Además, la ejecución afectada queda `error` con «WhatsApp no está
configurado», visible en el historial.

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
| R4 | `unit/utils/catalogo-de-variables.test.ts`; `unit/app/plantillas-picker-informe.test.tsx` |
| R5 | `unit/utils/whatsapp-template-documento.test.ts` (HEADER DOCUMENT + no regresión literal); `unit/services/whatsapp-template-port-documento.test.ts` |
| R8 | int `plantilla-enviables-excluye-informe.test.ts` (los tres lectores); `unit/services/plantilla-bienvenida-informe.test.ts` |
| R9 | `unit/services/plantilla-enviar-aprobacion-sin-app-id.test.ts` |
| R11–R14, R16, R18 | `unit/services/whatsapp-envio-service.test.ts` |
| R15 | `unit/services/whatsapp-envio-service.test.ts` + int `whatsapp-envio-defaults.test.ts` |
| R17 | `unit/services/previsualizar-destinatarios.test.ts`; int `whatsapp-envio-resolver-destinatarios.test.ts` |
| R19, R20, R21 | `unit/services/jobs/whatsapp-envio-programado-handler.test.ts` (apagado, borrado, obsoleto, hora pasada) |
| R22 | `unit/whatsapp-envios/proxima-ocurrencia.test.ts`; `unit/api/procesar-jobs-registro-envios.test.ts` (handlers registrados; mantenimiento en `buildRecurrencias`) |
| R23 | int `whatsapp-envio-idempotencia-programado.test.ts` (dos ejecuciones concurrentes del mismo día → 1 ejecución y 1 entrega por usuario; prueba no consume cupo) |
| R24 | `unit/services/jobs/whatsapp-envio-programado-handler.test.ts` (ventana) |
| R25 | `unit/services/jobs/whatsapp-envio-mantenimiento-handler.test.ts`; int `whatsapp-envio-cadena-rota.test.ts` (WHERE del job pendiente por `payload->>'envioId'`) |
| R26, R27 | `unit/services/disparador-envios-whatsapp.test.ts`; int `whatsapp-envio-idempotencia-evento.test.ts` |
| R28 | int `whatsapp-envio-resolver-destinatarios.test.ts` (rol ∪ usuario, solo `activo`, dedup, excluye `adminTienda`/`apiKey`/borrados) |
| R29–R35 | `unit/services/ejecucion-envio-service.test.ts` (dobles de informe, almacén, Meta) |
| R32 | `unit/whatsapp-envios/sanear-valor.test.ts` |
| R36, R37 | `unit/services/ejecucion-envio-service.test.ts`; `unit/services/jobs/whatsapp-envio-reintento-handler.test.ts`; int `whatsapp-envio-entrega-reclamo.test.ts` (UPDATE condicional) |
| R38 | int `whatsapp-envio-entrega-estado-webhook.test.ts` (no retrocede); `unit/api/webhook-whatsapp-entregas.test.ts` (cableado + 200 aunque falle) |
| R39–R41 | `unit/services/ejecucion-envio-prueba.test.ts`; int `whatsapp-envio-prueba-limite.test.ts` (ventana de 30 s) |
| R42 | int `whatsapp-envio-historial.test.ts` (orden, filtro, conteos, teléfono enmascarado) |
| R43 | `unit/storage/supabase-almacen-envios-whatsapp.test.ts` (`upsert: false`, ruta por ejecución, firmado) |
| R44 | int `whatsapp-envio-purga-seleccion.test.ts`; `unit/services/jobs/whatsapp-envio-mantenimiento-handler.test.ts` |
| R45 | `unit/whatsapp-envios/motivo-meta.test.ts`; `unit/services/ejecucion-envio-sin-pii.test.ts` (ni token ni teléfono en motivo/log) |
| R46 | `unit/whatsapp-envios/catalogo-informes.test.ts` (recorre el catálogo real) |
| R47 | `unit/whatsapp-envios/informe-prueba-envio.test.ts` |

Migraciones: `tests/integration/db/whatsapp-envios-migration.test.ts` (tablas con RLS habilitada, índices
únicos parciales existen con su predicado, `down.sql` presentes).

## 11. Riesgos

- **Doble envío con el sistema externo.** Nacen apagados (R15). El orden de puesta en marcha lo decide el
  humano: apagar el externo, encender aquí. Va en la nota de release.
- **La API de subida reanudable** no se ha probado contra Meta desde este repo. Se aísla en un cliente y
  la plantilla de prueba (R47) la ejercita antes de 475/476.
- **Plantilla con documento editada tras aprobarse**: R7 bloquea cambios de estructura; editar el cuerpo
  sigue el flujo 107 (vuelve a `pending`) y, mientras tanto, la ejecución sale `error` visible (R34) y
  R10 impide desactivarla con un envío encendido.
- **Base local compartida entre worktrees**: las migraciones de esta ficha pondrán rojo el gate de otras
  ramas que compartan la base local (memoria). Avisar al leader antes de migrar.
- **`next build`**: el gate no lo corre; revisar el build de Vercel del PR antes de mergear (memoria).

## 12. Despliegue

- Migraciones aditivas; `migrate deploy` en build (preview migra: `MIGRATE_ON_PREVIEW`).
- Crear `WHATSAPP_APP_ID` (Production y Preview por separado) cuando el humano lo dé; el resto de env tiene
  defaults.
- Verificación en producción: crear plantilla de informe «Prueba de envío» con documento → enviar a
  aprobación → al aprobarse, crear envío con ella → Probar ahora → comprobar mensaje con PDF en el
  teléfono y la fila en el historial; activar «simular vacío» → Probar ahora → historial «vacía». Luego
  borrar ese envío (o dejarlo apagado).
