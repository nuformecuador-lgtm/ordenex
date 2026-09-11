# 413 — Al mensajero le avisan del reparto que tiene para el día siguiente

> Requisitos en EARS. Sin detalle de implementación (eso vive en `design.md`).
> El mapa `R<n> → test` está en §11.
> **Preguntas abiertas: ninguna.** Las tres que abrió el borrador las cerró el humano el 2026-09-11,
> una de ellas **con medición**; las decisiones están incorporadas al texto y anotadas en §12.
> Ficha `backend`, `sdd: true`, complejidad media, `depends_on: null` (la 409 **ya está en `dev`**).

## Qué se midió antes de escribir esto (2026-09-10, en el árbol real, no en el grafo)

1. **No existe nada de este aviso.** `db/schema.prisma:2636` declara **trece** valores de
   `NotificacionEvento` y ninguno habla del reparto del día siguiente; `lib/notificaciones/emitir.ts`
   no tiene emisor; `vercel.json` tiene **nueve** crons y ninguno es éste; no hay productor. Lo que
   el lienzo aprobado promete al mensajero —«tenés N órdenes para mañana»— es **una promesa sin
   código**, y así lo dejó escrito la 410 (`design.md §3.2`, fila «su reparto de mañana»:
   *«No existe nada: ni evento en el enum, ni emisor, ni cron, ni productor»*).
2. **`orden.fecha_reparto` es `@db.Date`** (`db/schema.prisma:658`), no `timestamp`. Eso decide la
   convención horaria entera (ver `design.md §2`): aquí la trampa de las seis horas se pisa **por la
   puerta contraria** a la que suele avisarse.
3. **El día de reparto sólo puede ser HOY o MAÑANA.** `lib/types/dia-reparto.ts:18` declara
   `DIA_REPARTO = ["hoy", "manana"]`, y tanto la asignación (central y satélite) como la corrección
   de la 262 pasan por `resolverFechaReparto(dia)`. No existe «pasado mañana».
4. **La pregunta «¿cuáles son las de mañana?» ya la responde el portal**: `MisAsignacionesService`
   marca `esParaManana` con `fechaReparto > startOfDayCR(now)` sobre los estados `por_recoger`,
   `en_reparto` y `ayuda_tienda`. Este aviso cuenta **ese mismo conjunto** o miente.
5. **La maquinaria del aviso agregado ya existe y es de la 409**: catálogo
   (`lib/notificaciones/catalogo-avisos.ts`), cifra viva que apaga el aviso sola
   (`IVigenciaAvisoAgregado`), emisión best-effort (`emitirBestEffort`), dedupe por entidad-con-día
   y cron con secreto. Esta ficha **no inventa mecanismo**: añade un evento a lo que ya funciona.

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **día CR** | Día calendario de Costa Rica (UTC−6 fijo, sin horario de verano). |
| **reparto de mañana** | Las órdenes asignadas a un mensajero y **reservadas para un día CR posterior al día CR en curso**. Como el día de reparto sólo puede ser hoy o mañana (medición 3), «posterior» y «mañana» son hoy el mismo conjunto. |
| **día anunciado** | El día CR del que habla un aviso concreto: el siguiente al de su emisión. |
| **cifra viva** | El número de órdenes del reparto de mañana **en el instante de la consulta**, no en el de la emisión. Es el mecanismo de la 409 (`IVigenciaAvisoAgregado`). |
| **aviso agregado** | Una sola notificación con un número dentro, jamás una por orden. |
| **congelar** | Fijar el instante en que el proceso mira el número para emitir. Sólo afecta a lo que se **emite**; lo que se **lee** es siempre la cifra viva (R13). |

---

# Requisitos

## §1 — Qué se cuenta

**R1** (Ubicuo). El sistema DEBE poder contar, para un mensajero, las órdenes que le están asignadas,
no están borradas y están reservadas para un día CR **posterior** al día CR en curso.

**R2** (Ubicuo). El conjunto contado DEBE ser **exactamente** el que el portal del mensajero marca
como «para mañana»: los mismos estados de orden y el mismo criterio de reserva. NO DEBE existir un
segundo criterio para la misma pregunta.

