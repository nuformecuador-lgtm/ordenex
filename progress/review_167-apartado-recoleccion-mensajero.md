# review 167 — apartado propio de recolección para el mensajero

> Revisor: `reviewer`. Fecha: 2026-07-31. Rama `feature/167-apartado-recoleccion-mensajero`
> (worktree `lote-135`), diff contra `origin/dev`.
> Leído antes de revisar: los tres archivos de `specs/167-apartado-recoleccion-mensajero/`,
> `progress/impl_167-apartado-recoleccion-mensajero.md`, `docs/architecture.md`,
> `docs/conventions.md`, `docs/verification.md` y `CHECKPOINTS.md`.
>
> **Nada se dio por bueno de la bitácora.** Los comandos se re-ejecutaron aquí y las
> afirmaciones de cobertura se comprobaron por muestreo abriendo el test citado, y en tres
> puntos **por mutación propia** (guard de no-reintroducción, enlace a `/recoleccion`,
> reintroducción bajo el nombre nuevo).

---

## 1. Verificación ejecutable (corrida por el reviewer, no copiada)

| Comando | Resultado medido aquí | Veredicto |
| --- | --- | --- |
| `pnpm run typecheck` | sin salida (verde) | ✔ |
| `pnpm run lint` | `25 problems (3 errors, 22 warnings)` — los 3 errores en `app/(app)/ordenes/_components/OrdenesModule.tsx:340,345`, archivo **byte-idéntico a `origin/dev`** (`git diff origin/dev --stat` vacío) | ✗ por deuda AJENA; la 167 no añade ni un problema |
| `pnpm test` (suite completa) | `Test Files 2 failed / 663 passed (665)` · `Tests 7 failed / 8035 passed (8042)` | rojos AJENOS, ver §1.1 |
| `./init.sh` | corta en `lint` (`✗ 'pnpm run lint' fallo`); nunca llega a `test` | ✗ por la misma deuda ajena |
| Los 13 archivos de la feature juntos | `Test Files 13 passed (13)` · `Tests 326 passed (326)` | ✔ |

### 1.1 Los 2 archivos rojos: comprobado que son ajenos

- `tests/unit/analytics/frontera.guardia.test.ts` (6 casos) — `git diff origin/dev` **vacío**.
  Guard pinneado a la 135 que mide el diff de la rama ACTUAL y exige que viva en `lib/analytics/`.
  Falla en cualquier rama que toque `app/`. Uno de sus casos es literalmente "no añade rutas,
  páginas ni componentes en app o components", que es lo que **R1 ordena hacer**. Confirmo P3.
- `tests/unit/guards/no-embalaje.test.ts` (1 caso) — el diff contra `origin/dev` es **una sola
  línea de whitelist** (D3). Comprobado que su único hallazgo restante es
  `specs/135-analitica-catalogo-kpis-rangos/tasks.md:187`, que está en `origin/dev`. La 167 no
  aporta ningún hallazgo nuevo al guard.

Descontando esos dos archivos, la suite queda en **663/663 archivos y 8032/8032 casos verdes**:
coincide con lo medido por el leader y por el implementer.

### 1.2 Comprobado que el lint no empeoró por esta feature

Los 3 errores están en un archivo intocado. Revisé además el único warning que podía haber
nacido del corte limpio: `tests/components/MisAsignacionesModule.test.tsx:136
'ordenCardsEnReparto' is defined but never used` — **ya estaba sin usar en `origin/dev`**
(la misma única línea de definición, sin usos). Baseline 26 problemas → ahora 25. Ni uno nuevo.

---

## 2. Trazabilidad: los 39 requisitos, uno por uno

Muestreo abriendo el archivo citado y leyendo el cuerpo del caso (no solo su nombre).
**Ningún `R<n>` queda sin test.** Dos quedan con cobertura PARCIAL, detallada en §4.

