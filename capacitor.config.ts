import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cav.photostudio",
  appName: "CAV Photo Studio and Cafe",
  webDir: "frontend/build",
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;
