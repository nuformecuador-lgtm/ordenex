# Feature 401 — La caída del geocodificador no se avisa a nadie ni se recupera sola

> Lee también `design.md` (el cómo) y `tasks.md` (el desglose). Ficha `backend`, `sdd: true`,
> complejidad media, **`depends_on: 400`**.

## Origen, MEDIDO en producción (no supuesto)

El 2026-09-09 se midió en la base de producción:

1. La Google Geocoding API rechazó **todas** las peticiones con `REQUEST_DENIED` desde el
   **2026-09-08 19:40** hasta el **2026-09-09 15:35**: **19 h 55 min**. El cliente HTTP traduce ese
   estado al desenlace `config_invalida` —credencial, facturación o configuración del proyecto—, y el
   contrato de la feature 91 ya dejó escrito que ese caso **«debe ser RUIDOSO, nunca silencioso»**.
2. **No lo fue. Ninguna alerta se disparó en 19 horas.** Lo detectó un humano porque no podía asignar
   órdenes.
3. **25 jobs quedaron en `failed` y 23 en `pending`** (48 en total, todos con causa `config_invalida`).
   Cuando la credencial volvió a funcionar, la cola **no los recuperó**: el leader entró a la base de
   producción y los resucitó **a mano** (`estado='pending'`, `intentos=0`, `last_error=null`,
   `run_after` adelantado). Sólo entonces se geocodificaron las 42 órdenes represadas, en ~6 minutos.
4. Volumen histórico del tipo `geocodificacion` entre el **26-ago y el 8-sep**: entre **2 y 269 jobs
   `done` por día**. El **8-sep fallaron 25** y el **9-sep 23**, todos con `config_invalida`.

**El criterio de éxito de esta ficha, en una frase: si el mismo incidente se repite, nadie debe tener
que abrir la base de datos.**

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **fallo de configuración propia** | El intento de geocodificación murió por algo NUESTRO —el proveedor rechazó la petición, o falta la credencial— **sin llegar a evaluar la dirección**. |
| **marcador** | La señal legible por máquina que la **ficha 400** deja en el último error registrado del job y que identifica un fallo de configuración propia sin depender de la redacción del mensaje. **Esta ficha lo LEE; nunca lo escribe.** |
| **fallo ajeno a la configuración** | Cualquier otro motivo por el que un job de geocodificación falla: red, timeout, HTTP 5xx, cuota, estado desconocido del proveedor, respuesta con forma inesperada, payload inválido, handler no registrado. |
| **dirección irresoluble** | La geocodificación SÍ se ejecutó y concluyó que la dirección no resuelve. **Completa** el job; nunca lo mata. |
| **caída por configuración propia** | El estado que esta ficha define: hay evidencia suficiente y reciente de que la geocodificación está fallando por configuración nuestra (R3). |
| **jornada** | El día calendario de Costa Rica, unidad ya usada por el resto de avisos periódicos del repo. |
| **respuesta satisfactoria del proveedor** | Una geocodificación resuelta por una llamada real al proveedor. **Un acierto de la caché de direcciones NO lo es.** |
| **recuperación** | Devolver a la cola un job que murió por un fallo de configuración propia, para que vuelva a ejecutarse. |

---

# Requisitos

## Bloque A — Reconocer la caída, sin prosa y sin un segundo mecanismo

**R1** (Ubicuo). El sistema DEBE reconocer un fallo de configuración propia **exclusivamente** a
partir del marcador que define la ficha 400. NO DEBE introducir un segundo mecanismo de detección, ni
inspeccionar la redacción del mensaje de error, ni consultar al proveedor para averiguarlo.

**R2** (Evento). CUANDO un intento de geocodificación termine por un fallo de configuración propia, el
sistema DEBE evaluar la condición de caída contando **jobs de geocodificación distintos** —no
intentos— cuyo último error registrado lleve el marcador y que no estén completados.

**R3** (Condicional). SI el número de jobs distintos contados por R2, incluido el intento en curso,
alcanza el **umbral de jobs** configurado, Y sus últimos fallos ocurrieron dentro de la **ventana de
recencia** configurada, ENTONCES el sistema DEBE considerar que la geocodificación está **caída por
configuración propia**.

