# Feature 261 — El día de reparto reservado protege también del mensajero, y deshacer una gestión no lo borra

> **Una orden reservada para un día posterior al día de Costa Rica en curso deja de poder recogerse
> y de poder gestionarse antes de ese día. Y deshacer una gestión deja de cancelar esa reserva en
> silencio.**
>
> **Esto REVIERTE la decisión D5 de la feature 246.** D5 decía, con todas sus letras, que «la
> reserva protege del CRON, no del mensajero», y se apoyaba en la medición **M3** («nadie carga la
> furgoneta después de las 18:00»). El **2026-08-21 el humano refutó M3 usando la app en
> producción**, con la cuenta del mensajero José: recogió y gestionó `entregada` la guía **17496963**
> a las **22:10 CR del 21** estando reservada para el **22**. La reversión se escribe con fecha y
> motivo, y el texto original de D5 **no se toca**: un spec es la foto de su momento.
>
> **El tercer defecto no estaba en el reporte; lo encontró la medición.** Al **deshacer** esa misma
> gestión (22:18), `CierreDiaRepository.anularGestionYDevolverAGestion` devolvió la orden a
> `en_reparto` y reescribió el día de reparto a **hoy**: `fecha_reparto` pasó de `2026-08-22` a
> `2026-08-21`. La razón escrita de ese estampado es **buena** —«las dos columnas no pueden contar
> historias distintas»— y **sobrevive entera**; lo que no contempló es la reserva **a futuro**, donde
> no repara una incoherencia sino que **cancela una decisión que alguien tomó a propósito**, sin
> avisar, y cambia lo que el corte hace esa misma noche.
>
> **Daño en producción: medido y ya reparado a mano.** Una sola orden (17496963), con un `UPDATE` de
> una columna, con autorización humana explícita, antes del corte de medianoche.
>
> Fuentes leídas para escribir esto (no heredadas de ningún informe):
> `lib/interfaces/services/IMisAsignacionesService.ts`, `lib/services/MisAsignacionesService.ts`,
> `lib/repositories/GestionOrdenRepository.ts`, `lib/repositories/CierreDiaRepository.ts`,
> `lib/services/CierreDiaService.ts`, `lib/repositories/CorteDiarioRepository.ts`,
> `lib/utils/fecha-cr.ts`, `lib/utils/dia-reparto.ts`, `lib/utils/dia-reparto-textos.ts`,
> `db/schema.prisma`, `app/(app)/mis-asignaciones/**`, `tests/unit/guards/
> fecha-reparto-acompana-asignado-at.guardia.test.ts`, `tests/unit/tablero-dia/
> d10-revertida.guardia.test.ts`, `specs/246-asignacion-por-dia/**`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **día de Costa Rica** | La fecha calendario de `America/Costa_Rica` (UTC-6 fijo). Única definición admitida; vive en `lib/utils/fecha-cr.ts`. |
| **día de reparto** | El día de Costa Rica **para el que** se hizo la asignación. Columna `orden.fecha_reparto`, `@db.Date` (feature 246). |
| **reservada** | Una orden cuyo día de reparto es **estrictamente posterior** al día de Costa Rica en curso. |
| **recoger** | Transicionar `por_recoger → en_reparto`. En el portal sólo ocurre por número de guía o por escaneo. |
| **gestionar** | Registrar el resultado de la visita (`entregada`/`reprogramada`/`devuelta`/`rechazada`/`incidente`) desde `en_reparto`. |
| **escoger para gestión** | Fijar el puntero 1-a-1 `usuario.orden_en_gestion_id`. Es la puerta que abre el panel donde se gestiona. |
| **deshacer una gestión** | `CierreDiaService.deshacerGestion` (feature 67): anula la gestión y devuelve la orden a `en_reparto` reponiendo la asignación. |
| **el corte** | El cron `/api/cron/corte-diario`, `0 6 * * *` UTC = 00:00 de Costa Rica. |

### Precisión verificada en el código, no supuesta

1. **`esParaManana` es hoy una ETIQUETA, no una puerta.** Viaja en `MiAsignacionDTO` y se pinta como
   badge; ninguna capa lo consulta para decidir. Por eso la guía 17496963 pudo gestionarse.
2. **Gestionar exige `en_reparto`** (`MisAsignacionesService.cargarOrdenGestionable`). Es decir: una
   orden que se puede gestionar **ya está físicamente en la mano del mensajero**. Esto acota la
   población real del bloqueo de gestionar y hay que tenerlo delante (ver **R27** y `design.md` §7).
