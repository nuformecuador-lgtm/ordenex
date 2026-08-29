# Implementación — Feature 327 · el editor de datos llega a la dirección y la ubicación

- **Rama:** `feature/327-editor-ubicacion` · `8eec9724` (spec), `3aae41c4` (backend), `7e36c82f` (frontend)
- **Fecha:** 2026-08-28 / 29
- **Gate:** `./init.sh` **completo** en las dos bandas, `INIT_EXIT=0`. Backend: 21.701 tests.
  Frontend: 21.695 pasados / 26 saltados. Un solo rojo en ambas, el del baseline
  (`superficie-de-uso` → `obtenerTarifa`, ficha 275). **Delta cero.**

## Qué es

**Fase 2 de la 312.** Aquella dejó editar destinatario, teléfono, producto y notas; la dirección
quedó fuera **por decisión del humano** esa misma mañana, y la reabrió el mismo día con su ejemplo:
«si el cliente puso mal su dirección, debo poder corregir ese dato».

Gana `direccion`, `provinciaId`, `cantonId`, `distritoId` y `peso`. Siguen fuera el monto, la
remisión, la comisión, el estatus, el mensajero, la tienda y la guía. **Sin rastro**, como la 312.

## 💰 El aviso del importe, que es el centro de la ficha

**Lo emite el servidor al intentar guardar, no una pantalla previa.** Si cambia el distrito y no llega
la confirmación, la acción **no escribe nada** y responde con la zona actual, la propuesta y los
importes de cada una. Así es **imposible** guardar sin haberlos visto — una preview aparte sería un
adorno que un cliente hecho a mano se salta.

El disparo es el cambio de **distrito**, no de zona: la marca de zona especial es del distrito y
puede mover el flete **dentro de la misma zona**.

**La UI ramifica por el discriminante `tarifa`, nunca por el importe.** Y el caso que ancla eso no es
el obvio: es una tarifa **resuelta** con comisión `"0.00"` —una orden que no cobra comisión—, que
**sí** debe pintar cero. Sin ese caso, la mutación «decidir por el importe» pasa verde. Medido.

**Una orden ya en un cierre avisa, no bloquea.** Lo facturado está congelado en una fila inmutable
protegida por una guardia que **sigue verde sin tocarla** — eso *es* la prueba del requisito.
Bloquear condenaría a reintentarse con la ubicación equivocada justo a la orden que sigue viva.

## El guard de re-geocodificación: hubo que partirlo en dos

Confirmado en disco lo que el spec avisaba: **no estaba en el camino vivo**. La 312 usa un método
hermano, así que añadir `direccion` al schema **no lo activaba**.

El diseño pedía extraerlo a **un** método compartido. **No cabe, y el motivo importa:** la
pre-lectura de la dirección tiene que quedar **antes** del `UPDATE` y el encolado **después**. Leer
después devuelve la dirección nueva y la comparación diría siempre «no cambió» — que es exactamente
el bug que ese guard existe para impedir. Son dos métodos privados, cada mitad viviendo una sola vez.

Probado **contra Postgres real**: fila en la cola con su clave de deduplicación, payload exactamente
el identificador de la orden, los tres casos que no encolan, y el conflicto dejando cero trabajos.

## Mutaciones — 13 en total, todas cazadas

**Backend (10):** guardar sin confirmación escribe igual → **17 rojos**; el guard no se llama al
cambiar la dirección → **2**; el schema del borde admite la zona → **3**; admite el estatus → **2**;
sin el filtro de la ventana → **12**; la zona sale de la orden en vez del distrito → **4**; tomar la
primera zona en vez de exigir una única → **1**; encolar fuera de la transacción → **1**; invertir la
marca de central en el aviso → **6**; el composition root sin el repositorio de tarifas → **1**.

**Frontend (3):** ramificar por el importe en vez del discriminante → **1**; confirmar siempre → **3**;
el aviso de cierre saliendo siempre → **1**.

La segunda del backend trae un dato: `orden-geocode-enqueue` **siguió verde** con el guard
desactivado. Es la prueba de que esa suite nunca cubrió este camino.

## Cuatro cosas que no cuadraban con el spec

1. **Las pruebas de la 312 que esta ficha pone rojas son CINCO, no cuatro.** La que faltaba tiene un
   `toEqual` literal que **es** el contrato, y **la encontró el gate completo, no una búsqueda de
   texto**. Actualizada con el motivo escrito, sin relajarla a un conteo.
2. **Los comentarios que quedaban mintiendo eran TRES, no dos.** El tercero repetía la frase caducada
   en un test. Los tres reescritos en el mismo commit.
3. **Un requisito no se puede cumplir solo en el schema:** la validación de zod no rechaza una cadena
   de espacios. Se cierra en el servicio, junto a sus tres hermanos, para que «vacío» tenga una sola
   definición.
4. **Dos tareas del spec eran imposibles tal como estaban escritas, y se midió.** Exigían a la vez un
   import y una guardia verde que ese mismo import pone roja. Resuelto pidiendo el catálogo desde la
   ventana con clave compartida — patrón ya vivo en el repo, que sirve a las dos superficies con una
   implementación y no toca ninguna de las dos páginas.

## ⚠️ Decisión pendiente: los céntimos del aviso

El spec dice tres veces que el importe se pinte con el formateador de la casa. **Ese formateador es
la feature 230: el dinero se pinta SIN céntimos, redondeando.** Medido: el servidor manda `2825.40`
y la pantalla muestra `₡2.825`.

**El spec se contradice solo**: la pregunta P4 dice «no se redondean» y a la vez «lo pinta con el
formateador». Se implementó con el formateador de la casa, por tres razones: es la letra del spec;
las únicas dos excepciones declaradas de la 230 son descargas y salidas de máquina, y **crear una
tercera es decisión humana**; y lo contrario obliga a escribir un formateador de dinero propio en la
capa de UI, que es justo lo que la 230 centralizó.

**Queda pendiente de decisión del humano.** Es un cambio de una línea más dos literales de test.

## Deuda declarada

- **G3 (repaso a mano en la app) sin hacer:** exige navegador y dos roles.
- El índice del grafo devolvió **0 nodos** para toda esta familia: es anterior al merge de la 312.
  Ambas bandas trabajaron con lectura directa, y lo declararon.
- **Aviso de proceso que confirma la regla:** la primera corrida del gate del frontend terminó con
  *exit code 0* en el proceso de fondo y **`INIT_EXIT=1` dentro del log**. Sin esa línea dentro del
  log se habría dado por verde un gate rojo.
