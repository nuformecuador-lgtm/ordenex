# Feature 170 — Descarga a Excel en todas las tablas · requirements

> Notación EARS estricta. Cada `R<n>` debe terminar mapeado a un test concreto (ver
> `tasks.md § Trazabilidad`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **Pedido del humano (2026-07-31):** «toda tabla debe poderse descargar sus datos en un
> excel, y veo que hay muchas tablas que aún no tienen esta funcionalidad».
>
> **Hallazgo que origina la feature (verificado contra el código, ver `design.md §1`):** la
> capacidad ya existe y está bien hecha —la feature **151** la construyó como prop opt-in
> del `DataTable`, con acceso al dataset completo **sin paginación** y **server-side**—,
> pero de las **25 tablas dentro de alcance solo 1 la activa** (el listado de órdenes).
> Esta feature es el ROLLOUT a las **24 restantes**. No reabre ninguna decisión de la 151.

---

## Glosario

- **Listado**: superficie que presenta un conjunto de registros en forma de tabla.
- **Dataset completo**: todas las filas que corresponden a los filtros vigentes de un
  listado **para el actor autenticado**, sin recorte por página.
- **Familia A**: listado cuya página visible es un RECORTE server-side del dataset (el
  servidor pagina).
- **Familia B**: listado que ya recibe su dataset completo (no hay paginación server-side);
  la página visible ES el dataset.
- **Columna de export**: declaración `{clave, encabezado}` cuyo valor de celda es CRUDO
  (texto, número o vacío).
- **Tope (N)**: número máximo de filas que una descarga puede producir.
- **Campo prohibido**: dato que NUNCA puede aparecer en un archivo descargado (§D).

---

## A. Alcance del rollout

**R1** — El sistema DEBE ofrecer un control de descarga en CADA UNO de los listados
declarados dentro de alcance en el Anexo I.

**R2** — DONDE un listado esté declarado FUERA de alcance en el Anexo II, el sistema NO
DEBE renderizar en él control de descarga alguno.

**R3** — El sistema DEBE conservar sin cambios el comportamiento previo de cada listado al
añadirle la descarga: mismos datos, misma paginación, mismos filtros, mismas acciones y
mismo estado vacío.

**R4** — CUANDO se añada un listado tabular nuevo a la aplicación, el sistema DEBE fallar
una comprobación automatizada si ese listado no declara descarga ni queda registrado como
exclusión justificada.

## B. Contrato de export por listado

**R5** — Cada listado con descarga DEBE declarar sus columnas de export ENUMERADAS UNA A
UNA, independientes de las columnas visibles de la tabla.

**R6** — SI el conjunto de datos de origen de un listado gana un campo nuevo, ENTONCES el
archivo NO DEBE emitir ese campo mientras no se declare explícitamente como columna de
export.

**R7** — El sistema DEBE emitir en toda celda un valor CRUDO (texto, número o celda vacía);
NINGÚN archivo DEBE contener elementos de interfaz (insignias, botones, iconos) ni
representaciones de objeto.

**R8** — El sistema DEBE emitir los identificadores de entidades relacionadas como su
NOMBRE legible, no como su identificador interno.

**R9** — El archivo de un listado DEBE contener una fila por elemento del dataset completo,
y no solo por elemento de la página visible.

**R10** — CUANDO cambien los filtros de un listado, la siguiente descarga DEBE reflejar los
filtros vigentes en el momento de pulsar el control, incluidos los filtros que se resuelven
en el cliente.

**R11** — El sistema DEBE emitir las filas del archivo en el MISMO orden en que el listado
las presenta para esos mismos parámetros.

**R12** — El nombre del archivo descargado DEBE identificar el listado de origen y la fecha
de la descarga.

**R13** — El control de descarga de cada listado DEBE exponer un nombre accesible que
identifique el listado al que pertenece.

## C. Alcance por rol en la exportación

**R14** — MIENTRAS el actor tenga un rol acotado, el archivo DEBE contener EXACTAMENTE el
mismo subconjunto de filas que ese listado le muestra con los mismos filtros; NUNCA una
fila que el listado no le mostraría.

**R15** — El sistema NO DEBE permitir que un valor de filtro amplíe el alcance del rol: el
acotamiento por rol DEBE prevalecer sobre cualquier filtro recibido.

**R16** — SI la petición del dataset completo llega sin sesión válida, ENTONCES el sistema
DEBE responder «no autenticado» y NO DEBE devolver fila alguna.

**R17** — SI el rol del actor no está autorizado a ver ese listado, ENTONCES el sistema DEBE
responder «prohibido» y NO DEBE devolver fila alguna.

**R18** — SI la petición del dataset completo incluye una clave de filtro que no pertenece a
la lista blanca de ese listado, ENTONCES el sistema DEBE responder error de validación y NO
DEBE devolver fila alguna.

**R19** — El sistema DEBE excluir del archivo las mismas filas que el listado excluye por
borrado lógico o por estado.

**R20** — El acotamiento por rol DEBE verificarse LISTADO POR LISTADO; una verificación
genérica del mecanismo NO satisface este requisito.

## D. Datos sensibles

**R21** — El sistema NUNCA DEBE emitir en un archivo descargado: hashes de credenciales,
contraseñas, claves de API en claro, secretos de webhook, ni códigos o tokens de un solo
uso.

**R22** — El sistema NO DEBE emitir rutas de almacenamiento ni URL firmadas de evidencia
fotográfica.

**R23** — El sistema NO DEBE emitir identificadores internos de registro, salvo cuando ese
identificador ES el identificador de negocio que el listado ya muestra al actor.

**R24** — El sistema NO DEBE emitir en el archivo ningún campo que el listado no muestre a
ese actor en pantalla.

**R25** — El sistema DEBE verificar la ausencia de campos prohibidos con una comprobación
automatizada que se aplique a TODAS las declaraciones de columnas de export, presentes y
futuras.

## E. Volumen

**R26** — El sistema DEBE aplicar un tope máximo de filas `N` a TODA descarga de la
aplicación, configurable por entorno y ÚNICO para todos los listados.

**R27** — SI el dataset completo de un listado supera `N` filas, ENTONCES el sistema NO DEBE
producir archivo y DEBE devolver un error accionable que indique el total encontrado, el
tope vigente y qué hacer para acotarlo.

**R28** — El sistema NUNCA DEBE entregar un archivo con el dataset truncado en silencio:
todo archivo entregado contiene el dataset completo pedido.

**R29** — MIENTRAS el listado sea de Familia A, el sistema DEBE aplicar el tope en el
SERVIDOR y, cuando lo supere, NO DEBE materializar ni transportar más de `N + 1` filas.

**R30** — MIENTRAS el listado sea de Familia B, la descarga NO DEBE ejecutar una segunda
lectura del origen de datos: DEBE construirse sobre el dataset que la pantalla ya tiene.

**R31** — SI el dataset completo tiene cero filas, ENTONCES el sistema NO DEBE producir
archivo y DEBE informar que no hay datos que descargar.

**R32** — El sistema NO DEBE aumentar el número de consultas que un listado ejecuta mientras
el usuario no pulse el control de descarga.

## F. Consistencia de la experiencia

**R33** — El sistema DEBE producir el contenido de TODA descarga con la única función común
ya existente; NINGÚN listado DEBE construir el contenido de su archivo por su cuenta.

**R34** — El sistema DEBE producir un archivo `xlsx` cuando el listado no declare otro tipo.

**R35** — MIENTRAS una descarga esté en curso, el control DEBE indicar el estado de carga y
NO DEBE admitir una segunda ejecución simultánea.

**R36** — SI la obtención de filas falla, ENTONCES el sistema DEBE mostrar un mensaje
accionable, ese mensaje NO DEBE contener datos personales, y NO DEBE entregarse archivo
alguno.

**R37** — CUANDO se ejecute una descarga, el sistema NO DEBE alterar la página actual, la
selección de filas ni los datos visibles del listado.

**R38** — El archivo generado NO DEBE subirse a ningún servidor ni almacenarse fuera del
equipo del usuario.

## G. Entrega por tandas

**R39** — MIENTRAS el rollout esté incompleto, el sistema DEBE seguir funcionando: los
listados ya cableados descargan y los aún no cableados se comportan exactamente como antes.

---

## Anexo I — Listados DENTRO de alcance (25)

Un `R1` por fila: cada listado debe ofrecer descarga. La ruta del archivo y la fuente de
datos de cada uno están en `design.md §1` (censo verificado contra el código).

| # | Listado | Rol que lo ve | Familia |
| --- | --- | --- | --- |
| 1 | Órdenes (listado principal) | maestro · admin · adminTienda | A — **ya cableado (151)** |
| 2 | Apartado de órdenes por estado (revisión del maestro) | maestro · admin | A |
| 3 | Órdenes de la bodega satélite | adminSatelite | B |
| 4 | Usuarios | maestro | A |
| 5 | Plantillas de mensaje | maestro | A |
| 6 | API keys | maestro | A |
| 7 | Libro de movimientos de la caja principal | maestro · admin | A |
| 8 | Desglose de pagos por cierre de un mensajero | maestro · admin | A |
| 9 | Desglose de movimientos de la tienda (mi wallet) | adminTienda | A |
| 10 | Desglose de pagos del mensajero (mis pagos) | mensajero | A |
| 11 | Plantillas de gasto fijo | maestro · admin | B |
| 12 | Saldos de tiendas | maestro · admin | B |
| 13 | Cuentas por pagar a mensajeros | maestro · admin | B |
| 14 | Cierres del día pendientes de decisión | maestro · admin · adminSatelite | B |
| 15 | Cierres del día — histórico | maestro · admin · adminSatelite | B |
| 16 | Cierres de bodega pendientes | maestro · admin | B |
| 17 | Cierres de bodega resueltos | maestro · admin | B |
| 18 | Cierres del día a consolidar | adminSatelite | B |
| 19 | Cierres de bodega solicitados (histórico de la zona) | adminSatelite | B |
| 20 | Gestiones de un cierre por resultado (detalle del admin) | maestro · admin · adminSatelite | B |
| 21 | Gestiones del cierre del día por resultado (mensajero) | mensajero | B |
| 22 | Cierres solicitados por el mensajero | mensajero | B |
| 23 | Incidentes pendientes de decisión | maestro · admin · adminSatelite | B |
| 24 | Incidentes — histórico | maestro · admin · adminSatelite | B |
| 25 | Ranking del día | maestro · admin · mensajero | B |

## Anexo II — Listados FUERA de alcance (6) y por qué

| Listado | Motivo de la exclusión |
| --- | --- |
| Zonas (módulo de configuración) | **No está montado en ninguna página**: `ConfiguracionPage` dejó de renderizarlo. Cablear una tabla que ningún usuario ve no entrega valor. Ver P4. |
| Órdenes por numerar (modal «Generar guía») | Confirmación efímera de un lote todavía no cometido; el MISMO modal ya entrega el manifiesto `xlsx` del lote en su paso siguiente (feature 148). |
| Resumen de carga masiva | Ya ofrece la descarga del manifiesto `xlsx` del lote recién creado (feature 148). |
| Órdenes con error (previsualización de carga masiva) | Ya tiene su propia descarga `xlsx` de filas con error (feature 143). |
| Órdenes ya existentes (previsualización de carga masiva) | Paso de un asistente sobre un archivo que el usuario acaba de subir y que aún no está cometido; no aporta ningún dato que el usuario no tenga ya en su propio archivo. Ver P3. |
| Premios del podio (ranking) | No está construida sobre la tabla genérica sino como HTML crudo, y son 3 filas de CONFIGURACIÓN, no un listado de datos. Cablearla exigiría migrarla primero. Ver P1. |

---

## Fuera de alcance (explícito)

- **Búsqueda y filtros nuevos** en esas 24 tablas: son la feature 145 (que a su vez depende
  de la 144/169). Esta feature NO añade ni un filtro; se limita a exportar el dataset con
  los filtros que cada listado YA tiene.
- **Reabrir cualquier decisión de la 151**: función común, generación del binario en el
  navegador, ausencia de route handler interno, prop opt-in, columnas declaradas aparte y
  tope duro con error explícito quedan tal cual.
- **Paginar los listados de Familia B**: hoy leen su dataset entero sin paginación y eso es
  PREVIO a esta feature. Ver P6.
- **Descargas asíncronas** (encolar, generar en background, notificar por correo) para
  datasets por encima del tope.
- **Selección de columnas por el usuario** en tiempo de ejecución.
- **Formatos distintos de `xlsx` y `csv`.**

---

## Preguntas abiertas (para la puerta de aprobación humana)

**P1 — Premios del podio del ranking.** Es una `<table>` HTML cruda de 3 filas con montos
editables, no un `DataTable`. Queda FUERA por eso. ¿Se acepta, o se quiere migrarla a la
tabla genérica dentro de esta feature para poder descargarla?

**P2 — Detalle de un cierre: ¿un control por sección o uno por cierre?** El detalle
renderiza hasta CUATRO tablas (entregadas / reprogramadas / devueltas / rechazadas) dentro
de un modal. El diseño propone una descarga POR SECCIÓN, porque es lo que el contrato de la
151 permite sin infraestructura nueva (el control vive DENTRO del `DataTable`, gate P4 de
la 151). La alternativa —un solo archivo del cierre con una columna «Resultado»— exige
sacar el control fuera de la tabla y contradice ese gate. Se pide decisión.

**P3 — Las tres tablas del asistente de carga masiva.** Quedan fuera porque ese flujo ya
tiene DOS descargas (errores por la 143, manifiesto por la 148) y añadir tres controles más
en el mismo modal multiplica botones sin dato nuevo. ¿Se confirma la exclusión?

**P4 — Módulo de zonas huérfano.** `ZonasModule` existe, tiene tests y NO está montado en
ninguna página. Queda fuera del rollout. ¿Se borra (ticket aparte), se vuelve a montar, o se
deja como está?

**P5 — ¿Un tope único o un tope por tabla?** El diseño propone mantener el tope ÚNICO ya
existente (`DESCARGA_MAX_FILAS`, 5000, fijado en el gate de la 151) para las 25 tablas: una
sola regla, un solo mensaje, un solo test. La alternativa es un tope por tabla, que multiplica
la configuración. Se pide ratificación.

**P6 — Riesgo heredado de Familia B.** Dieciséis de los listados dentro de alcance leen HOY
su dataset entero sin paginación (por props desde el Server Component). Esta feature NO
empeora ese riesgo (R30: la descarga no relee) pero tampoco lo arregla. ¿Se acepta y se
registra como ticket aparte, o se quiere paginarlos dentro de esta feature?

**P7 — ¿`xlsx` solamente, o también `csv`?** El pedido dice «excel». El listado de órdenes
descarga solo `xlsx` hoy. El diseño propone `xlsx` para las 24, sin menú de formato. ¿Se
confirma?

**P8 — Permisos de descarga.** La 151 cerró (su P5) que quien ve un listado puede descargar
lo que ese listado ya le muestra, sin permiso nuevo. Con el rollout eso alcanza a los datos
de dinero (saldos de tiendas, cuentas por pagar, libro de la caja) y a la lista de usuarios.
Todas esas pantallas ya están acotadas por rol server-side, así que la descarga no añade
alcance. ¿Se ratifica «sin permiso nuevo» para las 24, o alguna tabla debe restringir la
descarga a un rol más estrecho que el que puede verla?
