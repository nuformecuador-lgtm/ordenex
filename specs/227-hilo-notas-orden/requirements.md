# Feature 227 — Hilo de notas por orden entre tienda y mensajero · requirements.md

Zone: `fullstack` · complexity: `high` · sdd: `true` · depends_on: `null`

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto en `tasks.md` (el reviewer
> rechaza si falta trazabilidad). Esta feature crea un HILO por orden, bidireccional entre
> `adminTienda` y `mensajero`, y RETIRA la nota privada del mensajero (feature 116) junto con la
> columna `orden_mensajero_meta.nota`.
>
> **Estado del spec: GATE HUMANO PASADO (2026-08-14). No quedan preguntas abiertas.** Las nueve
> que abrió la primera vuelta están resueltas y convertidas en requisitos; el registro de las
> decisiones, con su fecha, está en §Decisiones del gate al final de este archivo.

---

## Contexto verificado (símbolos reales medidos en el código, no supuestos)

- **Por qué tabla nueva.** `OrdenMensajeroMeta` declara `@@unique([usuarioId, ordenId])`
  (`db/schema.prisma:634`): UNA fila por pareja. De esa unicidad depende la idempotencia del upsert
  del toggle `marcar_luego` (feature 115/R7). Un hilo necesita N filas por orden; quitar el UNIQUE
  rompería la 115.
- **`orden.notas` es la nota de la TIENDA** (`db/schema.prisma:495`, "R14a"). Se escribe SOLO en el
  alta por carga masiva (`lib/types/carga-masiva.ts:86`, `lib/services/BulkOrdenService.ts:612`,
  `lib/repositories/OrdenRepository.ts:1333`); el CRUD que la editaba se borró
  (`lib/actions/ordenes.ts:35-44`). El mensajero la lee en `AsignacionDetalle.tsx:124`. NO es el
  hilo y no se toca.
- **La nota de la 116 se escribió bajo una promesa literal en pantalla:** «Solo tú puedes ver esta
  nota; no la ven la tienda ni otros mensajeros» (`NotaPrivadaMensajero.tsx:30`, R6/R8 de la 116).
  Cualquier diseño que abra esas filas a la tienda es una FUGA RETROACTIVA.
- **Alcance por tienda del adminTienda.** `NovedadesService` autoriza con
  `actor.rol !== "adminTienda" → forbidden` (`NovedadesService.ts:18,44`) y acota pasando
  `actor.usuarioId` como `tiendaId`; el predicado central es
  `OrdenRepository.novedadWhere(tiendaId) = { tiendaId, deletedAt: null, estatus: { value: devuelta } }`
  (`OrdenRepository.ts:2872-2878`). `orden.tiendaId` es FK -> `usuario` (`db/schema.prisma:488`):
  el `usuarioId` del adminTienda ES el identificador de su tienda. Este es el mecanismo que se
  reutiliza; no se inventa otro.
- **Vinculación del mensajero:** `orden.mensajeroAsignadoId` es, desde la feature 159, la ÚNICA
  fuente de verdad del mensajero de una orden (`db/schema.prisma:498`).
- **El corte del portal del mensajero se conserva intacto.**
  `MisAsignacionesService.listarMisAsignaciones` lee EXACTAMENTE `por_recoger` y `en_reparto`
  (`MisAsignacionesService.ts:152`, "corte limpio" de la feature 167/R34). Esta feature NO lo toca
  (R36).
- **Patrón de mutación a reutilizar:** Server Action (`'use server'`) + `resolveActorFromSession`
  (`lib/auth/resolve-actor.ts` → `{ usuarioId, rol, zonaId }`) + `withErrorHandler` + resultado de
  dominio DISCRIMINADO por `status`. Vivo en `lib/actions/notas-privadas-mensajero.ts` y
  `lib/actions/orden-mensajero-meta.ts`.
- **Patrón de tabla nueva:** RLS habilitada SIN policies (solo service role), autorización de
  negocio en el service, migración `migration.sql` + `down.sql`. Ejemplo literal:
  `db/migrations/20260723120000_orden_mensajero_meta/`.
- **Patrón de borrado lógico:** `orden` usa `deleted_at` (soft delete, `db/schema.prisma:480`).
- **Precedente de historial ordenado:** `ChatMensaje` resuelve la lectura del hilo con
  `@@index([conversacionId, ocurridoAt])` (`db/schema.prisma:291`). Se copia la FORMA del índice; el
  chat de WhatsApp con el CLIENTE está FUERA DE ALCANCE (otra persona, otro canal).

