# Revisión — Ficha 430 · SF-001 punto 3: contacto al cliente antes de recoger

Rama `feat/430-contacto-antes-de-recoger` (3 commits, `c565a34a..1335f2d7`), 20 archivos.
Revisado el 2026-09-16 en worktree aislado `rev430` (detached en `1335f2d7`), con `.env` copiado
del árbol principal y borrado al terminar. **Nada del árbol principal se modificó.**

## Veredicto: **OK**

Sin bloqueantes. Lo que la ficha pedía está implementado, la regla de la 261 sigue intacta y
medida, y no hay ninguna vía nueva —ni directa ni indirecta— para recoger o gestionar una orden
reservada. Cinco hallazgos `menor`, tres de ellos huecos de cobertura medidos con mutaciones que
**sobreviven**; los dos primeros son baratos de cerrar y merecen cerrarse antes del merge.

## Checklist

| Punto | Estado |
| --- | --- |
| Especificación (`specs/430/**`) | **N/A** — la ficha es `sdd: false`. El diseño vive en `progress/design_sf001_p3_contacto_dia_anterior.md` y está firmado |
| Tasks todas `[x]` | **N/A** — no hay `tasks.md` (sin SDD) |
| Trazabilidad `R<n>` → test | **N/A** — no hay `requirements.md`. Los 4 puntos del alcance de la ficha sí tienen test, y los verifiqué matando el código |
| `pnpm run typecheck` | **verde** (medido) |
| `pnpm run lint` | **verde** (medido) |
| Suite completa (`./init.sh`, CON `.env`) | **1 rojo de 29.175**, flake conocido y AJENO al diff — hallazgo 0 |
| Red de la 261 (6 archivos) | **verde, 72 tests**, y las 3 de `integration/db` corrieron contra Postgres (no `skipped`) |
| RLS / migraciones / `down.sql` | **N/A** — cero archivos de `db/`, `lib/`, `app/api/` |
| Webhooks: firma + idempotencia | **N/A** — ninguno tocado |
| Secretos / hardcode de contexto | **limpio** — el monto sale de `lib/config/moneda`, las fechas las resuelve el servidor, ningún reloj de cliente |
| Capas separadas | **respetado** — 100% composición de cliente; `chat-contactos.ts` es puro y colocado con la pantalla |
| Permisos server-side | **intacto** — `recoger/page.tsx` mantiene su `notFound()` por rol; `ChatDelMensajero` recibe todo por props |
| `progress/history.md` | **pendiente** — se añade al cerrar la ficha |

## Lo que se verificó a mano, en el archivo real

- **No hay vía nueva para trabajar una orden reservada.** La fila del chat es UN `<button>` cuyo
  único handler es `onSeleccionar` (`ChatOrdenesLista.tsx:66-76`). `AsignacionDetalle` —lo que
  monta «Ver detalle»— es presentación pura, sin un solo control («el botón *Gestionar esta orden*
  NO vive aquí», su propio comentario). En `ChatConversacion` los 14 `onClick` son del chat
  (volver, plantilla, adjuntar, grabar, enviar) más el del desplegable. Cero acciones de card.
- **Las acciones del chat no escriben en `orden`.** `findParaEnvio` es un `findFirst` de solo
  lectura; `marcarChatLeido` escribe en `chat_conversacion`. `intentosContacto` solo lo incrementa
  `SolicitudAyudaService`, que el chat no toca. Chatear no cambia el estatus.
- **La afirmación central del implementador es CIERTA, dos veces.** `ChatFlotante.tsx:140` filtra
  el resumen contra `new Set(contactos.todas.map(o => o.id))`, y el total del botón flotante se
  suma DESPUÉS de ese filtro: con dos listas distintas cada pantalla habría contado distinto y
  escondido lo de la otra, sin error visible. El efecto colateral también es cierto:
  `contarNoLeidosPorMensajero` (`ChatConversacionRepository.ts:166-174`) filtra solo por
  `c.mensajero_id` —ni estatus ni fecha—, y `resolverOrdenActivaPorNumero` resuelve entrantes
  contra cualquier orden viva y asignada; una `por_recoger` sí tenía pendientes y el filtro los
  tiraba.
