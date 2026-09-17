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

## Q3 — el «?» → **abre el panel**. CERRADA por el humano el 2026-09-17: **opción A**

**El mensajero NO lleva burbuja flotante.** El único acceso es el «?» del encabezado, que ya está en
las 32 pantallas. La esquina de abajo a la derecha sigue siendo del chat con el cliente, intacta.

Descartadas con su motivo, para no reabrirlas:

- **B — segunda burbuja abajo-izquierda.** Se descubre sola, pero deja el color como única diferencia
  entre dos botones redondos, con el teléfono al sol y una mano ocupada.
- **C — una burbuja que pregunta a cuál vas.** No añade nada en pantalla, pero **escribirle al cliente
  pasaría de un toque a dos**, y eso se hace decenas de veces al día mientras preguntar es excepcional.

Coste aceptado de la A: el asistente se descubre menos. Vive donde uno ya va a buscar ayuda.

Adopto la propuesta del spec: el «?» del encabezado abre el asistente, y el panel lleva como primera
acción visible **«Leer la ayuda de esta pantalla»** → `/ayuda/<slug>`. No se pierde nada de la 433 y
se gana el asistente en el mismo gesto, sin meter un segundo botón en un encabezado que a 390 px ya
estrangula el título.

Las seis aserciones de `AyudaBoton.test.tsx` y la de `PageHeader.test.tsx` **se mueven a mano**: pasan
de afirmar un `href` a afirmar que el control abre el panel con ese slug como contexto. Son contratos
vivos y se cambian a propósito, no se aflojan.

La colisión que el spec encontró —en el módulo del mensajero ya vive un chat flotante
(`ChatFlotante.tsx`), un círculo de 56 px fijo a 20 px de las esquinas inferior y derecha, y el layout
le reserva `pb-12`— **es justo lo que resuelve la opción A: no se añade ninguna burbuja.**

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

## Q7 — `ANTHROPIC_API_KEY` → **ENTREGADA y probada** el 2026-09-17

Está en `.env`. Comprobada con una llamada real mínima: `claude-sonnet-5` respondió (14 tokens de
entrada, 4 de salida), así que la credencial vale, el nombre del modelo existe y la cuenta tiene
saldo.

**NO está en Vercel**, a propósito: allí sólo hace falta para T25/T26 (una consulta real por rol sobre
el despliegue), que son puertas de **despliegue**, no de merge. Cuando toque va a Preview y a
Production **por separado** — nunca una sola variable marcada en los dos entornos.

---

## Lo que hay que corregir de paso (H4 del spec)

`components/shared/AyudaBoton.tsx:22-29` sigue diciendo que **tres pantallas se quedan sin «?»**
(`/configuracion/sinpe`, `/mi-bodega`, `/ranking/historico`). La ficha 434 les dio documento y su
propio test ya afirma lo contrario. Quien lea el componente creerá que el asistente nace con tres
agujeros que no existen. Va con esta ficha.