**R4** (Condicional). SI no se alcanza el umbral de jobs, o los fallos contados quedan fuera de la
ventana de recencia, ENTONCES el sistema NO DEBE considerar que hay una caída. En particular, un fallo
de configuración **aislado** NO DEBE producir ningún aviso.

**R5** (Ubicuo). El sistema NO DEBE contar como evidencia de caída ningún fallo ajeno a la
configuración.

**R6** (Ubicuo). El sistema NO DEBE evaluar la condición de caída en cada corrida del drenador de la
cola: DEBE evaluarla únicamente a raíz de un fallo de configuración recién ocurrido.

## Bloque B — Alguien se entera

**R7** (Evento). CUANDO el sistema considere que la geocodificación está caída por configuración propia
(R3), DEBE emitir una notificación **a cada uno de los roles `maestro` y `admin`**: una notificación por
rol, con el mismo texto, y ninguno de los dos DEBE quedarse sin ella.

**R8** (Ubicuo). El sistema DEBE emitir la notificación de R7 reutilizando el mecanismo de
notificaciones ya existente —tabla de notificaciones, su repositorio y el patrón de notificador
best-effort—, sin construir un canal de aviso nuevo.

**R9** (Evento). CUANDO la caída persista dentro de una misma jornada, el sistema DEBE emitir **como
mucho una** notificación **por rol destinatario** en esa jornada, por muchas veces que la condición se
evalúe. El aviso dirigido a un rol NO DEBE suprimir el dirigido al otro.

**R10** (Evento). CUANDO la caída persista más allá de una jornada, el sistema DEBE emitir una
notificación **independiente** en cada jornada nueva y para cada rol destinatario: un aviso ya emitido
NO DEBE suprimir el de la jornada siguiente.

**R11** (Condicional). SI la emisión de la notificación de R7 falla, ENTONCES el sistema DEBE registrar
el fallo con contexto (nunca un `catch` vacío), sin propagarlo y **sin alterar el desenlace del job en
curso**: el intento fallido DEBE seguir tratándose exactamente como hoy.

**R12** (Ubicuo). El aviso DEBE quedar **cableado en el punto donde se construye, para producción, el
servicio que lo emite**. Un aviso que exista sólo como función importada, sin que nadie lo pase, DEBE
hacer fallar la verificación: que la función exista NO DEBE bastar para dar el requisito por cumplido.

## Bloque C — Los jobs muertos se recuperan solos

**R13** (Evento). CUANDO una geocodificación se resuelva con una **respuesta satisfactoria del
proveedor**, el sistema DEBE intentar devolver a la cola los jobs de geocodificación que murieron por
un fallo de configuración propia.

**R14** (Ubicuo). Un acierto de la caché de direcciones NO DEBE tomarse como prueba de que el proveedor
volvió: sólo una respuesta satisfactoria del proveedor DEBE disparar R13.

**R15** (Condicional). SI el sistema devuelve un job a la cola por R13, ENTONCES DEBE dejarlo en
condiciones de volver a ejecutarse —pendiente, con sus intentos reiniciados y su último error
limpiado— y NO DEBE cambiar su tipo, su contenido ni su clave de deduplicación.

**R16** (Ubicuo). El sistema DEBE devolver a la cola **únicamente** jobs cuyo último error lleve el
marcador. Un job muerto por cualquier otra causa NO DEBE resucitarse nunca.

**R17** (Ubicuo). El sistema NUNCA DEBE resucitar un job cuya causa sea la dirección, ni introducir
ningún camino que devuelva a la cola un job completado por un desenlace determinista de dirección.

**R18** (Evento). CUANDO el proveedor vuelva a funcionar tras una caída, el sistema DEBE recuperar los
jobs muertos por esa caída **sin ninguna intervención manual sobre la base de datos**.

**R19** (Ubicuo). El sistema DEBE recuperar los jobs muertos empezando por **los más antiguos**.

