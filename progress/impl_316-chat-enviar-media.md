# Feature 316 — bitácora de implementación

> El mensajero puede ENVIAR imagen, vídeo, nota de voz y documentos por el chat.
> Rama `feature/316-chat-enviar-media`, sobre `origin/dev` (HEAD de partida `8f9916cb`).
> Medido el 2026-08-28. **Sin commit**: el aterrizaje lo hace el leader.

## Veredicto

Las 32 tareas de requisito están implementadas y con test verde. **238/238 tests de la
feature en verde**, typecheck limpio, lint sin errores. Quedan **dos rojos ajenos** y
**una medición de campo (S1)** que no se puede hacer sin un iPhone. Ver "Estado real".

## Reparto y bloques

| Bloque | Tasks | Agente |
| --- | --- | --- |
| A — política de subida y contrato de escritura | A0, A1, A2, A3 | backend_dev |
| A4 — normalización de imagen + E3 — textos por dirección | A4, E3 | frontend_dev |
| B/C/D — Meta, service y Server Action | B1, B2, B3, C1, C2, D1, D2 | backend_dev |
| E/F1 — composer, nota de voz y burbuja | E1, E2, F1 | frontend_dev |
| F2 — el proxy sirve un saliente sin cambios | F2 | backend_dev |
| Guard desplazado por la feature | — | backend_dev |

## Archivos creados

- `lib/config/chat-media-envio.ts` — política de SUBIDA (aparte de `chat-media.ts`, que es de SERVIDO)
- `lib/clients/whatsapp-media-upload.ts` — subida multipart a la Graph API
- `app/(app)/mis-asignaciones/_components/chat/hooks/useGrabadorVoz.ts`
- `tests/unit/config/chat-media-envio.test.ts`
- `tests/unit/types/chat-media-envio-tipos.test.ts`
- `tests/unit/utils/comprimir-imagen.test.ts` (el helper no tenía NINGÚN test antes)
- `tests/unit/clients/whatsapp-media-upload.test.ts`
- `tests/unit/clients/whatsapp-cloud-enviar-media.test.ts`
- `tests/components/ChatComposerAdjunto.test.tsx`
- `tests/components/ChatNotaVoz.test.tsx`

## Archivos modificados

- `lib/interfaces/repositories/IChatMensajeRepository.ts` — 4 campos media en InsertarSalienteInput
- `lib/repositories/ChatMensajeRepository.ts` — insertarSaliente escribe esas 4 columnas
- `lib/clients/whatsapp-cloud.ts` — enviarMedia (JSON, reusa el enviar privado)
- `lib/services/whatsapp/chat-logger.ts` — redacta caption y filename
- `lib/services/ChatWhatsappService.ts` — enviarMedia, guarda de reintentarEnvio, re-tipado de persistirFalloPermanente
- `lib/types/chat-whatsapp.ts` — EnviarMediaChatResult
- `lib/actions/chat-whatsapp.ts` — Server Action enviarMediaChat(formData, deps)
- `lib/utils/comprimir-imagen.ts` — UNA opción aditiva devolverOriginalSiMayor (default true)
- `app/(app)/mis-asignaciones/_components/chat/ChatConversacion.tsx` — composer con adjuntos
- `app/(app)/mis-asignaciones/_components/chat/MediaAdjunto.tsx` — prop direccion
- `app/(app)/mis-asignaciones/_components/chat/BurbujaContenido.tsx` — solo propaga direccion
- `app/(app)/mis-asignaciones/_components/chat/chat-format.ts` — textoAccesible(tipo, direccion)
- Ampliados: `tests/unit/repositories/chat-mensaje-repository.test.ts`,
  `tests/unit/services/chat-whatsapp-service.test.ts`,
  `tests/unit/services/whatsapp-fallo-saliente.test.ts`,
  `tests/unit/actions/chat-whatsapp-actions.test.ts`,
  `tests/components/ChatBurbujaMedia.test.tsx`,
  `tests/integration/api/chat-media-proxy.route.test.ts`
- `tests/unit/guards/credenciales-sin-consola-cruda.guardia.test.ts` — ver "Guard desplazado"

