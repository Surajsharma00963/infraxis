import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Infraxis Console — Universal CI/CD Platform",
  description:
    "Self-hosted engineering platform to build, test, and deliver software across mobile, web, desktop, and backend. Infrastructure for every release.",
  icons: {
    icon: "/assets/images/Infraxis.png",
    shortcut: "/assets/images/Infraxis.png",
    apple: "/assets/images/Infraxis.png",
  },
};

import { ThemeProvider } from "../context/ThemeContext";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("infraxis_theme");if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");document.documentElement.setAttribute("data-theme","light");}else{document.documentElement.classList.add("dark");document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className="min-h-full flex flex-col bg-slate-50 text-slate-900 dark:bg-[#070c18] dark:text-slate-100 selection:bg-blue-600 selection:text-white transition-colors duration-200"
        suppressHydrationWarning
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
