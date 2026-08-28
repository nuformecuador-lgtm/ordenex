# Feature 311 — bitácora de implementación (BACKEND)

> Alcance de esta bitácora: bloques **A, B, C, D, E, F** de `tasks.md` (datos, borde del webhook,
> repositorios, service, contrato hacia la UI, cliente de media y ruta proxy). El bloque **G**
> (componentes del hilo) y `lib/utils/linkificar.ts` quedan para el frontend; ver "Pendiente".

## Archivos creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260827180000_chat_mensaje_media_reacciones/migration.sql` | UP: 8 `ADD VALUE`, 9 `ADD COLUMN` nullable, índice parcial de reacciones (A2, R13) |
| `db/migrations/20260827180000_chat_mensaje_media_reacciones/down.sql` | DOWN: `DROP INDEX` + 9 `DROP COLUMN` + recreación del enum con los 4 valores previos (A3, R13) |
| `lib/types/chat-contactos.ts` | `chatContactosSchema` + `ChatContactoNormalizado` + `parsearContactosGuardados` (B1, R7/R14) |
| `lib/utils/chat-reacciones.ts` | `agregarReacciones` puro: saca las reacciones del hilo y las ancla al objetivo (E1, R19/R20) |
| `lib/utils/chat-media-headers.ts` | `esMimeIncrustable` / `contentTypeSeguro` / `sanearNombreArchivo` / `contentDisposition` (F4, R25) |
| `lib/config/chat-media.ts` | Política de servido: lista blanca de MIME, timeout, `Cache-Control`, nombre por defecto |
| `lib/clients/whatsapp-media.ts` | Cliente de descarga (2 saltos, `fetchImpl` inyectable, `WhatsappMediaOutcome`) (F1, R21/R24/R35) |
| `app/api/chat/media/[mensajeId]/route.ts` | Proxy `GET`, `runtime="nodejs"`, passthrough del stream (F3, R15/R21-R25) |
| `tests/fixtures/chat-mensaje.ts` | `SIN_CAMPOS_311` / `VISTA_SIN_311` para los tests que arman DTO/vista a mano |

## Archivos modificados

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | 8 valores en `ChatMensajeTipo`, 9 columnas nullable en `ChatMensaje`, `@@index(..., map: "chat_mensaje_reaccion_idx")` (A1) |
| `lib/types/whatsapp-webhook.ts` | `metaMediaSchema`/`metaContactSchema`/`reaction`/`system` en `metaMessageSchema`; `tipoDeMeta` → `Record`; helpers puros `normalizarMedia`, `captionDeMedia`, `normalizarReaccion`, `normalizarContactos`, `normalizarSistema`; `WebhookMensajeEntrante` con `media?/reaccion?/contactos?/sistema?` (B2) |
| `lib/interfaces/repositories/IChatMensajeRepository.ts` | `ChatMensajeCamposMedia` (los 9 campos, `contactos` TIPADO), `ChatMediaAutorizada`, `findMediaParaMensajero` (C1, F2) |
| `lib/interfaces/repositories/IChatConversacionRepository.ts` | `migrarTelefono(anterior, nuevo): Promise<number>` (C1) |
| `lib/repositories/ChatMensajeRepository.ts` | Columnas nuevas en `SELECT`/`Row`/`toDTO`/insert; `contactos_json` con `safeParse` al leer; `findMediaParaMensajero` (C2, F2) |
| `lib/repositories/ChatConversacionRepository.ts` | `migrarTelefono` con `NOT EXISTS` como "ON CONFLICT DO NOTHING" (C3) |
| `lib/services/ChatWhatsappService.ts` | Propaga los campos nuevos al insert; migra el hilo ANTES de resolver; `IngestaResumen.hilosMigrados` (D1, D2) |
| `lib/types/chat-whatsapp.ts` | `ChatMediaVista`, `ChatSistemaVista`, y `media/contactos/sistema/reacciones` en `ChatMensajeVista` (E2) |
| `lib/actions/chat-whatsapp.ts` | `listarHiloChat` aplica `agregarReacciones` y mapea los campos nuevos SIN el media id de Meta (E2) |
| `tests/unit/types/whatsapp-webhook.test.ts` | +23 tests (R1–R11) |
| `tests/unit/repositories/chat-mensaje-repository.test.ts` | +9 tests (R1/R4/R5/R7/R12/R14/R23) |
| `tests/unit/repositories/chat-conversacion-repository.test.ts` | +5 tests (R16/R17/R18) |
| `tests/unit/services/chat-whatsapp-service.test.ts` | +15 tests (R1/R2/R4/R5/R7/R12/R16/R17/R18/R35) |
| `tests/unit/actions/chat-whatsapp-actions.test.ts` | +7 tests (R19/R20/R21/R35) |
| `tests/unit/services/whatsapp-fallo-saliente.test.ts`, `tests/components/ChatConversacion*.test.tsx` | Solo fixtures: los DTO/vista literales usan `SIN_CAMPOS_311` / `VISTA_SIN_311` |