**R3** (Condicional). SI una orden está reservada para el día CR **siguiente**, ENTONCES DEBE
contarse cualquiera que sea la hora a la que se consulte, **incluidas las horas entre las 18:00 y
las 24:00 CR** (las seis primeras horas UTC del día siguiente); y SI está reservada para el día CR
**en curso**, ENTONCES NO DEBE contarse a ninguna hora, tampoco en esa misma franja.

**R4** (Ubicuo). El sistema NO DEBE contar órdenes de otro mensajero, ni borradas, ni las que ya
salieron del universo que el portal del mensajero muestra.

## §2 — El aviso es agregado

**R5** (Ubicuo). El aviso DEBE ser **uno solo con el número dentro**. El sistema NO DEBE emitir una
notificación por orden, cualquiera que sea el número de órdenes.

**R6** (Evento). CUANDO corre la emisión y un mensajero tiene al menos una orden en su reparto de
mañana, el sistema DEBE emitirle **una sola** notificación **dirigida a él**.

**R7** (Condicional). SI dos o más mensajeros tienen reparto para el día siguiente, ENTONCES **cada
uno** DEBE recibir su propio aviso esa misma noche.

**R8** (Ubicuo). El aviso de un mensajero NO DEBE ser visible para ningún otro usuario.

### §2.1 — A quién NO se le emite

> ⚠️ **R42 y R43 llevan número alto a propósito**: se añadieron al cerrar Q2 el 2026-09-11 y **no se
> renumeró el resto**, para no mover cuarenta referencias del mapa `R<n> → test` por estética.

**R42** (De estado). MIENTRAS un mensajero esté **bloqueado por cierres**, el sistema NO DEBE
emitirle este aviso, aunque tenga reparto para el día siguiente.

**R43** (Ubicuo). La comprobación de R42 DEBE aplicarse **en la emisión** y NO DEBE intervenir en la
cifra viva: un aviso ya emitido NO DEBE apagarse porque su destinatario se bloquee después.

## §3 — La hora a la que se congela «lo de mañana»

**R9** (Ubicuo). El sistema DEBE ejecutar la emisión **una sola vez al día**, a una hora CR
**declarada**, y esa hora DEBE ser la misma todo el año.

**R10** (Ubicuo). La hora planificada DEBE expresarse en **UTC** y corresponder exactamente a la hora
CR declarada; la correspondencia DEBE ser verificable sin ejecutar el cron.

**R11** (Ubicuo). El sistema NO DEBE programar esta emisión en la franja **22:00–06:00 hora CR**: el
aviso llega también al teléfono (§6) y esa franja es de noche.

**R12** (Condicional). SI una orden entra al reparto de mañana **después** de la hora de emisión,
ENTONCES el sistema NO DEBE emitir por ella una notificación adicional esa noche; el destinatario
DEBE verla reflejada igualmente al consultar (R13).

## §4 — Qué pasa cuando el número cambia después de avisar

**R13** (Ubicuo). El número que el destinatario LEE DEBE ser la **cifra viva** en el instante de la
consulta, acotada a él, y NO la del instante de la emisión.

**R14** (Ubicuo). El sistema NO DEBE emitir una segunda notificación por un cambio del número, ni al
alza ni a la baja.

**R15** (Ubicuo). El texto **persistido** de la notificación NO DEBE contener el número de órdenes:
un número persistido es un número que puede quedar obsoleto y nadie corrige.

**R16** (Condicional). SI la resolución de la cifra viva falla, ENTONCES el sistema DEBE mostrar el
aviso igualmente y seguir sirviendo el resto del listado (fallo hacia mostrar, nunca hacia una
campana en blanco).

**R17** (Condicional). SI quien consulta no puede tener reparto asignado —porque su rol no es el del
destinatario de este aviso—, ENTONCES la resolución de la cifra viva DEBE fallar de forma ruidosa y
NO DEBE devolver cero.

## §5 — El cero, y el día que llega