---

## A) El hilo: publicación y forma de las filas

- **R1** — CUANDO un actor autorizado publique una nota en el hilo de una orden elegible, el sistema
  DEBE persistir una fila NUEVA con la orden, el autor, el rol del autor, el cuerpo y el instante de
  creación, SIN modificar ni eliminar ninguna fila previa del mismo hilo.
  *Testeable:* con un hilo de N notas, publicar deja N+1; las N previas conservan cuerpo, autor e
  instante idénticos.

- **R2** — El sistema NO DEBE ofrecer ninguna forma de EDITAR el cuerpo de una nota ya publicada: una
  vez publicada, el texto no se reescribe (decisión P3d). Las únicas operaciones del hilo son crear,
  leer y eliminar.
  *Testeable:* la superficie pública del módulo (service + Server Actions) no exporta ninguna
  operación que reescriba el cuerpo; una guardia lo verifica sobre los símbolos exportados.

- **R3** — CUANDO se lea el hilo de una orden, el sistema DEBE devolver sus notas en orden
  cronológico ASCENDENTE por instante de creación, con un desempate determinista para instantes
  iguales.
  *Testeable:* con tres notas de instantes conocidos (dos idénticos), dos lecturas consecutivas
  devuelven la MISMA secuencia, ordenada asc.

- **R4** — CUANDO se publique una nota, el sistema DEBE registrar el rol del autor VIGENTE en ese
  instante y DEBE mostrar SIEMPRE ese rol registrado al leer el hilo, sin recalcularlo contra el rol
  actual del usuario.
  *Testeable:* publicada una nota con rol `mensajero`, un cambio posterior del rol del usuario no
  altera el rol devuelto por la lectura.

- **R5** — El sistema DEBE tomar el autor de la nota EXCLUSIVAMENTE del actor autenticado; NUNCA
  DEBE aceptar un identificador de autor proveniente de la entrada.
  *Testeable:* una entrada que incluya un `autorId` ajeno se ignora y la fila creada lleva el
  `usuarioId` del actor de la sesión.

- **R6** — SI el cuerpo de la nota queda VACÍO tras recortar espacios en blanco, ENTONCES el sistema
  DEBE rechazar la publicación con un error de validación y NO DEBE crear fila alguna.
  *Testeable:* publicar `"   "` → `validation_error`; el conteo de filas del hilo no cambia.

- **R7** — El sistema DEBE rechazar con error de validación un cuerpo de más de **200 caracteres**
  (decisión P5), SIN crear fila.
  *Testeable:* 200 caracteres → aceptado; 201 → `validation_error` y cero filas nuevas.

- **R8** — SI se intenta publicar sobre una orden inexistente, ENTONCES el sistema NO DEBE crear una
  fila huérfana y DEBE devolver un rechazo de dominio tipado, nunca una excepción cruda.
  *Testeable:* publicar sobre un `ordenId` inexistente → resultado de rechazo (sin `throw`) y cero
  filas creadas.

## A bis) Eliminar notas propias

- **R31** — CUANDO el AUTOR de una nota solicite eliminarla DENTRO de su ventana de escritura (R14),
  el sistema DEBE marcarla como eliminada mediante **borrado lógico** (marca de instante de borrado),
  conservando la fila y su autoría, y SIN alterar ninguna otra nota del hilo ni su orden.
  *Testeable:* borrar la nota del medio de un hilo de tres deja las otras dos intactas y en el mismo
  orden; la fila borrada sigue existiendo en la base con su autor y su instante de borrado.

- **R32** — El sistema NO DEBE permitir eliminar una nota AJENA a NINGÚN actor, incluidos la
  contraparte del hilo y los roles `maestro`, `admin` y `adminSatelite` (decisión P9: no hay
  moderación).
  *Testeable:* la contraparte y un `maestro` reciben rechazo al borrar una nota ajena; la nota sigue
  vigente y con el mismo cuerpo.

- **R33** — SI la nota indicada no existe, no pertenece al hilo de una orden accesible para el actor,
  o ya fue eliminada, ENTONCES el sistema DEBE responder con un resultado tipado y sin efectos,
  nunca con una excepción cruda, y sin revelar si la nota existe.
  *Testeable:* borrar un identificador inexistente, uno de otra tienda y uno ya borrado producen el
  mismo resultado tipado; el conteo de notas vigentes no cambia.