**R20** (Condicional). SI la operación de recuperación falla, ENTONCES el job que acaba de
geocodificarse con éxito DEBE completarse igualmente, y el fallo de la recuperación DEBE quedar
registrado con contexto sin propagarse.

## Bloque D — Ni tormenta de reintentos, ni bucle

**R21** (Ubicuo). El sistema DEBE limitar a un **máximo configurable** cuántos jobs devuelve a la cola
por cada respuesta satisfactoria observada. NO DEBE devolverlos todos de una vez.

**R22** (Ubicuo). El sistema DEBE **escalonar en el tiempo** los jobs que devuelve a la cola en una
misma tanda, con una separación configurable, de modo que como mucho uno de esa tanda pueda ser
reclamado en cada corrida del drenador.

**R23** (Ubicuo). La recuperación NO DEBE modificar ningún job de un tipo distinto al de la
geocodificación, ni ningún job que no esté muerto.

**R24** (Ubicuo). El sistema NO DEBE devolver a la cola un mismo job más de una vez dentro de un
**intervalo mínimo configurable**, de modo que un proveedor intermitente no pueda hacerlo reintentar
sin fin.

**R25** (Ubicuo). MIENTRAS la geocodificación siga caída por configuración propia, el sistema NO DEBE
devolver jobs a la cola: la recuperación se dispara sólo tras una respuesta satisfactoria del
proveedor.

## Bloque E — Sin datos personales y sin secretos

**R26** (Ubicuo). El texto de la notificación y todo log que esta feature emita NUNCA DEBEN contener la
dirección, el identificador de la orden, su número de guía o de remisión, ni la credencial del
proveedor.

**R27** (Ubicuo). El texto de la notificación DEBE estar en lenguaje llano: NO DEBE usar siglas ni
terminología interna del sistema —quedan prohibidas, entre otras, «geocodificación», «geocodificador»,
«config_invalida», «REQUEST_DENIED» y «API»— y DEBE dejar claro que la causa es la configuración de
nuestra cuenta, no la dirección de ninguna orden.

**R28** (Ubicuo). El sistema NO DEBE reducir el filtrado de datos personales que hoy aplican el cliente
HTTP del proveedor ni el servicio de geocodificación.

## Bloque F — Configuración

**R29** (Opcional/Where). DONDE el umbral de jobs, la ventana de recencia, el máximo de jobs
recuperados por respuesta satisfactoria, la separación entre ellos y el intervalo mínimo de
re-recuperación no se configuren explícitamente, el sistema DEBE usar respectivamente **3 jobs**,
**60 minutos**, **5 jobs**, **60 segundos** y **60 minutos**.

**R30** (Condicional). SI un valor de configuración de R29 está ausente o es inválido, ENTONCES el
sistema DEBE caer a su valor por defecto sin lanzar: cargar la configuración NO DEBE poder tumbar una
corrida del drenador.

## Bloque G — Alcance: lo que esta ficha NO hace

**R31**. Esta ficha NO DEBE introducir un proveedor de geocodificación de respaldo, un sistema de
alertas nuevo, un panel de observabilidad, ni una tabla o columna nueva para guardar el estado de la
caída.

**R32**. Esta ficha NO DEBE cambiar el reparto de turnos del drenador entre tipos de job: **eso es la
ficha 402**, independiente y complementaria.

**R33**. Esta ficha NO DEBE escribir ni modificar el marcador. Producirlo es de la **ficha 400**, y
añadirlo a filas legadas es de la operación idempotente que la 400 conserva. Esta ficha sólo lo **lee**.

**R34**. Esta ficha NO DEBE cambiar el árbol de decisión del gate de asignabilidad ni los mensajes al
operador: **eso es la ficha 400**.

**R35**. Esta ficha NO DEBE modificar el contrato genérico de la cola de jobs ni la lógica de backoff /
dead-letter de su drenador, que sirven a nueve tipos de job.

---

## Frontera con otras fichas

