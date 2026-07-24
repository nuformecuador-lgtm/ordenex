# Feature 121 — Tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con sus hermanos del
> mismo bloque. Cada task lleva criterio de "hecho" y cita los `R<n>` que cubre con su test.
> Extiende la feature 120: NO empezar hasta que la gate F1.4 apruebe este spec y la 120 haya
> aterrizado (ver `feature_list.json` id 121, `depends_on: 120`). Al final, el mapa R→test
> (regla del arnés: un requisito sin test que lo cubra hace que el reviewer rechace).

## Bloque A — Datos y migración

- [x] **A1.** En `db/schema.prisma`: añadir el valor `ubicacion` al enum `ChatMensajeTipo` y
  las columnas `latitud Float? @map("latitud")` / `longitud Float? @map("longitud")` al modelo
  `ChatMensaje` (design §1.1). Cubre R7. *Hecho:* `pnpm db:generate` compila y el tipo
  `ubicacion` aparece en `ChatMensajeTipo` de `@prisma/client`.
- [x] **A2.** Crear migración `db/migrations/<ts>_chat_mensaje_ubicacion/migration.sql` (UP):
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'ubicacion'` + `ADD COLUMN latitud/longitud DOUBLE
  PRECISION`, con el comentario del GOTCHA 55P04 (design §1.2). Depende de A1. Cubre R7.
  *Hecho:* la migración aplica en DB de test sin error.
- [x] **A3.** Escribir `down.sql` que revierte A2: `DROP COLUMN` de ambas columnas + recreación
  del enum sin `ubicacion` (patrón feature 106), documentando la precondición "ninguna fila
  con tipo=ubicacion" (design §1.2). Depende de A2. Cubre R7. *Hecho:* `pnpm db:rollback` deja
  el esquema como antes en una DB sin filas de ubicación.

## Bloque B — Borde tipado del webhook

- [x] **B1.** En `lib/types/whatsapp-webhook.ts`: añadir `location: z.object({ latitude:
  z.number(), longitude: z.number() }).optional()` a `metaMessageSchema`; extender
  `WebhookMensajeEntrante` con `ubicacion?: { latitud; longitud }`; ampliar `tipoDeMeta`/
  `parseWebhookEventos` para normalizar `type="location"` con coords válidas a
  `tipo="ubicacion"` + `ubicacion`, y degradar a `otro` sin coords si faltan/invalidas/fuera de
  rango (helper `esCoordenadaValida`, design §2). Depende de A1. Cubre R1, R2, R3. *Hecho:*
  tests B1.T verdes.

## Bloque C — Repositorio e interfaz

- [x] **C1. [P]** En `IChatMensajeRepository`: añadir `latitud?/longitud?` a
  `InsertarEntranteInput` y `latitud/longitud: number | null` a `ChatMensajeDTO` (design §4).
  Depende de A1. Cubre R4, R8 (contrato). *Hecho:* typecheck ok.
- [x] **C2.** En `ChatMensajeRepository`: incluir `latitud`/`longitud` en `SELECT`, `Row`,
  `toDTO`, y en el `data` de `insertarEntranteIdempotente`; salientes quedan `null` (design
  §4). Depende de C1. Cubre R4, R5 (dedupe con columnas nuevas), R8. *Hecho:* test de repo
  C2.T verde (persiste lat/lng en el entrante; dedupe sigue omitiendo el reenvío).

## Bloque D — Service

- [x] **D1.** En `ChatWhatsappService.ingerirEventos`: propagar
  `latitud`/`longitud` desde `mensaje.ubicacion` al `insertarEntranteIdempotente`, sin tocar
  el dedupe ni el `marcarUltimoEntrante` (design §3). Depende de B1, C2. Cubre R4, R5, R6.
  *Hecho:* tests D1.T verdes (unit, sin DB): registra la ubicación con coords; no duplica ante
  `wa_message_id` repetido; el entrante de ubicación sella `ultimo_entrante_at` y el
  deduplicado no lo re-sella.

## Bloque E — Contrato hacia la UI (Server Action)

- [x] **E1.** En `lib/types/chat-whatsapp.ts` (`ChatMensajeVista`) añadir `latitud/longitud:
  number | null`; en `lib/actions/chat-whatsapp.ts` (`listarHiloChat`) mapear ambos campos del
  DTO a la vista (design §4). Depende de C2. Cubre R8, R16 (scope reutilizado). *Hecho:* test
  E1.T verde (los entrantes de ubicación exponen lat/lng; los demás mensajes exponen `null`; el
  scope por mensajero sigue rechazando órdenes ajenas).

## Bloque F — UI: burbuja, modal y minimapa

- [x] **F1.** `UbicacionMapaInner.tsx` + wrapper `UbicacionMapa.tsx`
  (`next/dynamic({ ssr:false })`) en `mis-asignaciones/_components/`, calcando el patrón de la
  feature 97: 2 marcadores `L.divIcon` (cliente + repartidor), reencuadre, tiles OSM (design
  §5.2). Cubre R14 (anti-SSR) y la base de R10/R11/R12. *Hecho:* test F1.T verde (el wrapper
  usa `dynamic` con `ssr:false`; el inner dibuja 2 marcadores con 2 puntos y 1 con uno solo).
- [x] **F2.** En `ChatWhatsappPanel.tsx` (`Burbuja`): para `tipo==="ubicacion"` con coords,
  renderizar botón con icono `MapPin` y etiqueta accesible corta, sin volcar coords al DOM
  visible (design §5.1). Depende de E1. Cubre R9, R15 (no expone coords en texto). *Hecho:*
  test F2.T verde (la burbuja de ubicación muestra el icono clicable; una burbuja de texto no).
- [x] **F3.** Modal (Dialog shadcn) abierto por el icono de F2, que al abrir llama
  `pedirUbicacion()` (`useUbicacionActual`) y monta `UbicacionMapa` con el punto del cliente +
  el GPS del repartidor; cerrar sin recargar (design §5.2). Depende de F1, F2. Cubre R10, R11,
  R13. *Hecho:* test F3.T verde (al pulsar el icono se abre el Dialog con el minimapa; se cierra
  sin recargar; con GPS disponible pasa 2 puntos al mapa).
- [x] **F4.** Degradación sin GPS: si `pedirUbicacion()` resuelve `null`, el minimapa muestra
  solo el punto del cliente y el Dialog muestra el aviso, sin bloquear (design §5.2). Depende
  de F3. Cubre R12. *Hecho:* test F4.T verde (con `pedirUbicacion` mockeado a `null`, se
  renderiza el aviso y un solo punto; el modal sigue abrible/cerrable).

## Bloque G — Verificación final

- [x] **G1.** `./init.sh` en verde + suite de tests completa (incluye los nuevos). *Hecho:* CI
  local verde.
- [x] **G2.** Actualizar `progress/impl_121.md` con el mapa R→test completo (regla del arnés
  §4). *Hecho:* archivo escrito y consistente con la tabla de abajo.

---

## Mapa R → test (trazabilidad)

| Requisito | Test | Tipo |
| --- | --- | --- |
| R1 | B1.T `normaliza type=location con coords válidas a tipo ubicacion con lat/lng` | unit |
| R2 | B1.T `descarta name/address del objeto location sin romper el parseo` | unit |
| R3 | B1.T `location sin coords numéricas válidas o fuera de rango degrada a otro sin coords y no lanza` | unit |
| R4 | D1.T `registra el entrante de ubicación con lat/lng en el hilo` + C2.T `persiste lat/lng` | unit + integration |
| R5 | D1.T `no duplica la ubicación ante wa_message_id ya registrado` + C2.T dedupe | unit + integration |
| R6 | D1.T `un entrante de ubicación nuevo sella ultimo_entrante_at; el deduplicado no lo re-sella` | unit |
| R7 | A2/A3 `la migración aplica y el down.sql revierte enum+columnas` | migración/integration |
| R8 | E1.T `listarHiloChat expone lat/lng en entrantes de ubicación y null en los demás` | unit |
| R9 | F2.T `la burbuja de ubicación muestra un icono clicable, la de texto no` | component |
| R10 | F3.T `al pulsar el icono se abre el Dialog con el minimapa` | component |
| R11 | F3.T `al abrir el modal captura el GPS y pasa 2 puntos al minimapa` | component |
| R12 | F4.T `sin GPS del repartidor muestra solo el punto del cliente y un aviso, sin bloquear` | component |
| R13 | F3.T `el modal se cierra sin recargar la página` | component |
| R14 | F1.T `el minimapa se carga con next/dynamic ssr:false` | component |
| R15 | F2.T `la burbuja no vuelca coordenadas en el DOM visible` + revisión de logs en B1/D1 | component + unit |
| R16 | E1.T `listarHiloChat sigue rechazando órdenes de otro mensajero (scope reutilizado)` | unit |

> Nota R15 (logs): además de F2.T, los tests de B1 y D1 verifican que ni el normalizador ni el
> service registran coordenadas o número en logs (aserción sobre `console`), consistente con
> R11 de la feature 120.
