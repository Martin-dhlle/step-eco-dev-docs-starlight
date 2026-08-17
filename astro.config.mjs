// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://docs.dev.step.eco",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Serveur de développement step.eco",
      social: [
        {
          icon: "github",
          label: "GitHub Studio",
          href: "https://github.com/StudioFabrique",
        },
      ],
      sidebar: [
        {
          label: "Configuration du serveur",
          items: [{ autogenerate: { directory: "0-server-config" } }],
        },
      ],
    }),
  ],
});