| R | Test comprobado | Estado |
| --- | --- | --- |
| R1 | `RecoleccionPage.test.tsx` → "R1/R2: …título propio y el apartado montado" + `entregas-sin-recoleccion.test.ts` → "el apartado … SIGUE existiendo" | ✔ |
| R2 | `RecoleccionPage.test.tsx` → mismo caso (render real de la página) | ✔ |
| R3 | `RecoleccionPage.test.tsx` → 4 casos: 5 roles ajenos → `notFound` **y sin disparar consulta**, sin sesión, `forbidden`, `unauthenticated` | ✔ |
| R4 | `menu-visibility.test.ts` → un único ítem con href `/recoleccion`, lo ve el mensajero, ningún otro rol ni actor ausente, lista EXACTA del mensajero, posición justo tras "Entregas", sin subítems | ✔ |
| R5 | `menu-visibility.test.ts` → `iconKey === "store"` y ningún otro ítem la usa (+ contraste con `entregas.iconKey`) · `Sidebar.test.tsx` → clase `lucide-store`. Refuerzo TIPADO: `IconKey` es unión cerrada y `ICON_BY_KEY` es `Record<IconKey, SidebarIcon>` | ✔ |
| R6 | `RecoleccionPage.test.tsx` → `listarRecoleccion` llamada **una vez desde la página**, datos por props · `recoleccion-tienda-action.test.ts` → "R6: pasa el actor de SESION al service" + payload tal cual | ✔ |
| R7 | `RecoleccionModule.test.tsx` → 3 casos (lista vacía monta escáner; **con lista vacía el escaneo SÍ confirma**, no es decorativo; con órdenes sigue montado) + el caso de página | ✔ |
| R8 | `RecoleccionModule.test.tsx` → vacío explicado, y también bloqueado+vacío | ✔ |
| R9 | `RecoleccionModule.test.tsx` → sin escáner, sin textbox, sin botones, con `role="alert"` que dice el motivo **y** "Cierre del día" · `RecoleccionPage.test.tsx` → el flag lo deriva el servidor, y si degrada NO bloquea | ✔ |
| R10 | `RecoleccionModule.test.tsx` → vía manual y **vía cámara** llaman a la misma action con el mismo `numGuia` y el mismo efecto | ✔ |
| R11 | `RecoleccionModule.test.tsx` → 2 casos (texto no numérico por teclado; QR que no es la URL del paquete). En ambos `recolectarMock` **no se llama** | ✔ |
| R12 | `RecoleccionModule.test.tsx` → guía `9999` ausente de la lista **sí** viaja al servidor; el mensaje sale del `no_encontrada` del servidor. Verificado además en el hook: el pre-chequeo local ya no existe | ✔ |
| R13 | `RecoleccionModule.test.tsx` → 5 resultados con mensaje propio aseverado (ok, `ya_recolectada`, `no_encontrada`, `estado_invalido` con el estado dentro, `conflict` con su motivo) + código inválido | ⚠ parcial (§4, m1) |
| R14 | `RecoleccionModule.test.tsx` → `router.refresh()` tras efectiva y tras idempotente, y **el contraste**: NO revalida cuando no hubo transición | ✔ |
| R15 | `RecoleccionModule.test.tsx` → la confirmación con el número de guía permanece en el DOM tras el toast | ✔ |
| R16 | `recoleccion-tienda-service.test.ts`: comprobado en el `git diff` que **los 13 casos de la 157 no cambian ni una aserción**; lo único tocado fuera del bloque nuevo es el cableado de `makeRepo` (D2). Los ejecuté: verdes | ✔ |
| R17 | `RecoleccionModule.test.tsx` → agrupa por tienda con una tarjeta por orden | ✔ |
| R18 | `RecoleccionModule.test.tsx` → censo EXACTO de las 7 claves del DTO + sin símbolo de colón · `recoleccion-tienda-service.test.ts` → `toEqual` exacto | ✔ |
| R19 | `RecoleccionModule.test.tsx` → marca `tel:` de la TIENDA, no del destinatario | ✔ |
| R20 | `RecoleccionModule.test.tsx` → sin teléfono no hay botón · service → `null`, nunca `undefined`, incluso si la clave no viene | ✔ |
| R21 | `recoleccion-tienda-service.test.ts` → pide EXACTAMENTE `["recolectando"]` del propio actor; otro mensajero no ve nada; maestro/adminTienda → `forbidden` **sin leer nada**. Comprobado en `GestionOrdenRepository.findMisAsignaciones:108-120` que el WHERE real lleva `mensajeroAsignadoId` + `deletedAt: null` | ✔ |
| R22 | `RecoleccionModule.test.tsx` → censo de los 4 resultados, método de pago, valor a cobrar e `input[type=file]`: todos ausentes | ✔ |
| R23 | `RecoleccionModule.test.tsx` → bloqueado, las dos listas siguen visibles | ✔ |
| R24 | service (sale del repo de historial) + `RecoleccionModule.test.tsx` (contenido y guía sin número) | ✔ |
| R25 | service → "la lista se pide al repo de HISTORIAL, no al de asignaciones por estado" · repo → acota por actor + familia + ventana | ✔ |
| R26 | repo → **"NO filtra por `estatusDestinoId`"** (leí el `where`: no está) · service → con doble que aplica el filtro real, la orden ya en central sigue figurando y `porRecolectar` queda vacía | ✔ |
| R27 | service, bloque de 5 casos con **reloj inyectado**: ventana `[06:00Z, 06:00Z+24h)`, **BORDE 23:59 CR**, **BORDE 00:00 CR** (con la fila de anoche cayéndose), 19:00 CR y el default del constructor. Comprobado que sale de `lib/utils/fecha-cr.ts` (`fechaCalendarioCR` + `inicioDelDiaCREnUtc` + `inicioDelDiaSiguienteCREnUtc`), **el mismo módulo que usa `lib/analytics/ranges.ts`** (144) | ✔ |
| R28 | repo → `orderBy createdAt desc` y "no reordena en el cliente" · service → no reordena · UI → respeta el orden recibido | ✔ |
| R29 | repo → `orden: { deletedAt: null }` en el WHERE · service → "no trae la de OTRO actor, ni la de AYER, ni la BORRADA, ni la de otra familia" con doble semántico | ✔ |
| R30 | `RecoleccionModule.test.tsx` → vacío explícito dentro de la región "Recolectadas hoy" | ✔ |
| R31 | service → 4 casos (pide TOPE+1; justo en 100 sin recorte; 101 recorta a las 100 más recientes y marca; por debajo no marca) · repo → `take` exacto · UI → aviso presente/ausente | ✔ |
| R32 | `orden-historial-actor-origen-index-migration.test.ts` (16 casos: nombre explícito, orden igualdad→igualdad→rango, una sola sentencia, sin CONCURRENTLY, DOWN idempotente, paridad UP/DOWN, schema↔SQL). Verde en mi corrida | ✔ |
| R33 | `MisAsignacionesModule.test.tsx` → 2 casos, y **lo verifiqué por mutación propia**: al insertar un enlace a `/recoleccion` en el módulo, el caso falla | ✔ |
| R34 | `mis-asignaciones-service.test.ts` → lista EXACTA `["por_recoger","en_reparto"]`, el resultado no declara `porRecolectar`, y una fila en `recolectando` no cae en ningún grupo · guard con parseo de la llamada | ✔ |
| R35 | `MisAsignacionesModule.test.tsx`: 91 casos de gestión, foco, buscador y filtro **verdes sin tocar ninguno**. El `git diff` del archivo solo quita la prop de `renderModule` y sustituye el `describe` de la 157 | ✔ |
| R36 | `mis-asignaciones-service.test.ts` → KPIs y paradas derivan solo de `en_reparto` | ✔ |
| R37 | `recoleccion-no-contamina.test.ts` **intacto** (diff vacío contra índice y contra `origin/dev`) y verde (5 casos) | ⚠ parcial (§4, m2) |
| R38 | service → censo de 9 claves prohibidas + `toEqual` exacto · repo → la proyección no pide monto, coordenadas ni estado · UI → censo de las 7 claves | ✔ |
| R39 | `recoleccion-no-contamina.test.ts` intacto y verde; leído `listarRecoleccion`: es lectura pura, no escribe historial ni dinero | ✔ |

