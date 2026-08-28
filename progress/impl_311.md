# Impl — Feature 311 · el chat muestra media, reacciones, contactos y el cambio de número

> Consolida `impl_311_backend.md` (que cubría 27 de 35 y quedó diciendo «pendiente el frontend»
> con el frontend ya escrito) y la parte de UI. **Este archivo es el mapa R→test completo.**

## Estado

**Implementada.** Rama `feature/311-chat-media-reacciones-contactos`, 7 commits sobre `origin/dev`.

| commit | qué |
|---|---|
| `35bdd07c` | alta de la ficha + spec aprobado + cierre del bookkeeping de la 278 |
| `8b9d35e5` | backend: ingesta, migración, contrato y ruta proxy |
| `ac7369d7` | frontend: burbujas, reacciones, contactos, linkificación |
| `8b534461` | el cambio de número es EVIDENCIA, no continuidad; test que lo fija |
| `773cd300` | la burbuja lo dice al mensajero |
| `64464b9b` | renumerada 299 → 311 (segunda colisión de id) |
| `06b47e6f` | restaura el registro que el `sed` de la renumeración borró |
| `917f296d` | B4/M1/M2 de la revisión |

## El bug que la origina

`tipoDeMeta` sólo mapeaba `text` y `location`; todo lo demás caía en `otro` con `cuerpo: null`, y
`ChatConversacion.tsx` pintaba `<p>{cuerpo ?? ""}</p>`. En producción: **el cliente manda una foto
y el mensajero ve un globo vacío con la hora.**

## Decisiones del humano (cerradas, no reabrir)

1. **Media por proxy bajo demanda, sin almacenar.** Se guarda el media id + metadatos; una ruta
   propia autenticada baja el binario de la Graph API al abrirlo. Sin bucket y sin cron de purga
   **a propósito**. El token nunca llega al navegador.
2. **Meta borra el binario a los 30 días** → la UI dice explícitamente que el archivo ya no está
   disponible (410 → texto propio). Requisito, no cortesía.
3. **Cambio de número: SÓLO EVIDENCIA.** Ver el bloque «LIMITACIÓN CONOCIDA» de R16: un mensaje
   desde el número nuevo **no resuelve orden** y se cuenta `sinResolver`. Está fijado por test y
   la burbuja se lo dice al mensajero. **No es un bug.**
4. Reacciones ancladas a su burbuja; `contacts` con datos copiables; se enlaza sólo el tramo de
   URL, con `www.` sí y dominios sueltos no.

**Fuera de alcance:** `button`, `interactive`, `order`, `request_welcome`, `ephemeral`,
`message_template_status_update`.

## Trazabilidad R→test — 35 de 35

> Copiada literal de `specs/311-chat-media-reacciones-contactos/tasks.md`, que es la fuente única.
> El reviewer verificó que **muerden** rompiendo la implementación en 8 puntos: 7 pusieron rojo su
> test; el 8.º (chequeo de protocolo en `hrefSeguro`) no tenía test propio y se añadió en M2.