## Mapa R → test (alcance backend)

| R | Test |
| --- | --- |
| R1 | `tests/unit/types/whatsapp-webhook.test.ts` :: *R1: $metaType se normaliza a $tipo conservando media id y mime* (`it.each` sobre los 5) + *R1: un documento conserva el nombre de archivo* |
| R2 | `whatsapp-webhook.test.ts` :: *R2: el caption de una imagen se conserva como cuerpo* + *R2: sin caption el cuerpo es null* |
| R3 | `whatsapp-webhook.test.ts` :: *R3: media con id vacio degrada a `otro`* + *R3: un tipo inesperado dentro del sub-objeto NO tumba el resto del lote* |
| R4 | `whatsapp-webhook.test.ts` :: *R4: una reaction con message_id y emoji conserva objetivo y emoji* |
| R5 | `whatsapp-webhook.test.ts` :: *R5: emoji vacio = reaccion RETIRADA* + *R5: emoji ausente tambien es retirada* |
| R6 | `whatsapp-webhook.test.ts` :: *R6: reaction sin message_id degrada a `otro` sin lanzar* |
| R7 | `whatsapp-webhook.test.ts` :: *R7: normaliza nombre, telefonos y correos y DESCARTA lo no declarado* + `tests/unit/types/chat-contactos.test.ts` (4 tests) |
| R8 | `whatsapp-webhook.test.ts` :: *R8: contacts vacio / no parseable / sin datos utilizables degrada a `otro`* (3 tests) |
| R9 | `whatsapp-webhook.test.ts` :: *R9: `%s` normaliza el numero anterior y el nuevo* — **`it.each` sobre los TRES subtipos** + *R9: cascada `wa_id`→`new_wa_id`→`customer`* |
| R10 | `whatsapp-webhook.test.ts` :: *R10: system sin numero nuevo degrada, no inventa numeros* + *R10: un subtipo fuera de alcance degrada* |
| R11 | `whatsapp-webhook.test.ts` :: *`%s` se registra como `otro` sin lanzar* (`it.each` sobre button/interactive/order/request_welcome/ephemeral + un tipo desconocido) |
| R12 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *R12: un entrante de media ya registrado no se duplica ni re-sella* + *R12: solo el insert NUEVO sella `ultimo_entrante_at`* + `chat-mensaje-repository.test.ts` :: *R12: el dedupe sigue arbitrando CON las columnas nuevas* |
| R13 | `tests/integration/db/chat-mensaje-media-migration.test.ts` :: *UP: pg_enum contiene los ocho valores* / *UP: las nueve columnas existen y son NULLABLE* / *UP: crea el indice PARCIAL* / *DOWN: revierte el enum a cuatro valores y borra las nueve columnas* — **contra Postgres real, en un esquema desechable** |
| R14 | `chat-mensaje-repository.test.ts` :: *R14: un contactos_json CORRUPTO se lee como null y no rompe el hilo* + `chat-contactos.test.ts` :: *parsearContactosGuardados* (la mitad UI queda para G8) |
| R15 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *no importa ningun cliente de Storage ni escribe en disco* + *no persiste el binario en la base* + `chat-mensaje-media-migration.test.ts` :: *es ADITIVA (sin BYTEA)* |
| R16 | `chat-whatsapp-service.test.ts` :: *R16: llama migrarTelefono(anterior, nuevo)* + *R16: la migracion ocurre ANTES de resolver el hilo* + `chat-conversacion-repository.test.ts` :: *R16: reescribe telefono_e164 y devuelve las filas migradas* |
| R17 | `chat-whatsapp-service.test.ts` :: *R17: al migrar el hilo NO se escribe fuera de chat_conversacion/chat_mensaje* + *R17: el modulo del service no importa ningun repositorio de orden ni de cliente* + `chat-conversacion-repository.test.ts` :: *R17: el UPDATE escribe SOLO en chat_conversacion* |
| R18 | `chat-whatsapp-service.test.ts` :: *R18: deja evidencia PERSISTENTE con AMBOS numeros* + *R18: reprocesar el MISMO wa_message_id no inserta una segunda evidencia* + *R18/P5: si el hilo destino ya existe la ingesta NO se rompe* |
| R19 | `tests/unit/actions/chat-whatsapp-actions.test.ts` :: *R19: un hilo con imagen + reaccion devuelve UNA burbuja con `reacciones` no vacio* (+ contactos y sistema) + `tests/unit/utils/chat-reacciones.test.ts` (3 tests) |
| R20 | `chat-reacciones.test.ts` :: *el mismo autor reaccionando dos veces deja SOLO la mas reciente* / *si la mas reciente es una RETIRADA, el mensaje queda SIN reacciones* / *autores DISTINTOS suman conteo* / *la retirada de UN autor no borra la del otro* + `chat-whatsapp-actions.test.ts` :: *R20: una reaccion RETIRADA deja el objetivo SIN reacciones* |
| R21 | `chat-media-proxy.route.test.ts` :: *devuelve el binario con su Content-Type al mensajero asignado* + *el media id de Meta NO aparece en ninguna cabecera* + `chat-whatsapp-actions.test.ts` :: *R21/R35: la vista NO contiene el media id de Meta* + `tests/unit/clients/whatsapp-media.test.ts` |
| R22 | `chat-media-proxy.route.test.ts` :: *R22: sin sesion responde 401 y NO llama a la Graph API ni a la base* |
| R23 | `chat-media-proxy.route.test.ts` :: *R23: orden de otro mensajero responde 403 y NO llama a la Graph API* + `chat-mensaje-repository.test.ts` :: *devuelve null cuando el mensaje es de una orden de OTRO mensajero* |
| R24 | `chat-media-proxy.route.test.ts` :: *media caducada responde 410 con { error: 'expirado' }* + *un fallo real de la Graph API es 502, NO 410* + `whatsapp-media.test.ts` :: *404 → expirado* / *error.code 100 → expirado* / *url vacia → expirado* / *404 en el segundo salto → expirado* (la mitad UI queda para G4) |
| R25 | `chat-media-proxy.route.test.ts` :: *?descarga=1 responde attachment con el filename saneado* + *un image/svg+xml sale como attachment + octet-stream + nosniff* + `tests/unit/utils/chat-media-headers.test.ts` (12 tests) |
| R26 | `tests/integration/api/chat-media-middleware.test.ts` :: *GET sin cookie de sesion redirige (307) a /login* + *PUBLIC_ROUTES / SELF_AUTH_ROUTES no contienen ninguna entrada que cubra /api/chat* |
| R35 | `chat-whatsapp-service.test.ts` :: *no loguea numero, cuerpo, caption ni datos de contacto en NINGUNA rama* + `whatsapp-media.test.ts` :: *el token NO aparece en el detalle de NINGUN error* + *no loguea nada* |