- **R34** — MIENTRAS una nota esté eliminada, el sistema DEBE mostrar a AMBOS lados del hilo una
  marca visible de «nota eliminada» que conserve su posición cronológica, su autor y su hora, y NO
  DEBE devolver su cuerpo a ningún cliente.
  *Testeable:* tras eliminar, la lectura del adminTienda y la del mensajero devuelven el mismo hueco
  marcado, con autor y hora, y el cuerpo NO viaja en el DTO.

- **R35** — La ventana de BORRADO de cada rol DEBE coincidir EXACTAMENTE con su ventana de escritura
  (R14): SI el actor está fuera de SU ventana, ENTONCES el sistema DEBE rechazar la eliminación
  incluso de sus PROPIAS notas — quedan congeladas para él (decisión P3c, releída con la ventana
  asimétrica).
  *Testeable:* con la orden en `en_reparto`, el `adminTienda` no puede borrar su propia nota; con la
  orden en `devuelta`, el `mensajero` no puede borrar la suya; en ambos casos la nota sigue vigente.
  Dentro de la ventana propia, el borrado sí procede (R31).

## B) Autorización, alcance y ventana de escritura

- **R9** — MIENTRAS el actor sea `adminTienda`, el sistema DEBE permitirle leer y publicar en el hilo
  ÚNICAMENTE de las órdenes cuya tienda es la suya, resolviendo la pertenencia con el mismo
  mecanismo que ya usa el módulo de novedades (la orden pertenece al `usuarioId` del actor).
  *Testeable:* orden de su tienda → `ok`; el service resuelve la pertenencia con el identificador del
  actor y no con un dato del input.

- **R10** — SI un `adminTienda` intenta leer, publicar o eliminar en el hilo de una orden que NO es
  de su tienda, ENTONCES el sistema DEBE rechazar la operación SIN efectos y SIN revelar si la orden
  existe.
  *Testeable:* orden de otra tienda → el MISMO resultado que una orden inexistente; el hilo ajeno no
  se devuelve ni se modifica.

- **R11** — MIENTRAS el actor sea `mensajero`, el sistema DEBE darle acceso al hilo ÚNICAMENTE de las
  órdenes que tiene ASIGNADAS en ese momento (`orden.mensajeroAsignadoId` = el actor, decisión P5), y
  DEBE rechazar el resto. Dentro de ese acceso, DEBE poder LEER en cualquier estatus (R15) y DEBE
  poder PUBLICAR y ELIMINAR dentro de su ventana (R14).
  *Testeable:* orden asignada → `ok`; orden asignada a otro mensajero o sin mensajero → rechazo sin
  efectos, también en lectura.

- **R12** — SI el actor tiene un rol distinto de `adminTienda` o `mensajero`, ENTONCES el sistema
  DEBE rechazar la lectura, la publicación y la eliminación del hilo, sin efectos. No existe vista de
  supervisión para `maestro`, `admin` ni `adminSatelite` (decisión P8).
  *Testeable:* actores `maestro`, `admin` y `adminSatelite` → rechazo en las tres operaciones;
  ninguna fila creada ni marcada.

- **R13** — SI no hay sesión válida, ENTONCES el sistema DEBE rechazar la operación como no
  autenticada ANTES de consultar datos de negocio.
  *Testeable:* sin cookie de sesión → resultado `unauthenticated` y el doble del service no recibe
  ninguna llamada.

- **R14** — El sistema DEBE aplicar una **ventana de escritura ASIMÉTRICA POR ROL** (decisión del
  2026-08-14): MIENTRAS la orden esté en **`devuelta`**, el `adminTienda` dueño DEBE poder publicar;
  MIENTRAS la orden esté en **`en_reparto`** y asignada al actor, ese `mensajero` DEBE poder
  publicar. SI el actor está fuera de SU ventana, ENTONCES el sistema DEBE rechazar la publicación
  sin efectos, aunque el otro rol sí esté dentro de la suya.
  *Testeable:* matriz rol × estatus — `adminTienda` publica en `devuelta` y es rechazado en
  `en_reparto`; `mensajero` publica en `en_reparto` y es rechazado en `devuelta`; ambos rechazados en
  `entregada`, `reprogramada` y `rechazada`; en cada rechazo, cero filas nuevas.
  > Cada rol escribe **cuando ve la orden**: `/novedades` lista exactamente las `devuelta` y el panel
  > del mensajero lee exactamente `por_recoger` y `en_reparto` (feature 167/R34, R36). Una ventana
  > única en `devuelta` habría dejado al mensajero sin ningún estado alcanzable donde publicar y el
  > hilo habría sido unidireccional de hecho (ver R38).

