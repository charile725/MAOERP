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
    <html lang="zh-TW" className="dark">
      <head>
        {/* 在首次繪製前決定主題，避免預設夜色模式時閃一下白底 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t!=='light';var c=document.documentElement.classList;c.toggle('dark',d);c.toggle('light',!d);}catch(e){}})();`,
          }}
        />
      </head>
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
