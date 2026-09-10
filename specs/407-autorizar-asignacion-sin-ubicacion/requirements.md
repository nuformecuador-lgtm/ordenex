# 407 — Autorizar la asignación de una orden sin ubicación

## Contexto medido (no es requisito, es la evidencia)

El 2026-09-10, en producción:

- **Guía 76068276**, ÓSCAR ELIZONDO SOLIS, Quesada / San Carlos / Alajuela, zona «FGAM San
  Ramón», estatus `en_bodega_satelite`, sin mensajero. Cargada el 5-sep, geocodificada el
  7-sep con `geocode_status = ZERO_RESULTS` y `latitud`/`longitud` en `null`. **Cinco días
  parada**, porque el gate de asignabilidad por coordenadas (feature 92, R3) la clasifica como
  `direccion_no_geocodificable` y ninguno de los dos caminos de asignación la deja pasar.
- Su dirección: «DE LA CLINICA VETERINARIA MASCOTICAS, 75 METROS HACIA EL SUR SE ENCUENTRA LA
  ENTRADA PRINCIPAL DEL RESIDENCIAL VISTAS DEL SOL, DE ESA ENTRADA 870 METROS HACIA EL ESTÉ, EN
  LÍNEA RECTA HASTA PEGAR CON PORTON GRANDE». Correcta para un humano, ilegible para Google.
- Hay **otra** igual (Palmira / Carrillo, «Del doit center 8 kilómetros al norte camino a
  papagayo…»), todavía sin guía. **Son las 2 únicas órdenes sin coordenadas de toda la base.**

**Decisiones del humano, 2026-09-10 (premisas de la ficha, no reabribles):**

1. La dirección es descriptiva pero el mensajero llega sin problema, así que **no debe bloquear**.
2. La vía es **autorizar la asignación**, no capturar coordenadas a mano.
3. **No hace falta rastro.** La autorización **no se persiste**: es un **parámetro de la propia
   acción de asignar**. El operador la marca en el modal y esa misma llamada asigna. Sin tabla,
   sin columna, sin migración. Consecuencia aceptada a sabiendas: **no se podrá responder «quién
   autorizó esto» más adelante**, y si una orden se libera y se vuelve a asignar, **hay que volver
   a autorizarla**.
4. Autoriza **quien ya puede asignar** esa orden. Sin rol nuevo y sin restringir a `maestro`: la
   guía del caso real está en **bodega satélite**, así que exigir maestro dejaría a quien la tiene
   delante sin poder desatascarla.
5. `geocodificacion_agotada` **no** es autorizable: la feature 400 ya resuelve ese caso cuando el
   fallo es nuestro.

**Vocabulario de esta ficha.** «Dirección irresoluble» = el estado `direccion_no_geocodificable`
del gate (feature 92): el ÚNICO veredicto DEFINITIVO, producido por los tres `geocode_status`
deterministas `ZERO_RESULTS`, `INVALID_REQUEST` y `SIN_DIRECCION`. «La marca» = el parámetro con
el que una petición de asignación declara que una persona autoriza, a sabiendas, asignar esa orden
sin ubicación en el mapa.

---

## Requisitos

### Alcance de la marca

**R1.** CUANDO una petición de asignación traiga la marca para una orden de su propio lote, y el
gate de asignabilidad clasifique esa orden como bloqueada por dirección irresoluble, el sistema
DEBE dejarla pasar y asignarla en esa **misma** petición.

**R2.** El sistema NUNCA DEBE tener en cuenta la marca sobre una orden cuyo bloqueo no sea
«dirección irresoluble». En particular, `geocodificacion_en_curso`, `geocodificacion_encolada`,
`geocodificacion_no_encolable` y `geocodificacion_agotada` DEBEN seguir bloqueando la asignación
aunque la marca venga: ninguno es un veredicto definitivo sobre la dirección y la orden todavía
puede resolverse sola.

**R3.** El sistema NUNCA DEBE aplicar la marca a una orden que no esté en el lote de esa misma
petición.

**R4.** SI la orden marcada tiene latitud y longitud, ENTONCES el sistema DEBE clasificarla como
asignable con normalidad y la marca NO DEBE tener ningún efecto observable.

**R5.** MIENTRAS una petición de asignación no traiga ninguna marca, el sistema DEBE comportarse
exactamente como antes de esta ficha: misma clasificación del gate, mismos resultados, mismos
textos.