- **R15** — El sistema DEBE permitir LEER el hilo de una orden en CUALQUIER estatus, también después
  de que la orden deje de estar `devuelta` (decisión P7): la novedad acota la escritura, no la
  lectura.
  *Testeable:* con notas escritas mientras la orden estaba `devuelta`, la lectura devuelve el hilo
  completo con la orden ya en `en_reparto` y en un estatus terminal.

- **R36** — El sistema DEBE exponer el hilo al mensajero desde el panel de asignaciones que YA
  existe, sin abrir pantalla nueva, y NO DEBE alterar el conjunto de estatus que
  `listarMisAsignaciones` lee (`por_recoger` y `en_reparto`, corte de la feature 167/R34).
  *Testeable:* una guardia verifica que la lista de estatus leída por `listarMisAsignaciones` sigue
  siendo exactamente esos dos; el panel del mensajero monta el hilo de la orden activa.

## C) Bidireccionalidad y presentación

- **R16** — El sistema DEBE mostrar cada nota del hilo con su autor y su fecha/hora, y DEBE distinguir
  visualmente las notas propias de las de la contraparte.
  *Testeable:* renderizado un hilo con una nota de cada rol, ambas aparecen con autor y fecha y con
  marcas distintas para propia/ajena.

- **R17** — CUANDO un actor publique o elimine una nota con éxito, el sistema DEBE reflejar el hilo
  actualizado leyéndolo del servidor (persistente ante recarga), no solo en memoria del cliente.
  *Testeable:* tras publicar y tras eliminar, el componente solicita el refresco de datos del
  servidor y el resultado sobrevive a un remontaje.

- **R18** — SI una publicación o una eliminación es rechazada, ENTONCES el sistema DEBE informarlo
  con un motivo accionable y NO DEBE pintar el cambio como aplicado.
  *Testeable:* con la acción devolviendo cada rechazo tipado, la UI muestra el mensaje
  correspondiente y el hilo conserva su contenido previo.

- **R19** — MIENTRAS el hilo esté vacío, el sistema DEBE mostrar un estado vacío legible; y MIENTRAS
  el actor esté FUERA de su ventana de escritura (R14), DEBE mostrar el hilo en modo solo lectura,
  sin compositor ni controles de borrado.
  *Testeable:* hilo `[]` dentro de la ventana → estado vacío con compositor operativo; el mismo hilo
  fuera de la ventana → visible, sin compositor ni botón de eliminar. La UI decide con el indicador
  que le entrega el servidor, no re-derivando la regla en el cliente.

- **R38** — El sistema DEBE garantizar que CADA uno de los dos roles tiene al menos un estado
  ALCANZABLE en su propia pantalla donde puede publicar: el `adminTienda` en `devuelta` (que es lo
  que `/novedades` lista) y el `mensajero` en `en_reparto` (que es uno de los dos estatus que su
  panel lee). El hilo DEBE ser bidireccional de hecho, no solo de permiso.
  *Testeable:* una guardia cruza la ventana de escritura de cada rol (R14) con el conjunto de
  estatus que su pantalla lista (`novedadWhere` para la tienda; la lista de
  `listarMisAsignaciones` para el mensajero) y falla si la intersección de alguno queda vacía.

> **R37 — RETIRADO de esta ficha (decisión humana del 2026-08-14).** Era la notificación al mensajero
> («orden reactivada»). Sale íntegro a la ficha **228 «transición habilitar novedad»**, que es quien
> tendrá el disparador real (design §8). **La 227 no lleva notificación de ningún tipo.** El número
> **no se reutiliza**, para que ninguna referencia previa a «R37» quede apuntando a otra cosa.

## D) Retiro de la feature 116 (nota privada del mensajero)

- **R20** — El sistema DEBE dejar de ofrecer la nota privada del mensajero: ninguna Server Action,
  service, tipo o componente de esa funcionalidad DEBE permanecer en el árbol de producción.
  *Testeable:* una guardia recorre el árbol y verifica que no existen los módulos de la 116 ni
  referencias a ellos.

- **R21** — El sistema NO DEBE emitir el campo de nota privada en ningún DTO ni pintar indicadores,
  badges o previews de esa nota en ninguna card o detalle.
  *Testeable:* el DTO de asignaciones no incluye el campo; las tres pos-card renderizan una orden sin
  indicador de nota privada.

