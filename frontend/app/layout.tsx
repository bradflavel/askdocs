import type { Metadata } from "next";
import "./globals.css";
import { AuthBouncer } from "@/components/auth-bouncer";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "AskDocs",
  description: "RAG-powered document Q&A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <ToastProvider>
          <AuthBouncer />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