### Permisos

**R6.** El sistema NO DEBE exigir ningún permiso adicional por traer la marca: DEBE aplicar las
mismas comprobaciones de rol, zona, estado de origen, mensajero y tope de intentos que ya
gobiernan la asignación correspondiente, y DEBE evaluarlas **antes** de mirar la marca.

**R7.** SI el actor no supera esas comprobaciones, ENTONCES la marca NO DEBE producir ningún
efecto y ninguna orden DEBE cambiar de estado.

### Lote

**R8.** CUANDO un lote contenga a la vez órdenes marcadas y órdenes bloqueadas por un motivo no
autorizable, el sistema DEBE asignar las marcadas y reportar las demás como bloqueadas, sin
abortar el lote.

### Nada se guarda (consecuencia declarada de la decisión 3)

**R9.** El sistema NUNCA DEBE persistir la marca ni ningún estado derivado de ella. SI una orden
asignada con la marca vuelve a quedar disponible para asignación, ENTONCES el sistema DEBE volver
a exigir la marca para poder asignarla de nuevo.

### Las cifras y los textos

**R10.** CUANDO una asignación deje pasar órdenes por la marca, el resultado DEBE informar cuántas
fueron, como cifra agregada y separada de la cifra de la feature 400.

**R11.** Ninguna orden DEBE contarse a la vez en la cifra de la feature 400 y en la de esta ficha.

**R12.** El sistema NUNCA DEBE describir una orden asignada por la marca con el texto de la
feature 400 («por un problema del sistema, no de la dirección»): en este caso el problema **sí** es
la dirección, y ese texto sería falso.

**R13.** CUANDO el sistema informe de órdenes asignadas por la marca, DEBE usar el literal fijado
en `design.md` §5.2, en lenguaje llano, sin siglas ni jerga interna.

**R14.** ANTES de que la persona confirme la autorización, el sistema DEBE mostrarle el literal de
consecuencia fijado en `design.md` §5.1: que la orden se asignará sin ubicación en el mapa, que
aparecerá al final de la lista de entregas del mensajero y que no se tendrá en cuenta al calcular
el orden del recorrido.

**R15.** El sistema NUNCA DEBE incluir en los textos de R13 y R14 la dirección, el destinatario,
el teléfono, el número de guía ni el identificador interno de ninguna orden.

### Lo que hace el modal

**R16.** CUANDO un intento de asignación devuelva al menos una orden bloqueada por dirección
irresoluble, el modal DEBE ofrecer autorizar y asignar esas órdenes, tanto si el intento no asignó
ninguna orden como si asignó solo una parte del lote.

**R17.** Los modales de asignación NUNCA DEBEN decidir con literales propios qué motivo del gate
es autorizable: DEBEN obtener ese criterio del único módulo compartido de vocabulario.

**R18.** CUANDO la persona confirme la autorización, el modal DEBE lanzar **una sola** petición de
asignación que lleve la marca y esté acotada a las órdenes autorizables.

**R19.** El modal DEBE identificar las órdenes de ese bloque por su número de remisión, nunca por
su identificador interno ni por su dirección.

**R20.** El manifiesto del modal DEBE incluir todas las órdenes efectivamente asignadas durante
esa apertura, también las asignadas en la segunda petición.

---

## Mapa `R<n>` → test

Los tests marcados «(nuevo)» no existen todavía; el resto se amplía. El criterio de «hecho» de
cada uno está en `tasks.md`.