**CERO migraciones** (git status de db/ y git diff contra origin/dev en db/migrations, ambos vacíos).
**El proxy `app/api/chat/media/[mensajeId]/route.ts` NO se tocó** (git status de esa ruta, vacío).

## Mapa R -> test (medido, con el nombre real del it)

| R | Test (ruta) | it |
| --- | --- | --- |
| R1 | `tests/components/ChatComposerAdjunto.test.tsx` | R1: el clip ofrece las CUATRO vias de adjuntar, cada una con nombre accesible |
| R2 | idem | R2: sin texto libre habilitado el clip esta deshabilitado y se explica por que |
| R3 | `tests/unit/services/chat-whatsapp-service.test.ts` | (a) R3: fuera de la ventana de 24 h NO sube nada ni persiste nada |
| R4 | `tests/components/ChatComposerAdjunto.test.tsx` | R4: el adjunto se ve antes de enviarlo y Quitar adjunto lo retira sin enviar nada |
| R5 | idem + `tests/unit/clients/whatsapp-cloud-enviar-media.test.ts` | R5: con adjunto y texto sale UN SOLO mensaje, con el texto como pie / (a) imagen con pie |
| R6 | `tests/components/ChatNotaVoz.test.tsx` + cloud + service | R6: la nota va SIN pie y el texto escrito NO se pierde al enviarla / (b) R6: en audio NO existe la clave caption aunque se pase |
| R7 | `tests/components/ChatComposerAdjunto.test.tsx` | R7: con el envio en vuelo, un segundo click y un Enter no mandan el adjunto dos veces |
| R8 | `tests/unit/config/chat-media-envio.test.ts` | (a) deriva el tipo de mensaje del MIME |
| R9 | config + service + composer | (b) webp y heic NO estan / (b) R11: un mime fuera de la lista blanca / R9: un tipo que no es imagen y no esta en la lista blanca se rechaza con OTRO texto |
| R10 | config + service | (c) el limite de imagen es exclusivo / (f) LIMITE_BYTES.documento REFERENCIA la constante |
| R11 | `tests/unit/actions/chat-whatsapp-actions.test.ts` | (c) R11: 6 MB se rechaza AUNQUE el FormData declare un tamano mentiroso |
| R12 | actions + composer | (d) R12: un pie de MAX_CAPTION + 1 -> caption_largo / R12: con adjunto el composer baja su tope al maximo de un pie de adjunto |
| R13 | `tests/components/ChatNotaVoz.test.tsx` | R13: tras detener se puede ESCUCHAR la nota y Descartar la borra sin enviar nada |
| R14 | idem | R14: graba en el PRIMER formato de la lista de Meta que el dispositivo soporta |
| R15 | idem | R15: sin formato aceptado la via queda deshabilitada, se dice, y las otras TRES siguen |
| R16 | idem | R16: si se deniega el microfono se dice, no se queda en Grabando y no se envia nada |
| R17 | service + repo + upload | (c) R17: camino feliz / R17: insertarSaliente escribe las cuatro columnas |
| R18 | `tests/unit/services/chat-whatsapp-service.test.ts` | (f) R18: ningun argumento persistido lleva los bytes, ni un Blob, ni un ArrayBuffer |
| R19 | service + composer | (d) R19: si la SUBIDA falla / R19: si el envio falla, el adjunto SIGUE en el composer para reintentar |
| R20 | `tests/unit/services/chat-whatsapp-service.test.ts` | (e) R20: un transitorio del envio queda failed con su media id y SIN encolar |
| R21 | idem | R21: un queued de tipo imagen NO se reenvia como texto (+ regresion 109/120 de texto) |
| R22 | `tests/components/ChatBurbujaMedia.test.tsx` | R22: el adjunto propio se pinta a la derecha, con su adjunto y su acuse |
| R23 | idem | textos por direccion: saliente sin "cliente", entrante conserva el de la 311 |
| R24 | `tests/integration/api/chat-media-proxy.route.test.ts` | 200 al mensajero asignado, 403 a otro, sin media_id en la respuesta |
| R25 | proxy + burbuja | 410 con expirado / R25: un adjunto PROPIO caducado dice que el archivo ya no esta disponible |
| R26 | `tests/unit/actions/chat-whatsapp-actions.test.ts` | (a) R26: sin sesion -> unauthenticated, sin tocar la orden ni el service |
| R27 | idem | (b) R27: orden de otro mensajero -> forbidden, sin llamar al service |
| R28 | upload + logger | (e) ningun detalle lleva el token ni el nombre del archivo, en NINGUNA rama / el volcado NO contiene el pie ni el nombre del archivo, y SI el codigo HTTP |
| R29 | `tests/unit/utils/comprimir-imagen.test.ts` + composer | heic 3 MB y heic 200 KB con saltarSiMenorA 0 salen image/jpeg / R29: un HEIC de iPhone se sube convertido a JPEG y el ORIGINAL no se sube |
| R30 | helper + composer | createImageBitmap con imageOrientation from-image / R30: una foto de 8 MB que al convertir pesa 1 MB SI se envia |
| R31 | helper + composer | toBlob null devuelve el original / R31: si la conversion no se pudo completar, el aviso es propio y NO el de tipo no permitido |
| R32 | `tests/components/ChatComposerAdjunto.test.tsx` | R32: un JPEG de 9 MB se normaliza y se envia + R32: si tras convertir sigue por encima de 5 MB se rechaza por TAMANO |
| — | regresion de las 4 superficies del helper | con el default devolverOriginalSiMayor true, un blob mayor devuelve el ORIGINAL |

