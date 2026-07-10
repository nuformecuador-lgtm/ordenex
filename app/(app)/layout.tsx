import type { ReactNode } from "react";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </ToastProvider>
  );
}
