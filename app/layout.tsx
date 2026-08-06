import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ViewportFix } from "@/components/layout/ViewportFix";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Core Chat",
  description: "A personal AI assistant — Gemini-style chat UI.",
  // iOS ignores the manifest's `display: standalone`; it needs these. Without
  // them "Add to Home Screen" still opens inside Safari chrome.
  appleWebApp: {
    capable: true,
    title: "Core Chat",
    // "default" would leave a light status bar over the dark header. "black-translucent"
    // lets the app paint under the status bar, which the safe-area insets already
    // account for (viewportFit: "cover" below).
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Stops iOS turning dates and numbers in assistant replies into blue tap-to-call
    // and tap-to-add links, which it does aggressively in chat text.
    telephone: false,
    date: false,
    address: false,
  },
};

// `viewportFit: "cover"` is what makes env(safe-area-inset-*) non-zero on a
// notched iPhone; without it the insets read as 0 and the composer renders under
// the home indicator. maximumScale is deliberately NOT set — capping it blocks
// pinch-zoom, which is an accessibility regression, and the inputs are already
// 16px so iOS has no reason to auto-zoom on focus.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">
        <ViewportFix />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthGuard>{children}</AuthGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
