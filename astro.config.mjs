// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://docs.dev.step.eco",
  integrations: [
    starlight({
      title: "Serveur de développement step.eco",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/withastro/starlight",
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