---

## 3. Los siete puntos de criterio explícito

**1. El corte limpio (R33/R34/R35).** Está hecho de verdad, y en las dos capas.
`grep -in "recolect"` sobre `MisAsignacionesModule.tsx` y `mis-asignaciones/page.tsx` da **0**;
en `MisAsignacionesService.ts` queda **1 sola** aparición y es un comentario que documenta la
ausencia (la bitácora dice 2 en D5; hoy es 1 — la otra usa la palabra acentuada, que no contiene
la subcadena). El contrato ya no transporta el grupo: `ListarMisAsignacionesResult` y
`ListarMisAsignacionesServiceResult` perdieron `porRecolectar`, y la lectura quedó
`findMisAsignaciones(actor.usuarioId, ["por_recoger","en_reparto"])`. Entregas no perdió nada:
91 casos de gestión, modo foco, buscador y filtro cantón/distrito verdes **sin que se tocara
ninguno**; el diff del archivo de test solo quita la prop del helper y cambia el `describe` de
la 157. Sin aviso, sin conteo y sin enlace, como pidió la decisión 2.

**2. El guard de no-reintroducción. NO es un test que pase siempre — lo probé.**
Tres mutaciones propias, cada una revertida y verificada con `git diff --stat`:
- insertar la cadena `RecoleccionTiendaPanel` en `MisAsignacionesModule.tsx` → `1 failed / 11 passed`. **Falla.**
- insertar un enlace `href="/recoleccion"` → el guard **pasa**, pero `MisAsignacionesModule.test.tsx` **falla** (`1 failed / 102 passed`). R33 sigue protegido.
- importar el componente por su nombre NUEVO (`RecoleccionModule`) sin nombrar ninguna prop → **ambos pasan**. Es el hueco real, ver §4/m3.