**R18** (Condicional). SI un mensajero no tiene ninguna orden en su reparto de mañana, ENTONCES el
sistema NO DEBE emitirle este aviso.

**R19** (Condicional). SI la cifra viva de un aviso ya emitido llega a cero, ENTONCES el sistema NO
DEBE mostrarlo en el panel ni contarlo en el distintivo, **sin que nadie lo lea, lo marque ni lo
descarte**.

**R20** (Condicional). SI la cifra viva vuelve a ser mayor que cero el mismo día, ENTONCES el aviso
DEBE volver a mostrarse y a contarse, **sin crear una segunda notificación**.

**R21** (Evento). CUANDO llega el día CR anunciado por el aviso, el sistema NO DEBE seguir
mostrándolo ni contándolo, aunque su destinatario nunca lo haya abierto.

## §6 — Uno al día, y el de la noche siguiente

**R22** (De estado). MIENTRAS un mensajero tenga reparto para el día siguiente, el sistema DEBE
emitirle este aviso **una vez por día anunciado**, y no más de una: dos corridas del mismo anuncio
DEBEN dejar **una sola** notificación.

**R23** (Evento). CUANDO la emisión corre en dos noches consecutivas y el mensajero tiene reparto las
dos, el sistema DEBE crear **dos** notificaciones, una por cada día anunciado.

**R24** (Ubicuo). La unicidad de R22 y la repetición de R23 DEBEN ser **estructurales** —una
propiedad de la clave de los datos— y no el resultado de una comprobación previa que una carrera o
un reintento puedan burlar.

## §7 — Clasificación, atajo y texto

**R25** (Ubicuo). El sistema DEBE declarar, para el evento nuevo y su rol destinatario, si el aviso
es accionable o informativo y cuál es su atajo. Un valor del enum sin esa declaración DEBE **impedir
la compilación**.

**R26** (Ubicuo). El aviso DEBE llevar atajo a la pantalla donde el mensajero ve su reparto, y esa
ruta DEBE existir **y** ser visible para el rol destinatario.

**R27** (Ubicuo). El título DEBE decir la cifra viva con singular y plural **correctos**.

**R28** (Ubicuo). El texto persistido DEBE **nombrar la fecha** del día anunciado, de modo que siga
siendo cierto cualquiera que sea el día en que se lea.

**R29** (Ubicuo). El texto del aviso NO DEBE contener número de guía, remisión, dirección, teléfono,
nombre de destinatario, nombre de tienda ni monto.

## §8 — Elegibilidad de push

**R30** (Ubicuo). El sistema DEBE declarar la elegibilidad de push del evento nuevo. Un valor del
enum sin esa declaración DEBE **impedir la compilación**, nunca caer en un valor por defecto.

**R31** (Opcional). DONDE el catálogo de elegibilidad de push exista en el árbol, el evento nuevo
DEBE estar declarado **elegible para el mensajero destinatario** y para ningún otro perfil.

**R32** (Ubicuo). El push de este aviso NO DEBE crear ninguna notificación adicional: es transporte
del aviso que ya existe.

## §9 — El proceso

**R33** (Condicional). SI la petición al endpoint de emisión no trae el secreto correcto, o el
secreto no está configurado, ENTONCES el sistema DEBE responder 401 **sin producir ningún efecto**.

**R34** (Condicional). SI la emisión del aviso de un mensajero falla, ENTONCES el sistema DEBE
registrar el fallo con su contexto, continuar con los demás y terminar la corrida.

**R35** (Ubicuo). La respuesta del endpoint DEBE llevar sólo conteos agregados y la fecha de la
corrida; NO DEBE llevar identificadores de orden, de persona ni de zona.

**R36** (Ubicuo). El emisor **real** de este aviso DEBE estar inyectado en el punto de composición
del proceso; el valor por defecto DEBE seguir siendo el emisor nulo.

**R37** (Ubicuo). La emisión NO DEBE ejecutarse dentro de la transacción de ninguna operación de
negocio ni bloquear ninguna.

## §10 — Datos, seguridad y lo que no se toca