- **400** (`depends_on`): define y **escribe** el marcador. 401 lo **lee** y no lo escribe nunca (R33).
  La operación idempotente de la 400 (que añade el marcador a filas legadas) y la recuperación de la
  401 **se complementan y no se solapan**: la 400 decide la *elegibilidad* (quién lleva el marcador),
  la 401 decide el *estado* (quién vuelve a la cola). Detalle y regla de precedencia en `design.md` §8.
- **403** (`una suscripción de webhook que falla siempre…`): comparte con esta ficha la necesidad de
  «avisar cuando algo falla sistemáticamente en la cola», pero **no hay dependencia de código en
  ninguna dirección**. Lo que 401 toma de 403 es el **criterio de razonamiento del umbral** y la
  **convención de entidad sintética**; los números de 403 (3 fallos y 24 h sin entrega exitosa) están
  calibrados sobre el histórico de webhooks y **no se heredan**: esta ficha mide los suyos
  (`design.md` §4). El único acoplamiento real es el **orden de las migraciones de enum**, resuelto por
  regla en `design.md` §3.3.
- **402** (`la cola no reparte trabajo entre tipos`): esta ficha se **protege** de causar el problema
  de la 402 (limitando y escalonando las recuperaciones, R21/R22) pero **no lo resuelve**; la 402 sigue
  siendo necesaria y ninguna sustituye a la otra.
- **92** (done): sus desenlaces deterministas de dirección **completan** el job en vez de matarlo, y por
  eso el conjunto de jobs recuperables y el de «dirección mala» son disjuntos por construcción (R17).

---

## Trazabilidad R → test

Un requisito sin test es un fallo de la feature (`docs/specs.md`). Archivos existentes marcados
*(ext.)* = se extienden; el resto son nuevos.