**Sin requisitos huérfanos: los 32 tienen test verde.**

## Estado real de la verificación (salida medida, no copiada)

```
pnpm exec vitest run <los 13 archivos de la 316>
  Test Files  13 passed (13)
       Tests  238 passed (238)

pnpm run typecheck   -> limpio, sin salida de error
pnpm run lint        -> 119 problems (0 errors, 119 warnings); ninguna en archivos de la 316
pnpm exec vitest run tests/unit/guards
  Test Files  1 failed | 85 passed (86)
       Tests  1 failed | 1284 passed (1285)   <- el unico rojo es AJENO (ver abajo)
```

### Rojos que NO son de esta feature (verificados contra origin/dev, no supuestos)

1. **`tests/unit/services/usuario-descarga.test.ts`** — falla por una clave `zonaNombre` de más.
   Viene del commit `e81bb003`, y `git merge-base --is-ancestor e81bb003 origin/dev` confirma que
   **ya está en dev**. La 316 no toca usuarios ni descargas.
2. **`tests/unit/guards/superficie-de-uso.guardia.test.ts`** — señala `lib/actions/tarifas.ts:67
   obtenerTarifa`. `git status` de ese archivo sale **vacío**: la 316 no lo toca.
   Dato a favor: el guard **ya no** lista `enviarMediaChat`, porque la Server Action nueva sí tiene
   superficie desde el composer.

### Guard desplazado POR esta feature (causado y reparado aquí)

`tests/unit/guards/credenciales-sin-consola-cruda.guardia.test.ts` declara una excepción
**posicional** para un console.log preexistente de `lib/clients/whatsapp-cloud.ts`. Ese console.log
existe igual en origin/dev (**no lo introdujo la 316 y no se ha borrado**), pero añadir
`enviarMedia()` lo desplazó de la **línea 382 a la 415**, y el guard pasó a rojo. Se actualizó el
número en los tres sitios donde se citaba, conservando el motivo escrito. No se metió el archivo en
ningún whitelist ni se relajó el assert. Queda **7/7 verde**.

> Deuda declarada, no resuelta aquí: la anotación sigue siendo posicional y **volverá a caducar** con
> el próximo cambio que desplace líneas en ese archivo. El propio guard dice que se cita "para que
> otra ficha la retire". Retirar ese console.log —que imprime el wabaId y duplica una URL que la
> función construye dos líneas más abajo— mataría el mantenimiento recurrente de una vez.

### Artefacto local que ensuciaba el gate