| R | Test que lo cubre |
| --- | --- |
| R1 | `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts` (nuevo) — fila `ZERO_RESULTS` sin coordenadas + su id en el conjunto marcado → `asignable_sin_ubicacion_autorizada`; y `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` (ampliados) — esa orden sale en `resultados` y **no** en `bloqueadas` |
| R2 | `asignabilidad-coordenadas-autorizada.test.ts` — tabla parametrizada con los cuatro estados de cola, **todos con la marca puesta** → los cuatro siguen bloqueando |
| R3 | `asignabilidad-coordenadas-autorizada.test.ts` — conjunto marcado con un id que no está en el lote → ninguna orden del lote cambia de estado |
| R4 | `asignabilidad-coordenadas-autorizada.test.ts` — lat/lng presentes + marca → `asignable` (no el estado nuevo) |
| R5 | `tests/unit/services/asignabilidad-coordenadas.test.ts` (existente, **sin tocar expectativas**) + los dos gate-tests de los writers siguen verdes con sus `toEqual` intactos |
| R6 | `guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` — con la marca puesta, un actor sin rol devuelve `forbidden`; un mensajero bloqueado por cierres, una orden en origen inválido y una orden en el tope de intentos siguen abortando el lote **antes** del gate |
| R7 | idem — en cada uno de esos casos, `asignarBodegaLote` / `asignarSateliteLote` **no se llamó** |
| R8 | `guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` — lote de 3 (una marcada e irresoluble, una `geocodificacion_en_curso`, una asignable) → `partial` con 2 en `resultados` y 1 en `bloqueadas` |
| R9 | `asignabilidad-coordenadas-autorizada.test.ts` — dos llamadas consecutivas a `evaluar` sobre la MISMA fila, la primera con marca y la segunda sin ella → la segunda devuelve `direccion_no_geocodificable`. Mutación que lo pone rojo: guardar el conjunto en un campo de la instancia |
| R10 | `guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` — `ok`/`partial` llevan `sinUbicacionAutorizada` solo cuando es mayor que cero (`not.toHaveProperty` cuando es cero) |
| R11 | idem — lote con una orden de la 400 y una de la 407 → `{ sinUbicacion: 1, sinUbicacionAutorizada: 1 }`, sumas disjuntas |
| R12 | `tests/unit/guards/autorizacion-texto-no-miente.guardia.test.ts` (nuevo) — lee el árbol real y afirma que el literal de R13 no contiene «no de la dirección» ni «problema del sistema», y que los dos mensajes agregados son distintos entre sí |
| R13 | `tests/unit/components/geocodificacion-motivo-messages.test.ts` (ampliado) — singular, plural y `n <= 0`, comparados contra el texto **escrito a mano en el test**, copiado de `design.md` §5.2 |
| R14 | `tests/components/AsignarBodegaModal.autorizacion.test.tsx` y `tests/components/AsignarSateliteModal.autorizacion.test.tsx` (nuevos) — el literal de §5.1 está en el documento **antes** de pulsar el control |
| R15 | `geocodificacion-motivo-messages.test.ts` — la función recibe un `number` (test de firma) y el literal no contiene ninguna cadena de una fixture de PII (la dirección del caso medido, `"76068276"`, un uuid) |
| R16 | `AsignarBodegaModal.autorizacion.test.tsx` / `AsignarSateliteModal.autorizacion.test.tsx` — dos casos: respuesta `conflict` (nada asignado) y respuesta `partial`; y un tercero de contraste: `conflict` con `geocodificacion_en_curso` → **no** hay panel |
| R17 | `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (ampliado) — el barrido de literales sobre el código real de los dos modales, con el octavo estado en su lista, más un `it` que exige que los dos importen el predicado del mismo módulo |
| R18 | `AsignarBodegaModal.autorizacion.test.tsx` / `...Satelite...` — tras confirmar, la acción se llamó **una** vez más, con `ordenIds` y marca **iguales al conjunto autorizable** |
| R19 | idem — el bloque muestra el `numRemision` y el uuid de la orden **no** aparece en el DOM |
| R20 | idem — tras la segunda petición, `ManifiestoResultado` recibe la unión de las órdenes asignadas en las dos |

---

## Preguntas abiertas

Ninguna. Las seis que abría la versión anterior de este documento quedaron **resueltas por el
humano el 2026-09-10** y están recogidas como premisas arriba:

| Antes | Resolución |
| --- | --- |
| Q1 — fila en `historial_accion` | **No.** Cae con el rastro. |
| Q2 — ¿se ve la autorización en pantalla? | **No.** Cae con el rastro. |
| Q3 — ¿`geocodificacion_agotada` autorizable? | **No.** La 400 ya cubre el fallo propio. |
| Q4 — ¿revocar una autorización? | **Sin objeto.** Si nada persiste, no hay nada que revocar. |
| Q5 — ¿quién autoriza? | **Quien ya puede asignar.** Sin rol nuevo (R6). |
| Q6 — los dos literales | **Aprobados tal cual.** No se tocan. |
</content>