**R38** (Ubicuo). La migración que amplía los enums DEBE ser reversible; su reversión NO DEBE
eliminar valores añadidos por otras fichas **ni dejar sin convertir ninguna columna** que use esos
tipos.

**R39** (Ubicuo). El sistema NO DEBE modificar el predicado de visibilidad de notificaciones ni la
autorización de ninguna de sus operaciones.

**R40** (Ubicuo). El sistema NO DEBE alterar el comportamiento de ningún aviso existente, de ningún
emisor existente ni del portal del mensajero.

**R41** (Ubicuo). La resolución de la cifra viva NO DEBE añadir más de **una** consulta por sondeo
para el actor que tiene este aviso vivo, y **ninguna** para quien no lo tiene.

---

## §11 — Mapa `R<n> → test`

> Ruta y nombre **propuestos**; el implementer los confirma en `progress/impl_413.md`.
> **Los literales de texto se afirman a mano**, nunca comparándolos contra la función o la constante
> que los genera (lección «aserción contra su propia fuente»).
> ⚠️ **Los tests marcados `[PG]` van contra Postgres real** (`tests/integration/db/`): son el
> `WHERE` y la clave única, que un doble no puede ver. Si el gate los reporta `skipped`, **la ficha
> no está verificada**.

| R | Test | Aserto que se pone ROJO si el código está mal |
| --- | --- | --- |
| R1 | `tests/integration/db/reparto-manana-repository.test.ts` **[PG]** | siembra 3 órdenes del mensajero para mañana, 2 para hoy y 1 borrada para mañana ⇒ el conteo da **3**. **Matar el test antes de creerlo:** con la base vacía debe FALLAR, no pasar por vacío |
| R2 | `tests/unit/guards/estados-reparto-mensajero-unica-fuente.guardia.test.ts` | la lista de estados se declara **una vez** y la leen **dos**: el portal y el repositorio del aviso. **Mutación:** duplicar la lista en el repositorio ⇒ rojo |
| R3 | `tests/integration/db/reparto-manana-repository.test.ts` **[PG]** | con reloj fijo en `2026-09-11T23:50:00-06:00` (= `2026-09-12T05:50:00Z`), una orden con `fecha_reparto = 2026-09-12` **entra** y una con `2026-09-11` **no**. **Mutación obligatoria:** cambiar el helper de fecha al de columnas `timestamp` ⇒ los dos asertos rojos |
| R4 | `tests/integration/db/reparto-manana-repository.test.ts` **[PG]** | órdenes de OTRO mensajero para mañana no entran; una en un estado fuera del universo del portal tampoco |
| R5 | `tests/unit/notificaciones/reparto-manana-aviso.test.ts` | 40 órdenes ⇒ `crear` llamado **exactamente una vez**, con el `40` en el título |
| R6 | `tests/unit/services/reparto-manana-service.test.ts` | mensajero con 5 ⇒ una emisión dirigida **a usuario** (no a rol), con su id |
| R7 | `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** | dos mensajeros con reparto la misma noche ⇒ **2 filas**. **Mutación obligatoria:** dirigir el aviso a un ROL en vez de a un usuario ⇒ 1 fila y rojo (es el silencio que la 409 destapó) |
| R8 | `tests/unit/repositories/notificacion-visibilidad.test.ts` (vigente, ampliar) | un mensajero B no ve la fila dirigida al mensajero A |
| R9 | `tests/unit/guards/cron-hora-cr.guardia.test.ts` | `vercel.json` tiene **una** entrada para esta ruta, y una sola |
| R10 | `tests/unit/guards/cron-hora-cr.guardia.test.ts` | convierte la expresión de `vercel.json` a hora CR y la compara con la hora declarada en la configuración. **Mutación:** poner la hora CR directamente en el cron (`0 19 * * *`) ⇒ rojo |
| R11 | `tests/unit/guards/cron-hora-cr.guardia.test.ts` | la hora CR resultante cae fuera de 22:00–06:00. **Mutación:** `0 5 * * *` (= 23:00 CR) ⇒ rojo |
| R12 | `tests/unit/services/reparto-manana-service.test.ts` | dos corridas la misma noche con distinto número ⇒ **una** emisión (la segunda no llama a `crear`), y el resumen lo dice |
| R13 | `tests/unit/services/notificacion-service.test.ts` (ampliar) | fila emitida con «5», resolutor devuelve **3** ⇒ el título dice **3** |
| R14 | `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** | subir el número entre dos corridas del mismo anuncio ⇒ sigue habiendo **1** fila |
| R15 | `tests/unit/notificaciones/reparto-manana-aviso.test.ts` | la `descripcion` persistida **no contiene ningún dígito de conteo**: se afirma el literal a mano, con la fecha dentro y sin número |
| R16 | `tests/unit/services/notificacion-service.test.ts` (ampliar) | resolutor que lanza ⇒ el ítem sale y el resto del listado también |
| R17 | `tests/unit/services/vigencia-aviso-agregado.test.ts` (ampliar) | actor `adminTienda` pidiendo este evento ⇒ **lanza**. **Mutación:** devolver `0` ⇒ rojo (es el apagado silencioso de la 417) |
| R18 | `tests/unit/services/reparto-manana-service.test.ts` | mensajero con 0 ⇒ `crear` no se llama; los demás sí reciben el suyo |
| R19 | `tests/unit/services/notificacion-service.test.ts` (ampliar) | fila agregada + resolutor `0` ⇒ el ítem no sale y no cuenta, **sin** fila de lectura ni de descarte |
| R20 | `tests/unit/services/notificacion-service.test.ts` (ampliar) | resolutor `0` ⇒ oculto; resolutor `3` ⇒ visible; el repositorio de **escritura** no se llama en ninguno |
| R21 | `tests/unit/services/vigencia-aviso-agregado.test.ts` | con reloj en `2026-09-12T00:01 CR`, las órdenes de `2026-09-12` ya **no** cuentan ⇒ cifra `0` ⇒ R19 lo apaga. **Es el test que protege la palabra «mañana» del título** |
| R22 | `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** | dos corridas del mismo anuncio ⇒ **1** fila |
| R23 | `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** | dos noches consecutivas ⇒ **2** filas. **Mutación obligatoria:** quitar el día de la entidad ⇒ la segunda noche no avisa y rojo |
| R24 | `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** | dos `crear` concurrentes con la misma entidad ⇒ una fila y **ningún error propagado** (la absorción del choque del índice único) |
| R25 | `tests/unit/notificaciones/catalogo-avisos.test.ts` (ampliar) | «declara los 14 eventos del enum, ni uno menos»; quitar la clave nueva **no compila** |
| R26 | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` (vigente) | el destino existe en `SIDEBAR_ITEMS` y es visible para `mensajero`. **Mutación:** apuntarlo a `/wallet` ⇒ rojo |
| R27 | `tests/unit/notificaciones/catalogo-avisos.test.ts` (ampliar) | literales a mano para `n = 1` y `n = 7` |
| R28 | `tests/unit/notificaciones/reparto-manana-aviso.test.ts` | literal a mano con la fecha en palabras del día anunciado |
| R29 | `tests/unit/notificaciones/reparto-manana-aviso.test.ts` | el texto no contiene guía, remisión, dirección, teléfono, nombre ni `₡` |
| R30 | `pnpm run typecheck` + `tests/unit/notificaciones/catalogo-avisos.test.ts` | el catálogo de la 409 es `Record` exhaustivo: el valor nuevo no compila sin decisión |
| R31 | `tests/unit/notificaciones/push-elegibles.test.ts` **(sólo si el archivo existe)** | entrada `reparto_manana` ⇒ perfil **usuario/mensajero**. Si el archivo aún no existe, T0.3 lo deja escrito y **la casilla queda vacía a propósito** |
| R32 | — | lo garantiza la 410; esta ficha no toca el canal |
| R33 | `tests/unit/api/aviso-reparto-manana-route.test.ts` | sin `Authorization` ⇒ 401 y el service **no se construye**; secreto ausente ⇒ 401 |
| R34 | `tests/unit/services/reparto-manana-service.test.ts` | tres mensajeros, el segundo lanza ⇒ 2 emisiones, 1 fallo registrado, la corrida termina |
| R35 | `tests/unit/api/aviso-reparto-manana-route.test.ts` | el cuerpo 200 tiene exactamente las claves de conteo declaradas y ninguna con un id |
| R36 | `tests/unit/services/notificacion-notificadores-reales.test.ts` (ampliar) | sobre el fuente **sin imports ni comentarios**: el composition root **PASA** el notificador real. **Mutación:** borrar el argumento dejando el import ⇒ rojo |
| R37 | `tests/unit/services/reparto-manana-service.test.ts` | el servicio no recibe ningún cliente transaccional y el emisor va envuelto en best-effort |
| R38 | `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` **[PG]** | aplica y revierte contra Postgres real; tras el `down` quedan los 13 eventos y 11 entidades previos, **todas** las columnas que usan esos tipos siguen convertidas, y el índice único conserva su `NULLS NOT DISTINCT` y su `WHERE` parcial |
| R39 | `tests/unit/repositories/notificacion-visibilidad.test.ts` (vigente) | sigue verde **sin editarla** |
| R40 | suites vigentes de 146/246/261/271/409 | siguen verdes **sin editarlas** |
| R41 | `tests/unit/services/notificacion-service.test.ts` (ampliar) | espía del resolutor: actor con el aviso vivo ⇒ **1** llamada; actor sin él ⇒ **0** |
| R42 | `tests/unit/services/reparto-manana-service.test.ts` | tres mensajeros con reparto, **el segundo bloqueado** ⇒ **2** emisiones y el bloqueado **no** recibe ninguna. **Mutación obligatoria:** no consultar el bloqueo ⇒ 3 emisiones y rojo |
| R43 | `tests/unit/services/vigencia-aviso-agregado.test.ts` (ampliar) | la resolución de la cifra viva **no consulta cierres**: con un doble que falla si alguien le pide el bloqueo, la cifra sale igual. **Mutación:** meter la comprobación en el resolutor ⇒ rojo (y R41 también, por la consulta de más) |