Además el guard tiene dos casos de existencia que evitan el otro fallo clásico (leer un archivo
que ya no está y pasar en verde sin proteger nada), y uno que parsea la llamada a
`findMisAsignaciones` y exige la lista cerrada de dos estados.

**3. La ventana de «hoy» (R27).** Correcta y probada en los bordes. Usa la convención de la 144
—`fechaCalendarioCR` + `inicioDelDiaCREnUtc` + `inicioDelDiaSiguienteCREnUtc` de
`lib/utils/fecha-cr.ts`, el mismo módulo del que tira `lib/analytics/ranges.ts`— y **no** replica
la ventana 18:00–18:00 del ranking, con el porqué escrito en el código y en `design §6`. El reloj
es inyectable por constructor, así que los bordes 23:59 CR y 00:00 CR se prueban sin falsear
`Date` global: en el de 00:00 la recolección de las 23:59 de anoche **desaparece** y la de las
00:00 entra. La cota superior es `lt`, comprobado en el test del repo.

**4. «Recolectadas hoy» sale del historial (R25/R26).** Sobrevive de verdad. El `where` del repo
lleva `actorUsuarioId` + `origenTipo: "recoleccion_tienda"` + rango + `orden.deletedAt: null`, y
**no** filtra por `estatusDestinoId` — hay un caso dedicado que lo asevera. En el service, el
doble con semántica real devuelve la orden ya recibida en la central mientras `porRecolectar`
queda vacía: es exactamente el escenario que la feature existe para resolver. El `recolectadaAt`
es el `created_at` de la fila de historial, no "ahora".

**5. Los DTOs flacos (R38).** El payload que llega al navegador está limpio. `RecoleccionOrdenDTO`
tiene 7 claves (`id`, `numGuia`, `numRemision`, `producto`, `destinatario`, `tiendaNombre`,
`tiendaTelefono`) y `RecolectadaHoyDTO` 5. El test de service alimenta la fila de origen **con**
`montoCobrar: 25000`, `latitud`, `longitud`, `direccion` y `notas` a propósito y luego asevera que
ninguna de las 9 claves prohibidas sobrevive; el `toEqual` exacto lo cierra. El recorte se hace en
el service (`toRecoleccionOrdenDTO`), y la proyección Prisma del repo ni siquiera pide esos campos.