3. **La vía de la TIENDA parte de otro estado.** `GestionDesdeAyudaService` resuelve desde
   `ayuda_tienda`, no desde `en_reparto`, y esa orden **conserva su día de reparto** (pedir ayuda no
   lo toca, 235/R6). O sea: el mismo defecto, por otra puerta y con otro actor — que es exactamente
   lo que la decisión de P2 cierra (sección **G**).
4. **El corte ya está bien resuelto y NO entra en esta ficha.** Filtra
   `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)` en el pre-`SELECT` **y** en el
   `updateMany` guardado. Una orden reservada a futuro **no se barre**. La preocupación original
   —«se las va a llevar el cron»— era infundada **para la orden que conservó su fecha**.

---

## A · La reserva bloquea al mensajero (reversión de D5)

**R1.** MIENTRAS una orden esté reservada, el sistema NO DEBE permitir que el mensajero la **recoja**.

**R2.** MIENTRAS una orden esté reservada, el sistema NO DEBE permitir que el mensajero **registre una
gestión** sobre ella.

**R3.** MIENTRAS una orden esté reservada, el sistema NO DEBE permitir que el mensajero la **escoja
para gestión** (fijar el puntero 1-a-1).

**R4.** CUANDO el sistema rechace una de esas tres operaciones por estar la orden reservada, DEBE
hacerlo **sin efectos**: sin cambio de estatus, sin fila de gestión, sin evidencia subida a Storage,
sin fila de historial y sin tocar el puntero de gestión.

**R5.** El sistema DEBE aplicar ese rechazo **en el servidor**, de modo que una petición que no venga
de la interfaz del portal sea rechazada igual.

**R6.** El sistema DEBE decidir «reservada» comparando contra el **día de Costa Rica en curso**,
resuelto en el servidor a partir de un reloj **inyectable**, nunca leído dentro del acceso a datos.

**R7.** CUANDO llegue el día reservado, la orden DEBE volver a ser recogible y gestionable **sin que
nadie ejecute ninguna acción y sin que se escriba nada** en la base.

**R8.** SI una orden **no tiene** día de reparto, ENTONCES el sistema DEBE tratarla como recogible y
gestionable: nada cambia para las órdenes anteriores a la feature 246.

**R9.** El bloqueo NO DEBE **ocultar** la orden ni retirarla del grupo en el que hoy aparece. (R23 de
la 246 sigue vigente: lo que se revierte es R24, no R23.)

**R10.** El bloqueo NO DEBE alterar los indicadores del portal ni la ruta optimizada: una orden
bloqueada cuenta exactamente donde contaba antes.

---

## B · Lo que el mensajero lee

**R11.** MIENTRAS una orden esté reservada, el portal **del mensajero** DEBE decir —**con palabras,
sin siglas y sin nombres de columna**— que todavía no se puede trabajar y **desde qué día** se
podrá. (La superficie de la tienda tiene su propio requisito: **R32**.)

**R12.** MIENTRAS una orden esté reservada y ya esté en reparto, el portal DEBE presentar
**deshabilitado** el control que llevaría a gestionarla.

**R13.** CUANDO el mensajero intente recoger por número de guía o por escaneo una orden reservada, el
portal DEBE decírselo con un mensaje que nombre el **motivo real**, y NO DEBE presentarlo como un
error de la orden ni como un código inválido.

**R14.** El portal NO DEBE derivar del reloj del navegador ni la marca de reserva ni la fecha que
muestre.

**R15.** Los textos que expliquen el bloqueo DEBEN tener **una sola fuente** compartida por todas las
superficies que los muestren, y el servidor DEBE usar esa misma fuente en el motivo que devuelve.

---

## C · Deshacer una gestión no cancela una reserva a futuro

**R16.** CUANDO se deshaga una gestión, el sistema DEBE devolver la orden a `en_reparto` reponiendo
la asignación al mensajero autor y DEBE escribir el día de reparto **en la misma escritura** que el
instante de asignación. (La invariante 246/R10 se conserva entera.)

**R17.** SI el día de reparto de la orden es **posterior** al día de Costa Rica en curso, ENTONCES
deshacer la gestión DEBE **conservarlo**.

**R18.** SI el día de reparto de la orden es anterior o igual al día en curso, **o está ausente**,
ENTONCES deshacer la gestión DEBE fijarlo al **día de Costa Rica en curso**.

**R19.** El día que se escriba al deshacer una gestión DEBE resolverse a partir de un reloj
**inyectable** del servidor, y NO DEBE calcularse dentro del acceso a datos ni derivarse del reloj
del motor de base de datos.

**R20.** CUANDO se deshaga una gestión de una orden cuya reserva sigue siendo futura, el corte de esa
misma noche DEBE seguir sin barrerla.

---

## D · Lo que NO cambia (requisitos de no-regresión)

