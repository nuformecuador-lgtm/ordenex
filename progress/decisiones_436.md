# Ficha 436 — las siete preguntas del spec, resueltas

Decisiones del leader, 2026-09-17. Las que dependían del humano están marcadas como tales.

---

## Q1 — ¿lectura o visibilidad? → **LECTURA**

El asistente usa el predicado de **lectura**, el mismo que la 435 ensancha para maestro y admin. Si
la oficina puede leer un documento, también tiene que poder preguntar sobre él; lo contrario sería
una pantalla que enseña algo y un asistente que finge no conocerlo.

El spec ya lo redactó **por función-rol** («el mismo predicado que decide el gate de
`/ayuda/<slug>`») y no por nombre, que es lo correcto: la 435 puede moverlo debajo sin invalidar nada.

**El argumento del spec es mejor que el mío y lo adopto:** el empate de `/ordenes` que preocupa a la
435 **aquí no existe**, porque el asistente recibe un *conjunto* y nunca tiene que elegir uno. Ese
problema es exclusivo de `mapaRutaDocumento`.

## Q2 — el tope → **30 consultas por persona y día**, configurable

Sale del propio diseño: el cálculo de coste se hizo sobre «diez veces al día cada uno», así que el
triple es tope y no freno. Configurable por entorno con ese valor por defecto.

**Lo que ve quien lo agota** dice el número y cuándo vuelve, nunca «error»: *«Llegaste a las 30
preguntas de hoy. Mañana volvés a tener.»* Un tope que se explica no es un fallo; uno que no se
explica se lee como que la aplicación está rota.

## Q3 — el «?» → **abre el panel**, y va por `/design`

Adopto la propuesta del spec: el «?» del encabezado abre el asistente, y el panel lleva como primera
acción visible **«Leer la ayuda de esta pantalla»** → `/ayuda/<slug>`. No se pierde nada de la 433 y
se gana el asistente en el mismo gesto, sin meter un segundo botón en un encabezado que a 390 px ya
estrangula el título.

Las seis aserciones de `AyudaBoton.test.tsx` y la de `PageHeader.test.tsx` **se mueven a mano**: pasan
de afirmar un `href` a afirmar que el control abre el panel con ese slug como contexto. Son contratos
vivos y se cambian a propósito, no se aflojan.

⚠️ **Y hay una colisión que el spec encontró y yo no había visto:** en el módulo del mensajero ya vive
un chat flotante (`ChatFlotante.tsx`) y el layout le reserva `pb-12`. **Dos burbujas en la misma
esquina de un teléfono es peor que lo de hoy**, y ahí trabajan 18 de los 37 usuarios. Esto lo resuelve
el `/design`, no la implementación.

## Q4 — `/configuracion/sinpe` + `adminSatelite` → **se queda sin «?»**

Es el único par (pantalla, rol) del portal sin botón, y es deliberado: ese rol ve **una fila, la
suya**, mientras el documento describe la tabla de las ocho. Enseñárselo sería documentación que le
miente al único rol que no puede comprobarla — y él ya tiene `satelite/mi-bodega.md`.

Consecuencia aceptada: si el asistente vive sólo en el «?», ese rol no lo tiene **en esa pantalla**.
Lo tiene en las otras seis suyas.

## Q5 — persistencia → **la conversación NO se guarda; el «no lo sé» SÍ se cuenta**

La conversación sigue viviendo en el cliente y desaparece al recargar. Nada de texto de usuario en la
base: no hay retención que decidir ni datos de clientes que custodiar.

**Pero la pregunta del spec es buena y no se puede despachar con «ya veremos»:** sin ninguna señal,
nadie sabría nunca si el asistente sirve. La tabla del tope ya existe y ya se escribe una vez por
consulta, así que **una columna entera más** —cuántas veces dijo «no lo sé» ese día— cuesta
prácticamente nada y es la diferencia entre saber y no saber qué documento falta.

Se guarda **el número, nunca el texto**. Es el único bucle de realimentación de toda la pieza.

## Q6 — imágenes → **una por mensaje, hasta 5 MB, y cuenta igual para el tope**

5 MB es el tope que este repo ya usa para la evidencia de gestión (`GESTION_MAX_FILE_BYTES`), así que
no se inventa un número nuevo. Una por mensaje: quien manda tres capturas de la misma pantalla no
está dando más contexto, está gastando tres veces.

Cuenta como una consulta normal: el tope mide preguntas, no bytes.

## Q7 — `ANTHROPIC_API_KEY` → **pendiente del humano, y NO bloquea**

Pedida el 2026-09-17, con los pasos dados. No bloquea ni la implementación ni el merge: toda la pieza
se construye y se verifica contra el doble. Bloquea **sólo** T25 y T26, que son puertas de
despliegue.

---

## Lo que hay que corregir de paso (H4 del spec)

`components/shared/AyudaBoton.tsx:22-29` sigue diciendo que **tres pantallas se quedan sin «?»**
(`/configuracion/sinpe`, `/mi-bodega`, `/ranking/historico`). La ficha 434 les dio documento y su
propio test ya afirma lo contrario. Quien lea el componente creerá que el asistente nace con tres
agujeros que no existen. Va con esta ficha.
