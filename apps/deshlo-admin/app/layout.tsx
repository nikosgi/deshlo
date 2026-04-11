import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deshlo Dashboard",
  description: "Client dashboard for Deshlo onboarding and API keys",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