**6. Las 11 desviaciones.** Ninguna cambia el comportamiento acordado ni esconde alcance.
- **D5** (menciones en comentarios): hoy es **una**, y documenta la ausencia que exige R34. No es alcance oculto.
- **D6** (`router.refresh()`): es forzoso, no una preferencia — la página es un Server Component y no puede pasar funciones por el borde RSC; `design §5.5` ya lo dibujaba así. La garantía baja un nivel (de `onRecolectada` a `refresh`) pero se conserva, **con contraste**: hay un caso que exige que NO revalide cuando no hubo transición.
- **D11** (4 casos → 2): correcto. Dos de los cuatro perdieron sujeto por diseño (R11 "los tres apartados coexisten" y R25 modo foco) y su cobertura real migró al backend en forma más fuerte (lista EXACTA de estados). Los 2 que entran cubren el caso desnudo y el caso BLOQUEADO, que es donde un aviso podría colarse.
- D1, D2, D4, D7, D8, D9 son decisiones de ejecución bien argumentadas. **D3** (whitelist de un guard ajeno) es tocar un archivo de otra feature: comprobado que la línea es del tipo que ese guard documenta, que ya tenía tres precedentes idénticos y que no oculta ningún hallazgo de la 167.
- **D10** deja un campo muerto: ver §4/m4.

**7. Ausencias.** `tests/unit/guards/recoleccion-no-contamina.test.ts`: `git diff` contra el índice
**y** contra `origin/dev` **vacío**, y verde (5/5) en mi corrida. Intacto, como exigía T2.11.

---

## 4. Hallazgos

### Bloqueantes

**Ninguno.**

### Menores