- **Los documentos de ayuda dicen lo que es cierto.** Contrasté las 11 afirmaciones nuevas contra
  el código y las 11 se cumplen: el botón abajo a la derecha, la misma lista en las dos pantallas,
  los tres grupos con los nombres exactos de la 277, «Ver detalle» con dirección/producto/teléfono/
  cobro, la marca «Para mañana» con su fecha, y que desde el chat no se recoge ni se gestiona.

## Hallazgos

### 0 · `menor` — el rojo del gate completo es un flake ajeno al diff
`tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts:260` — `expected 4 to be 3` en
`findBloqueoDetalle`. Es el modo de flake ya documentado (+1 en N/V por la carrera contra la base
local compartida). **Verde 3 de 3 veces en aislado.** El diff no toca un solo archivo de servidor,
así que no puede producirlo. No bloquea, pero el gate que quede en el PR tiene que decirlo.

### 1 · `menor` — el distintivo de «sin leer» de las `por_recoger` NO tiene test (mutación viva)
Mutación en `ChatFlotante.tsx:140`:
`new Set(ordenes.filter(o => o.estatusValue !== "por_recoger").map(o => o.id))` — o sea, reponer
exactamente el comportamiento anterior a la ficha: los pendientes de un paquete sin recoger vuelven
a caerse del distintivo, en silencio. **Resultado: 149 tests en verde**, y otros 65 también verdes
en los dos archivos dedicados a los no leídos (`ChatNoLeidos.test.tsx`,
`chat-whatsapp-actions.test.ts`). Es la razón nº 2 del implementador —la que sostiene la decisión
de una sola lista— y es lo único del cambio que no fija nada. Cuesta un test: `resumenNoLeidosChat`
devolviendo un pendiente de la orden `c` y aserción sobre `chat-no-leidos-c`.

### 2 · `menor` — la guardia de «el chat no ofrece trabajar la orden» no ve dentro del desplegable
`tests/components/ChatContactoAntesDeRecoger.test.tsx:365-373`. El test abre el modal con el
detalle PLEGADO, así que nada de lo que viva dentro de «Ver detalle» entra en su alcance. Medido:
metí un `<button>Gestionar esta orden</button>` dentro del propio desplegable, junto a
`<AsignacionDetalle>`, y **los 16 tests siguieron verdes**. La contraprueba de que el test sí mide
algo en su alcance actual está hecha: el mismo botón en la FILA lo pone rojo. Cerrarlo es una
línea: pulsar «Ver detalle» antes de las dos aserciones negativas.

### 3 · `menor` — `porRecoger` requerida en la prop, pero opcional un piso más abajo
`chat-contactos.ts:67` — `porRecoger: MiAsignacionDTO[] = []`. El argumento para la prop REQUERIDA
es correcto y lo comparto: el typecheck enumeró los productores —los 6 archivos de test tocados son
esa enumeración funcionando— y el `?` habría dejado un fallo mudo. Pero el default reabre el mismo
agujero en la función que compone: quité el tercer argumento en `ChatDelMensajero.tsx:43` y **el
typecheck pasó en verde**; solo dos tests de componente lo cazaron. El default existe «para el
patrón aditivo de los fixtures» y el único fixture que lo usa es la contraprueba de
`chat-contactos.test.ts`, que puede pasar `[]` explícito.

### 4 · `menor` — dos módulos distintos llamados `chat-contactos.ts`
El nuevo `app/(app)/mis-asignaciones/_components/chat/chat-contactos.ts` convive con el ya
existente `lib/types/chat-contactos.ts` (ficha 311, tarjetas de contacto de WhatsApp), que se
importa desde `TarjetaContacto.tsx` — **el archivo de al lado, en la misma carpeta**. Y los tests
se llaman igual (`tests/unit/types/chat-contactos.test.ts` vs
`tests/unit/components/chat-contactos.test.ts`). Nada se rompe; es un tropiezo cognitivo evitable.

### 5 · `menor` — anillo de foco no conforme en la pieza NUEVA
`ChatConversacion.tsx:731` («Ver detalle»): `focus-visible:ring-2 focus-visible:ring-ring/50`.
`DESIGN.md` es explícito —el estándar es `ring-3 ring-ring` OPACO porque con alfa se mide 1,71/2,33
contra el 3:1 de WCAG 1.4.11— y remata con «Pieza nueva: escribe el opaco». Es coherente con sus
vecinos (la fila y el composer llevan el mismo `/50`), pero es deuda nueva, no heredada.

