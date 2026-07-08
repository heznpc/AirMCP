import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://heznpc.github.io",
  base: "/AirMCP/docs",
  outDir: "./dist",
  integrations: [
    starlight({
      title: "AirMCP Docs",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/heznpc/AirMCP",
        },
      ],
      defaultLocale: "en",
      locales: {
        en: { label: "English", lang: "en" },
        ko: { label: "한국어", lang: "ko" },
      },
      sidebar: [
        { label: "Getting Started", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "Modules", items: [{ autogenerate: { directory: "modules" } }] },
        { label: "Architecture", items: [{ autogenerate: { directory: "architecture" } }] },
        { label: "Contributing", items: [{ autogenerate: { directory: "contributing" } }] },
      ],
    }),
  ],
});
