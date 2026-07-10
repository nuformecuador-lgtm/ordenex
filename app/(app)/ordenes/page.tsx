import { PageHeader } from "@/components/shared/PageHeader";

import { OrdenesModule } from "./_components/OrdenesModule";

export default function OrdenesPage() {
  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Órdenes" description="Listado y gestión de órdenes" />
      <OrdenesModule />
    </section>
  );
}
