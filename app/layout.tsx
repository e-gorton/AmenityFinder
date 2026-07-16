import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://amenity-finder.e-gorton.workers.dev"),
  title: "Amenity Finder | Local facilities to GeoJSON",
  description:
    "Find mapped UK amenities within 2 km of a point, include the nearest bank and post office, and export QGIS-ready GeoJSON.",
  applicationName: "Amenity Finder",
  openGraph: {
    title: "Amenity Finder",
    description: "2 km. One point. QGIS-ready GeoJSON.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1736,
        height: 909,
        alt: "Amenity Finder map with a two kilometre search radius",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Amenity Finder",
    description: "2 km. One point. QGIS-ready GeoJSON.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