- **R22** — El sistema NO DEBE exponer a la tienda, ni a ningún otro rol, el CONTENIDO de las notas
  privadas ya escritas: **no se migran, no se copian al hilo, no se leen y no se registran en logs**.
  Las notas que el hilo muestra son EXCLUSIVAMENTE las de la tabla nueva (decisión P1).
  *Testeable:* una guardia verifica que ninguna migración ni módulo de esta feature lee o inserta a
  partir de `orden_mensajero_meta.nota`; el hilo de una orden con nota privada previa nace vacío.

- **R23** — El sistema DEBE retirar la columna `nota` de `orden_mensajero_meta` mediante una
  migración cuyo `down.sql` reponga EXACTAMENTE la estructura (columna nullable), declarando de
  forma explícita que el CONTENIDO **se pierde de forma definitiva y deliberada** (decisión humana
  del 2026-08-14) y citando el conteo de filas afectadas medido contra producción.
  *Testeable:* test de migración que aplica up (la columna desaparece), aplica down (la columna
  vuelve, nullable) y comprueba que el resto de la tabla queda intacto; el comentario de la migración
  contiene el conteo.

- **R24** — El sistema DEBE preservar `marcar_luego` (feature 115) sin cambios: la unicidad
  `(usuario_id, orden_id)`, la idempotencia del toggle y su indicador en la UI DEBEN seguir
  comportándose igual tras la retirada.
  *Testeable:* la suite de la 115 pasa sin modificaciones de comportamiento; el índice único sigue
  presente tras la migración.

- **R25** — El sistema DEBE mantener `orden.notas` (nota de la TIENDA) intacta: ninguna operación del
  hilo la lee para escribir, la modifica ni la sustituye, y su presentación actual en el detalle del
  mensajero se conserva.
  *Testeable:* tras publicar y eliminar notas, `orden.notas` queda idéntica; el detalle sigue
  mostrando el campo de notas de la tienda con su etiqueta.

## E) Datos, borde, rendimiento y errores

- **R26** — El sistema DEBE almacenar el hilo en una tabla NUEVA con Row Level Security habilitada y
  sin policies, resolviendo TODA la autorización de negocio en la capa de servicio.
  *Testeable:* test de migración que comprueba `relrowsecurity = true` y cero policies; el service
  rechaza sin depender de la DB.

- **R27** — El sistema DEBE validar en el borde toda entrada externa del hilo (identificadores con
  formato válido y cuerpo acotado) y DEBE devolver un resultado tipado y discriminado por estado,
  sin filtrar detalles internos.
  *Testeable:* entradas mal formadas → `validation_error` con errores por campo; ningún resultado
  incluye mensajes de excepción ni datos de otras órdenes.

- **R28** — El sistema DEBE leer el hilo completo de una orden con UNA sola consulta a datos,
  soportada por un índice por orden y fecha; NO DEBE emitir una consulta por nota.
  *Testeable:* con un doble del repositorio, la lectura del hilo produce **exactamente UNA llamada a
  `listarPorOrden`** —nunca una por nota— y el **total** de llamadas al repositorio es **2 y CONSTANTE
  con el tamaño del hilo** (3 notas y 30 notas producen el mismo número); el test de migración
  verifica el índice compuesto.
  > *Corrección de la cláusula testeable (2026-08-15, pedida por el reviewer).* La redacción original
  > decía «exactamente una llamada» y era **inalcanzable por construcción**: el paso 2 del orden de
  > comprobaciones de design §2.2 (`findOrdenParaHilo`, obligatorio para autorizar) ya es una segunda
  > llamada. El texto NORMATIVO de R28 —una sola consulta para traer el hilo, sin N+1, apoyada en el
  > índice— se cumple; el literal de la cláusula no lo hacía. Lo que se afirma arriba es lo que el
  > test mide de verdad, y sigue siendo lo que R28 protege: que el coste no crezca con el hilo.

- **R29** — El sistema NO DEBE registrar en logs ni en mensajes de error el cuerpo de las notas ni
  datos personales del destinatario, y NO DEBE contener `catch` vacíos en los módulos de esta
  feature.
  *Testeable:* guardia sobre los módulos de la feature: sin `console.log` del cuerpo, sin `catch {}`
  vacío; los textos de rechazo son fijos y sin PII.

