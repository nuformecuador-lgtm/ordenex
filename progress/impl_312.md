# Implementación — Feature 312 · corregir los datos del cliente de una orden

- **Rama:** `feature/312-corregir-datos-cliente`
- **Commits:** `ea008013` (spec), `272e49e7` (spec revisado), `225595a9` (backend), `7455ea16` (frontend)
- **Fecha:** 2026-08-28
- **Gate:** `./init.sh` **completo**, `INIT_EXIT=0`. 21.134 verdes / 26 skipped. Tres archivos rojos,
  **los tres del baseline** (`superficie-de-uso` → `obtenerTarifa` de la ficha 275,
  `usuario-descarga`, `usuarios-filtro-busqueda`). **Delta de la feature: cero.**
  El modo `--rapido` **no aplica** aquí y se niega solo: el módulo de tipos vive en `lib/types/**`.
  El `design.md` §2.1 afirmaba lo contrario razonando «no hay migraciones»; el razonamiento es
  correcto pero incompleto, y queda corregido aquí.

## La decisión que define esta feature

**Corregir no deja rastro.** Ni nota en el hilo, ni tabla de auditoría, ni fila en
`orden_historial_estado`. El único rastro es `updated_at`. Es decisión humana del 2026-08-28, con
sus palabras: «no veo necesario avisar que se corrigió un dato».

**Lo que se pierde, dicho aquí y no escondido:** no se puede saber quién corrigió qué, ni cuál era
el valor anterior. La nota automática queda registrada en `design.md` §8/B como **alternativa
evaluada y descartada**, con sus costes, para que nadie la reintroduzca creyendo que fue un olvido.

Y por eso el requisito **R14 se generalizó**: no dice «no escribe el historial de estados», dice
**«no escribe en ninguna otra tabla»**. Es lo que convierte la ausencia de rastro en algo *medible*
por un test en vez de una promesa.

## Mapa R → test

| Req | Test |
| --- | --- |
| R1, R2, R3, R6 | `tests/unit/types/correccion-datos-cliente-schema.test.ts` · R6 también en `CorregirDatosCliente.ordenes.test.tsx` («producto de 5.000 caracteres») |
| R4 | `tests/unit/services/corregir-datos-cliente-service.test.ts` §R4 |
| R5, R15 | `tests/integration/db/corregir-datos-cliente.repo.test.ts` caso 5 — comparación fila a fila de más de 25 columnas: las diferencias son exactamente los 4 campos más `updatedAt` |
| R7 | `tests/unit/actions/corregir-datos-cliente.action.test.ts` §R7 |
| R8–R11, R24 (servidor) | `tests/unit/types/correccion-datos-cliente.test.ts` y el service |
| R12 | service §R12 (5 causas → el mismo objeto opaco) y repo int. caso 3 |
| R13 | repo int. caso 2 (los 4 estados) y service |
| **R14** | repo int. caso 4 — **conteo real** de `orden_historial_estado` y `orden_nota` — y caso 4bis (chat, gestión, día de reparto), más `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts` con contraprueba |
| R16 | guardia: `console` a secas y PII en textos de rechazo, con contraprueba inyectada |
| R17 | repo int. G3: un teléfono con espacios alrededor entra recortado, **no** canonizado a formato internacional |
| R18 | service §R18 |
| R19–R21 | `tests/integration/db/corregir-datos-cliente.chat.test.ts`, con anti-vacuidad: antes de corregir, el número viejo **sí** resolvía |
| R22, R24 (UI) | `CorregirDatosCliente.ordenes.test.tsx` — «no renderiza NADA» en los 4 estados y sin `estatusValue` |
| R23 | `CorregirDatosCliente.novedades.test.tsx` (las dos pestañas), `novedad-acciones-catalogo.test.ts` («UNA sola clave») y las dos guardias |
| R25 | action test y service §R25 |
| R26 | los dos archivos de componente |
| R27 | ordenes (con y sin guía, sin botón de reimprimir) y novedades |
| R28 | ordenes (teléfono tocado / otro campo tocado) |
| R29 | ordenes (predicado de la key SWR ejercido) y novedades (relectura por pestaña) |
| R30 | ordenes (`forbidden` opaco sin el identificador en el DOM, `validation_error` junto al campo, `conflict`) y novedades |

