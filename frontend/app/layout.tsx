import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { AuthBouncer } from "@/components/auth-bouncer";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "AskDocs",
  description: "RAG-powered document Q&A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            <AuthBouncer />
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
