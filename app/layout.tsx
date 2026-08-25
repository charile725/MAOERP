import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import MainLayout from "@/components/MainLayout";
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
  title: "毛先生ERP",
  description: "簡單好用的 ERP 系統",
  icons: {
    icon: '/maosir-icon-192.png',
    apple: '/maosir-apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '毛先生ERP',
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
            <MainLayout>
              {children}
            </MainLayout>
          </GlobalSplashScreen>
        </SWRProvider>
      </body>
    </html>
  );
}