## Mutaciones — 9 lanzadas, 9 muertas

**Backend.** Arnés con autocomprobación: exige BASE verde, exige la línea de resumen de vitest,
restaura y re-verifica. BASE 118 → RESTAURADO 118.

| # | Mutación | Rojos |
| --- | --- | --- |
| M1 | el schema del borde admite `estatusId` y `direccion` | 2 |
| M2 | `CorregirDatosClienteData` admite `estatusId`/`direccion` | 1 |
| M3 | la ventana pierde los 3 terminales | 6 |
| M4 | el `WHERE` pierde el `notIn` | 5 |
| M5 | el `WHERE` pierde el `deletedAt: null` | 1 |
| M6 | un rol ajeno puede corregir | 8 |
| M7 | el `updateMany` deja de escribir `telefonoDest` | 4 |

**Frontend.** Ofrecer la corrección en un estado bloqueado → **5 rojos**. Pintar el aviso de etiqueta
siempre → **2 rojos**; la primera medición dio **1**, y se añadió el caso «sin guía» también en
`/novedades` antes de darla por muerta.

## Cinco cosas que no cuadraban con el spec — reportadas, no adaptadas

1. **`design.md` §2.1 se equivoca sobre el gate** (arriba). El razonamiento «no hay migración» es
   correcto pero incompleto: la negativa la dispara `lib/types/**`.
2. **El spec no nombraba el método de LECTURA** que el servicio necesita. Se usó el `findById` que ya
   existe en vez de añadir superficie nueva: su `WHERE` lleva `deletedAt: null`, así que «no existe» y
   «borrada» llegan indistinguibles — que es exactamente la opacidad de R12, gratis.
3. **La validación de zod corre ANTES del recorte**, así que un campo de solo espacios pasaba el
   schema y habría dejado la orden sin destinatario. Se cierra en el servicio, con 3 casos de test.
   No tiene `R<n>` propio: sale de §10 del design.
4. **La garantía anti-carrera de R13 es total para la ventana terminal y PARCIAL para el
   `adminTienda`:** el `estadosBloqueados` del repositorio es una lista negativa y la regla de la
   tienda es positiva. Una orden suya que cambiara de estado entre la lectura y la escritura colaría.
   Microsegundos, y el peor desenlace es corregir un nombre. Está en el comentario del paso 6, no
   escondido.
5. **`orden.busqueda_texto` es una columna GENERADA** que incluye destinatario, teléfono y producto:
   Postgres la recalcula sola al corregir. No es una escritura de la ficha y el cliente la omite
   globalmente, por eso no aparece en la comparación fila a fila de R5.

## Una desviación de forma, y su porqué

El `design.md` §9.3 quiere que el modal llame a la Server Action y que viva en `ordenes/_components`.
La guardia `novedad-acciones-sin-maqueta` exige que un archivo **de `app/(app)/novedades/`** importe
**y llame** al productor declarado — el frente se endureció el 2026-08-20 y ya no basta con importar.
Las dos cosas juntas son imposibles.

Se resolvió como el propio F1 anticipaba: **el modal recibe la acción por prop y cada superficie
enseña su cable**. Es la única desviación respecto de la forma de `EliminarOrdenModal`, y está
documentada en el JSDoc del componente y en la fila nueva del mapa de la guardia.

## Deuda declarada

- **La anotación `@sin-superficie` de la Server Action se borró** al importarla el modal, que es lo
  que exige su propia guardia. Confirmado: no denuncia ni «acción huérfana» ni «anotación que
  sobrevive a su motivo».
- **El censo de la guardia de la ficha creció de 4 a 9 rutas**, con huella de contenido por archivo.
  Los archivos de UI no entran solos: si alguien añade una superficie nueva y no la censa, la guardia
  sigue verde sin vigilarla — que es la peor forma de fallar.
- **G6 (repaso a mano en la app) queda SIN HACER.** Exige levantar el servidor y entrar como
  `maestro` y como `adminTienda`. Lo que conviene mirar: en `/novedades` el módulo usa **voseo**
  («Actualizá») y los textos nuevos usan **tuteo**, que es lo que manda en el repo y lo que usa la
  familia de `eliminar-orden`. Conviven hoy en la misma pantalla.