### Nits (no hace falta actuar)
- El bloque «Las dos pestañas» de `docs/ayuda/mensajero/por-recoger.md` las nombra «Órdenes por
  recoger / Órdenes para otro día»; en pantalla dicen «Para recoger hoy (N)» / «Para otro día (N)»
  (`RecogerModule.tsx:354-357`). **Es texto previo a esta ficha**, no lo introdujo el cambio.
- `reparto.md` conserva «Cada orden tiene su chat. Lo abrís desde la orden», que ya no describe la
  única entrada (el botón flotante); la sección nueva, justo debajo, lo corrige.
- La tabla de grupos de `reparto.md` enumera tres, pero la lista puede pintar cuatro secciones: la
  orden «En gestión» se ancla arriba (comportamiento previo, nunca documentado).
- `SECCION_CON_EL_PAQUETE = "En reparto"` repite el literal de `ESTADO_CHIP.en_reparto.label`. Y
  ese grupo contiene también las `ayuda_tienda`, cuyo chip dice «Asignada».

## Mutaciones aplicadas (12) — 9 muertas, 3 vivas

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | `chat-contactos`: todas las `porRecoger` al grupo de hoy | **ROJO** 2 tests |
| 2 | `ChatOrdenesLista`: se borra la frase con la fecha de la fila | **ROJO** 1 test |
| 3 | `ChatConversacion`: la nota del día se pinta SIEMPRE | **ROJO** 1 test |
| 4 | `ChatDelMensajero`: se cae el 3er argumento de `agruparContactosChat` | **ROJO** 2 tests — pero typecheck VERDE (hallazgo 3) |
| 5 | contador = `conElPaquete.length` | **ROJO** 2 tests |
| 6 | botón «Gestionar» falso en la FILA de la lista | **ROJO** 1 test (la guardia sí mide) |
| 7 | el detalle arranca desplegado | **ROJO** 2 tests |
| 9 | `ChatFlotante`: el filtro de no leídos vuelve a tirar las `por_recoger` | **VIVA** — 149 + 65 tests verdes (hallazgo 1) |
| 10 | `todas` sin `paraOtroDia` | **ROJO** 4 tests |
| 11 | `RepartoModule`: `porRecoger` se cuela en la grilla visual (cards con «Gestionar») | **VIVA** — 160 tests verdes, incluida la red de la 261 |
| 12 | botón «Gestionar» falso DENTRO del desplegable «Ver detalle» | **VIVA** — 16 tests verdes (hallazgo 2) |

Sobre la 11: hoy el código es correcto —`porRecoger` aparece en 4 sitios de `RepartoModule.tsx`
(106 comentario, 109 prop, 173 destructuring, 332 el memo) y ninguno alimenta la grilla, el mapa,
el panel ni el buscador—. Pero la ficha acerca esa lista a un sitio donde antes no llegaba, y
ningún test protege la distancia. El servidor sí: la red de la 261 rechaza igual, y la corrí verde.

## Sobre el hueco del gate rápido (188 archivos saltados)

**De acuerdo, y ya no hace falta suponerlo.** Corrí `./init.sh` completo CON `.env`: los 272
archivos de `integration/db` se ejecutaron (ni un `↓`), 29.148 tests en verde, 26 `skipped`
—condicionales de dos archivos de componentes, ajenos a esto— y el único rojo es el flake del
hallazgo 0.

## Alcance: el punto 5 del diseño no se implementó

El diseño firmado lista cinco puntos y el quinto es «cerrar de paso el agujero del servidor: hoy la
autorización del chat no mira fecha ni estado». El `status_note` de la ficha —el alcance que aprobó
el humano— enumera solo los cuatro primeros, así que **no es un incumplimiento**; pero el informe
del implementador no lo declara. Conviene decirlo en voz alta al cerrar: la autorización del chat
sigue siendo «es tuya y está viva», sin lista blanca de estatus.

## Nota sobre el baseline de rojos

El gate cerró con `✗ hay rojos NUEVOS respecto del baseline` por ese único archivo. Seguí el
procedimiento que el propio gate escribe dos líneas más abajo —«antes de darlo por ajeno, corre ese
archivo AISLADO: los flakes de saturación pasan solos y no son deuda de nadie»— y pasó **3 de 3**.
Así que **no** hay que añadirlo a `tests/baseline-rojos.json`: no es deuda, es saturación.

Evidencia completa de esta revisión: `progress/gate_review_430.log` (13.114 líneas, `INIT_EXIT=1`
por ese flake).