---

## §12 — Decisiones del humano incorporadas (2026-09-11)

**Preguntas abiertas: ninguna.** Las tres del borrador quedaron cerradas, y la primera **con número
medido**, no con una estimación.

| # | Decisión | Dónde vive en este spec |
| --- | --- | --- |
| **Q1** | **19:00 CR confirmado, y ahora con medida.** Asignaciones de los últimos 14 días por franja horaria CR: **06:00–11:00 → 3.183 (89 %)**; 12:00–18:00 → 262; **19:00 en adelante → 148 (~4 %, unas 10 al día)**. **A las 19:00 ya está asignado el ~96 % del volumen del día.** La hora deja de ser «parece razonable» y pasa a ser «a las 19:00 falta por asignar el 4 %» | R9, R10, R11 · `design.md §4.1` |
| **Q2** | **El mensajero bloqueado por cierres NO recibe este aviso.** Si está bloqueado no puede trabajar, así que decirle cuántas órdenes tiene mañana es **prometerle algo que el sistema le va a negar**; y ya tiene su aviso propio —el de bloqueo—, que es el que sí le pide la acción que lo desbloquea. **Dos avisos que apuntan a acciones opuestas es peor que uno menos.** Si se desbloquea, no pierde el dato —su reparto está en su pantalla y la cifra que lea es la viva—: pierde sólo el empujón de esa noche | **R42**, **R43** · `design.md §6.1` |
| **Q3** | **La segunda corrida de las 21:00 CR queda DESCARTADA, con el número delante.** Ese 4 % son ~10 asignaciones al día repartidas entre 18 mensajeros: compraría muy poco y pagaría caro en la regla que más importa —**uno al día por tipo**—. Dos pushes la misma noche por el mismo hecho es justo lo que prohibió la 409. Queda **diseñada y descartada**, con el umbral que la reabriría escrito | `design.md §4.3` |