**Sin cubrir aquí (bloque G, frontend):** R27, R28, R29, R30, R31, R32, R33, R34 y las mitades UI
de R14 y R24.

## Gate

`./init.sh` completo (el modo rápido se niega: el diff toca `db/schema.prisma`, una migración y
`lib/types/`).

```
typecheck  OK  (pnpm exec tsc --noEmit, 0 errores)
lint       0 errors, 118 warnings (todas preexistentes, `no-unused-vars` con guion bajo)
vitest     Test Files  8 failed | 1473 passed (1481)
           Tests       30 failed | 20406 passed | 40 skipped (20476)
```

**Baseline medido ANTES de atribuir nada** (stash de todo mi diff + `pnpm db:generate` desde el
schema limpio, sobre los 11 archivos que salieron rojos en la primera corrida):

```
Test Files  7 failed | 4 passed (11)
Tests       30 failed | 167 passed (197)
```

Los 7 archivos rojos del baseline —`premio-ranking-idempotencia` (14),
`premio-ranking-devengo-migration` (6), `orden-remision-borrada-libera-numero` (5),
`analitica-financiera-action` (2), `usuarios-filtro-busqueda` (1), `usuario-descarga` (1),
`superficie-de-uso.guardia` (1, `lib/actions/tarifas.ts:67 obtenerTarifa`)— **vienen de `dev`**,
no de esta feature. Ninguno toca chat.

Los otros 4 archivos (`rollup-guards`, `no-embalaje`, `DetalleMensajeroPanel`,
`wallet-tiendas-desglose`) sí los tocaba yo o eran flakes de saturación:

- **`rollup-guards` era MÍO y está arreglado.** `TIMEOUT_MEDIA_MS` valía `20_000`, exactamente
  la misma cifra que `UMBRAL_AVISO_FILAS_CORRIDA` de `lib/config/analitica-rollup.ts`, y la
  guardia R47 prohíbe que esa cifra aparezca copiada en otro archivo del árbol. Cambiado a
  `30_000`.
