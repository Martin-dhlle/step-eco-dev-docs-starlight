// @ts-check
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://docs.dev.step.eco",
  trailingSlash: "always",
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
    }),
    starlight({
      title: "Docs dev.step.eco",
      social: [
        {
          icon: "github",
          label: "GitHub Studio",
          href: "https://github.com/StudioFabrique",
        },
      ],
      sidebar: [
        {
          label: "Suivi de la documentation",
          slug: "suivi-documentation",
        },
        {
          label: "Configuration du serveur",
          items: [{ autogenerate: { directory: "0-server-config" } }],
        },
        {
          label: "Publication d’une application",
          items: [{ autogenerate: { directory: "1-publication-application" } }],
        },
      ],
    }),
  ],
});