- **R30** — El sistema DEBE conservar el hilo asociado a su orden mientras la orden exista, y DEBE
  eliminar sus notas si la orden se elimina físicamente, sin dejar filas huérfanas.
  *Testeable:* borrar la orden arrastra sus notas; no queda ninguna fila con `orden_id` inexistente.

---

## Decisiones del gate (2026-08-14) — registro, no discusión

Se conservan escritas porque varias son decisiones deliberadas que, sin registro, se leerían como
olvidos. Ninguna se reabre en implementación.

| # | Decisión | Dónde vive ahora |
| --- | --- | --- |
| P1 | **No se migra nada.** Las notas privadas actuales de los mensajeros **se borran** junto con la columna `orden_mensajero_meta.nota`. El hilo muestra SOLO las notas de la tabla nueva. Es pérdida de datos reales, decidida a conciencia y coherente con la promesa de privacidad bajo la que se escribieron. Se mantiene el **conteo informativo** contra producción antes de correr la migración (no reabre la decisión). | R22, R23, T0.1 |
| P2 | **Novedad = `devuelta`, y solo ese estatus.** Ningún otro. Coincide con el predicado que `/novedades` ya usa. Define la ventana **del adminTienda**; la del mensajero es `en_reparto` (ver D1). | R14 |
| P3a | **Borrado LÓGICO** (`deleted_at`, patrón de `orden`). Nunca `DELETE` físico. | R31 |
| P3b | **Marca VISIBLE**: el otro lado ve «nota eliminada», no un hueco silencioso. | R34 |
| P3c | **Ventana de borrado = la misma ventana de escritura del rol.** Fuera de ella, las notas quedan congeladas para ese actor. | R35 |
| P3d | **No se puede editar.** Solo crear y borrar. | R2 |
| P4 | **RETIRADO de la 227** (ver D2). La notificación «orden reactivada» sale a la ficha 228. | — |
| P5 | **Máximo 200 caracteres** (no 2000, que era el de la 116). El mensajero **no** puede escribir en órdenes que no tiene asignadas. | R7, R11 |
| P6 | **No se abre pantalla nueva del lado mensajero** y **no se toca** el corte de la feature 167/R34: el mensajero lee el hilo desde el panel que ya tiene. | R36 |
| P7 | **La novedad acota la ESCRITURA, no la LECTURA.** Leer: siempre, cualquier estatus. Escribir y borrar: dentro de la ventana del rol. | R14, R15, R35 |
| P8 | **No hay vista para `admin`/`maestro`.** Decisión, no olvido: hoy nadie supervisa el hilo desde fuera. | R12 |
| P9 | **Solo notas propias.** No hay moderación ni borrado de notas ajenas por ningún rol. | R32 |

### Decisiones de la tercera vuelta (2026-08-14, cierre del spec)

| # | Decisión | Dónde vive |
| --- | --- | --- |
| **D1** | **VENTANA ASIMÉTRICA POR ROL.** Cada uno escribe cuando ve la orden: `adminTienda` en `devuelta`, `mensajero` en `en_reparto` y asignada a él. La lectura no cambia (siempre). El corte de la feature 167/R34 **no se toca**. Corrige una contradicción real de la vuelta anterior: con ventana única en `devuelta`, el mensajero **nunca** tenía delante una orden en la que pudiera publicar y el permiso de R11 era letra muerta. | R11, R14, R19, R31, R35, **R38** |
| **D2** | **Partición: un solo aviso, dentro de 228.** R37 sale íntegro de la 227; no hay aviso de «la tienda te escribió»; N1 desaparece. 228 («transición habilitar novedad», `depends_on: 227`) emitirá el único aviso, «orden reactivada», disparado por la transición y no por publicar. El coste medido queda heredado en design §8 para que 228 no vuelva a medirlo. | design §8 |
| **D3** | **SIN INDICADOR, por ahora.** No se añade badge, contador ni punto en ninguna card. **Consecuencia dicha en voz alta: hasta que exista 228, el mensajero solo se entera de que hay notas si ABRE la orden.** Es una decisión consciente por no tener aún canal de aviso, no un olvido de UI. | design §5 |

**Consecuencia sobre la ficha:** el `description` de la 227 en `feature_list.json` dice «HILO
append-only … sin update». Con P3a/P3c el hilo **no es append-only estricto** (hay borrado lógico por
el autor dentro de una ventana). La ficha debe corregirse; este spec manda sobre ella (tarea T0.3,
la ejecuta el leader).