`.vitest-rojos.json` (8 MB, untracked, **no está en .gitignore**) es un volcado de resultados de
vitest que contiene nombres de test con la palabra "embalaje", y por eso hacía fallar
`tests/unit/guards/no-embalaje.test.ts` **sin que hubiera código culpable**. Se apartó al scratchpad
de la sesión (no se borró) y el guard volvió a verde. **Recomendación para el leader: añadir
`.vitest-rojos.json` a `.gitignore`.** RESUELTO: el leader lo hizo en el commit `6501cf84`, donde
ese archivo pasa a estar gitignoreado y a ser el insumo de `scripts/comparar-baseline-rojos.mjs`.

## Desviaciones del spec, con su motivo

1. **clasificarAdjunto normaliza el MIME base** (minúsculas y sin parámetros: `audio/ogg;codecs=opus`
   -> `audio/ogg`). No estaba escrito en el design, pero sin ello la feature se rompe sola: §6.2 dice
   que el File de la nota de voz lleva el `recorder.mimeType` REAL, y MediaRecorder lo entrega *con*
   el parámetro de codec, así que una nota en ogg —formato que Meta **sí** acepta— se habría
   rechazado como tipo_no_permitido. `audio/webm;codecs=opus` sigue dando null, con assert.
2. **Contradicción REAL del design, resuelta y anotada.** El assert (e) de A1 pedía que "todos los
   elementos de FORMATOS_NOTA_VOZ estén en MIMES_ENVIO.audio", pero §6.2 hace que la lista empiece
   por `audio/ogg;codecs=opus`, string que §2 no incluye en el set. Es **imposible de satisfacer
   literalmente**: §2 y §6.2 se contradicen entre sí. Se asserta lo que importa —el MIME base sí está
   en MIMES_ENVIO.audio, clasificarAdjunto(formato) es "audio", y ningún formato empieza por
   `audio/webm`—, con lo que la regresión que la task buscaba sigue en pie.
3. **TIMEOUT_SUBIDA_MS = 60_000.** El design solo pedía "más generoso que el de envío"; no daba
   número. El test asserta > 10_000 para no congelar un valor arbitrario. Queda escrito que un
   documento pegado a 25 MB por uplink móvil puede agotarlo igual, y que ese caso cae en
   fallo_subida con el adjunto conservado (R19).
4. **ChatClient.enviarMedia se declara Partial**, no obligatorio: exigirlo rompía el typecheck de
   todos los fakes de ingesta/texto existentes. El service lo exige en runtime.
5. **El desenlace del service se llama EnviarMediaChatOutcome**, para no chocar con el
   EnviarMediaChatResult que consume la UI; la action mapea con un switch exhaustivo. Un transitorio
   de Meta se persiste failed y se devuelve como permanente, único slot del union.
6. **B3: caption y filename van a CLAVES_CONTENIDO, no a CLAVES_PII.** No identifican al destinatario
   y el marcador <str:N> conserva la LONGITUD, que es justo el dato que explica el 400 más probable
   de esta feature (pie por encima de MAX_CAPTION). El texto y el nombre no aparecen; el código HTTP
   sí. **Nota heredada, no introducida aquí:** con WHATSAPP_DEBUG_LOG=true el volcado sigue siendo
   literal (comportamiento previo, opt-in).
7. **Un FormData sin archivo devuelve forbidden**: design §5 no contempla ese caso y es una petición
   malformada, mismo trato que un ordenId inválido. Con test.
8. **textoAccesible cubre imagen/sticker/audio/video, no documento**: el nombre accesible de un
   documento es el nombre del archivo, y el design §6.3 no define texto atribuido al autor para él.
9. **R16 partido en dos it**: el assert literal pedía aviso + no quedarse en "Grabando" + stop() de
   las pistas en el mismo caso de getUserMedia rechazado, pero **ahí no hay stream y por tanto no hay
   pista que parar**; ese assert habría sido ficción. El cierre del micrófono se cubre en el caso
   real (el MediaRecorder no arranca tras conceder el permiso) y al descartar.
10. **Los avisos de validación previos al envío son inline (role="alert"), no toast**; los fallos del
    servidor sí van por toast. El aviso debe seguir visible mientras el mensajero decide, y así el
    assert no depende del temporizador de auto-descarte.
11. **Las líneas citadas en el spec para MediaAdjunto.tsx (~146, 147, 194) no coincidían** con el
    archivo real (100/101/134). Se sustituyó por contenido, no por número de línea.