| R | Test concreto |
| --- | --- |
| R1 | `tests/unit/services/geocode-salud-service.test.ts` — «la evidencia se cuenta con el detector del marcador de la 400, y un `lastError` con la prosa legada SIN marcador no cuenta» + `tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts` — el árbol de esta feature no contiene los literales `REQUEST_DENIED` ni `config_invalida` en ningún predicado (con contraprueba) |
| R2 | `tests/unit/services/geocode-salud-service.test.ts` — «un solo job con 7 intentos fallidos con marcador NO cruza el umbral; tres jobs distintos con 1 intento cada uno SÍ» (fija «jobs, no intentos») |
| R3 | idem — matriz sobre el umbral: 2 jobs → no avisa; 3 jobs → avisa; 3 jobs con el más viejo fuera de la ventana → no avisa |
| R4 | idem — «un fallo de configuración aislado no emite nada» y «el job en curso cuenta como uno: con `umbral−1` ya registrados, avisa» |
| R5 | idem, parametrizado sobre red / timeout / 5xx / cuota / estado desconocido / respuesta inválida / payload inválido / handler no registrado — «ninguno cuenta como evidencia y ninguno emite» |
| R6 | `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* — un doble de salud que cuenta llamadas: en los desenlaces `ok` (con caché), `sin_resultados`, `consulta_invalida`, `SIN_DIRECCION`, orden borrada y `transitorio` **no se llama a la evaluación de caída** |
| R7 | `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` — «una emisión crea **exactamente dos** filas, una al rol `maestro` y otra al rol `admin`, con el **mismo** texto y sin acotar por tienda ni por zona» (lista de destinatarios afirmada a mano, no derivada de la constante) + `tests/unit/services/notificacion-notificadores-reales.test.ts` *(ext.)* — el camino real las crea |
| R8 | `tests/unit/services/notificacion-notificadores-reales.test.ts` *(ext.)* — usa `INotificacionRepository.crear`; ningún canal nuevo |
| R9 | `tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts` — dos emisiones el mismo día CR dejan **dos filas en total** (una por rol), no cuatro; y «con la fila del `maestro` ya leída y la del `admin` sin leer, una segunda emisión del mismo día no crea ninguna nueva» (índice único de dedupe vivo tras la migración, con `destinatario_rol` dentro de la clave) + `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` — la entidad emitida es el día CR |
| R10 | idem *(integración)* — dos emisiones en días CR distintos dejan **cuatro** filas (dos por jornada), aunque las de la primera jornada sigan sin leer |
| R11 | `tests/unit/services/geocode-salud-service.test.ts` — con el notificador lanzando: el error queda logueado con contexto, no se propaga, y el desenlace del job no cambia |
| R12 | `tests/unit/services/notificacion-notificadores-reales.test.ts` *(ext.)*: (a) guardia por SITIO sobre `lib/services/jobs/geocodificacion-handler.ts` afirmando el **uso efectivo** (fuente sin imports ni comentarios) del binding real dentro de la construcción; (b) `GeocodeSaludService.ts` entra en el censo `SERVICES_CON_NOTIFICADOR` (su default debe ser el no-op); (c) la guardia derivada ya existente («ningún notificador REAL puede quedarse sin composition root») lo cubre por nombre. **Prueba de la prueba, obligatoria (`tasks.md` T13):** borrar el argumento dejando el import intacto y ver (a) y (c) en ROJO |
| R13 | `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* — tras un desenlace `ok` del proveedor, se invoca la recuperación exactamente una vez |
| R14 | idem *(ext.)* — con acierto de caché **no** se invoca la recuperación (el job termina igual) |
| R15 | `tests/integration/db/geocode-recuperacion.test.ts` — filas sembradas: tras recuperar quedan `pending`, `intentos = 0`, `last_error` nulo, y `tipo`/`payload`/`dedupe_key` **idénticos** a los de antes (comparación de filas testigo antes/después) |
| R16 | idem — se siembra un `failed` de geocodificación **sin** marcador y otro con la prosa legada: ninguno se toca |
| R17 | `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* — los tres desenlaces deterministas de dirección siguen dejando el job completado y **nunca** producen una fila elegible; + R16 (un job sin marcador no es elegible) |
| R18 | `tests/integration/db/geocode-recuperacion.test.ts` — reproducción del incidente: N filas `failed` con marcador → una respuesta satisfactoria → todas vuelven a `pending` sin ninguna sentencia manual |
| R19 | idem — con más candidatos que el máximo, los recuperados son **los de `updated_at` más antiguo** |
| R20 | `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* — con la recuperación lanzando, el job exitoso se completa igual y el fallo queda logueado |
| R21 | `tests/integration/db/geocode-recuperacion.test.ts` — con 25 candidatos y máximo 5, se recuperan exactamente 5 |
| R22 | idem — los `run_after` de la tanda están separados **al menos** la separación configurada y todos son posteriores al instante de la recuperación; + `tests/unit/services/geocode-salud-service.test.ts` — aserción sobre los parámetros pasados al repositorio |
| R23 | `tests/integration/db/geocode-recuperacion.test.ts` — filas testigo de otros tipos de job y de geocodificaciones `done`/`pending` con marcador: ninguna cambia (se comparan antes/después) |
| R24 | idem — un job recuperado hace un instante no se vuelve a recuperar en la siguiente llamada; uno cuyo `updated_at` es anterior al enfriamiento, sí |
| R25 | `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* — durante `config_invalida` la recuperación **no** se invoca ni una vez |
| R26 | `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` — el texto emitido no contiene dígitos de identificador, `@`, ni las cadenas de una dirección/id/guía de prueba, y el `anexo` es nulo + `tests/unit/services/geocode-salud-service.test.ts` — ningún mensaje pasado al logger contiene la credencial de prueba |
| R27 | `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` — el literal completo afirmado **a mano** (nunca comparado contra la función que lo genera) y ausencia, case-insensitive, de «geocodifica», «config_invalida», «REQUEST_DENIED» y «API» |
| R28 | `tests/unit/clients/google-geocode.test.ts` y `tests/unit/services/geocodificacion-service.test.ts` (tests vigentes) deben seguir verdes sin cambios: esta ficha no toca el cliente HTTP |
| R29 | `tests/unit/config/geocode-salud-config.test.ts` — los cinco defaults sin variables de entorno definidas, afirmados a mano |
| R30 | idem — valores vacíos, no numéricos, cero y negativos caen al default y `load…()` no lanza |
| R31 | `./init.sh` completo + revisión de alcance: el diff no crea tabla ni columna. La única migración de estructura es el índice parcial (`design.md` §3.2), declarado en `progress/impl_401_*.md` |
| R32 | Revisión de alcance: el diff no toca `lib/services/JobQueueService.ts` ni el orden del claim. Verificable con `git diff --stat` en el informe del reviewer |
| R33 | `tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts` — el árbol de esta feature no contiene ninguna escritura del marcador; el módulo del marcador (400) sigue siendo su único productor |
| R34 | Revisión de alcance: el diff no toca `AsignabilidadCoordenadasService.ts` ni `geocodificacion-motivo-messages.ts`. Sin test de código (requisito de NO-hacer) |
| R35 | `tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts` — `lib/interfaces/repositories/IJobRepository.ts` no gana métodos por esta ficha (afirmación sobre la lista de miembros) |

---

## Preguntas abiertas

**Q1 — RESUELTA el 2026-09-09 por el humano: el aviso va al `maestro` Y a los `admin`.**
La propuesta de este spec era «sólo `maestro`» (mismo criterio con el que la 333 lo eligió: la acción
que el aviso pide —revisar la credencial y la facturación de la cuenta del proveedor de mapas— es del
dueño). **El humano decidió los dos roles**, y R7/R9/R10 ya lo dicen. No es un destinatario «de más»:
un corte del proveedor deja de ubicar direcciones de toda la operación, y el `admin` es quien la mira a
diario; el `maestro` puede no estar delante durante las horas que dura el corte —que es exactamente lo
que pasó las 19 h del 8/9-sep—. El coste está medido y es nulo (`design.md` §7.5). La alternativa
descartada queda escrita en `design.md` §8-A13.

**Q2 — ¿Los cinco números son los correctos?**
Umbral 3 jobs / ventana 60 min / lote 5 / separación 60 s / enfriamiento 60 min están **calibrados
contra el histórico medido** y justificados uno a uno en `design.md` §4 y §6. Siguen siendo un juicio
de producto: si el humano prefiere otro punto del equilibrio entre «avisar antes» y «no avisar por un
fallo aislado», son cinco variables de entorno (R29), no un cambio de diseño.

**Q3 — ¿El aviso debe repetirse cada jornada mientras el corte siga vivo, o basta uno por corte?**
Se propone **uno por jornada** (R9/R10, patrón de la 333). Con el incidente medido eso son **2 avisos**
(8-sep y 9-sep) en vez de ~1.140 (el drenador corre cada minuto) y en vez de uno solo que se pierde si
nadie lo lee esa noche. El coste declarado: **dos cortes independientes dentro de la misma jornada
producen un solo aviso**. Si eso no se acepta, la alternativa es una entidad por franja horaria, con su
coste medido en `design.md` §7-A5.

**Q4 — ¿Se acepta que un job legado, sin marcador, no se recupere nunca solo?**
La 400 conserva una operación idempotente de un solo uso que añade el marcador a filas legadas, y esta
ficha **no la automatiza** (R33). Consecuencia: un job `failed` cuyo `last_error` sea anterior al
marcador **nunca** se recuperará por sí solo. Medido el 2026-09-09 por la propia 400: hoy hay **cero
filas** en esa condición. Se propone aceptar el hueco; reconocer la prosa legada en caliente es
exactamente lo que la 400 prohíbe (`design.md` §8-A1 de la 400). Si el humano prefiere cerrarlo, la vía
es correr esa operación de la 400 como paso de despliegue, no ampliar el predicado de la 401.

**Q5 — ¿Es aceptable que un día de volumen mínimo no dispare el aviso?**
Con el volumen más bajo medido (**2 jobs/día**) el umbral de 3 jobs distintos **no se alcanza**, y un
corte que ocurra ese día no se avisa. Se propone aceptarlo, con este argumento: el daño son 2 órdenes,
y con la 400 desplegada esas 2 órdenes **ya son asignables sin ubicación**, así que no bloquean a nadie.
Bajar el umbral a 1 compraría ese caso al precio de avisar en cada ventana de despliegue sin credencial
(`design.md` §4). Está declarado, no escondido.