- Los otros tres pasan en aislado con mi diff aplicado (`4 passed (4) / 81 passed`): son los
  flakes por saturación que ya documenta la memoria del repo (tardaban 34–56 s en la corrida
  completa).

**Delta atribuible a la feature: 0.** Los 30 rojos de la corrida completa son EXACTAMENTE los 30
del baseline, archivo por archivo.

El octavo archivo rojo (`ranking-snapshot-migration`) no aporta ningun test fallido: revienta a
nivel de suite con `40P01 se ha detectado un deadlock` sobre Postgres. Es contencion de DDL entre
tests de base que corren en paralelo (el patron de "flakes por saturacion" que ya documenta el
repo): en aislado, y tambien corrido JUNTO a mi test de migracion, pasa
(`2 passed (2) / 60 passed`). No aparecio en la primera corrida completa y si en la segunda, con
el mismo codigo: cambia de archivo entre corridas, que es la firma del flake, no de una regresion.

## Notas del recorrido y puntos abiertos

- **P1 sigue sin medirse.** `normalizarSistema` acepta los TRES subtipos
  (`user_changed_number`, `customer_changed_number`, `customer_identity_changed`) y resuelve el
  número nuevo en cascada `wa_id → new_wa_id → customer`. Es tolerancia, no medición: en cuanto
  se capture un payload real de producción hay que confirmar el campo exacto.
- **Tensión R16 ↔ R17, que el diseño no resuelve y no he inventado.** `migrarTelefono` reescribe
  `chat_conversacion.telefono_e164`, pero `resolverOrdenActivaPorNumero` busca la orden por
  `orden.telefono_dest`, que R17 prohíbe tocar. Consecuencia medible: la evidencia del cambio de
  número SÍ cae en el hilo migrado (el `system` llega con el `from` antiguo, que todavía casa con
  la orden), pero **un mensaje posterior enviado desde el número NUEVO no resolverá ninguna orden
  y se contará como `sinResolver`**. R16 tal como está escrito ("reescribe ese `telefono_e164`")
  queda cumplido y probado; la promesa de "los mensajes posteriores caen en el mismo hilo" no se
  sostiene sin tocar el maestro o sin una tabla de alias, y eso es decisión humana. **Anotado, no
  resuelto.**
- **P2** (tamaño del archivo): `media_tamano_bytes` queda nullable y solo se puebla si Meta lo
  manda. La respuesta del proxy sí emite `Content-Length` cuando la Graph API lo devuelve.
- **P5** (colisión al migrar): implementado como degradación, sin fusionar hilos. El `NOT EXISTS`
  del `UPDATE` es lo que evita que la violación del único `(orden_id, telefono_e164)` aborte la
  transacción del webhook entero.
- **H1 (recorrido manual con un payload real) NO se ha hecho:** no hay payload real capturado en
  el repo ni credencial de WhatsApp en este entorno. Queda para quien tenga la base con datos.

## Pendiente para el frontend (bloque G)

1. `lib/utils/linkificar.ts` (G1) — helper puro; no lo he escrito para no chocar con el diff de UI.
2. `BurbujaContenido.tsx` (switch exhaustivo con `never`), `TextoConEnlaces.tsx`,
   `MediaAdjunto.tsx` + `hooks/useMediaChat.ts`, `TarjetaContacto.tsx`, `Reacciones.tsx`,
   `BurbujaSistema.tsx`, y `ChatConversacion.tsx` delegando en ellos.
3. Contrato que ya está listo y tipado para consumir, sin `any`:
   - `ChatMensajeVista.media: { mime, nombre, tamanoBytes } | null` — la URL del binario se
     construye con `/api/chat/media/${mensaje.id}` (id INTERNO; el media id de Meta no sale).
   - `?descarga=1` fuerza `attachment`.
   - **`410` con cuerpo `{ "error": "expirado" }`** es el desenlace de R24: es lo que la burbuja
     tiene que distinguir de un fallo de red para pintar el texto de "ya no está disponible".
     `401` sin sesión, `403` orden ajena, `404` mensaje sin adjunto, `502` fallo de la Graph API.
   - `ChatMensajeVista.contactos: ChatContactoNormalizado[] | null` (`lib/types/chat-contactos.ts`).
   - `ChatMensajeVista.sistema: { telefonoAnterior, telefonoNuevo } | null`.
   - `ChatMensajeVista.reacciones: { emoji, conteo }[]` — **ya vienen ancladas al mensaje
     objetivo**; el hilo NO trae ninguna burbuja de tipo `reaccion` (R19/R30 por construcción).
