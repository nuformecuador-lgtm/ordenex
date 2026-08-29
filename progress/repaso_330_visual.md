# Repaso a mano — Ficha 330 · las cuatro features de interfaz del 28 de agosto

- **Fecha:** 2026-08-29 · app levantada en local (`next dev`), navegador real, base local
- **Árbol repasado:** `origin/dev` **más** la rama de la 327, para ver todo junto
- **Roles:** `admin` (órdenes, columnas) y `adminTienda` (novedades)

> Por qué existe este documento: en este repo un repaso visual de minutos ya encontró **siete textos
> rotos que 12.000 tests daban por buenos**. Un test comprueba lo que alguien pensó en comprobar; la
> pantalla enseña lo que nadie pensó.

## Lo que se comprobó y está bien

**El selector de columnas (ficha 314) funciona.** Se abre como «Columnas del archivo», ofrece las
**22 casillas** del catálogo —contadas dentro del popover, no en la página— y **se alcanza la
última**: el popover mide 392 px y tiene desplazamiento interno propio. Se ven las columnas nuevas
(«Teléfono del destinatario», «Peso (kg)», «Dirección»), las flechas de reordenar y «Restablecer».

**El buscador de `/ordenes`** dice «Guía, remisión, teléfono, destinatario o producto» — coincide con
lo que la ficha 325 declaró como identidad de la orden.

**Ni «SLA» ni la sigla aparecen** en ninguna de las pantallas repasadas.

**`/novedades` responde 404 al rol `admin`, y es correcto:** es pantalla de tienda, y ni siquiera
aparece en su menú lateral. Como tienda carga bien, con sus tres pestañas.

**La barra de búsqueda oculta con la lista vacía es DELIBERADO**, no un fallo:
`items.length === 0 && !filtro.barraEnUso`. No se ofrece un buscador para cero elementos, y en cuanto
se usa el filtro la barra se queda. Verificado en el código tras verlo en pantalla.

## ⚠️ Hallazgo: el voseo y el tuteo conviven, y lo de ayer añadió más

La deuda estaba **declarada** por la 312 y el repaso la confirma **y la amplía**: no es un caso
suelto, son cuatro archivos de la misma pantalla, y **el componente nuevo de la ficha 325 usa
voseo**.

| Archivo | Texto | Forma |
| --- | --- | --- |
| `NovedadesFiltrosBarra.tsx:39` *(nuevo, ficha 325)* | «**Tenés** … **Descargá** el listado y **buscá** en el archivo» | voseo |
| `novedad-grupo-textos.ts:82` | «Cuando un mensajero necesite que **resuelvas** … aparecerá **acá**» | tuteo + acá |
| `RechazosSlaModule.tsx:42` | «aparecerá **acá**» | acá |
| `GestionarDesdeAyudaModal.tsx:205` | «lo que sí **podés** registrar desde **acá**» | voseo |

En la misma pantalla, y a veces en la misma frase. **El usuario ve las dos formas sin salir de la
vista.** No lo caza ningún test porque cada texto es correcto por separado: lo que falla es la
convivencia, y eso solo se ve mirando.

Queda como **ficha propia**: elegir una forma y aplicarla, que es decisión de producto y no del
implementador que pasaba por ahí.

## Lo que NO se pudo comprobar, dicho como límite y no como veredicto

**El modal de corregir datos no se abrió.** El disparador no está en un menú de la fila —la primera
fila solo tiene dos botones— sino, previsiblemente, en la barra de acciones que aparece al
seleccionar, como en «eliminar orden». **No es un defecto probado: es alcance que este repaso no
cubrió.**

Con ello quedan sin ver a mano: los cinco campos nuevos del modal (312 y 327), los tres selectores
encadenados, el aviso de la etiqueta impresa y **el aviso del importe antes de guardar**, que es la
pantalla donde se confirma un cambio de dinero y la que más merece un vistazo humano.

**Tampoco se vio el buscador de novedades con datos**: la tienda de pruebas local no tiene órdenes,
así que solo se comprobó el estado vacío. El vacío **filtrado** —el que debe decir «ninguna coincide
con lo que buscaste» en vez de «no tienes órdenes»— no se pudo provocar.

## Método, para quien repita esto

- Login en `/login`; el formulario es de **React**: un `fill` antes de la hidratación deja el estado
  vacío y el envío va en blanco con «correo inválido». Hay que escribir tecla a tecla y **confirmar
  el valor** antes de enviar.
- Las credenciales de los e2e (`maestro@example.com`) **no están sembradas** en local. Sí funcionan
  las de `scripts/seed-usuarios-qa.ts` — que **no siembra el maestro**, tiene su propio script.
- El paquete instalado es `@playwright/test`, no `playwright`.
