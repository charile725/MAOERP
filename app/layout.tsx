import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import GlobalSplashScreen from "@/components/GlobalSplashScreen";
import DisableNumberInputScroll from "@/components/DisableNumberInputScroll";
import SWRProvider from "@/components/SWRProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "瘋玩ERP",
  description: "簡單好用的 ERP 系統",
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '瘋玩ERP',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DisableNumberInputScroll />
        <SWRProvider>
          <GlobalSplashScreen showOnEveryVisit={true}>
            <Navigation />
            {children}
          </GlobalSplashScreen>
        </SWRProvider>
      </body>
    </html>
  );
}