## S1 — supuesto que sigue SIN medir

Qué File.type entrega iOS por la vía cámara frente a "Examinar". **No hubo ningún iPhone en esta
sesión**, así que sigue abierto y se declara como tal. **No condiciona el comportamiento**: el camino
de R29–R32 normaliza igual venga JPEG o venga HEIC, y hay test de los dos casos. Lo único que cambia
según la medición es cuánta batería y memoria gasta la conversión en iOS, y si conviene mencionar la
vía "Examinar" en el texto de ayuda. Cómo medirlo está escrito en
`specs/316-chat-enviar-media/requirements.md > Preguntas abiertas`.

## Lo que queda fuera de esta bitácora

- **F4 (./init.sh --rapido)**: lo corre el leader. Aquí se dejan medidos typecheck, lint, los 238
  tests de la feature y las 86 suites de guardias.
- **Commit, merge y PR**: los hace el leader, por instrucción explícita.
- **Comprobación a ojo en un móvil real** de que la foto no llega girada (R30): jsdom no rasteriza,
  así que el test solo puede afirmar que createImageBitmap recibe imageOrientation "from-image". El
  propio tasks.md dice que eso se mira a ojo y se anota; **no se ha hecho**.

## F4 — gate completo (medido el 2026-08-28, tras el arnés de baseline `6501cf84`)

`./init.sh --rapido` **se negó solo**, como estaba previsto: el diff toca `lib/types/chat-whatsapp.ts`
(y `init.sh`/`package.json`, del propio arnés). Mensaje literal: *"esto exige el gate completo"*.
No se esquivó: se corrió `./init.sh` entero.

```
./init.sh   (gate completo, 538.62 s de suite)
  feature_list.json  -> OK (sin ids duplicados, cupo por zona respetado)
  typecheck          -> paso
  lint               -> paso
  Test Files  5 failed | 1505 passed (1510)
       Tests  5 failed | 20949 passed | 26 skipped (20980)
  veredicto: ROJOS NUEVOS respecto del baseline (2 archivos)
```

### Los 5 rojos, uno por uno

| Archivo | Baseline | Qué es |
| --- | --- | --- |
| `tests/integration/db/usuarios-filtro-busqueda.test.ts` | conocido | deuda ajena ya registrada |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` | conocido | `lib/actions/tarifas.ts`, ajeno |
| `tests/unit/services/usuario-descarga.test.ts` | conocido | `zonaNombre`, commit `e81bb003` ya en dev |
| `tests/components/GenerarApiKeyForm.test.tsx` | **NUEVO** | **flake de saturación** |
| `tests/components/TableroOperativo.test.tsx` | **NUEVO** | **flake de saturación** |

**Los dos "nuevos" pasan AISLADOS**, que es justo lo que el propio gate manda comprobar antes de
darlos por ajenos:

```
pnpm exec vitest run tests/components/GenerarApiKeyForm.test.tsx tests/components/TableroOperativo.test.tsx
  Test Files  2 passed (2)
       Tests  61 passed (61)
```

Además **ninguno de los dos está en el diff de la 316** (`git status` de ambos, vacío): no importan
nada de `lib/config/chat-media-envio.ts`, del service de chat ni del composer. Encaja con el
precedente ya documentado del repo: la suite completa tira 2–4 rojos que **cambian de archivo entre
corridas** y pasan en aislado.

**NO se ha tocado `tests/baseline-rojos.json`.** Editarlo para pasar el gate es exactamente la
trampa que el arnés existe para impedir, y estos dos ni siquiera son deuda estable: son flakes, y
meterlos en el baseline los volvería permanentes y taparía una regresión futura de verdad en esos
mismos archivos. **Decisión del leader**, no del implementer.

**F4 queda SIN marcar**: el gate no salió verde. Lo que está medido es que sus 5 rojos son ajenos o
flakes, y que typecheck, lint y los 238 tests de la 316 están en verde.

> El guard `no-embalaje` **ya no aparece** entre los rojos: el `.gitignore` del commit `6501cf84`
> resolvió la contaminación del artefacto, confirmando el diagnóstico de la sección anterior.