**m1 — R13 está cubierto en 5 de sus 8 resultados; 3 mensajes no tienen aserción.**
El hook (`useRecolectarPorGuia.ts:52-82`) da un mensaje distinto para los 8 status, pero
`forbidden` ("No tienes permiso para recolectar órdenes."), `unauthenticated` ("Tu sesión
expiró…") y `validation_error` no los asevera ningún test. La tabla de trazabilidad los imputa
a `tests/integration/actions/recoleccion-tienda-action.test.ts`, y **eso es impreciso**: ese
archivo verifica el *status* que devuelve la action, no el *mensaje* que lee el mensajero, que es
lo que R13 exige. No es bloqueante porque los tres son inalcanzables por la UI en la práctica
(la página hace `notFound` antes de montar nada para un rol ajeno o sin sesión, y el código mal
formado se corta en cliente) y porque los 5 resultados que el mensajero sí ve en la calle están
probados. *Para saldarlo:* 3 casos más en `RecoleccionModule.test.tsx`, o corregir la tabla para
que no reclame lo que ese archivo no prueba.

**m2 — El guard citado para R37 vigila el estado de la 157, no el que usa esta feature.**
`recoleccion-no-contamina.test.ts` comprueba que `ESTADOS_PENDIENTES` de `CierreDiaService` no
contenga `por_recolectar_en_tienda`; **no** comprueba `recolectando`, que es el estado sobre el
que la 167 construye su lista. Comprobé el hecho a mano y **se cumple**:
`CierreDiaService.ts:41` es `const ESTADOS_PENDIENTES = ["por_recoger", "en_reparto"]`, lista
cerrada, y ni `CorteDiarioService` ni `RankingService` mencionan la recolección. Es deuda
heredada de la 157 (su propio guard lo declara en un comentario), no algo que la 167 rompa, pero
la tabla de trazabilidad afirma más de lo que el test verifica.

**m3 — El guard nuevo lleva un token muerto y tiene un hueco demostrado.**
`PROHIBIDOS` incluye `RecoleccionTiendaPanel`, nombre que ya no existe en el árbol salvo en dos
comentarios: es un tercio del guard protegiendo contra algo imposible. Mutación propia: importar
`RecoleccionModule` en `MisAsignacionesModule.tsx` sin nombrar ninguna prop deja el guard en
verde. El riesgo real es bajo —montarlo de verdad exige la prop `porRecolectar`, que **sí** está
vigilada, y el test de componente caza el render y el enlace— pero cambiar `RecoleccionTiendaPanel`
por `RecoleccionModule` en esa lista es una línea y cierra el hueco.

**m4 — `MiAsignacionDTO.tiendaTelefono` queda muerto y además sin test.**
Es la P1/D10 ya declarada, con un matiz que la bitácora no dice: los dos casos que lo cubrían
("R15: expone el teléfono de la TIENDA…" y "R15: sin teléfono el campo es null") se fueron con el
`describe` retirado de `mis-asignaciones-service.test.ts`. El campo queda hoy sin consumidor **y**
sin cobertura. No es bloqueante: el equivalente vivo (`RecoleccionOrdenDTO.tiendaTelefono`) sí está
probado en `recoleccion-tienda-service.test.ts`. Decidir en la puerta si se retira.

**m5 — El tope 100 está duplicado como número mágico en la UI.**
`TOPE_RECOLECTADAS_HOY = 100` en el service y el literal "Se muestran las 100 más recientes de
hoy." en `RecolectadasHoyLista.tsx`. Si el humano cambia el tope, el aviso miente sin que ningún
test lo note (los tests de UI aseveran el literal, no la constante).

**m6 — `T3.5` sigue sin marcar en `tasks.md`.** Es la única `[ ]` y es del leader por diseño
(estado + `progress/history.md`, después de este review). Se anota porque el CHECKPOINT
"todas las tasks marcadas `[x]`" no se cumple hasta que se cierre.

### Fuera del alcance de esta feature (no cuentan contra ella, pero bloquean el CHECKPOINT)

**a1 — `./init.sh` no termina en verde.** Corta en `lint` por 3 errores de
`app/(app)/ordenes/_components/OrdenesModule.tsx`, archivo **byte-idéntico a `origin/dev`**.
Deuda de `dev` sin dueño. Mientras siga ahí, **ninguna** feature puede cumplir el checkpoint
"`./init.sh` termina en verde" ni llegar a `pnpm test` desde el script.

**a2 — `frontera.guardia.test.ts` prohíbe lo que R1 ordena.** Guard pinneado a la 135 que mide el
diff de la rama actual: 6 casos rojos aquí, entre ellos "no añade rutas, páginas ni componentes en
app o components". Toda feature que toque `app/` nacerá roja. Es la P3 de la bitácora y necesita
decisión (acotarlo al branch de la 135, congelarlo contra su commit de merge, o retirarlo).

**a3 — Drift preexistente entre `schema.prisma` y la base local** (P2, 10 sentencias que
`migrate dev` volverá a arrastrar a la migración de turno). El implementer hizo lo correcto
retirándolas a mano (D4) y hay un caso de test que impide que se cuelen en un regenerado futuro.

---

## 5. Checklist de CHECKPOINTS.md

**Especificación**
- [x] `requirements.md` con EARS numerados `R1`–`R39`.
- [x] `design.md` con alternativas descartadas y su porqué — hay **7** (A1–A7), no una.
- [ ] `tasks.md` todas `[x]` — falta **T3.5** (del leader, posterior a este review). Ver m6.

**Trazabilidad**
- [x] Cada `R<n>` mapea a al menos un test concreto (39/39). Dos parciales: m1, m2.
- [x] `progress/impl_167-….md` contiene el mapa `R<n> → test`, con archivo **y nombre de caso**.

**Calidad de código**
- [x] `pnpm run typecheck` verde (corrido aquí).
- [ ] `pnpm run lint` — 3 errores, **todos preexistentes en un archivo intocado** (a1).
- [x] `pnpm test` — 8035/8042; los 7 rojos son de 2 guards ajenos, uno byte-idéntico a `dev` y el otro con su único hallazgo en `origin/dev`. Descontados: 8032/8032.
- [n/a] E2E — no hay harness de Playwright en el repo (sin `playwright.config.*` ni script `e2e`). Declarado inaplicable y sustituido por la lista de verificación humana de T3.4, que además cubre lo único que ningún test alcanza: decodificar el QR de una etiqueta impresa con la cámara de un móvil.

**Datos y seguridad**
- [x] RLS: **no hay tablas nuevas** — la migración crea un índice y nada más; comprobado en el SQL y con un caso de test dedicado. `orden_historial_estado` conserva la RLS de la 49.
- [x] Migración versionada y reversible: `migration.sql` con una sola sentencia y `down.sql` con `DROP INDEX IF EXISTS` idempotente; UP/DOWN/re-UP reales contra Postgres pegados en la bitácora y paridad cubierta por 16 casos estáticos.
- [x] Sin secretos hardcodeados (censo sobre los archivos nuevos: 0).
- [n/a] Webhooks: la feature no toca ninguno.

**Patrón de capas**
- [x] La Server Action no tiene queries ni lógica: resuelve actor, arma el service y traduce el borde. Su traductor **relanza** cualquier `AppErrorCode` que no sea `UNAUTHORIZED` en vez de disfrazar una caída de base de "sesión expirada" — coherente con el commit `8428498a`.
- [x] El service no conoce HTTP.
- [x] `findRecoleccionesDeActor` es query Prisma pura; la ventana llega ya calculada.
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.

**Permisos**
- [x] `/recoleccion` resuelve el rol **server-side** con `resolveActorFromSession` y hace `notFound()` **antes** de leer nada (probado con 5 roles + sin sesión, aseverando que no se dispara ninguna consulta). `middleware.ts` es deny-by-default y no hizo falta tocarlo.
- [x] El componente de cliente recibe todo por props; no fetchea.
- [x] La mutación va por Server Action.

**Multi-país / configuración**
- [x] Sin país, moneda ni cuenta nuevos hardcodeados. La zona `America/Costa_Rica` en
      `RecolectadasHoyLista` sigue la convención ya establecida del repo (`lib/utils/fecha-cr.ts`,
      `HistorialOrdenTimeline.tsx`, el cron de reprogramadas) y es deliberada: la hora que se lee y
      el día que el servidor llama "hoy" no pueden contradecirse.

**Verificación final**
- [ ] `./init.sh` en verde — no, por a1 (deuda ajena, no de esta feature).
- [x] `progress/review_167-….md` existe (este archivo).
- [ ] Entrada en `progress/history.md` — pendiente, T3.5 del leader.

---

## 6. Lo que está bien, dicho sin rodeos

- **El bug reportado está muerto y con dos testigos.** El `return null` con lista vacía se fue, y
  hay un caso que va más allá de "el escáner está en el DOM": **con la lista vacía, escanear
  funciona** (la action recibe la guía). Un escáner montado pero inerte habría sido el mismo bug
  con otra cara, y ese caso lo impide.
- **La decisión de leer del historial está probada donde duele**, con un doble que aplica el filtro
  real en vez de devolver lo que convenga, y con el `where` del repo aseverado campo a campo.
- **Los bordes de día se prueban con reloj inyectado**, no falseando `Date` global, y el caso de
  00:00 CR comprueba las dos mitades: la de anoche se cae, la de ahora entra.
- **R38 es una verificación de contrato, no una inspección visual**: la fila de origen lleva
  cobro y coordenadas a propósito para que el test vea el corte.
- **Las desviaciones están declaradas antes de que el reviewer pregunte**, incluidas las
  incómodas (tocar un guard ajeno, editar a mano el SQL generado, dejar un campo muerto). Eso es
  exactamente lo que hace revisable un trabajo.
- **Los rojos ajenos vienen con la prueba de su ajenidad** (`git diff` contra `origin/dev`), no con
  una afirmación. La verifiqué y se sostiene.

---

## Veredicto

# APROBADO CON NOTAS (OK)

**Sin hallazgos bloqueantes.** Los 39 requisitos están mapeados a tests que existen, se llaman
como lo que prueban y verifican de verdad el requisito; lo comprobé por muestreo leyendo los
cuerpos y por mutación propia en los tres puntos donde un test podía estar pasando de gratis.
`typecheck` verde y la suite en 8032/8032 descontando dos guards ajenos que ya estaban rojos en
`origin/dev` y a los que esta feature no añade ni un hallazgo.

Las 6 notas menores (m1–m6) no bloquean el merge; m1 y m3 son cada una de pocas líneas y valen la
pena antes de cerrar. Los tres puntos `a1`–`a3` son deuda de `dev` que impide marcar el checkpoint
de `./init.sh` y necesita decisión del humano **fuera** de esta feature.

Para pasar a `done` falta únicamente **T3.5** (estado en `feature_list.json`, `progress/current.md`
y entrada en `progress/history.md`), que es del leader.