| Requisito | Test (archivo :: nombre) | Tipo |
| R1 | `tests/unit/types/whatsapp-webhook.test.ts` :: *normaliza image/audio/video/document/sticker a su tipo con media id y mime* | unit |
| R2 | `tests/unit/types/whatsapp-webhook.test.ts` :: *el caption de una imagen se conserva como cuerpo; sin caption el cuerpo es null* | unit |
| R3 | `tests/unit/types/whatsapp-webhook.test.ts` :: *un media sin id degrada a otro sin lanzar* | unit |
| R4 | `tests/unit/types/whatsapp-webhook.test.ts` :: *una reaction con message_id y emoji se normaliza a reaccion con su objetivo* | unit |
| R5 | `tests/unit/types/whatsapp-webhook.test.ts` :: *una reaction con emoji vacio se normaliza como retirada (emoji null)* | unit |
| R6 | `tests/unit/types/whatsapp-webhook.test.ts` :: *una reaction sin message_id degrada a otro sin lanzar* | unit |
| R7 | `tests/unit/types/whatsapp-webhook.test.ts` :: *contacts normaliza nombre, telefonos y correos y descarta lo no declarado* + `tests/unit/types/chat-contactos.test.ts` | unit |
| R8 | `tests/unit/types/whatsapp-webhook.test.ts` :: *contacts vacio o no parseable degrada a otro sin lanzar* | unit |
| R9 | `tests/unit/types/whatsapp-webhook.test.ts` :: *system normaliza numero anterior y nuevo en los TRES subtipos (`user_changed_number`, `customer_changed_number`, `customer_identity_changed`)* — `it.each` sobre los tres, no solo el antiguo | unit |
| R10 | `tests/unit/types/whatsapp-webhook.test.ts` :: *system sin numero nuevo no migra, degrada y no lanza* | unit |
| R11 | `tests/unit/types/whatsapp-webhook.test.ts` :: *button/interactive/order/request_welcome/ephemeral y un type desconocido caen en otro sin lanzar* | unit |
| R12 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *no duplica un entrante de media ya registrado y solo el insert nuevo sella ultimo_entrante_at* | unit |
| R13 | `tests/integration/db/chat-mensaje-media-migration.test.ts` :: *la migracion crea enum y columnas y el down.sql las revierte* | integration |
| R14 | `tests/components/ChatBurbujaContenido.test.tsx` :: *un mensaje otro con cuerpo null muestra el aviso de mensaje no compatible* + `tests/unit/repositories/chat-mensaje-repository.test.ts` :: *contactos_json corrupto se lee como null* | component + unit |
| R15 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *el proxy no persiste el binario en ningun almacenamiento* | integration |
| R16 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *el cambio de numero reescribe telefono_e164 del hilo* + *LIMITACION CONOCIDA (decision humana 2026-08-27): un entrante desde el numero NUEVO NO resuelve orden y se cuenta sinResolver* + `tests/unit/repositories/chat-conversacion-repository.test.ts` :: *migrarTelefono* | unit |
| R17 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *el cambio de numero no escribe en orden ni cliente* | unit |
| R18 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *deja evidencia con ambos numeros, no la duplica al reprocesar y no rompe si el hilo destino ya existe* | unit |
| R19 | `tests/unit/actions/chat-whatsapp-actions.test.ts` :: *listarHiloChat expone media/contactos/sistema y cuelga las reacciones del mensaje objetivo sin burbuja propia* + `tests/unit/utils/chat-reacciones.test.ts` | unit |
| R20 | `tests/unit/utils/chat-reacciones.test.ts` :: *la ultima reaccion del mismo autor gana y una retirada deja el mensaje sin reacciones* | unit |
| R21 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *devuelve el binario con su Content-Type al mensajero asignado* + `tests/unit/actions/chat-whatsapp-actions.test.ts` :: *la vista no contiene el media id de Meta* | integration + unit |
| R22 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *sin sesion responde 401 y no llama a la Graph API* | integration |
| R23 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *con una orden de otro mensajero responde 403 y no llama a la Graph API* | integration |
| R24 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *media caducada responde 410 expirado* + `tests/components/ChatBurbujaMedia.test.tsx` :: *ante 410 la burbuja dice que el archivo ya no esta disponible* + `tests/unit/clients/whatsapp-media.test.ts` | integration + component + unit |
| R25 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *?descarga=1 responde attachment con filename saneado; un svg sale como octet-stream con nosniff* + `tests/unit/utils/chat-media-headers.test.ts` | integration + unit |
| R26 | `tests/integration/api/chat-media-middleware.test.ts` :: *GET /api/chat/media sin cookie redirige a /login (la ruta no es publica ni self-auth)* | integration |
| R27 | `tests/components/ChatBurbujaContenido.test.tsx` :: *cada uno de los ocho tipos nuevos renderiza contenido perceptible (ninguna burbuja vacia)* | component |
| R28 | `tests/components/ChatBurbujaMedia.test.tsx` :: *la imagen tiene alt y el audio/video exponen controles con nombre accesible* | component |
| R29 | `tests/components/ChatBurbujaMedia.test.tsx` :: *el documento muestra su nombre y ofrece descarga* | component |
| R30 | `tests/components/ChatReacciones.test.tsx` :: *el emoji se pinta dentro del li del mensaje objetivo y no anade una burbuja al hilo* | component |
| R31 | `tests/components/ChatTarjetaContacto.test.tsx` :: *cada dato del contacto se copia y la confirmacion aparece en un role=status* | component |
| R32 | `tests/components/ChatBurbujaSistema.test.tsx` :: *la burbuja de sistema cita ambos numeros y no es entrante ni saliente* | component |
| R33 | `tests/unit/utils/linkificar.test.ts` :: *solo el tramo de la URL se convierte en enlace* + `tests/components/ChatTextoConEnlaces.test.tsx` :: *el enlace lleva target blank y rel noopener noreferrer* | unit + component |
| R34 | `tests/unit/utils/linkificar.test.ts` :: *javascript:, data: y file: no producen enlace* + `tests/components/ChatTextoConEnlaces.test.tsx` :: *una carga con etiquetas HTML se renderiza como texto* | unit + component |
| R35 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *la ingesta no loguea numero, cuerpo ni datos de contacto* + `tests/unit/clients/whatsapp-media.test.ts` :: *el token no aparece en ningun detalle de error* | unit |

## Verificación

`./init.sh` **completo** (el rápido se niega solo: el diff toca `db/schema.prisma`, una migración y
`lib/types/`). Última corrida, 772 s de tests, 1488 archivos (suite no degradada):

```
typecheck  verde
lint       0 errores (118 warnings preexistentes)
vitest     35 failed | 20497 passed | 26 skipped
```

**Delta atribuible a la 311: 0.** De esos 35: **30 son el baseline heredado de `dev`** medido cinco
veces (premio-ranking 20, orden-remision 5, analitica-financiera 2, usuarios-filtro 1,
usuario-descarga 1, superficie-de-uso 1) y **5 son flakes de saturación** en componentes que la
feature no toca (`usuario-form`, `wallet-tiendas-desglose`, `TableroOperativo`,
`DetalleMensajeroPanel`, `CrearTiendaForm`): **los cinco pasan en aislado, 138/138**.

Los 19 archivos de test de la feature, en aislado: **262 verdes, 0 rojos**.

## Lo que queda pendiente y NO se puede cerrar aquí

- **H1 — recorrido manual con un payload real de Meta.** No hay credencial de WhatsApp ni payload
  capturado en este entorno. Es la única verificación que ningún test sustituye, y toca hacerla en
  producción tras el despliegue.
- **P1 — la forma del `system` sigue sin medirse.** Los tres subtipos aceptados y la cascada
  `wa_id → new_wa_id → customer` son **tolerancia, no medición**. Al primer cambio de número real en
  producción hay que confirmar el campo contra lo medido y anotarlo.
- **El histórico no se reconstruye.** Los entrantes ya guardados como `otro` nunca persistieron el
  media id; pasan a decir «Mensaje no compatible», que es lo máximo honesto que se puede hacer.
- **Menores de la revisión sin tocar, por decisión:** M3 (`Content-Length` del metadato puede
  truncar), M4 (Bearer a la URL de Meta sin validar host), M5 (rama 28 commits detrás de `dev`;
  hay que rebasar antes del PR), M6 (= H1).
