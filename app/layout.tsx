import type { Metadata } from "next";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RemotePlayListener } from "@/components/remote-play-listener";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Relay",
  description:
    "Browse, stream, and download files from your TorBox cloud storage. Self-hosted, secure, and fast.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=localStorage.getItem("relay-accent");if(!h)return;var m=h.trim().replace(/^#/,"");var hex;if(/^[0-9a-fA-F]{3}$/.test(m)){hex="#"+m[0]+m[0]+m[1]+m[1]+m[2]+m[2]}else if(/^[0-9a-fA-F]{6}$/.test(m)){hex="#"+m}else{return}function f(c){return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)}var r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;var y=0.2126*f(r)+0.7152*f(g)+0.0722*f(b);var fg=y>0.4?"oklch(0.2 0.02 250)":"oklch(0.98 0.01 70)";var st=document.documentElement.style;st.setProperty("--primary",hex);st.setProperty("--ring",hex);st.setProperty("--primary-foreground",fg)}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200}>
            {children}
          </TooltipProvider>
          <RemotePlayListener />
          <Toaster
            theme="system"
            position="bottom-right"
            richColors
            closeButton
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