**R21.** El corte diario DEBE seguir sin barrer una orden reservada para un día que aún no ha llegado,
y DEBE seguir barriendo las de día ausente o pasado.

**R22.** Esta feature NO DEBE introducir ninguna escritura nueva sobre el día de reparto fuera de la
vía de deshacer una gestión, ni retirar ninguna de las existentes.

**R23.** Esta feature NO DEBE requerir migración de esquema ni relleno de datos.

---

## E · La decisión revertida queda escrita, en los dos soportes

**R24.** El contrato donde D5 se declaró (`lib/interfaces/services/IMisAsignacionesService.ts`) DEBE
declararla **revertida**, con la fecha en que se adoptó, la fecha de la reversión, el motivo (la
medición **M3** quedó refutada por una prueba humana en producción) y el puntero a esta ficha. Y NO
DEBE quedar en el árbol del portal del mensajero ninguna frase que la afirme como vigente.

**R25.** El spec de la feature 246 DEBE llevar un **apéndice fechado** que marque D5 como supersedida
y apunte a esta ficha, **conservando intacto** su texto original.

**R26.** El sistema DEBE tener una comprobación automática que se ponga **roja** si (a) reaparece en
el código una frase que afirme que la reserva no bloquea al mensajero, o (b) desaparece el apéndice,
o (c) se **reescribe** el texto original de D5 en vez de anexarle el apéndice.

---

## F · Las órdenes que ya están en ese estado

**R27.** SI al desplegar existen órdenes ya en `en_reparto` con día de reparto posterior al día en
curso, ENTONCES el bloqueo DEBE alcanzarlas igual que a cualquier otra, y su número DEBE haberse
**medido contra producción y escrito** antes del despliegue.

---

## G · La tienda tampoco puede resolver el día que no es

> **Decisión humana del 2026-08-22.** El razonamiento: si el problema es que se registre un resultado
> en un día que no es, **da igual quién lo registre**. La vía de la pestaña de ayuda (feature 237)
> entra en el alcance; ya no es un límite declarado.

**R28.** MIENTRAS una orden esté reservada, el sistema NO DEBE permitir que **la tienda** registre un
resultado sobre ella desde la pestaña de ayuda.

**R29.** CUANDO el sistema rechace esa operación por estar la orden reservada, DEBE hacerlo **antes
de subir ninguna evidencia** a Storage, y sin fila de gestión, sin transición de estado y sin fila de
historial.

**R30.** El sistema DEBE aplicar ese rechazo **también en la escritura**, de modo que una orden cuya
reserva cambie entre la comprobación y la escritura no llegue a registrarse; y SI eso ocurre, las
evidencias ya subidas DEBEN retirarse.

**R31.** El sistema DEBE decidir «reservada» en esa vía con **el mismo criterio y el mismo día** que
en la del mensajero, resuelto en el servidor a partir de un reloj inyectable.

**R32.** CUANDO la tienda intente resolver una orden reservada, la pantalla DEBE decírselo con
palabras, sin siglas ni nombres de columna, nombrando el día desde el que podrá.

---

## H · El agujero que este bloqueo abre queda escrito

**R33.** El sistema DEBE dejar escrito, **en el sitio donde se decide el bloqueo**, que hoy no existe
ninguna superficie para corregir el día de reparto de una orden ya asignada, y el **puntero a la
ficha 262**, que es la que lo resolverá. Esa nota DEBE estar vigilada por la misma comprobación
automática de **R26**: mientras la 262 no exista, el riesgo no puede quedar sólo en un spec que nadie
relee.

---

## Límites declarados (no son controles, son honestidad)

1. **La escritura de la gestión del MENSAJERO no re-comprueba nada en su `WHERE`.** Medido:
   `GestionOrdenRepository.crearGestionYTransicionar` hace `tx.orden.update({ where: { id } })` sin
   re-verificar ni siquiera el estatus de origen. Esta ficha **no le inventa** una puerta SQL sólo
   para el día; la razón y la mitigación están en `design.md` §4.
2. **⚠️ No hay ninguna superficie para corregir el día de reparto de una orden ya asignada, y este
   bloqueo la hace falta.** Medido dos veces —por el spec y por el leader—: `fechaReparto` **no
   aparece en un solo componente de escritura**; las únicas escrituras son las dos vías de
   asignación, cinco limpiezas y el deshacer. Con D5 vigente el mensajero era el escape (recogía y
   entregaba igual); al cerrarlo, un lote mal marcado para otro día queda **inalcanzable para todo
   el mundo** hasta que llegue ese día, y **la única salida es un `UPDATE` a mano en producción**,
   como el que hubo que hacer el 2026-08-21. **Riesgo aceptado por el humano el 2026-08-22**: se
   bloquea ahora y la corrección va en la **ficha 262**. Mientras la 262 no exista, esto es cierto y
   no se suaviza (**R33**).
3. **Una orden reservada a futuro y ya en reparto queda parada del mapa y contacto del chat.** No se
   toca: sigue en la mano del mensajero, y esconderla del mapa sería empezar a ocultar (R9).
4. **La tienda no ve el control deshabilitado, sólo el rechazo explicado.** Decisión de alcance con
   su motivo en `design.md` §5.4: el mensajero está en la calle con el paquete y necesita saberlo
   **antes** de intentarlo; la tienda está en un escritorio y el rechazo es instantáneo y explicado
   (**R32**). El bloqueo de la tienda es igual de real: vive en el servidor, en dos capas (**R28-R31**).

---

## Mediciones que faltan (se toman antes de desplegar, contra producción, **solo lectura**)

| # | Qué mide | Qué decide |
| --- | --- | --- |
| **M1** | Órdenes en `en_reparto` (o `ayuda_tienda`) con `fecha_reparto > <día CR en curso>`, con su mensajero. | **R27**: si el despliegue deja a alguien con un paquete en la mano y sin botón. **YA MEDIDA el 2026-08-21: 2 órdenes, un solo mensajero, ambas para el 22** (`design.md` §7). Se **re-mide** antes de desplegar. |
| **M2** | Órdenes en `por_recoger` con `fecha_reparto > <día CR en curso>`. | Cuántas van a dejar de poder recogerse el primer día. Es el tamaño del cambio visible. |
| **M3'** | Distribución horaria de `por_recoger → en_reparto` **de órdenes reservadas a futuro**, últimos 30 días (`orden_historial_estado`, `origen_tipo='recoleccion'`, uniendo por `fecha_reparto`). | La refutación de **M3**, en números y no sólo en una anécdota. Es lo que deja la reversión de D5 documentada con evidencia. |
| **M4** | Cuántas anulaciones de gestión (`gestion_orden.anulada_at IS NOT NULL`) de los últimos 30 días cayeron sobre órdenes con reserva futura. | La población real del defecto (3). Hoy sabemos de **una**; este número dice si fue casualidad. |

⏳ **Caducan.** Son fotos: se re-miden **justo antes de desplegar**, no antes de mergear. Sus
resultados se pegan en `progress/impl_261_*.md`, con la consulta al lado.

---

## PUERTA HUMANA — decisiones firmadas el 2026-08-22

Las cinco preguntas abiertas de la primera versión de este spec están **resueltas**. Aquí queda el
registro; el texto de las preguntas ya no hace falta porque **ninguna quedó sin respuesta**.

**P1 → Se dejan correr.** Las órdenes ya en `en_reparto` con reserva futura **no se reparan** antes
del despliegue. Medido contra producción el 2026-08-21: **exactamente 2 órdenes, de un solo
mensajero, ambas para el 22** — las de la prueba del humano. Con esa población la recomendación del
spec se sostiene: se desbloquean solas al día siguiente, el corte no se las lleva y no hay dinero en
juego. **Se re-mide antes de desplegar** (B0.3): si el número creciera, la decisión se re-abre.
→ R27.

**P2 → LA TIENDA TAMBIÉN ENTRA.** Razonamiento del humano: *si el problema es que se registre un
resultado en un día que no es, da igual quién lo registre*. La vía de la pestaña de ayuda deja de ser
un límite declarado y pasa a ser alcance. → **R28-R32**, sección G.

**P3 → Se queda en su grupo, con la acción deshabilitada.** Con la recomendación del spec y por su
motivo: es el patrón que el repo ya usa con el mensajero bloqueado por un cierre. **R9 no se
reescribe.** El texto que explica por qué no se puede va en lenguaje claro y sin nombres de columna.
→ R9, R11, R12.

**P4 → Se bloquea AHORA; la corrección va en la ficha 262.** Riesgo **aceptado explícitamente**:
mientras la 262 no exista, un lote mal marcado para otro día **no se puede corregir desde ninguna
pantalla** y la única salida es un `UPDATE` a mano en producción, como el del 2026-08-21. No se
suaviza: es el coste real de cerrar esta puerta antes de abrir la otra. → **R33** y límite declarado 2.

**P5 → `2026-08-21`.** La fecha de la decisión humana, no la del merge, por el motivo que el propio
spec dio: es la que da sentido al texto de la reversión. → R24, R25.

---

### Lo que este spec NO puede decidir y no ha inventado

Nada. Si al implementar aparece un dato que no está en `docs/`, en `specs/` ni en el código, **se
para y se pregunta** (CLAUDE.md, regla 6) — no se rellena con un supuesto.
